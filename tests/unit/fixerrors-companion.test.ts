import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createManagedCompanionStopHandler, executeCompanionClaim, inspectCompanionWorkspace, releaseOwnedCompanionLock, unavailableFixerrorsExecutor,
  type CompanionDependencies, type TrustedFixerrorsExecutor,
} from '@/scripts/automation/fixerrors-companion';
import { candidate, FixtureStore, harness, workspace } from './fixerrors-control-fixtures';
import type { ExecutionResult } from '@/lib/fixerrors/protocol';
import { createHash } from 'crypto';

const packetFixture = vi.hoisted(() => ({
  bytes: Buffer.from('{}'), initialSize: 2, largestRead: 0, closed: false,
  packetHead: 'a'.repeat(40), packetTree: '', replacedLock: false, removedLock: false,
}));
vi.mock('@/scripts/automation/fixerrors-companion-packet', () => ({
  parseCompanionPacket: () => ({ retrieval: {
    baseHead: packetFixture.packetHead,
    treeFingerprint: packetFixture.packetTree || createHash('sha256').update(`${'b'.repeat(40)}\n`).digest('hex'),
  } }),
}));
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  existsSync: () => false,
  openSync: () => 7,
  fstatSync: () => ({ isFile: () => true, size: packetFixture.initialSize, dev: 1, ino: 7 }),
  lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, dev: 1, ino: packetFixture.replacedLock ? 8 : 7 }),
  unlinkSync: () => { packetFixture.removedLock = true; },
  readSync: (_file: number, buffer: Buffer, offset: number, length: number, position: number) => {
    packetFixture.largestRead = Math.max(packetFixture.largestRead, length);
    return packetFixture.bytes.copy(buffer, offset, position, position + length);
  },
  closeSync: () => { packetFixture.closed = true; },
}));
vi.mock('@/scripts/automation/fixerrors-device-admission', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/scripts/automation/fixerrors-device-admission')>();
  return {
    ...original,
    inspectFixedFixerrorsWorkspace: () => ({
      platform: 'win32', workspace: original.FIXERRORS_WORKSPACE, topLevel: original.FIXERRORS_WORKSPACE,
      gitDirectory: `${original.FIXERRORS_WORKSPACE}\\.git`, branch: 'main', porcelain: '',
      head: 'a'.repeat(40), tree: 'b'.repeat(40),
    }),
  };
});

async function setup(action: 'review' | 'repair' | 'deploy' = 'repair') {
  const store = new FixtureStore();
  const h = harness(store);
  if (action === 'deploy') await h.approve(await h.testedRepair());
  else await h.enqueue(action);
  const claim = await h.claim();
  const executor: TrustedFixerrorsExecutor = {
    available: true, execute: vi.fn<TrustedFixerrorsExecutor['execute']>(async () => ({ status: 'reviewed' })),
    localTestedCandidate: () => candidate,
  };
  const deps: CompanionDependencies = {
    executor, consent: () => ({ allowReadOnly: true, allowRepair: true, allowDeploy: true }),
    inspect: () => action === 'deploy' ? { ...workspace, head: candidate.head, tree: candidate.tree } : workspace,
    startDeploy: vi.fn(async () => {}),
    renew: vi.fn(async () => {}), complete: vi.fn(async () => {}),
  };
  return { claim, executor, deps };
}

afterEach(() => vi.useRealTimers());

