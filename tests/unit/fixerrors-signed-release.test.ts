import { execFileSync } from 'child_process';
import { createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAdminCommand, applyDeviceCommand, checkEvidenceDigest, hash } from '@/lib/fixerrors/control';
import {
  encodePreparedReleaseEvidence, issueStartedReleaseTicket, prepareReleaseDeviceProof, verifyReleaseTicket,
  type PreparedReleaseEvidence, type ReleaseIssuer,
} from '@/lib/fixerrors/release';
import type { CheckEvidence, ReleaseMode } from '@/lib/fixerrors/protocol';
import { executeCompanionClaim, type TrustedFixerrorsExecutor } from '@/scripts/automation/fixerrors-companion';
import { createSignedReleaseFixtureExecutor } from '@/scripts/automation/fixerrors-signed-release';
import { actorId, checks, credential, deviceId, FixtureStore, now, workspace } from './fixerrors-control-fixtures';

vi.mock('child_process', async (original) => ({
  ...await original<typeof import('child_process')>(), execFileSync: vi.fn(),
}));

const releaseKey = generateKeyPairSync('ed25519');
const repairKey = generateKeyPairSync('ed25519');
const deviceKey = generateKeyPairSync('ed25519');
const issuer: ReleaseIssuer = {
  keyId: 'fixture-release', privateKey: releaseKey.privateKey,
  repairKeyId: 'fixture-repair', repairPublicKey: repairKey.publicKey,
};
const verifier = { ...issuer, publicKey: releaseKey.publicKey };
const evidence: PreparedReleaseEvidence = {
  repairJobId: 'd071629d-23de-4f76-930f-a6540b422831',
  head: checks.head, tree: checks.tree, candidateSha256: '4'.repeat(64),
  allChecksPassed: true, workerResultSha256: '5'.repeat(64),
  preparedChecks: {
    'targeted-tests': { receiptId: 'a'.repeat(32), sha256: checks.checks[0].outputSha256 },
    typecheck: { receiptId: 'b'.repeat(32), sha256: checks.checks[1].outputSha256 },
    lint: { receiptId: 'c'.repeat(32), sha256: checks.checks[2].outputSha256 },
  },
};
const preparedChecks: CheckEvidence = {
  ...checks,
  release: { candidateSha256: evidence.candidateSha256, testEvidenceSha256: hash(encodePreparedReleaseEvidence(evidence)) },
};
const candidate = { head: checks.head, tree: checks.tree, checksSha256: checkEvidenceDigest(preparedChecks) };
const clean = { ...workspace, head: checks.head, tree: checks.tree };

async function approved(releaseMode: ReleaseMode = 'full') {
  const store = new FixtureStore();
  const device = (command: Parameters<typeof applyDeviceCommand>[3], issue?: Parameters<typeof applyDeviceCommand>[5]) =>
    store.transact((tx) => applyDeviceCommand(tx, deviceId, credential, command, now, issue));
  const admin = (command: Parameters<typeof applyAdminCommand>[2]) =>
    store.transact((tx) => applyAdminCommand(tx, actorId, command, now));
  await admin({ op: 'enqueue', requestId: evidence.repairJobId, deviceId, action: 'repair' });
  const repair = await device({ op: 'claim' });
  if (!('claim' in repair) || !repair.claim) throw new Error('Fixture repair claim missing');
  await device({
    op: 'complete', jobId: evidence.repairJobId, leaseToken: repair.claim.leaseToken,
    result: { status: 'tested', candidate, checks: preparedChecks },
  });
  const approvalId = randomUUID();
  await admin({
    op: 'approve-deploy', requestId: approvalId, repairJobId: evidence.repairJobId,
    candidate, confirmation: true, releaseMode,
  });
  const response = await device({ op: 'claim' });
  if (!('claim' in response) || !response.claim) throw new Error('Fixture deploy claim missing');
  const claim = response.claim;
  const start = () => device({ op: 'start-deploy', jobId: claim.job.id, leaseToken: claim.leaseToken },
    (job, at) => issueStartedReleaseTicket(job, at, issuer));
  return { store, device, claim, start };
}

