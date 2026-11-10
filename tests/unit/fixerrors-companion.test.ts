import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeCompanionClaim, inspectCompanionWorkspace, unavailableFixerrorsExecutor,
  type CompanionDependencies, type TrustedFixerrorsExecutor,
} from '@/scripts/automation/fixerrors-companion';
import { candidate, FixtureStore, harness, workspace } from './fixerrors-control-fixtures';
import type { ExecutionResult } from '@/lib/fixerrors/protocol';
import { createHash } from 'crypto';

const packetFixture = vi.hoisted(() => ({
  bytes: Buffer.from('{}'), initialSize: 2, largestRead: 0, closed: false,
}));
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  openSync: () => 7,
  fstatSync: () => ({ isFile: () => true, size: packetFixture.initialSize }),
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
    expect(packetFixture.largestRead).toBe(96 * 1024 + 1);
    expect(packetFixture.closed).toBe(true);
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
    expect(executor.execute).toHaveBeenCalledWith(claim.job, expect.any(AbortSignal), undefined, claim.admissionTicket);
    await vi.advanceTimersByTimeAsync(19_999);
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
});