describe('outbound companion: fake executors only, never real fap', () => {
  it('handles fragmented managed stop input with bounded state and stops exactly once', () => {
    const stop = vi.fn();
    const input = createManagedCompanionStopHandler(stop);
    input(Buffer.from('SQUIRES_'));
    input(Buffer.from('RUNNER_STOP'));
    expect(stop).not.toHaveBeenCalled();
    input(Buffer.from('\n'));
    input(Buffer.from('SQUIRES_RUNNER_STOP\n'));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('fails closed on invalid managed input without echoing its contents', () => {
    const stop = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      createManagedCompanionStopHandler(stop)(Buffer.from('synthetic-private-input'));
      expect(stop).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith('Managed companion input invalid; stopping without dispatch.');
    } finally {
      error.mockRestore();
    }
  });

  it('hashes only the bounded fixed packet and closes its descriptor', () => {
    packetFixture.bytes = Buffer.from('{}');
    packetFixture.initialSize = 2;
    packetFixture.closed = false;
    expect(inspectCompanionWorkspace()).toEqual({
      ...workspace, packetSha256: createHash('sha256').update(packetFixture.bytes).digest('hex'),
    });
    expect(packetFixture.closed).toBe(true);
  });

  it('bounds allocation and reads even if a packet grows after its initial stat', () => {
    packetFixture.bytes = Buffer.alloc(2 * 1024 * 1024);
    packetFixture.initialSize = 1;
    packetFixture.largestRead = 0;
    packetFixture.closed = false;
    expect(() => inspectCompanionWorkspace()).toThrow('changed or too large');
    expect(packetFixture.largestRead).toBe(packetFixture.initialSize + 1);
    expect(packetFixture.closed).toBe(true);
  });

  it('retains the original packet digest after repair prepares a new clean candidate', () => {
    packetFixture.bytes = Buffer.from('{}');
    packetFixture.initialSize = 2;
    packetFixture.packetHead = 'c'.repeat(40);
    expect(inspectCompanionWorkspace()).toEqual({
      ...workspace, packetSha256: createHash('sha256').update(packetFixture.bytes).digest('hex'),
    });
    packetFixture.packetHead = 'a'.repeat(40);
    packetFixture.packetTree = 'd'.repeat(64);
    expect(inspectCompanionWorkspace()?.head).toBe(workspace.head);
    packetFixture.packetTree = '';
  });

  it('never deletes another process lock, including a replacement at the same path', () => {
    packetFixture.replacedLock = true;
    packetFixture.removedLock = false;
    expect(() => releaseOwnedCompanionLock(7, 'fixture.lock')).toThrow('identity changed');
    expect(packetFixture.removedLock).toBe(false);
    packetFixture.replacedLock = false;
    releaseOwnedCompanionLock(7, 'fixture.lock');
    expect(packetFixture.removedLock).toBe(true);
  });

  it('has no installed bridge and always refuses the live execution path', async () => {
    const { claim, deps } = await setup();
    deps.executor = unavailableFixerrorsExecutor;
    await executeCompanionClaim(claim, deps);
    expect(deps.complete).toHaveBeenCalledWith({ status: 'blocked', reason: 'bridge-unavailable' });
    expect(unavailableFixerrorsExecutor.available).toBe(false);
  });

  it('checks local consent and workspace before invoking a fake executor', async () => {
    const { claim, deps, executor } = await setup();
    deps.consent = () => ({ allowReadOnly: true, allowRepair: false, allowDeploy: false });
    await executeCompanionClaim(claim, deps);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledWith({ status: 'blocked', reason: 'local-opt-out' });
  });

  it('forwards the actual admission and bounds repair by remaining job expiry', async () => {
    vi.useFakeTimers();
    const { claim, deps, executor } = await setup();
    vi.setSystemTime(claim.job.expiresAt - 30_000);
    claim.admissionTicket = 'synthetic-signed-admission';
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>((_job, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ status: 'blocked', reason: 'timeout' }), { once: true });
    }));
    const running = executeCompanionClaim(claim, deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.execute).toHaveBeenCalledWith(claim.job, expect.any(AbortSignal), undefined, claim.admissionTicket, undefined);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(deps.complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(deps.complete).toHaveBeenCalledWith({ status: 'blocked', reason: 'timeout' });
  });

  it('permits repair preparation beyond five minutes but stops at the eight-minute execution cap', async () => {
    vi.useFakeTimers();
    const { claim, deps, executor } = await setup();
    vi.setSystemTime(claim.job.expiresAt - 600_000);
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>((_job, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ status: 'blocked', reason: 'timeout' }), { once: true });
    }));
    const running = executeCompanionClaim(claim, deps);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(deps.complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(179_999);
    expect(deps.complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(deps.complete).toHaveBeenCalledWith({ status: 'blocked', reason: 'timeout' });
  });

  it('refuses dispatch when the lease is lost or checkout drifts during renewal', async () => {
    const { claim, deps, executor } = await setup();
    deps.renew = vi.fn(async () => { throw new Error('Lease lost'); });
    await expect(executeCompanionClaim(claim, deps)).rejects.toThrow('Lease lost');
    expect(executor.execute).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    deps.renew = vi.fn(async () => { deps.inspect = () => null; });
    await executeCompanionClaim(claim, deps);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledWith({ status: 'blocked', reason: 'checkout-drift' });
  });

  it('requires locally held exact check evidence as well as server approval', async () => {
    const { claim, deps, executor } = await setup('deploy');
    executor.localTestedCandidate = () => ({ ...candidate, checksSha256: '0'.repeat(64) });
    await executeCompanionClaim(claim, deps);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledWith({ status: 'blocked', reason: 'checkout-drift' });
  });

  it('executes only a proof fixture for an exact separately approved candidate', async () => {
    const { claim, deps, executor } = await setup('deploy');
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>(async () => ({ status: 'deployed', candidate }));
    await executeCompanionClaim(claim, deps);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(deps.startDeploy).toHaveBeenCalledTimes(1);
    expect(deps.renew).toHaveBeenCalledTimes(2);
    expect(deps.complete).toHaveBeenCalledWith({ status: 'deployed', candidate });
  });

  it('renews a deployment throughout a six-minute execution', async () => {
    vi.useFakeTimers();
    const { claim, deps, executor } = await setup('deploy');
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>(() => new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'deployed', candidate }), 6 * 60_000);
    }));
    const running = executeCompanionClaim(claim, deps);
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    await running;
    expect(deps.renew).toHaveBeenCalledTimes(25);
    expect(deps.complete).toHaveBeenCalledWith({ status: 'deployed', candidate });
  });

  it('reports an unknown deployment when the executor times out after starting', async () => {
    vi.useFakeTimers();
    const { claim, deps, executor } = await setup('deploy');
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>((_job, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ status: 'blocked', reason: 'timeout' }), { once: true });
    }));
    deps.timeoutMs = 100;
    const running = executeCompanionClaim(claim, deps);
    await vi.advanceTimersByTimeAsync(100);
    await running;
    expect(deps.complete).toHaveBeenCalledWith({ status: 'unknown', reason: 'release-unconfirmed' });
  });

  it('times out cooperatively, acknowledges cancellation and reports blocked', async () => {
    vi.useFakeTimers();
    const { claim, deps, executor } = await setup();
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>((_job, signal) => new Promise<ExecutionResult>((resolve) => {
      signal.addEventListener('abort', () => resolve({ status: 'blocked', reason: 'timeout' }), { once: true });
    }));
    deps.timeoutMs = 100;
    const running = executeCompanionClaim(claim, deps);
    await vi.advanceTimersByTimeAsync(100);
    await running;
    expect(deps.complete).toHaveBeenCalledWith({ status: 'blocked', reason: 'timeout' });
  });

  it('aborts on a lost running lease, without success or completion acknowledgement', async () => {
    vi.useFakeTimers();
    const { claim, deps, executor } = await setup();
    let aborted = false;
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>((_job, signal) => new Promise<ExecutionResult>((resolve) => {
      signal.addEventListener('abort', () => { aborted = true; resolve({ status: 'blocked', reason: 'lease-lost' }); }, { once: true });
    }));
    deps.renew = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('revoked'));
    const running = executeCompanionClaim(claim, deps);
    const rejected = expect(running).rejects.toThrow('lease lost');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(aborted).toBe(true);
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('retains a fail-closed unsafe-stop condition when a fake executor ignores cancellation', async () => {
    vi.useFakeTimers();
    const { claim, deps, executor } = await setup();
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>(async () => new Promise<ExecutionResult>(() => {}));
    deps.timeoutMs = 100;
    const running = executeCompanionClaim(claim, deps);
    const rejected = expect(running).rejects.toThrow('lock retained');
    await vi.advanceTimersByTimeAsync(5100);
    await rejected;
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('does not dispatch an already stopped claim or acknowledge an interrupted running claim', async () => {
    const { claim, deps, executor } = await setup();
    const shutdown = new AbortController();
    deps.signal = shutdown.signal;
    shutdown.abort();
    await expect(executeCompanionClaim(claim, deps)).rejects.toThrow('lock retained');
    expect(executor.execute).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();

    const activeShutdown = new AbortController();
    deps.signal = activeShutdown.signal;
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>((_job, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ status: 'reviewed' }), { once: true });
      activeShutdown.abort();
    }));
    await expect(executeCompanionClaim(claim, deps)).rejects.toThrow('lock retained');
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('does not dispatch when stopped during renewal or a deployment start transaction', async () => {
    const { claim, deps, executor } = await setup('deploy');
    const shutdown = new AbortController();
    deps.signal = shutdown.signal;
    deps.renew = vi.fn(async () => { shutdown.abort(); });
    await expect(executeCompanionClaim(claim, deps)).rejects.toThrow('lock retained');
    expect(deps.startDeploy).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();

    const deployShutdown = new AbortController();
    deps.signal = deployShutdown.signal;
    deps.renew = vi.fn(async () => {});
    deps.startDeploy = vi.fn(async () => { deployShutdown.abort(); });
    await expect(executeCompanionClaim(claim, deps)).rejects.toThrow('lock retained');
    expect(executor.execute).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('keeps shutdown authoritative when a pending renewal also fails', async () => {
    vi.useFakeTimers();
    const { claim, deps, executor } = await setup();
    const shutdown = new AbortController();
    deps.signal = shutdown.signal;
    deps.renew = vi.fn().mockResolvedValueOnce(undefined).mockImplementation(async () => {
      shutdown.abort();
      throw new Error('synthetic lease failure');
    });
    executor.execute = vi.fn<TrustedFixerrorsExecutor['execute']>((_job, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ status: 'reviewed' }), { once: true });
    }));
    const rejected = expect(executeCompanionClaim(claim, deps)).rejects.toThrow('lock retained');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(deps.complete).not.toHaveBeenCalled();
  });
});
