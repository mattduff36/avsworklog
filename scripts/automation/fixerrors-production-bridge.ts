import { spawn } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  candidateSchema, resultSchema, sha256Schema, type ExecutionResult, type FixerrorsJob,
} from '../../lib/fixerrors/protocol';
import { checkEvidenceDigest } from '../../lib/fixerrors/control';
import { encodeFixerrorsDeviceJob, fixerrorsDeviceJobSchema, fixerrorsDeviceSigningBytes } from '../../lib/fixerrors/admission';
import { prepareReleaseDeviceProof, preparedReleaseEvidenceSchema } from '../../lib/fixerrors/release';
import { FIXERRORS_WORKSPACE } from './fixerrors-device-admission';
import type { TrustedFixerrorsExecutor } from './fixerrors-companion';

export const productionBridgeFiles = ['squires-windows-release.py', 'squires_release.py', 'squires_companion.py', 'squires_repair.py'] as const;
const protectedEnrollmentSchema = z.object({
  deviceId: z.string().uuid(),
  credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  pythonExe: z.string().max(512),
  devicePrivateKeyPem: z.string().max(1024),
  releasePublicKeyPem: z.string().max(1024),
  repairPublicKeyPem: z.string().max(1024),
  bridgeHashes: z.tuple([sha256Schema, sha256Schema, sha256Schema, sha256Schema]),
}).strict();
export type ProductionBridgeEnrollment = z.infer<typeof protectedEnrollmentSchema>;

const preparedSchema = z.object({
  candidate: candidateSchema, evidence: preparedReleaseEvidenceSchema,
}).strict();
const releasedSchema = z.object({
  approvalId: z.string().uuid(), repairJobId: z.string().uuid(),
  status: z.literal('released'), deploymentId: z.string().regex(/^dpl_[A-Za-z0-9]{1,120}$/u),
}).strict();
const unconfirmed = { status: 'unknown', reason: 'release-unconfirmed' } as const;
const repairResponseSchema = z.object({
  jobId: z.string().uuid(),
  result: resultSchema,
}).strict();
const admissionEnvelopeSchema = z.object({
  version: z.literal(1), keyId: z.literal('squires-repair-v1'),
  payload: z.string().min(1).max(2731), signature: z.string().length(86),
}).strict();

export function prepareProductionRepairProof(
  ticket: string, packet: Buffer, job: Readonly<FixerrorsJob>, enrollment: ProductionBridgeEnrollment, now: number,
): Buffer {
  if (Buffer.byteLength(ticket) > 4096 || !packet.length || packet.length > 96 * 1024) throw new Error('Repair input limit');
  const envelope = admissionEnvelopeSchema.parse(JSON.parse(ticket));
  const payload = Buffer.from(envelope.payload, 'base64url');
  const signature = Buffer.from(envelope.signature, 'base64url');
  const issuer = createPublicKey(enrollment.repairPublicKeyPem);
  if (JSON.stringify(envelope) !== ticket || payload.toString('base64url') !== envelope.payload ||
      signature.toString('base64url') !== envelope.signature || signature.length !== 64 ||
      !verify(null, fixerrorsDeviceSigningBytes(envelope.keyId, envelope.payload), issuer, signature)) {
    throw new Error('Invalid signed repair admission');
  }
  const admitted = fixerrorsDeviceJobSchema.parse(JSON.parse(payload.toString('utf8')));
  if (encodeFixerrorsDeviceJob(admitted) !== envelope.payload || job.action === 'deploy' ||
      job.state !== 'leased' || !job.lease || job.lease.until <= now * 1000 ||
      admitted.jobId !== job.id || admitted.deviceId !== job.deviceId || job.deviceId !== enrollment.deviceId ||
      admitted.authority !== (job.action === 'repair' ? 'bounded-repair' : 'read-only') ||
      admitted.head !== job.workspace.head || admitted.tree !== job.workspace.tree ||
      admitted.packetSha256 !== job.workspace.packetSha256 ||
      admitted.packetSha256 !== createHash('sha256').update(packet).digest('hex') ||
      !Number.isSafeInteger(now) || admitted.issuedAt > now || admitted.expiresAt <= now ||
      admitted.expiresAt <= admitted.issuedAt ||
      admitted.expiresAt - admitted.issuedAt > (admitted.authority === 'bounded-repair' ? 600 : 300) ||
      admitted.expiresAt > Math.floor(job.expiresAt / 1000)) throw new Error('Repair admission binding mismatch');
  const device = createPrivateKey(enrollment.devicePrivateKeyPem);
  requireSeparateDevice(device, issuer, createPublicKey(enrollment.releasePublicKeyPem));
  const body = Buffer.from(JSON.stringify({ ticket, packet: packet.toString('base64url') }), 'utf8').toString('base64url');
  return Buffer.from(JSON.stringify({
    payload: body,
    signature: sign(null, Buffer.from(`squires-companion-repair-v1\n${body}`, 'ascii'), device).toString('base64url'),
  }), 'utf8');
}

function requireSeparateDevice(device: KeyObject, repair: KeyObject, release: KeyObject) {
  if (device.asymmetricKeyType !== 'ed25519' || repair.asymmetricKeyType !== 'ed25519' ||
      release.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 keys required');
  const key = (value: KeyObject) => (value.type === 'private' ? createPublicKey(value) : value)
    .export({ type: 'spki', format: 'der' });
  if (key(device).equals(key(repair)) || key(device).equals(key(release)) || key(repair).equals(key(release))) {
    throw new Error('Separate device, repair and release keys required');
  }
}

export function parseProductionBridgeEnrollment(input: unknown): ProductionBridgeEnrollment {
  return protectedEnrollmentSchema.parse(input);
}

function pinnedFile(file: string, digest?: string): void {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(file) !== file) {
    throw new Error('Production bridge requires a fixed ordinary file');
  }
  if (digest && (info.size > 1024 * 1024 || createHash('sha256').update(readFileSync(file)).digest('hex') !== digest)) {
    throw new Error('Production bridge file pin changed');
  }
}

