import 'server-only';

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  X509Certificate,
} from 'node:crypto';
import * as asn1js from 'asn1js';
import { getAppSessionHashSecret } from '@/lib/server/app-auth/constants';
import { issueAppSession, validateAppSession } from '@/lib/server/app-auth/session';
import { fromBase64Url, randomToken, sha256Hex } from '@/lib/server/app-auth/jwt';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashInventoryKioskDeviceToken } from '@/lib/server/inventory-kiosk-devices';

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const REQUEST_CLOCK_SKEW_MS = 2 * 60 * 1000;
const REQUEST_PROOF_RETENTION_MS = 5 * 60 * 1000;
const ANDROID_KEY_ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17';
const ANDROID_KEYSTORE_PACKAGE = 'com.squiresapp.yardkiosk';
const AUTH_DOMAIN = 'AVS-YARD-KIOSK-AUTH-V1';
const REQUEST_DOMAIN = 'AVS-YARD-KIOSK-REQUEST-V1';
const ANDROID_ATTESTATION_STATUS_URL =
  'https://android.googleapis.com/attestation/status';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type ChallengePurpose = 'android_enrollment' | 'android_authentication';
type HardwareIdentityKind = 'browser_cookie' | 'android_keystore';

interface ChallengeRow {
  id: string;
  purpose: ChallengePurpose;
  pairing_session_id: string | null;
  device_id: string | null;
  challenge_hash: string;
  expires_at: string;
  consumed_at: string | null;
}

interface PairingHardwareRow {
  id: string;
  pairing_token_hash: string | null;
  status: string;
  expires_at: string;
  candidate_identity_kind: 'android_keystore' | null;
  candidate_hardware_public_key_spki: string | null;
  candidate_hardware_key_fingerprint: string | null;
}

export interface HardwareDeviceRow {
  id: string;
  kiosk_user_id: string;
  pairing_session_id: string | null;
  revoked_at: string | null;
  hardware_identity_kind: HardwareIdentityKind;
  hardware_public_key_spki: string | null;
}

interface AsnNode {
  idBlock?: {
    tagClass?: number;
    tagNumber?: number;
  };
  valueBlock?: {
    value?: AsnNode[] | boolean;
    valueDec?: number;
    valueHexView?: Uint8Array;
    toString?: () => string;
  };
}

export interface InventoryKioskChallenge {
  challenge_id: string;
  challenge: string;
  expires_at: string;
}

export type InventoryKioskEnrollmentChallenge =
  | ({ enrolled: false } & InventoryKioskChallenge)
  | { enrolled: true };

export interface AndroidAttestationInput {
  publicKeySpki: string;
  certificateChain: string[];
  challenge: string;
}

export interface AndroidAttestationSummary {
  security_level: 'tee' | 'strongbox';
  attestation_version: number;
  keymaster_version: number;
  package_name: string;
  signing_certificate_sha256: string;
  verified_boot: true;
  device_locked: true;
  root_certificate_sha256: string;
}

export interface InventoryKioskRequestProofResult {
  sessionValidation: Awaited<ReturnType<typeof validateAppSession>>;
  device: HardwareDeviceRow | null;
  hardwareProofRequired: boolean;
}

export class InventoryKioskHardwareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'InventoryKioskHardwareError';
  }
}

