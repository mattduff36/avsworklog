import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { issueClaimedFixerrorsAdmission } from '@/lib/fixerrors/admission';
import { checkEvidenceDigest } from '@/lib/fixerrors/control';
import { resultSchema } from '@/lib/fixerrors/protocol';
import { encodePreparedReleaseEvidence, preparedReleaseEvidenceSchema } from '@/lib/fixerrors/release';
import { prepareProductionRepairProof, type ProductionBridgeEnrollment } from '@/scripts/automation/fixerrors-production-bridge';
import { controlledAcceptancePacket } from '@/scripts/automation/fixerrors-controlled-acceptance';
import { parseCompanionPacket } from '@/scripts/automation/fixerrors-companion-packet';
import { validateBridgeRepair } from '@/scripts/automation/fixerrors-bridge-boundary';
import { captureCandidateFingerprint, type FixerrorsDecision } from '@/scripts/fixerrors-decision';
import { deviceId, harness, now } from './fixerrors-control-fixtures';

const repair = generateKeyPairSync('ed25519');
const release = generateKeyPairSync('ed25519');
const device = generateKeyPairSync('ed25519');
const pem = (key: ReturnType<typeof createPublicKey>) => key.export({ type: 'spki', format: 'pem' }).toString();
const packet = Buffer.from('{"fixtureOnly":true}');
const enrollment: ProductionBridgeEnrollment = {
  deviceId, credential: 'x'.repeat(43), pythonExe: 'C:\\fixture\\python.exe',
  devicePrivateKeyPem: device.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  repairPublicKeyPem: pem(repair.publicKey), releasePublicKeyPem: pem(release.publicKey),
  bridgeHashes: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)],
};
const issuer = { keyId: 'squires-repair-v1', privateKey: repair.privateKey,
  releaseKeyId: 'squires-release-v1', releasePublicKey: release.publicKey };