function preparedCandidate() {
  const file = path.join(FIXERRORS_WORKSPACE, '.git', 'squires-fixerrors', 'prepared-release.json');
  pinnedFile(file);
  if (lstatSync(file).size > 16_384) throw new Error('Prepared release evidence exceeds limit');
  return preparedSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

function invoke(exe: string, entry: string, proof: Buffer, signal: AbortSignal, repair = false): Promise<unknown> {
  const keep = new Set(['SYSTEMROOT', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP',
    'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)']);
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.has(key.toUpperCase()))),
    NODE_ENV: 'production',
  };
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Release cancelled')); return; }
    const child = spawn(exe, ['-I', '-B', entry, ...(repair ? ['repair'] : [])], {
      cwd: FIXERRORS_WORKSPACE, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const stop = () => { child.kill(); };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const output: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) stop();
      else output.push(chunk);
    });
    // Wait for close even if stdin fails; the wrapper owns descendant lifetime.
    child.stdin.on('error', () => { stop(); });
    child.once('error', reject);
    child.once('close', () => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted || size > 4096) { reject(new Error('Release stopped')); return; }
      try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); }
      catch { reject(new Error('Release outcome unavailable')); }
    });
    child.stdin.end(proof);
  });
}

export function createProductionReleaseBridge(enrollment: ProductionBridgeEnrollment): TrustedFixerrorsExecutor {
  const root = path.join(homedir(), '.codex', 'cursor-worker', 'squires-production-bridge');
  if (process.platform !== 'win32' || !path.isAbsolute(enrollment.pythonExe) ||
      path.basename(enrollment.pythonExe).toLowerCase() !== 'python.exe') throw new Error('Pinned Windows Python required');
  const files = productionBridgeFiles.map((name) => path.join(root, name));
  const verifyPins = () => {
    pinnedFile(enrollment.pythonExe);
    files.forEach((file, index) => pinnedFile(file, enrollment.bridgeHashes[index]));
  };
  verifyPins();
  const deviceKey = createPrivateKey(enrollment.devicePrivateKeyPem);
  requireSeparateDevice(deviceKey, createPublicKey(enrollment.repairPublicKeyPem), createPublicKey(enrollment.releasePublicKeyPem));
  const verifier = {
    keyId: 'squires-release-v1', publicKey: createPublicKey(enrollment.releasePublicKeyPem),
    repairKeyId: 'squires-repair-v1', repairPublicKey: createPublicKey(enrollment.repairPublicKeyPem),
  };
  return {
    available: true,
    localTestedCandidate() {
      try { return preparedCandidate().candidate; }
      catch { return null; }
    },
    async execute(job, signal, releaseTicket, admissionTicket): Promise<ExecutionResult> {
      verifyPins();
      if (job.action !== 'deploy') {
        if (!admissionTicket) return { status: 'blocked', reason: 'bridge-unavailable' };
        const packetFile = path.join(FIXERRORS_WORKSPACE, '.git', 'squires-fixerrors', 'sanitized-packet.json');
        pinnedFile(packetFile);
        if (lstatSync(packetFile).size > 96 * 1024) throw new Error('Sanitized packet exceeds transport limit');
        const proof = prepareProductionRepairProof(
          admissionTicket, readFileSync(packetFile), job, enrollment, Math.floor(Date.now() / 1000),
        );
        const response = repairResponseSchema.safeParse(await invoke(enrollment.pythonExe, files[0], proof, signal, true));
        if (!response.success || signal.aborted || response.data.jobId !== job.id) {
          return { status: 'failed', reason: 'execution-failed' };
        }
        const result = response.data.result;
        if (job.action === 'review' && result.status === 'reviewed') return result;
        if (job.action === 'repair' && result.status === 'tested') {
          const prepared = preparedCandidate();
          if (result.candidate.checksSha256 === checkEvidenceDigest(result.checks) &&
              result.candidate.head === result.checks.head && result.candidate.tree === result.checks.tree &&
              JSON.stringify(result.candidate) === JSON.stringify(prepared.candidate) &&
              prepared.evidence.repairJobId === job.id && result.checks.release &&
              result.checks.release.testEvidenceSha256 === createHash('sha256').update(JSON.stringify(prepared.evidence)).digest('hex') &&
              result.checks.release.candidateSha256 === prepared.evidence.candidateSha256 &&
              result.checks.checks.every(check => prepared.evidence.preparedChecks[check.id].sha256 === check.outputSha256)) return result;
        }
        return { status: 'failed', reason: 'execution-failed' };
      }
      if (!releaseTicket) return { status: 'blocked', reason: 'bridge-unavailable' };
      const { evidence } = preparedCandidate();
      const proof = prepareReleaseDeviceProof(
        releaseTicket, evidence, job, verifier, deviceKey, Math.floor(Date.now() / 1000),
      );
      const response = releasedSchema.safeParse(await invoke(enrollment.pythonExe, files[0], proof, signal));
      if (!response.success || signal.aborted || response.data.approvalId !== job.id ||
          response.data.repairJobId !== job.parentRepairId || !job.candidate) return unconfirmed;
      return { status: 'deployed', candidate: job.candidate };
    },
  };
}