function decodeBase64(value: string, field: string): Buffer {
  if (!value || value.length > 16_384) {
    throw new InventoryKioskHardwareError(`Invalid ${field}`, 400, 'HARDWARE_INPUT_INVALID');
  }
  try {
    return Buffer.from(value, 'base64');
  } catch {
    throw new InventoryKioskHardwareError(`Invalid ${field}`, 400, 'HARDWARE_INPUT_INVALID');
  }
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function parseDer(value: Uint8Array, label: string): AsnNode {
  const parsed = asn1js.fromBER(arrayBuffer(value));
  if (parsed.offset === -1) {
    throw new InventoryKioskHardwareError(
      `Invalid ${label}`,
      400,
      'ANDROID_ATTESTATION_INVALID',
    );
  }
  return parsed.result as unknown as AsnNode;
}

function childNodes(node: AsnNode): AsnNode[] {
  const value = node.valueBlock?.value;
  return Array.isArray(value) ? value : [];
}

function octets(node: AsnNode): Uint8Array | null {
  const direct = node.valueBlock?.valueHexView;
  if (direct && direct.byteLength > 0) return new Uint8Array(direct);
  for (const child of childNodes(node)) {
    const nested = octets(child);
    if (nested) return nested;
  }
  return null;
}

function findContextTag(node: AsnNode, tagNumber: number): AsnNode | null {
  if (node.idBlock?.tagClass === 3 && node.idBlock.tagNumber === tagNumber) {
    return node;
  }
  for (const child of childNodes(node)) {
    const match = findContextTag(child, tagNumber);
    if (match) return match;
  }
  return null;
}

function findExtensionValue(node: AsnNode, oid: string): Uint8Array | null {
  const children = childNodes(node);
  for (let index = 0; index < children.length; index += 1) {
    const candidate = children[index];
    if (candidate.valueBlock?.toString?.() !== oid) continue;
    for (let siblingIndex = index + 1; siblingIndex < children.length; siblingIndex += 1) {
      const value = octets(children[siblingIndex]);
      if (value) return value;
    }
  }
  for (const child of children) {
    const value = findExtensionValue(child, oid);
    if (value) return value;
  }
  return null;
}

function integerValue(node: AsnNode | undefined): number {
  const value = node?.valueBlock?.valueDec;
  if (!Number.isSafeInteger(value)) {
    throw new InventoryKioskHardwareError(
      'Invalid Android key attestation integer',
      400,
      'ANDROID_ATTESTATION_INVALID',
    );
  }
  return value as number;
}

function integerValues(node: AsnNode): number[] {
  const values: number[] = [];
  const value = node.valueBlock?.valueDec;
  if (Number.isSafeInteger(value)) values.push(value as number);
  childNodes(node).forEach((child) => values.push(...integerValues(child)));
  return values;
}

function requireAuthorizationValues(
  authorizationList: AsnNode,
  tagNumber: number,
  label: string,
): number[] {
  const tagged = findContextTag(authorizationList, tagNumber);
  const values = tagged ? integerValues(tagged) : [];
  if (values.length === 0) {
    throw new InventoryKioskHardwareError(
      `Android key attestation is missing ${label}`,
      403,
      'ANDROID_ATTESTATION_UNTRUSTED',
    );
  }
  return values;
}

function parseRootOfTrust(authorizationList: AsnNode): {
  deviceLocked: boolean;
  verifiedBoot: boolean;
} {
  const rootOfTrust = findContextTag(authorizationList, 704);
  if (!rootOfTrust) {
    throw new InventoryKioskHardwareError(
      'Android verified-boot attestation is missing',
      403,
      'ANDROID_ATTESTATION_UNTRUSTED',
    );
  }
  const values = childNodes(rootOfTrust).flatMap(childNodes);
  const booleanNode = values.find((node) => node.idBlock?.tagNumber === 1);
  const stateNode = values.find((node) => node.idBlock?.tagNumber === 10);
  return {
    deviceLocked: booleanNode?.valueBlock?.value === true,
    verifiedBoot: integerValue(stateNode) === 0,
  };
}

function parseAttestationApplicationId(authorizationList: AsnNode): {
  packageNames: string[];
  signingDigests: string[];
} {
  const applicationId = findContextTag(authorizationList, 709);
  const encoded = applicationId ? octets(applicationId) : null;
  if (!encoded) {
    throw new InventoryKioskHardwareError(
      'Android application attestation is missing',
      403,
      'ANDROID_ATTESTATION_UNTRUSTED',
    );
  }
  const sequence = parseDer(encoded, 'Android application attestation');
  const [packagesNode, signaturesNode] = childNodes(sequence);
  const packageNames = childNodes(packagesNode).map((packageInfo) => {
    const packageName = octets(childNodes(packageInfo)[0]);
    return packageName ? new TextDecoder().decode(packageName) : '';
  }).filter(Boolean);
  const signingDigests = childNodes(signaturesNode)
    .map((digest) => octets(digest))
    .filter((digest): digest is Uint8Array => Boolean(digest))
    .map((digest) => Buffer.from(digest).toString('hex'));
  return { packageNames, signingDigests };
}

function configuredFingerprints(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((value) => value.replaceAll(':', '').trim().toLowerCase())
    .filter((value) => SHA256_PATTERN.test(value));
}

function assertCertificateChain(chain: X509Certificate[]): string {
  const now = Date.now();
  chain.forEach((certificate, index) => {
    if (
      new Date(certificate.validFrom).getTime() > now
      || new Date(certificate.validTo).getTime() < now
    ) {
      throw new InventoryKioskHardwareError(
        'Android key attestation certificate is expired or not yet valid',
        403,
        'ANDROID_ATTESTATION_UNTRUSTED',
      );
    }
    const issuer = chain[index + 1];
    if (index > 0 && !certificate.ca) {
      throw new InventoryKioskHardwareError(
        'Android key attestation issuer is not a certificate authority',
        403,
        'ANDROID_ATTESTATION_UNTRUSTED',
      );
    }
    if (issuer && !certificate.verify(issuer.publicKey)) {
      throw new InventoryKioskHardwareError(
        'Android key attestation certificate chain is invalid',
        403,
        'ANDROID_ATTESTATION_UNTRUSTED',
      );
    }
  });

  const root = chain.at(-1);
  if (!root || !root.verify(root.publicKey)) {
    throw new InventoryKioskHardwareError(
      'Android key attestation root is invalid',
      403,
      'ANDROID_ATTESTATION_UNTRUSTED',
    );
  }
  const rootFingerprint = root.fingerprint256.replaceAll(':', '').toLowerCase();
  const trustedRoots = configuredFingerprints('YARD_KIOSK_ANDROID_ATTESTATION_ROOT_SHA256');
  if (trustedRoots.length === 0) {
    throw new InventoryKioskHardwareError(
      'Android attestation roots are not configured',
      503,
      'ANDROID_ATTESTATION_NOT_CONFIGURED',
    );
  }
  if (!trustedRoots.includes(rootFingerprint)) {
    throw new InventoryKioskHardwareError(
      'Android key attestation root is not trusted',
      403,
      'ANDROID_ATTESTATION_UNTRUSTED',
    );
  }
  return rootFingerprint;
}

let attestationStatusCache: {
  expiresAt: number;
  entries: Record<string, { status?: string; reason?: string }>;
} | null = null;

async function assertAttestationCertificatesNotRevoked(
  chain: X509Certificate[],
): Promise<void> {
  if (!attestationStatusCache || attestationStatusCache.expiresAt <= Date.now()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(ANDROID_ATTESTATION_STATUS_URL, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as {
        entries?: Record<string, { status?: string; reason?: string }>;
      };
      if (!payload.entries || typeof payload.entries !== 'object') {
        throw new Error('Invalid Android attestation status response');
      }
      attestationStatusCache = {
        expiresAt: Date.now() + 60 * 60 * 1000,
        entries: payload.entries,
      };
    } catch {
      throw new InventoryKioskHardwareError(
        'Android attestation revocation status is unavailable',
        503,
        'ANDROID_ATTESTATION_STATUS_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  for (const certificate of chain) {
    const serial = certificate.serialNumber.replace(/^0+/, '').toLowerCase();
    const entry = Object.entries(attestationStatusCache.entries).find(
      ([key]) => key.replace(/^0+/, '').toLowerCase() === serial,
    )?.[1];
    if (entry?.status && entry.status.toUpperCase() !== 'GOOD') {
      throw new InventoryKioskHardwareError(
        `Android attestation certificate is ${entry.status.toLowerCase()}`,
        403,
        'ANDROID_ATTESTATION_REVOKED',
      );
    }
  }
}

async function validateAndroidKeyAttestationUnchecked(
  input: AndroidAttestationInput,
): Promise<AndroidAttestationSummary> {
  if (input.certificateChain.length < 2 || input.certificateChain.length > 8) {
    throw new InventoryKioskHardwareError(
      'Android key attestation certificate chain is incomplete',
      400,
      'ANDROID_ATTESTATION_INVALID',
    );
  }
  const certificates = input.certificateChain.map((value) => (
    new X509Certificate(decodeBase64(value, 'attestation certificate'))
  ));
  const rootFingerprint = assertCertificateChain(certificates);
  await assertAttestationCertificatesNotRevoked(certificates);
  const leafSpki = certificates[0].publicKey.export({ type: 'spki', format: 'der' });
  const suppliedSpki = decodeBase64(input.publicKeySpki, 'hardware public key');
  if (!Buffer.from(leafSpki).equals(suppliedSpki)) {
    throw new InventoryKioskHardwareError(
      'The attested key does not match the supplied public key',
      403,
      'ANDROID_ATTESTATION_KEY_MISMATCH',
    );
  }
  if (
    certificates[0].publicKey.asymmetricKeyType !== 'ec'
    || certificates[0].publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new InventoryKioskHardwareError(
      'The Android kiosk key must use the P-256 elliptic curve',
      403,
      'ANDROID_ATTESTATION_KEY_MISMATCH',
    );
  }

  const certificateDer = new Uint8Array(certificates[0].raw);
  const extension = findExtensionValue(
    parseDer(certificateDer, 'Android attestation certificate'),
    ANDROID_KEY_ATTESTATION_OID,
  );
  if (!extension) {
    throw new InventoryKioskHardwareError(
      'Android key attestation extension is missing',
      403,
      'ANDROID_ATTESTATION_UNTRUSTED',
    );
  }
  const keyDescription = parseDer(extension, 'Android key attestation extension');
  const values = childNodes(keyDescription);
  if (values.length < 8) {
    throw new InventoryKioskHardwareError(
      'Android key attestation extension is malformed',
      400,
      'ANDROID_ATTESTATION_INVALID',
    );
  }

  const attestationVersion = integerValue(values[0]);
  const attestationSecurityLevel = integerValue(values[1]);
  const keymasterVersion = integerValue(values[2]);
  const keymasterSecurityLevel = integerValue(values[3]);
  const attestedChallenge = octets(values[4]);
  const expectedChallenge = Buffer.from(fromBase64Url(input.challenge));
  if (!attestedChallenge || !Buffer.from(attestedChallenge).equals(expectedChallenge)) {
    throw new InventoryKioskHardwareError(
      'Android key attestation challenge does not match',
      403,
      'ANDROID_ATTESTATION_CHALLENGE_MISMATCH',
    );
  }
  if (
    ![1, 2].includes(attestationSecurityLevel)
    || ![1, 2].includes(keymasterSecurityLevel)
    || attestationSecurityLevel !== keymasterSecurityLevel
  ) {
    throw new InventoryKioskHardwareError(
      'The Android key is not hardware-backed',
      403,
      'ANDROID_HARDWARE_KEY_REQUIRED',
    );
  }

  const softwareAuthorizationList = values[6];
  const teeAuthorizationList = values[7];
  if (
    !requireAuthorizationValues(teeAuthorizationList, 1, 'SIGN purpose').includes(2)
    || requireAuthorizationValues(teeAuthorizationList, 2, 'EC algorithm')[0] !== 3
    || !requireAuthorizationValues(teeAuthorizationList, 5, 'SHA-256 digest').includes(4)
    || requireAuthorizationValues(teeAuthorizationList, 10, 'P-256 curve')[0] !== 1
    || requireAuthorizationValues(teeAuthorizationList, 702, 'generated origin')[0] !== 0
  ) {
    throw new InventoryKioskHardwareError(
      'The Android key authorizations do not match the kiosk signing policy',
      403,
      'ANDROID_ATTESTATION_KEY_MISMATCH',
    );
  }
  const rootOfTrust = parseRootOfTrust(teeAuthorizationList);
  if (!rootOfTrust.deviceLocked || !rootOfTrust.verifiedBoot) {
    throw new InventoryKioskHardwareError(
      'The tablet must be locked and running verified Android software',
      403,
      'ANDROID_VERIFIED_BOOT_REQUIRED',
    );
  }
  const applicationId = parseAttestationApplicationId(
    findContextTag(softwareAuthorizationList, 709)
      ? softwareAuthorizationList
      : teeAuthorizationList,
  );
  const expectedPackage = process.env.YARD_KIOSK_ANDROID_PACKAGE || ANDROID_KEYSTORE_PACKAGE;
  const expectedSigningDigests = configuredFingerprints(
    'YARD_KIOSK_ANDROID_SIGNING_CERT_SHA256',
  );
  if (expectedSigningDigests.length === 0) {
    throw new InventoryKioskHardwareError(
      'Android kiosk signing identity is not configured',
      503,
      'ANDROID_ATTESTATION_NOT_CONFIGURED',
    );
  }
  const signingDigest = applicationId.signingDigests.find((digest) => (
    expectedSigningDigests.includes(digest)
  ));
  if (!applicationId.packageNames.includes(expectedPackage) || !signingDigest) {
    throw new InventoryKioskHardwareError(
      'This Android app is not the approved Yard Inventory build',
      403,
      'ANDROID_APP_IDENTITY_MISMATCH',
    );
  }

  return {
    security_level: attestationSecurityLevel === 2 ? 'strongbox' : 'tee',
    attestation_version: attestationVersion,
    keymaster_version: keymasterVersion,
    package_name: expectedPackage,
    signing_certificate_sha256: signingDigest,
    verified_boot: true,
    device_locked: true,
    root_certificate_sha256: rootFingerprint,
  };
}

export async function validateAndroidKeyAttestation(
  input: AndroidAttestationInput,
): Promise<AndroidAttestationSummary> {
  try {
    return await validateAndroidKeyAttestationUnchecked(input);
  } catch (error) {
    if (error instanceof InventoryKioskHardwareError) throw error;
    throw new InventoryKioskHardwareError(
      'The Android key attestation is malformed',
      400,
      'ANDROID_ATTESTATION_INVALID',
    );
  }
}

async function hashChallenge(challenge: string): Promise<string> {
  return sha256Hex(
    `${getAppSessionHashSecret()}:inventory-kiosk-hardware-challenge:${challenge}`,
  );
}

async function loadPairingByToken(pairingToken: string): Promise<PairingHardwareRow> {
  const tokenHash = await hashInventoryKioskDeviceToken(pairingToken);
  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_pairing_sessions')
    .select(
      'id, pairing_token_hash, status, expires_at, candidate_identity_kind, candidate_hardware_public_key_spki, candidate_hardware_key_fingerprint',
    )
    .eq('pairing_token_hash', tokenHash)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw new InventoryKioskHardwareError(error.message, 500, 'HARDWARE_STORE_FAILED');
  if (!data) {
    throw new InventoryKioskHardwareError(
      'The kiosk pairing window is unavailable',
      409,
      'PAIRING_WINDOW_UNAVAILABLE',
    );
  }
  return data as unknown as PairingHardwareRow;
}

async function loadActiveHardwareDevice(deviceId: string): Promise<HardwareDeviceRow> {
  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_devices')
    .select(
      'id, kiosk_user_id, pairing_session_id, revoked_at, hardware_identity_kind, hardware_public_key_spki',
    )
    .eq('id', deviceId)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw new InventoryKioskHardwareError(error.message, 500, 'HARDWARE_STORE_FAILED');
  const device = data as unknown as HardwareDeviceRow | null;
  if (
    !device
    || device.hardware_identity_kind !== 'android_keystore'
    || !device.hardware_public_key_spki
  ) {
    throw new InventoryKioskHardwareError(
      'This Android kiosk is not paired',
      401,
      'DEVICE_UNPAIRED',
    );
  }
  return device;
}

async function insertChallenge(
  purpose: ChallengePurpose,
  scope: { pairingSessionId?: string; deviceId?: string },
): Promise<InventoryKioskChallenge> {
  const challenge = randomToken(32);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const admin = createAdminClient();
  await admin
    .from('inventory_kiosk_device_challenges')
    .delete()
    .lt('expires_at', new Date().toISOString());
  const { data, error } = await admin
    .from('inventory_kiosk_device_challenges')
    .insert({
      purpose,
      pairing_session_id: scope.pairingSessionId || null,
      device_id: scope.deviceId || null,
      challenge_hash: await hashChallenge(challenge),
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new InventoryKioskHardwareError(
      error?.message || 'Unable to create the kiosk challenge',
      500,
      'HARDWARE_CHALLENGE_FAILED',
    );
  }
  return {
    challenge_id: (data as { id: string }).id,
    challenge,
    expires_at: expiresAt,
  };
}

export async function issueInventoryKioskEnrollmentChallenge(
  pairingToken: string | null,
): Promise<InventoryKioskEnrollmentChallenge> {
  if (!pairingToken) {
    throw new InventoryKioskHardwareError(
      'Open the manager-approved pairing window first',
      401,
      'PAIRING_COOKIE_REQUIRED',
    );
  }
  const pairing = await loadPairingByToken(pairingToken);
  const { error: claimError } = await createAdminClient()
    .from('inventory_kiosk_pairing_sessions')
    .update({ candidate_identity_kind: 'android_keystore' })
    .eq('id', pairing.id)
    .eq('status', 'active');
  if (claimError) {
    throw new InventoryKioskHardwareError(
      claimError.message,
      500,
      'HARDWARE_STORE_FAILED',
    );
  }
  if (
    pairing.candidate_hardware_public_key_spki
    && pairing.candidate_hardware_key_fingerprint
  ) {
    return { enrolled: true };
  }
  return {
    enrolled: false,
    ...await insertChallenge('android_enrollment', { pairingSessionId: pairing.id }),
  };
}

export async function issueInventoryKioskAuthenticationChallenge(
  deviceId: string,
): Promise<InventoryKioskChallenge> {
  if (!UUID_PATTERN.test(deviceId)) {
    throw new InventoryKioskHardwareError('Invalid kiosk device', 400, 'DEVICE_ID_INVALID');
  }
  const device = await loadActiveHardwareDevice(deviceId);
  return insertChallenge('android_authentication', { deviceId: device.id });
}

async function consumeChallenge(input: {
  challengeId: string;
  challenge: string;
  purpose: ChallengePurpose;
  pairingSessionId?: string;
  deviceId?: string;
}): Promise<ChallengeRow> {
  const admin = createAdminClient();
  let query = admin
    .from('inventory_kiosk_device_challenges')
    .select('*')
    .eq('id', input.challengeId)
    .eq('purpose', input.purpose)
    .eq('challenge_hash', await hashChallenge(input.challenge))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString());
  if (input.pairingSessionId) query = query.eq('pairing_session_id', input.pairingSessionId);
  if (input.deviceId) query = query.eq('device_id', input.deviceId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new InventoryKioskHardwareError(error.message, 500, 'HARDWARE_STORE_FAILED');
  if (!data) {
    throw new InventoryKioskHardwareError(
      'The kiosk challenge has expired or was already used',
      409,
      'HARDWARE_CHALLENGE_INVALID',
    );
  }
  const row = data as unknown as ChallengeRow;
  const { data: consumed, error: consumeError } = await admin
    .from('inventory_kiosk_device_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();
  if (consumeError) {
    throw new InventoryKioskHardwareError(consumeError.message, 500, 'HARDWARE_STORE_FAILED');
  }
  if (!consumed) {
    throw new InventoryKioskHardwareError(
      'The kiosk challenge was already used',
      409,
      'HARDWARE_CHALLENGE_REPLAY',
    );
  }
  return row;
}

export async function enrollInventoryKioskHardware(input: {
  pairingToken: string | null;
  challengeId: string;
  challenge: string;
  publicKeySpki: string;
  certificateChain: string[];
}): Promise<{ fingerprint: string; attestation: AndroidAttestationSummary }> {
  if (!input.pairingToken) {
    throw new InventoryKioskHardwareError(
      'The kiosk pairing cookie is missing',
      401,
      'PAIRING_COOKIE_REQUIRED',
    );
  }
  const pairing = await loadPairingByToken(input.pairingToken);
  const attestation = await validateAndroidKeyAttestation({
    publicKeySpki: input.publicKeySpki,
    certificateChain: input.certificateChain,
    challenge: input.challenge,
  });
  const fingerprint = createHash('sha256')
    .update(decodeBase64(input.publicKeySpki, 'hardware public key'))
    .digest('hex');
  if (
    pairing.candidate_hardware_key_fingerprint
    && pairing.candidate_hardware_key_fingerprint !== fingerprint
  ) {
    throw new InventoryKioskHardwareError(
      'Another hardware identity already claimed this pairing window',
      409,
      'PAIRING_HARDWARE_ALREADY_CLAIMED',
    );
  }
  await consumeChallenge({
    challengeId: input.challengeId,
    challenge: input.challenge,
    purpose: 'android_enrollment',
    pairingSessionId: pairing.id,
  });

  const { data: updated, error } = await createAdminClient()
    .from('inventory_kiosk_pairing_sessions')
    .update({
      candidate_hardware_public_key_spki: input.publicKeySpki,
      candidate_hardware_key_fingerprint: fingerprint,
      candidate_hardware_attestation: attestation,
      candidate_hardware_seen_at: new Date().toISOString(),
    })
    .eq('id', pairing.id)
    .eq('status', 'active')
    .eq('candidate_identity_kind', 'android_keystore')
    .or(
      `candidate_hardware_key_fingerprint.is.null,candidate_hardware_key_fingerprint.eq.${fingerprint}`,
    )
    .select('id')
    .maybeSingle();
  if (error) throw new InventoryKioskHardwareError(error.message, 500, 'HARDWARE_STORE_FAILED');
  if (!updated) {
    throw new InventoryKioskHardwareError(
      'The pairing was confirmed or another hardware identity claimed it first',
      409,
      'PAIRING_HARDWARE_ALREADY_CLAIMED',
    );
  }
  return { fingerprint, attestation };
}

export function buildInventoryKioskAuthenticationCanonical(input: {
  deviceId: string;
  challengeId: string;
  challenge: string;
  expiresAt: string;
}): string {
  return [
    AUTH_DOMAIN,
    input.deviceId,
    input.challengeId,
    input.challenge,
    input.expiresAt,
  ].join('\n');
}

export function buildInventoryKioskRequestCanonical(input: {
  deviceId: string;
  requestId: string;
  issuedAt: string;
  method: string;
  path: string;
  bodySha256: string;
}): string {
  return [
    REQUEST_DOMAIN,
    input.deviceId,
    input.requestId,
    input.issuedAt,
    input.method.toUpperCase(),
    input.path,
    input.bodySha256,
  ].join('\n');
}

export function verifyInventoryKioskHardwareSignature(
  publicKeySpki: string,
  canonical: string,
  signature: string,
): boolean {
  try {
    return verifySignature(
      'sha256',
      Buffer.from(canonical, 'utf8'),
      createPublicKey({
        key: decodeBase64(publicKeySpki, 'hardware public key'),
        format: 'der',
        type: 'spki',
      }),
      Buffer.from(fromBase64Url(signature)),
    );
  } catch {
    return false;
  }
}

export async function authenticateInventoryKioskHardware(input: {
  deviceId: string;
  challengeId: string;
  challenge: string;
  expiresAt: string;
  signature: string;
}) {
  const device = await loadActiveHardwareDevice(input.deviceId);
  const canonical = buildInventoryKioskAuthenticationCanonical({
    deviceId: device.id,
    challengeId: input.challengeId,
    challenge: input.challenge,
    expiresAt: input.expiresAt,
  });
  if (!verifyInventoryKioskHardwareSignature(
    device.hardware_public_key_spki!,
    canonical,
    input.signature,
  )) {
    throw new InventoryKioskHardwareError(
      'The kiosk hardware signature is invalid',
      401,
      'DEVICE_PROOF_INVALID',
    );
  }
  const challenge = await consumeChallenge({
    challengeId: input.challengeId,
    challenge: input.challenge,
    purpose: 'android_authentication',
    deviceId: device.id,
  });
  if (challenge.expires_at !== input.expiresAt) {
    throw new InventoryKioskHardwareError(
      'The signed kiosk challenge expiry does not match',
      401,
      'DEVICE_PROOF_INVALID',
    );
  }

  const now = new Date().toISOString();
  await createAdminClient()
    .from('inventory_kiosk_devices')
    .update({
      last_seen_at: now,
      last_authenticated_at: now,
      last_device_proof_at: now,
    })
    .eq('id', device.id)
    .is('revoked_at', null);
  if (device.pairing_session_id) {
    await createAdminClient()
      .from('inventory_kiosk_pairing_sessions')
      .update({
        status: 'consumed',
        consumed_at: now,
      })
      .eq('id', device.pairing_session_id)
      .eq('status', 'confirmed');
  }

  const appSession = await issueAppSession({
    profileId: device.kiosk_user_id,
    source: 'kiosk_device',
    rememberMe: true,
    kioskDeviceId: device.id,
    actorProfileId: device.kiosk_user_id,
  });
  return { device, appSession };
}

function requestBodyHash(bodyText: string): string {
  return createHash('sha256').update(bodyText, 'utf8').digest('hex');
}

export async function verifyInventoryKioskRequestProof(
  request: Request,
  bodyText = '',
): Promise<InventoryKioskRequestProofResult> {
  const sessionValidation = await validateAppSession({
    allowKioskDevice: true,
    refresh: false,
  });
  if (
    sessionValidation.status !== 'active'
    || sessionValidation.session?.session_source !== 'kiosk_device'
    || !sessionValidation.session.kiosk_device_id
  ) {
    throw new InventoryKioskHardwareError(
      'The Yard kiosk session has expired',
      401,
      'SESSION_EXPIRED',
    );
  }

  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_devices')
    .select(
      'id, kiosk_user_id, pairing_session_id, revoked_at, hardware_identity_kind, hardware_public_key_spki',
    )
    .eq('id', sessionValidation.session.kiosk_device_id)
    .eq('kiosk_user_id', sessionValidation.session.profile_id)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw new InventoryKioskHardwareError(error.message, 500, 'HARDWARE_STORE_FAILED');
  const device = data as unknown as HardwareDeviceRow | null;
  if (!device) {
    throw new InventoryKioskHardwareError('The Yard kiosk was revoked', 401, 'DEVICE_REVOKED');
  }
  if (device.hardware_identity_kind !== 'android_keystore') {
    const refreshedValidation = await validateAppSession({ allowKioskDevice: true });
    if (refreshedValidation.status !== 'active') {
      throw new InventoryKioskHardwareError(
        'The Yard kiosk session has expired',
        401,
        'SESSION_EXPIRED',
      );
    }
    return {
      sessionValidation: refreshedValidation,
      device,
      hardwareProofRequired: false,
    };
  }
  if (!device.hardware_public_key_spki) {
    throw new InventoryKioskHardwareError(
      'The Yard kiosk hardware identity is incomplete',
      401,
      'DEVICE_PROOF_INVALID',
    );
  }

  const deviceId = request.headers.get('x-yard-kiosk-device-id') || '';
  const requestId = request.headers.get('x-yard-kiosk-request-id') || '';
  const issuedAtRaw = request.headers.get('x-yard-kiosk-issued-at') || '';
  const signature = request.headers.get('x-yard-kiosk-signature') || '';
  const issuedAt = Number(issuedAtRaw);
  if (
    deviceId !== device.id
    || !UUID_PATTERN.test(requestId)
    || !Number.isSafeInteger(issuedAt)
    || Math.abs(Date.now() - issuedAt) > REQUEST_CLOCK_SKEW_MS
    || !signature
  ) {
    throw new InventoryKioskHardwareError(
      'A fresh hardware proof is required',
      401,
      'DEVICE_PROOF_REQUIRED',
    );
  }
  const url = new URL(request.url);
  const canonical = buildInventoryKioskRequestCanonical({
    deviceId: device.id,
    requestId,
    issuedAt: issuedAtRaw,
    method: request.method,
    path: `${url.pathname}${url.search}`,
    bodySha256: requestBodyHash(bodyText),
  });
  if (!verifyInventoryKioskHardwareSignature(
    device.hardware_public_key_spki,
    canonical,
    signature,
  )) {
    throw new InventoryKioskHardwareError(
      'The kiosk hardware proof is invalid',
      401,
      'DEVICE_PROOF_INVALID',
    );
  }

  const now = new Date();
  const admin = createAdminClient();
  await admin
    .from('inventory_kiosk_device_request_proofs')
    .delete()
    .lt('expires_at', now.toISOString());
  const { error: proofError } = await admin
    .from('inventory_kiosk_device_request_proofs')
    .insert({
      request_id: requestId,
      device_id: device.id,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(now.getTime() + REQUEST_PROOF_RETENTION_MS).toISOString(),
    });
  if (proofError) {
    const replay = (proofError as { code?: string }).code === '23505';
    throw new InventoryKioskHardwareError(
      replay ? 'The kiosk hardware proof was already used' : proofError.message,
      replay ? 409 : 500,
      replay ? 'DEVICE_PROOF_REPLAY' : 'HARDWARE_STORE_FAILED',
    );
  }
  await admin
    .from('inventory_kiosk_devices')
    .update({
      last_device_proof_at: now.toISOString(),
      last_seen_at: now.toISOString(),
    })
    .eq('id', device.id)
    .is('revoked_at', null);

  const refreshedValidation = await validateAppSession({ allowKioskDevice: true });
  if (refreshedValidation.status !== 'active') {
    throw new InventoryKioskHardwareError(
      'The Yard kiosk session became inactive',
      401,
      refreshedValidation.failureReason === 'kiosk_device_inactive'
        ? 'DEVICE_REVOKED'
        : 'SESSION_EXPIRED',
    );
  }

  return {
    sessionValidation: refreshedValidation,
    device,
    hardwareProofRequired: true,
  };
}
