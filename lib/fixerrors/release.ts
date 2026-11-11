import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'crypto';
import { z } from 'zod';
import { checkEvidenceDigest, hash } from './control';
import { releaseModeSchema, sameCandidate, sha256Schema, type FixerrorsJob } from './protocol';

const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/u);
const oid = z.string().regex(/^[a-f0-9]{40}$/u);
const keyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);
const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const releaseTicketSchema = z.object({
  version: z.literal(1),
  audience: z.literal('squires-windows-fap'),
  job: z.literal('fap'),
  approvalId: uuid,
  repairJobId: uuid,
  deviceId: uuid,
  environment: z.literal('squires-production'),
  issuedAt: seconds,
  expiresAt: seconds,
  approvedBy: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u),
  head: oid,
  tree: oid,
  candidateSha256: sha256Schema,
  testEvidenceSha256: sha256Schema,
  releaseMode: releaseModeSchema.optional(),
}).strict();
const envelopeSchema = z.object({
  version: z.literal(1), keyId: keyIdSchema,
  payload: z.string().min(1).max(2731),
  signature: z.string().length(86),
}).strict();
const receiptSchema = z.object({
  receiptId: z.string().regex(/^[a-f0-9]{32}$/u), sha256: sha256Schema,
}).strict();
export const preparedBatchProofSchema = z.object({
  version: z.literal(1), manifestSha256: sha256Schema, contributionsSha256: sha256Schema,
  clusterCount: z.number().int().positive(), repairCount: z.number().int().positive(),
}).strict().refine(value => value.repairCount <= value.clusterCount, 'Invalid batch coverage');
export const preparedReleaseEvidenceSchema = z.object({
  repairJobId: uuid, head: oid, tree: oid, candidateSha256: sha256Schema,
  allChecksPassed: z.literal(true), workerResultSha256: sha256Schema,
  preparedChecks: z.object({
    'targeted-tests': receiptSchema, typecheck: receiptSchema, lint: receiptSchema,
  }).strict(),
  batch: preparedBatchProofSchema.optional(),
}).strict();
export type PreparedReleaseEvidence = z.infer<typeof preparedReleaseEvidenceSchema>;
export type ReleaseTicket = z.infer<typeof releaseTicketSchema>;

export interface ReleaseIssuer {
  keyId: string;
  privateKey: KeyObject;
  repairKeyId: string;
  repairPublicKey: KeyObject;
}
export interface ReleaseVerifier {
  keyId: string;
  publicKey: KeyObject;
  repairKeyId: string;
  repairPublicKey: KeyObject;
}

function requireRelease(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`Fixerrors release denied: ${message}`);
}

function publicKey(key: KeyObject): KeyObject {
  return key.type === 'public' ? key : createPublicKey(key);
}

function separateKeys(config: ReleaseVerifier): void {
  keyIdSchema.parse(config.keyId);
  keyIdSchema.parse(config.repairKeyId);
  requireRelease(config.publicKey.asymmetricKeyType === 'ed25519' &&
    config.repairPublicKey.asymmetricKeyType === 'ed25519' &&
    config.keyId !== config.repairKeyId &&
    !publicKey(config.publicKey).export({ type: 'spki', format: 'der' }).equals(
      publicKey(config.repairPublicKey).export({ type: 'spki', format: 'der' })),
  'release issuer must be separate');
}

function decode(value: string, limit: number): Buffer {
  requireRelease(/^[A-Za-z0-9_-]+$/u.test(value), 'invalid base64url');
  const bytes = Buffer.from(value, 'base64url');
  requireRelease(bytes.length <= limit && bytes.toString('base64url') === value, 'noncanonical base64url');
  return bytes;
}

function signingBytes(keyId: string, payload: string): Buffer {
  return Buffer.from(`squires-windows-fap-v1\n${keyId}\n${payload}`, 'ascii');
}

function validTime(ticket: ReleaseTicket, now: number): void {
  requireRelease(Number.isSafeInteger(now) && ticket.issuedAt <= now && now < ticket.expiresAt &&
    ticket.expiresAt > ticket.issuedAt && ticket.expiresAt - ticket.issuedAt <= 300,
  'invalid or expired ticket');
}

