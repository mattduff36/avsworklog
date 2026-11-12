import { afterEach, describe, expect, it, vi } from 'vitest';
import { companionDeviceRequest } from '@/scripts/automation/fixerrors-companion';
import type { DeviceCommand } from '@/lib/fixerrors/protocol';
import { credential, deviceId } from './fixerrors-control-fixtures';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function delayedResponse(delay: number) {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('Request deadline')), ms);
    return controller.signal;
  });
  vi.stubGlobal('fetch', vi.fn((_url: unknown, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(JSON.stringify({ ok: true }))), delay);
    options.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal!.reason); }, { once: true });
  })));
}

describe('companion receipt settlement deadlines', () => {
  const enrollment = { deviceId, credential };
  const commands: DeviceCommand[] = [
    { op: 'complete', jobId: deviceId, leaseToken: 'a'.repeat(43), result: { status: 'no-change' } },
    { op: 'batch-reconcile', jobId: deviceId },
    { op: 'heartbeat', workspace: null, allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true },
  ];
  it.each(commands)('allows durable settlement past the polling deadline: $op', async command => {
    delayedResponse(15_000);
    const result = companionDeviceRequest(enrollment, command);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toEqual({ ok: true });
  });
  it('still bounds an unavailable receipt server', async () => {
    delayedResponse(61_000);
    const assertion = expect(companionDeviceRequest(enrollment, commands[1])).rejects.toThrow('Request deadline');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
  it('keeps ordinary polling on the shorter deadline', async () => {
    delayedResponse(15_000);
    const assertion = expect(companionDeviceRequest(enrollment, { op: 'claim' })).rejects.toThrow('Request deadline');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});