async function signed(mode: ReleaseMode = 'full') {
  const fixture = await approved(mode);
  const result = await fixture.start();
  if (!('releaseTicket' in result) || !result.releaseTicket) throw new Error('Missing signed ticket');
  return { ...fixture, ticket: result.releaseTicket };
}

const roots: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('signed release handoff: no worker, fap, commits or push', () => {
  function resign(ticket: Record<string, unknown>) {
    const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
    return JSON.stringify({ version: 1, keyId: issuer.keyId, payload,
      signature: sign(null, Buffer.from(`squires-windows-fap-v1\n${issuer.keyId}\n${payload}`), releaseKey.privateKey).toString('base64url') });
  }

  it.each(['full', 'targeted'] as const)('cryptographically binds %s, rejects mode tampering and mismatched local approvals', async (mode) => {
    const f = await signed(mode);
    const ticket = verifyReleaseTicket(f.ticket, verifier, now / 1000);
    expect(ticket.releaseMode).toBe(mode);
    const envelope = JSON.parse(f.ticket);
    envelope.payload = Buffer.from(JSON.stringify({ ...ticket, releaseMode: mode === 'full' ? 'targeted' : 'full' })).toString('base64url');
    expect(() => verifyReleaseTicket(JSON.stringify(envelope), verifier, now / 1000)).toThrow('signature');
    expect(() => prepareReleaseDeviceProof(f.ticket, evidence, {
      ...f.claim.job, approval: { ...f.claim.job.approval!, releaseMode: mode === 'full' ? 'targeted' : 'full' },
    }, verifier, deviceKey.privateKey, now / 1000)).toThrow('mismatch');
    expect(() => verifyReleaseTicket(resign({ ...ticket, releaseMode: 'fast' }), verifier, now / 1000)).toThrow();
    expect(() => verifyReleaseTicket(resign({ ...ticket, releaseMode: null }), verifier, now / 1000)).toThrow();
  });

  it('accepts original canonical historical tickets as full-only, never targeted', async () => {
    const f = await signed();
    const { releaseMode: _mode, ...legacy } = verifyReleaseTicket(f.ticket, verifier, now / 1000);
    const ticket = resign(legacy);
    expect(verifyReleaseTicket(ticket, verifier, now / 1000).releaseMode).toBeUndefined();
    expect(() => prepareReleaseDeviceProof(ticket, evidence, f.claim.job, verifier, deviceKey.privateKey, now / 1000)).not.toThrow();
    delete f.claim.job.approval!.releaseMode;
    expect(() => prepareReleaseDeviceProof(ticket, evidence, f.claim.job, verifier, deviceKey.privateKey, now / 1000)).not.toThrow();
    f.claim.job.approval!.releaseMode = 'targeted';
    expect(() => prepareReleaseDeviceProof(ticket, evidence, f.claim.job, verifier, deviceKey.privateKey, now / 1000)).toThrow('mismatch');
  });
  it('issues only after the authenticated separate approval enters started state', async () => {
    const f = await approved();
    expect(() => issueStartedReleaseTicket(f.claim.job, now, issuer)).toThrow('started approval');
    const started = await f.start();
    expect(started).toHaveProperty('releaseTicket');
    if (!('releaseTicket' in started) || !started.releaseTicket) throw new Error('No ticket');
    expect(verifyReleaseTicket(started.releaseTicket, verifier, now / 1000)).toMatchObject({
      approvalId: f.claim.job.id, repairJobId: evidence.repairJobId, approvedBy: actorId,
      head: candidate.head, tree: candidate.tree,
      candidateSha256: evidence.candidateSha256,
      testEvidenceSha256: hash(encodePreparedReleaseEvidence(evidence)),
    });
    await expect(f.start()).rejects.toThrow('cannot be started');
    expect(f.store.events.filter((event) => event.event === 'deploy-started')).toHaveLength(1);
  });

  it('never invokes the issuer with a wrong lease, expired approval or revoked device', async () => {
    const f = await approved();
    const issue = vi.fn(() => 'never');
    await expect(f.device({
      op: 'start-deploy', jobId: f.claim.job.id, leaseToken: 'y'.repeat(43),
    }, issue)).rejects.toThrow('Lease lost');
    f.store.state.devices[0].revoked = true;
    await expect(f.device({
      op: 'start-deploy', jobId: f.claim.job.id, leaseToken: f.claim.leaseToken,
    }, issue)).rejects.toThrow('Unauthorized');
    f.store.state.devices[0].revoked = false;
    f.store.state.jobs.find((job) => job.id === f.claim.job.id)!.expiresAt = now;
    await expect(f.device({
      op: 'start-deploy', jobId: f.claim.job.id, leaseToken: f.claim.leaseToken,
    }, issue)).rejects.toThrow('Lease lost');
    expect(issue).not.toHaveBeenCalled();
  });

  it('rolls back start and audit if signing fails; does not expose a ticket before commit', async () => {
    const f = await approved();
    await expect(f.device({
      op: 'start-deploy', jobId: f.claim.job.id, leaseToken: f.claim.leaseToken,
    }, () => { throw new Error('Signing unavailable'); })).rejects.toThrow('Signing unavailable');
    expect(f.store.state.jobs.find((job) => job.id === f.claim.job.id)?.lease?.deployStartedAt).toBeUndefined();
    expect(f.store.events.some((event) => event.event === 'deploy-started')).toBe(false);
  });

  it('rejects tampered signatures, reordered/duplicate envelopes and separate-key violations', async () => {
    const f = await signed();
    const value = JSON.parse(f.ticket);
    const wrong = { ...value, signature: sign(null, Buffer.from('wrong'), repairKey.privateKey).toString('base64url') };
    expect(() => verifyReleaseTicket(JSON.stringify(wrong), verifier, now / 1000)).toThrow('signature');
    expect(() => verifyReleaseTicket(`{"version":1,${f.ticket.slice(1)}`, verifier, now / 1000)).toThrow('noncanonical');
    expect(() => verifyReleaseTicket(JSON.stringify({
      keyId: value.keyId, version: 1, payload: value.payload, signature: value.signature,
    }), verifier, now / 1000)).toThrow('noncanonical');
    expect(() => verifyReleaseTicket(f.ticket, { ...verifier, repairKeyId: issuer.keyId }, now / 1000)).toThrow('separate');
    expect(() => verifyReleaseTicket(f.ticket, { ...verifier, repairPublicKey: releaseKey.publicKey }, now / 1000)).toThrow('separate');
  });

  it('enforces exclusive expiry, no future grace and the five-minute lifetime', async () => {
    const f = await signed();
    const ticket = verifyReleaseTicket(f.ticket, verifier, now / 1000);
    expect(() => verifyReleaseTicket(f.ticket, verifier, ticket.expiresAt)).toThrow('expired');
    expect(() => verifyReleaseTicket(f.ticket, verifier, ticket.issuedAt - 1)).toThrow('expired');
    const altered = { ...ticket, expiresAt: ticket.issuedAt + 301 };
    const payload = Buffer.from(JSON.stringify(altered)).toString('base64url');
    const raw = JSON.stringify({
      version: 1, keyId: issuer.keyId, payload,
      signature: sign(null, Buffer.from(`squires-windows-fap-v1\n${issuer.keyId}\n${payload}`),
        releaseKey.privateKey).toString('base64url'),
    });
    expect(() => verifyReleaseTicket(raw, verifier, now / 1000)).toThrow('expired');
  });

  it.each(['head', 'tree', 'candidateSha256', 'workerResultSha256'] as const)(
    'rejects changed local evidence %s', async (key) => {
      const f = await signed();
      expect(() => prepareReleaseDeviceProof(f.ticket, {
        ...evidence, [key]: 'f'.repeat(key === 'head' || key === 'tree' ? 40 : 64),
      }, f.claim.job, verifier, deviceKey.privateKey, now / 1000)).toThrow('mismatch');
    },
  );

  it('binds prepared receipt bytes, device identity, approver and check digest', async () => {
    const f = await signed();
    const proof = () => prepareReleaseDeviceProof(f.ticket, evidence, f.claim.job, verifier, deviceKey.privateKey, now / 1000);
    expect(JSON.parse(proof().toString())).toHaveProperty('signature');
    for (const change of [
      { deviceId: randomUUID() }, { parentRepairId: randomUUID() },
      { candidate: { ...candidate, checksSha256: 'f'.repeat(64) } },
      { approval: { ...f.claim.job.approval!, actorId: randomUUID() } },
    ]) {
      expect(() => prepareReleaseDeviceProof(f.ticket, evidence, { ...f.claim.job, ...change },
        verifier, deviceKey.privateKey, now / 1000)).toThrow('mismatch');
    }
    expect(() => prepareReleaseDeviceProof(f.ticket, evidence, f.claim.job, verifier,
      releaseKey.privateKey, now / 1000)).toThrow('separate device');
    const outer = JSON.parse(proof().toString());
    expect(verify(null, Buffer.from(`squires-companion-release-v1\n${outer.payload}`),
      deviceKey.publicKey, Buffer.from(outer.signature, 'base64url'))).toBe(true);
  });

  it('keeps prepared release hashes inside the exact browser-approved checks digest', () => {
    expect(checkEvidenceDigest(checks)).not.toBe(checkEvidenceDigest(preparedChecks));
    expect(checkEvidenceDigest({
      ...preparedChecks, release: { ...preparedChecks.release!, testEvidenceSha256: 'f'.repeat(64) },
    })).not.toBe(candidate.checksSha256);
  });

  it('does not inspect, sign or invoke a transport when disabled', () => {
    const invoke = vi.fn();
    const executor = createSignedReleaseFixtureExecutor({
      enabled: false, scope: { root: 'D:\\Websites\\avsworklog', gitExe: 'ignored' },
      verifier, deviceKey: deviceKey.privateKey,
      evidence: () => { throw new Error('Must not read evidence'); },
      testedCandidate: () => candidate, transport: { fixtureOnly: true, invoke }, nowSeconds: () => now / 1000,
    });
    expect(executor.available).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('forwards only the started server response, never a browser claim field', async () => {
    const f = await approved();
    const execute = vi.fn<TrustedFixerrorsExecutor['execute']>(async () => ({ status: 'deployed', candidate }));
    const lease = { jobId: f.claim.job.id, leaseToken: f.claim.leaseToken };
    await executeCompanionClaim(f.claim, {
      executor: { available: true, execute, localTestedCandidate: () => candidate },
      consent: () => ({ allowDeploy: true, allowReadOnly: false, allowRepair: false }), inspect: () => clean,
      startDeploy: async () => {
        const result = await f.start();
        return 'releaseTicket' in result ? { releaseTicket: result.releaseTicket } : {};
      },
      renew: async () => { await f.device({ op: 'renew', ...lease }); },
      complete: async (result) => { await f.device({ op: 'complete', ...lease, result }); },
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(verifyReleaseTicket(execute.mock.calls[0][2]!, verifier, now / 1000).approvalId).toBe(f.claim.job.id);
  });

  it('does not invoke an executor if transactional start fails', async () => {
    const f = await approved();
    const execute = vi.fn();
    await expect(executeCompanionClaim(f.claim, {
      executor: { available: true, execute, localTestedCandidate: () => candidate },
      consent: () => ({ allowDeploy: true, allowReadOnly: false, allowRepair: false }), inspect: () => clean,
      startDeploy: async () => { throw new Error('Commit uncertain'); },
      renew: async () => {}, complete: async () => {},
    })).rejects.toThrow('Commit uncertain');
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows only isolated temporary fixture directories, not the working repository', () => {
    expect(() => createSignedReleaseFixtureExecutor({
      enabled: true, scope: { root: 'D:\\Websites\\avsworklog', gitExe: 'C:\\Program Files\\Git\\cmd\\git.exe' },
      verifier, deviceKey: deviceKey.privateKey, evidence: () => evidence, testedCandidate: () => candidate,
      transport: { fixtureOnly: true, invoke: vi.fn() }, nowSeconds: () => now / 1000,
    })).toThrow('isolated');
  });

  it.skipIf(process.platform !== 'win32')('requires a guarded filesystem remote before handing proof to a paired transport', async () => {
    const f = await signed();
    const root = path.join(tmpdir(), `SquiresSignedReleaseFixture-${randomUUID()}`);
    roots.push(root);
    mkdirSync(path.join(root, 'checkout', '.git'), { recursive: true });
    mkdirSync(path.join(root, 'remote.git'));
    const gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe';
    const responses: Record<string, string> = {
      'rev-parse --show-toplevel': path.join(root, 'checkout'),
      'rev-parse --absolute-git-dir': path.join(root, 'checkout', '.git'),
      'branch --show-current': 'main', 'status --porcelain=v1 --untracked-files=all': '',
      remote: 'origin', 'remote get-url --all origin': path.join(root, 'remote.git'),
      'remote get-url --push --all origin': path.join(root, 'remote.git'),
      'rev-parse --is-bare-repository': 'true',
      'rev-parse HEAD': candidate.head, 'rev-parse HEAD^{tree}': candidate.tree,
    };
    vi.mocked(execFileSync).mockImplementation((_file, args) => responses[args!.slice(4).join(' ')] ?? '');
    const invoke = vi.fn(async () => ({
      approvalId: f.claim.job.id, repairJobId: evidence.repairJobId,
      status: 'released' as const, deploymentId: 'fixture-only',
    }));
    let secondsNow = now / 1000;
    const executor = createSignedReleaseFixtureExecutor({
      enabled: true, scope: { root, gitExe }, verifier, deviceKey: deviceKey.privateKey,
      evidence: () => evidence, testedCandidate: () => candidate,
      transport: { fixtureOnly: true, invoke }, nowSeconds: () => secondsNow,
    });
    expect(await executor.execute(f.claim.job, new AbortController().signal)).toMatchObject({ status: 'blocked' });
    expect(invoke).not.toHaveBeenCalled();
    secondsNow += 300;
    await expect(executor.execute(f.claim.job, new AbortController().signal, f.ticket)).rejects.toThrow('expired');
    secondsNow -= 300;
    const bad = JSON.parse(f.ticket);
    bad.signature = sign(null, Buffer.from('tamper'), repairKey.privateKey).toString('base64url');
    await expect(executor.execute(f.claim.job, new AbortController().signal, JSON.stringify(bad))).rejects.toThrow('signature');
    responses['rev-parse HEAD'] = 'f'.repeat(40);
    expect(await executor.execute(f.claim.job, new AbortController().signal, f.ticket)).toMatchObject({ status: 'blocked' });
    responses['rev-parse HEAD'] = candidate.head;
    expect(invoke).not.toHaveBeenCalled();
    expect(await executor.execute(f.claim.job, new AbortController().signal, f.ticket)).toMatchObject({ status: 'deployed' });
    expect(invoke).toHaveBeenCalledOnce();
    for (const remote of [
      'https://github.com/not/allowed', 'D:\\arbitrary.git',
      `${path.join(root, 'remote.git')}\nD:\\extra.git`,
    ]) {
      responses['remote get-url --push --all origin'] = remote;
      await expect(executor.execute(f.claim.job, new AbortController().signal, f.ticket)).rejects.toThrow('filesystem remote');
    }
    expect(invoke).toHaveBeenCalledOnce();
  });
});

const staged = path.resolve('scripts\\automation');
it.skipIf(!existsSync(path.join(staged, 'squires_companion.py')))(
  'interoperates with repository Python signatures and rejects candidate drift before replay or execution',
  async () => {
    const f = await signed();
    const proof = prepareReleaseDeviceProof(f.ticket, evidence, f.claim.job, verifier, deviceKey.privateKey, now / 1000);
    // Use the original native function only for this bounded, non-launching verifier.
    const native = await vi.importActual<typeof import('child_process')>('child_process');
    const config = {
      deviceId, environment: 'squires-production', allowRelease: true,
      issuer: { keyId: issuer.repairKeyId, publicKeyPem: repairKey.publicKey.export({ type: 'spki', format: 'pem' }) },
      releaseIssuer: { keyId: issuer.keyId, publicKeyPem: releaseKey.publicKey.export({ type: 'spki', format: 'pem' }) },
      devicePublicKeyPem: createPublicKey(deviceKey.privateKey).export({ type: 'spki', format: 'pem' }),
    };
    const script = [
      'import sys,json',
      'sys.path.insert(0,sys.argv[1])',
      'import squires_companion as s',
      'x=json.load(sys.stdin)',
      'body=s.signed_device(x["proof"].encode(),"release",x["config"])',
      'ticket=s.signed_ticket(body["ticket"],x["config"],"release",x["now"])',
      'assert ticket["releaseMode"]=="full"',
      'assert s.sha(s.unb64(body["testEvidence"],s.MAX_PACKET))==ticket["testEvidenceSha256"]',
      'for at in (ticket["expiresAt"], ticket["issuedAt"]-1):',
      ' try: s.signed_ticket(body["ticket"],x["config"],"release",at)',
      ' except s.Denied: pass',
      ' else: raise AssertionError("expiry accepted")',
      'bad=dict(x["config"],devicePublicKeyPem=x["config"]["issuer"]["publicKeyPem"])',
      'try: s.signed_device(x["proof"].encode(),"release",bad)',
      'except s.Denied: pass',
      'else: raise AssertionError("wrong device signature accepted")',
      'from unittest.mock import patch',
      'with patch.object(s.time,"time",return_value=x["now"]):',
      ' try: s.release(x["proof"].encode(),x["config"],lambda t,r:("wrong","candidate","digest"),lambda t:sys.exit(99))',
      ' except s.Denied as denied: assert str(denied)=="reviewed_candidate_changed"',
      ' else: raise AssertionError("candidate drift accepted")',
      'print(json.dumps({"approvalId":ticket["approvalId"],"negativeChecks":4}))',
    ].join('\n');
    const text = native.execFileSync('python', ['-I', '-B', '-c', script, staged], {
      input: JSON.stringify({ proof: proof.toString(), config, now: now / 1000 }), encoding: 'utf8',
      timeout: 10_000, maxBuffer: 4096, windowsHide: true, shell: false,
    });
    expect(JSON.parse(text)).toEqual({ approvalId: f.claim.job.id, negativeChecks: 4 });
  },
);

it.each(['targeted', 'full', undefined, 'fast', null])('native verifier validates canonical signed mode %s without a replay claim or launch', async (mode) => {
  const f = await signed();
  const ticket = verifyReleaseTicket(f.ticket, verifier, now / 1000);
  const { releaseMode: _mode, ...legacy } = ticket;
  const body = mode === undefined ? legacy : { ...legacy, releaseMode: mode };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const envelope = JSON.stringify({ version: 1, keyId: issuer.keyId, payload,
    signature: sign(null, Buffer.from(`squires-windows-fap-v1\n${issuer.keyId}\n${payload}`), releaseKey.privateKey).toString('base64url') });
  const config = { deviceId, environment: 'squires-production',
    releaseIssuer: { keyId: issuer.keyId, publicKeyPem: releaseKey.publicKey.export({ type: 'spki', format: 'pem' }) } };
  const script = [
    'import sys,json', 'sys.path.insert(0,sys.argv[1])', 'import squires_companion as s', 'x=json.load(sys.stdin)',
    'try:', ' t=s.signed_ticket(x["ticket"],x["config"],"release",x["now"])',
    'except s.Denied:', ' assert not x["valid"]',
    'else:', ' assert x["valid"] and t.get("releaseMode","full")==x["expected"]',
    'print("mode verified")',
  ].join('\n');
  const native = await vi.importActual<typeof import('child_process')>('child_process');
  expect(native.execFileSync('python', ['-I', '-B', '-c', script, staged], {
    input: JSON.stringify({ ticket: envelope, config, now: now / 1000,
      valid: mode === undefined || mode === 'full' || mode === 'targeted', expected: mode ?? 'full' }),
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  })).toContain('mode verified');
});
