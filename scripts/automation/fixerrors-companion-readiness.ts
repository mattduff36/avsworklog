import { spawn } from 'child_process';
import type { Checkout } from '../../lib/fixerrors/protocol';
import { FIXERRORS_WORKSPACE } from './fixerrors-device-admission';

type Mode = 'ready' | 'check';
export class UncertainReadinessStop extends Error {}
export function runCompanionCacheCheck(mode: Mode): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // The cache owns its direct compiler's 120-second timeout. Do not kill only
    // this wrapper (or kill it through an output-buffer limit) while its child lives.
    const child = spawn(process.execPath, ['scripts/automation/fixerrors-typecheck-cache.mjs', mode], {
      cwd: FIXERRORS_WORKSPACE, windowsHide: true, stdio: 'ignore', shell: false,
      env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' },
    });
    child.once('error', () => child.pid
      ? reject(new UncertainReadinessStop('Local check process outcome is uncertain')) : resolve(false));
    child.once('close', (code, signal) => {
      if (signal || code === null || code < 0 || code > 255) reject(new UncertainReadinessStop('Local check process outcome is uncertain'));
      else resolve(code === 0);
    });
  });
}

/** Refresh source-only cache drift before admission; never provision or replace a damaged cache. */
export async function prepareCompanionChecks(
  checkout: Checkout,
  inspect: () => Checkout | null,
  heartbeat: () => Promise<void>,
  run: (mode: Mode) => Promise<boolean> = runCompanionCacheCheck,
): Promise<boolean> {
  const work = (async () => {
    if (!await run('ready') && (!await run('check') || !await run('ready'))) return false;
    const current = inspect();
    return Boolean(current?.clean && current.head === checkout.head && current.tree === checkout.tree);
  })();
  let finished = false;
  void work.finally(() => { finished = true; }).catch(() => {});
  try {
    while (!finished) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, 10_000); })]);
      } finally { clearTimeout(timer); }
      if (!finished) await heartbeat();
    }
    return await work;
  } catch (error) {
    // Wait for the bounded checker before allowing the host to release its ownership lock.
    try { await work; } catch (workError) {
      if (workError instanceof UncertainReadinessStop) throw workError;
    }
    if (error instanceof UncertainReadinessStop) throw error;
    return false;
  }
}