// Called only inside the authenticated start-deploy transaction, never by the browser.
export function issueStartedReleaseTicket(job: FixerrorsJob, nowMs: number, issuer: ReleaseIssuer): string {
  separateKeys({ ...issuer, publicKey: publicKey(issuer.privateKey) });
  requireRelease(job.action === 'deploy' && job.state === 'leased' && job.lease &&
    job.lease.deployStartedAt === nowMs && job.lease.until > nowMs && job.expiresAt > nowMs &&
    job.approval && job.candidate && job.checks?.release && job.parentRepairId &&
    job.requestedBy === job.approval.actorId && job.approval.confirmedAt === job.createdAt &&
    sameCandidate(job.approval.candidate, job.candidate) &&
    job.candidate.head === job.workspace.head && job.candidate.tree === job.workspace.tree &&
    job.checks.head === job.candidate.head && job.checks.tree === job.candidate.tree &&
    checkEvidenceDigest(job.checks) === job.candidate.checksSha256,
  'started approval or prepared evidence mismatch');
  const now = Math.floor(nowMs / 1000);
  const ticket = releaseTicketSchema.parse({
    version: 1, audience: 'squires-windows-fap', job: 'fap',
    approvalId: job.id, repairJobId: job.parentRepairId, deviceId: job.deviceId,
    environment: 'squires-production', issuedAt: now,
    expiresAt: Math.min(now + 300, Math.floor(job.expiresAt / 1000)),
    approvedBy: job.approval.actorId, head: job.candidate.head, tree: job.candidate.tree,
    ...job.checks.release,
    releaseMode: job.approval.releaseMode ?? 'full',
  });
  validTime(ticket, now);
  requireRelease(ticket.approvalId !== ticket.repairJobId, 'approval is not separate');
  const payload = Buffer.from(JSON.stringify(ticket), 'utf8').toString('base64url');
  return JSON.stringify({
    version: 1, keyId: issuer.keyId, payload,
    signature: sign(null, signingBytes(issuer.keyId, payload), issuer.privateKey).toString('base64url'),
  });
}

export function verifyReleaseTicket(raw: string, verifier: ReleaseVerifier, now: number): ReleaseTicket {
  separateKeys(verifier);
  requireRelease(Buffer.byteLength(raw, 'utf8') <= 4096, 'oversize ticket');
  const envelope = envelopeSchema.parse(JSON.parse(raw));
  requireRelease(JSON.stringify(envelope) === raw && envelope.keyId === verifier.keyId, 'noncanonical envelope or issuer');
  const body = decode(envelope.payload, 2048);
  requireRelease(verify(null, signingBytes(envelope.keyId, envelope.payload), verifier.publicKey,
    decode(envelope.signature, 64)), 'invalid signature');
  const ticket = releaseTicketSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
  requireRelease(JSON.stringify(ticket) === body.toString('utf8'), 'noncanonical ticket');
  requireRelease(ticket.approvalId !== ticket.repairJobId, 'approval is not separate');
  validTime(ticket, now);
  return ticket;
}

export function encodePreparedReleaseEvidence(input: PreparedReleaseEvidence): string {
  return JSON.stringify(preparedReleaseEvidenceSchema.parse(input));
}

export function prepareReleaseDeviceProof(
  rawTicket: string, evidence: PreparedReleaseEvidence, job: FixerrorsJob,
  verifier: ReleaseVerifier, deviceKey: KeyObject, now: number,
): Buffer {
  const ticket = verifyReleaseTicket(rawTicket, verifier, now);
  const encoded = encodePreparedReleaseEvidence(evidence);
  requireRelease(job.action === 'deploy' && job.approval && job.candidate && job.checks?.release &&
    ticket.approvalId === job.id && ticket.repairJobId === job.parentRepairId &&
    ticket.deviceId === job.deviceId && ticket.approvedBy === job.approval.actorId &&
    ticket.expiresAt <= Math.floor(job.expiresAt / 1000) &&
    ticket.head === job.candidate.head && ticket.tree === job.candidate.tree &&
    (ticket.releaseMode ?? 'full') === (job.approval.releaseMode ?? 'full') &&
    sameCandidate(job.approval.candidate, job.candidate) &&
    checkEvidenceDigest(job.checks) === job.candidate.checksSha256 &&
    evidence.repairJobId === ticket.repairJobId && evidence.head === ticket.head &&
    evidence.tree === ticket.tree && evidence.candidateSha256 === ticket.candidateSha256 &&
    ticket.candidateSha256 === job.checks.release.candidateSha256 &&
    hash(encoded) === ticket.testEvidenceSha256 &&
    ticket.testEvidenceSha256 === job.checks.release.testEvidenceSha256 &&
    job.checks.checks.every((check) => evidence.preparedChecks[check.id].sha256 === check.outputSha256),
  'candidate or prepared receipt mismatch');
  requireRelease(deviceKey.type === 'private' && deviceKey.asymmetricKeyType === 'ed25519' &&
    !publicKey(deviceKey).export({ type: 'spki', format: 'der' }).equals(
      publicKey(verifier.publicKey).export({ type: 'spki', format: 'der' })) &&
    !publicKey(deviceKey).export({ type: 'spki', format: 'der' }).equals(
      publicKey(verifier.repairPublicKey).export({ type: 'spki', format: 'der' })),
  'separate device signing key required');
  const payload = Buffer.from(JSON.stringify({
    ticket: rawTicket, testEvidence: Buffer.from(encoded, 'utf8').toString('base64url'),
  }), 'utf8').toString('base64url');
  return Buffer.from(JSON.stringify({
    payload, signature: sign(null, Buffer.from(`squires-companion-release-v1\n${payload}`, 'ascii'),
      deviceKey).toString('base64url'),
  }), 'utf8');
}

export function parseReleasePrivateKey(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  requireRelease(key.asymmetricKeyType === 'ed25519', 'Ed25519 required');
  return key;
}