describe('production signed repair transport (offline; no model launch)', () => {
  async function fixture(action: 'review' | 'repair' = 'repair') {
    const h = harness();
    await h.enqueue(action);
    const { job } = await h.claim();
    job.workspace.packetSha256 = createHash('sha256').update(packet).digest('hex');
    return { job, ticket: issueClaimedFixerrorsAdmission(job, now, issuer) };
  }

  it.each(['review', 'repair'] as const)('binds the device proof to the actual %s admission without supplied commands or plan', async (action) => {
    const { job, ticket } = await fixture(action);
    const proof = JSON.parse(prepareProductionRepairProof(ticket, packet, job, enrollment, now / 1000).toString());
    expect(Object.keys(proof)).toEqual(['payload', 'signature']);
    expect(verify(null, Buffer.from(`squires-companion-repair-v1\n${proof.payload}`, 'ascii'), device.publicKey,
      Buffer.from(proof.signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(proof.payload, 'base64url').toString())).toEqual({ ticket, packet: packet.toString('base64url') });
  });

  it('rejects changed packet, foreign job/device/action, duplicate keys, expiry and shared issuer/device keys', async () => {
    const { job, ticket } = await fixture();
    const proof = (t = ticket, p = packet, j = job, e = enrollment, at = now / 1000) =>
      prepareProductionRepairProof(t, p, j, e, at);
    expect(() => proof(ticket, Buffer.from('changed'))).toThrow();
    expect(() => proof(ticket, packet, { ...job, action: 'review' })).toThrow();
    expect(() => proof(ticket, packet, { ...job, id: '00000000-0000-4000-8000-000000000000' })).toThrow();
    expect(() => proof(ticket, packet, job, { ...enrollment, deviceId: '00000000-0000-4000-8000-000000000000' })).toThrow();
    expect(() => proof(ticket, packet, job, enrollment, now / 1000 + 300)).toThrow();
    expect(() => proof(ticket, packet, job, enrollment, now / 1000 - 1)).toThrow();
    expect(() => proof(ticket.replace('{"version":1,', '{"version":1,"version":1,'))).toThrow();
    expect(() => proof(ticket, packet, job, { ...enrollment, releasePublicKeyPem: pem(device.publicKey) })).toThrow();
    const bad = JSON.parse(ticket);
    bad.signature = sign(null, Buffer.from('tampered'), repair.privateKey).toString('base64url');
    expect(() => proof(JSON.stringify(bad))).toThrow();
  });

  it('labels the controlled packet synthetic and scopes it to one existing test-only target', () => {
    const parsed = parseCompanionPacket(controlledAcceptancePacket({ baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) }));
    expect(parsed.retrieval.clusters).toHaveLength(1);
    expect(parsed.retrieval.clusters[0].query.normalizedMessage).toContain('SYNTHETIC');
    expect(parsed.retrieval.clusters[0].sourceFiles).toEqual(['lib/utils/fixerrors-controlled-acceptance.ts']);
  });

  it('checks the actual clean filesystem boundary, holds, missing tests and sensitive source before dispatch', () => {
    const cwd = mkdtempSync(path.join(realpathSync(tmpdir()), 'squires-decision-boundary-'));
    const source = 'lib/utils/fixerrors-controlled-acceptance.ts';
    const test = 'tests/unit/fixerrors-controlled-acceptance.test.ts';
    const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args], {
      stdio: 'ignore', timeout: 10_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL' },
    });
    const fixture = () => {
      const candidate = captureCandidateFingerprint(cwd);
      const bytes = controlledAcceptancePacket(candidate);
      const packet = parseCompanionPacket(bytes);
      const decision: FixerrorsDecision = {
        schemaVersion: 1, snapshotId: packet.retrieval.snapshotId, analyst: 'MPDEE Worker', ...candidate,
        clusters: [{
          id: 'cluster-1', lane: 'fast', action: 'fix', disposition: 'outstanding', nextStep: 'Repair synthetic label',
          evidencePaths: [source, test], files: [source, test], requiredTestIds: [test],
          forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
          rationale: 'Synthetic label fixture reproduced', priorIncidentIds: [], evidenceEnrichmentAttempted: true,
        }],
      };
      return { packet: bytes.toString('base64url'), decision };
    };
    try {
      mkdirSync(path.join(cwd, 'lib', 'utils'), { recursive: true });
      mkdirSync(path.join(cwd, 'tests', 'unit'), { recursive: true });
      writeFileSync(path.join(cwd, source), 'export const label = (value: string) => value.trimEnd();\n');
      writeFileSync(path.join(cwd, test), '// Synthetic boundary fixture only\n');
      git('init', '-b', 'main');
      git('add', '--', source, test);
      git('-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgSign=false', 'commit', '-m', 'test: synthetic decision boundary');
      const valid = fixture();
      expect(validateBridgeRepair(valid, cwd).plan.editablePaths).toEqual([source, test]);
      const critical = structuredClone(valid);
      critical.decision.clusters[0].lane = 'critical';
      expect(() => validateBridgeRepair(critical, cwd)).toThrow('Critical');
      const missing = structuredClone(valid);
      missing.decision.clusters[0].requiredTestIds = ['tests/unit/absent.test.ts'];
      expect(() => validateBridgeRepair(missing, cwd)).toThrow();
      writeFileSync(path.join(cwd, source), '// requireSyntheticAccess\n');
      expect(() => validateBridgeRepair(valid, cwd)).toThrow('clean');
      git('add', '--', source);
      git('-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgSign=false', 'commit', '-m', 'test: sensitive boundary fixture');
      expect(() => validateBridgeRepair(fixture(), cwd)).toThrow('Sensitive');
      expect(() => validateBridgeRepair(valid, cwd)).toThrow('current');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  const installed = 'C:\\Users\\mattd\\.codex\\cursor-worker\\squires-production-bridge';
  it.skipIf(!existsSync(path.join(installed, 'worker_checks.py')))(
    'prepares a synthetic two-commit candidate and real scoped/whole-worktree receipts in a disposable checkout, never a model or release',
    () => {
      const result = execFileSync('python', ['-I', '-B', path.resolve('tests\\fixtures\\fixerrors-repair-boundary.py'),
        installed, process.cwd(), process.execPath], {
        encoding: 'utf8', timeout: 120_000, maxBuffer: 16_384, windowsHide: true,
        env: { ...process.env, AVSWORKLOG_TEST_SKIP_DOTENV: '1' },
      });
      const output = JSON.parse(result);
      expect(output).toMatchObject({
        fixtureOnly: true, modelLaunched: false, released: false, preparedCommits: 2,
        realPreparedReceipts: 3, negativeChecks: 4,
      });
      const tested = resultSchema.parse(output.result);
      expect(tested.status).toBe('tested');
      if (tested.status !== 'tested') throw new Error('Synthetic prepared result missing');
      const evidence = preparedReleaseEvidenceSchema.parse(output.evidence);
      expect(tested.candidate.checksSha256).toBe(checkEvidenceDigest(tested.checks));
      expect(tested.checks.release?.testEvidenceSha256).toBe(
        createHash('sha256').update(encodePreparedReleaseEvidence(evidence)).digest('hex'),
      );
    }, 120_000,
  );
});
