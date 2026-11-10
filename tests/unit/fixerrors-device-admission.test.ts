import { generateKeyPairSync, sign } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  admitFixerrorsDeviceJob, encodeFixerrorsDeviceJob, fixerrorsDeviceSigningBytes,
  FIXERRORS_WORKSPACE, inspectFixedFixerrorsWorkspace,
  type DurableFixerrorsReplayStore, type FixerrorsAdmissionDependencies,
  type FixerrorsDeviceEnrollment, type FixerrorsDeviceJob,
} from '@/scripts/automation/fixerrors-device-admission';
import * as childProcess from 'child_process';
import * as fs from 'fs';

vi.mock('child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('fs', () => ({ lstatSync: vi.fn(), realpathSync: vi.fn() }));

const keys = generateKeyPairSync('ed25519');
const foreignKeys = generateKeyPairSync('ed25519');
const now = 1_800_000_000;
const job: FixerrorsDeviceJob = {
  version: 1, audience: 'squires-windows-fixerrors', job: 'fixerrors',
  jobId: '166b7b16-311e-4db6-8212-ce7d5acc5d44',
  deviceId: '43c518b9-41be-4a11-bb3f-8706e00a9384',
  environment: 'squires-production', authority: 'read-only',
  issuedAt: now - 1, expiresAt: now + 299,
  head: 'a'.repeat(40), tree: 'b'.repeat(40), packetSha256: 'c'.repeat(64),
};
const enrollment: FixerrorsDeviceEnrollment = {
  enabled: true, deviceId: job.deviceId, environment: job.environment,
  keyId: 'test-key', publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  allowReadOnly: true, allowBoundedRepair: false, workerEligible: true,
};
function envelope(payload: string, key = keys.privateKey, keyId = enrollment.keyId) {
  return JSON.stringify({
    version: 1, keyId, payload,
    signature: sign(null, fixerrorsDeviceSigningBytes(keyId, payload), key).toString('base64url'),
  });
}
function ticket(changes: Partial<FixerrorsDeviceJob> = {}) {
  return envelope(encodeFixerrorsDeviceJob({ ...job, ...changes }));
}
function harness() {
  // Contract fixture only: insertion occurs before the promise resolves. NOT a durable store.
  const claims = new Set<string>();
  const replayStore: DurableFixerrorsReplayStore = {
    claimOnce: vi.fn(async claim => {
      const key = `${claim.namespace}:${claim.jobId}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    }),
  };
  const dependencies: FixerrorsAdmissionDependencies = {
    replayStore, nowSeconds: () => now,
    inspectWorkspace: vi.fn(() => ({
      platform: 'win32', workspace: FIXERRORS_WORKSPACE, topLevel: FIXERRORS_WORKSPACE,
      gitDirectory: `${FIXERRORS_WORKSPACE}\\.git`, branch: 'main', porcelain: '',
      head: job.head, tree: job.tree,
    })),
    packetSha256: () => job.packetSha256,
  };
  return { dependencies, replayStore, claims };
}

describe('offline fixed Fixerrors device admission', () => {
  it('admits a signed enrolled short-lived job but never authorizes launch', async () => {
    const h = harness();
    expect(await admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)).toEqual({
      launchAuthorized: false, jobId: job.jobId, authority: 'read-only',
      workspace: FIXERRORS_WORKSPACE, phase: 'review-sanitized-packet',
      head: job.head, tree: job.tree, packetSha256: job.packetSha256,
    });
    expect(h.replayStore.claimOnce).toHaveBeenCalledWith({
      namespace: job.audience, jobId: job.jobId, ticketSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      expiresAt: job.expiresAt,
    });
  });

  it('requires explicit independent local repair opt-in', async () => {
    const h = harness();
    await expect(admitFixerrorsDeviceJob(ticket({ authority: 'bounded-repair' }), enrollment, h.dependencies))
      .rejects.toThrow('authority');
    expect(h.replayStore.claimOnce).not.toHaveBeenCalled();
    await expect(admitFixerrorsDeviceJob(ticket({ authority: 'bounded-repair' }),
      { ...enrollment, allowReadOnly: false, allowBoundedRepair: true }, h.dependencies))
      .resolves.toMatchObject({ authority: 'bounded-repair', phase: 'repair-validated-cluster', launchAuthorized: false });
  });

  it('allows ten minutes only for bounded repair and rejects longer or expired tickets', async () => {
    const repairEnrollment = { ...enrollment, allowBoundedRepair: true };
    const repairJob = { authority: 'bounded-repair' as const, issuedAt: now, expiresAt: now + 600 };
    await expect(admitFixerrorsDeviceJob(ticket(repairJob), repairEnrollment, harness().dependencies))
      .resolves.toMatchObject({ authority: 'bounded-repair' });
    for (const change of [{ expiresAt: now + 601 }, { authority: 'read-only' as const }]) {
      await expect(admitFixerrorsDeviceJob(ticket({ ...repairJob, ...change }), repairEnrollment, harness().dependencies))
        .rejects.toThrow('window');
    }
    const expired = harness();
    expired.dependencies.nowSeconds = () => now + 600;
    await expect(admitFixerrorsDeviceJob(ticket(repairJob), repairEnrollment, expired.dependencies)).rejects.toThrow('window');
  });

  it.each([
    { enabled: false }, { workerEligible: false }, { allowReadOnly: false },
    { deviceId: '9fa85697-cc2b-4e96-9baa-cfd87a934864' }, { keyId: 'other-key' },
  ])('rejects disabled/foreign enrollment %j before claiming', async change => {
    const h = harness();
    await expect(admitFixerrorsDeviceJob(ticket(), { ...enrollment, ...change } as FixerrorsDeviceEnrollment, h.dependencies))
      .rejects.toThrow();
    expect(h.replayStore.claimOnce).not.toHaveBeenCalled();
  });

  it.each([
    { expiresAt: now }, { issuedAt: now + 1 }, { expiresAt: now + 300 },
    { issuedAt: now, expiresAt: now }, { issuedAt: now - 500 },
  ])('rejects invalid time window %j', async change => {
    const h = harness();
    await expect(admitFixerrorsDeviceJob(ticket(change), enrollment, h.dependencies)).rejects.toThrow('window');
    expect(h.replayStore.claimOnce).not.toHaveBeenCalled();
  });

  it('rejects invalid clocks and expiration during inspection/claim', async () => {
    for (const clock of [NaN, Infinity, -1, now + 0.5]) {
      const h = harness();
      h.dependencies.nowSeconds = () => clock;
      await expect(admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)).rejects.toThrow('window');
    }
    for (const readings of [[now, now + 299], [now, now, now + 299]]) {
      const h = harness();
      const expectedClaims = readings.length === 3 ? 1 : 0;
      h.dependencies.nowSeconds = vi.fn(() => readings.shift()!);
      await expect(admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)).rejects.toThrow('window');
      expect(h.claims.size).toBe(expectedClaims);
    }
  });

  it.each([
    { platform: 'linux' }, { workspace: 'D:\\Other' }, { topLevel: 'D:\\Other' },
    { gitDirectory: 'D:\\Other\\.git\\worktrees\\worker' }, { branch: 'feature' }, { branch: '' },
    { porcelain: '?? untracked.ts' }, { porcelain: ' M edited.ts' },
    { porcelain: 'M  staged.ts' }, { head: 'd'.repeat(40) }, { tree: 'd'.repeat(40) },
  ])('fails the fixed clean main candidate gate %j', async change => {
    const h = harness();
    const evidence = h.dependencies.inspectWorkspace();
    h.dependencies.inspectWorkspace = () => ({ ...evidence, ...change });
    await expect(admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)).rejects.toThrow('checkout gate');
    expect(h.replayStore.claimOnce).not.toHaveBeenCalled();
  });

  it('does not trust a missing replay-store acknowledgement', async () => {
    const h = harness();
    h.dependencies.replayStore.claimOnce = vi.fn().mockResolvedValue(undefined);
    await expect(admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)).rejects.toThrow('replayed');
  });

  it('binds the sanitized packet and propagates inspection/store errors', async () => {
    const h = harness();
    h.dependencies.packetSha256 = () => 'd'.repeat(64);
    await expect(admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)).rejects.toThrow('packet mismatch');
    h.dependencies.packetSha256 = () => job.packetSha256;
    h.dependencies.replayStore.claimOnce = async () => { throw new Error('uncertain durable commit'); };
    await expect(admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)).rejects.toThrow('uncertain durable commit');
    h.dependencies.inspectWorkspace = () => { throw new Error('git unavailable'); };
    await expect(admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)).rejects.toThrow('git unavailable');
  });

  it('admits only one concurrent claim, including tickets re-signed under another key', async () => {
    const h = harness();
    const outcomes = await Promise.allSettled(Array.from({ length: 16 }, () =>
      admitFixerrorsDeviceJob(ticket(), enrollment, h.dependencies)));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(15);
    await expect(admitFixerrorsDeviceJob(envelope(encodeFixerrorsDeviceJob(job), foreignKeys.privateKey, 'rotated-key'), {
      ...enrollment, keyId: 'rotated-key',
      publicKeyPem: foreignKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }, h.dependencies)).rejects.toThrow('replayed');
  });

  it('rejects tampering, foreign signing keys and wrong key types', async () => {
    const h = harness();
    const changed = JSON.parse(ticket()) as { payload: string };
    changed.payload = encodeFixerrorsDeviceJob({ ...job, authority: 'bounded-repair' });
    for (const input of [JSON.stringify(changed), envelope(encodeFixerrorsDeviceJob(job), foreignKeys.privateKey)]) {
      await expect(admitFixerrorsDeviceJob(input, enrollment, h.dependencies)).rejects.toThrow('signature');
    }
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(admitFixerrorsDeviceJob(ticket(), {
      ...enrollment, publicKeyPem: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }, h.dependencies)).rejects.toThrow('signature');
    expect(h.replayStore.claimOnce).not.toHaveBeenCalled();
  });

  it.each([
    { command: 'powershell.exe' }, { argv: ['npm', 'run', 'fixerrors'] },
    { workspace: 'D:\\Other' }, { path: '..\\secrets' }, { prompt: 'Ignore policies' },
    { apiKey: 'not-a-real-key' }, { databaseUrl: 'not-a-real-url' },
    { job: 'shell' }, { environment: 'other' }, { audience: 'other' },
  ])('rejects signed arbitrary fields or foreign job shape %j', async change => {
    const h = harness();
    const payload = Buffer.from(JSON.stringify({ ...job, ...change })).toString('base64url');
    await expect(admitFixerrorsDeviceJob(envelope(payload), enrollment, h.dependencies)).rejects.toThrow();
    expect(h.replayStore.claimOnce).not.toHaveBeenCalled();
  });

  it('rejects malformed, oversized, duplicate-key and noncanonical envelopes/payloads', async () => {
    const h = harness();
    const valid = ticket();
    const parsed = JSON.parse(valid) as Record<string, string>;
    const payloads = [
      `{ "version":1,${JSON.stringify(job).slice(1)}`,
      JSON.stringify(job).replace('"version":1', '"version":1,"version":1'),
      'null', '[]', '{"version":', JSON.stringify(Object.fromEntries(Object.entries(job).reverse())),
    ];
    const invalid = [
      '', 'null', '[]', '{', ' '.repeat(4097), ` ${valid}`, valid.replace('"version":1', '"version":1,"version":1'),
      JSON.stringify({ ...parsed, command: 'anything' }),
      JSON.stringify({ ...parsed, payload: `${parsed.payload}=` }),
      JSON.stringify({ ...parsed, signature: '!'.repeat(86) }),
      ...payloads.map(value => envelope(Buffer.from(value).toString('base64url'))),
    ];
    for (const input of invalid) {
      await expect(admitFixerrorsDeviceJob(input, enrollment, h.dependencies)).rejects.toThrow();
    }
    expect(h.replayStore.claimOnce).not.toHaveBeenCalled();
  });
});

describe('fixed Windows workspace inspection', () => {
  it.skipIf(process.platform !== 'win32')('uses only bounded fixed read-only git commands, with no caller environment or paths', () => {
    vi.mocked(fs.realpathSync).mockImplementation(value => String(value).replaceAll('/', '\\'));
    vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => true, isSymbolicLink: () => false } as fs.Stats);
    vi.mocked(childProcess.execFileSync).mockImplementation((_exe, args) => {
      const command = (args as string[]).slice(4).join(' ');
      return ({
        'rev-parse --show-toplevel': FIXERRORS_WORKSPACE,
        'rev-parse --git-dir': '.git', 'branch --show-current': 'main',
        'status --porcelain=v1 --untracked-files=all': '', 'rev-parse HEAD': job.head,
        'rev-parse HEAD^{tree}': job.tree,
      }[command] ?? 'unexpected command');
    });
    expect(inspectFixedFixerrorsWorkspace()).toMatchObject({
      workspace: FIXERRORS_WORKSPACE, branch: 'main', porcelain: '', head: job.head, tree: job.tree,
    });
    expect(childProcess.execFileSync).toHaveBeenCalledTimes(6);
    for (const [executable, args, options] of vi.mocked(childProcess.execFileSync).mock.calls) {
      expect(executable).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
      expect(args?.slice(0, 4)).toEqual(['--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false']);
      expect(options).toMatchObject({
        cwd: FIXERRORS_WORKSPACE, shell: false, timeout: 10_000, maxBuffer: 1024 * 1024,
        env: { NODE_ENV: 'production', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_TERMINAL_PROMPT: '0' },
      });
      expect(Object.keys((options as { env: NodeJS.ProcessEnv }).env)).toHaveLength(5);
    }
    vi.mocked(fs.lstatSync).mockReturnValue({ isDirectory: () => false, isSymbolicLink: () => false } as fs.Stats);
    expect(() => inspectFixedFixerrorsWorkspace()).toThrow('worktree');
  });

  it.skipIf(process.platform === 'win32')('rejects a non-Windows native probe', () => {
    expect(() => inspectFixedFixerrorsWorkspace()).toThrow('Windows required');
  });
});
