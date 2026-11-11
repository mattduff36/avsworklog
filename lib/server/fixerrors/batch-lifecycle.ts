import 'server-only';
import type { QueueStore } from '@/lib/fixerrors/control';
import { parseBatchBytes } from '@/lib/fixerrors/batch';
import { buildAutomaticLifecyclePlan } from '@/scripts/fixerrors-lifecycle-run';
import { applyLifecyclePlan, hashLifecycleRecord } from '@/scripts/fixerrors-lifecycle';
import { withFixerrorsApplicationDatabase } from './evidence';

function lifecycleBlocker(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/commit may have completed/u.test(message)) return 'uncertain' as const;
  if (/trigger\/schema|operational trust/u.test(message)) return 'schema' as const;
  if (/expired|expiry/u.test(message)) return 'expired' as const;
  if (/row|fingerprint|state changed|coverage|transition|receipt/iu.test(message)) return 'conflict' as const;
  return 'unavailable' as const;
}

// Save the immutable exact-row plan before touching application storage. A lost
// commit acknowledgement retries this same plan against the database receipts.
export async function reconcileBatchLifecycle(store: QueueStore, jobId: string) {
  const saved = await store.transact(({ state }) => {
    const job = state.jobs.find(entry => entry.id === jobId);
    const batch = job?.privateBatch;
    if (!job || !batch?.outcome || !job.batch) return null;
    if (!batch.lifecycle) {
      try {
        batch.lifecycle = {
          state: 'pending', receipts: {},
          plan: buildAutomaticLifecyclePlan({
            result: batch.outcome, retrieval: parseBatchBytes(Buffer.from(batch.manifest)).retrieval,
            bindings: batch.bindings, suppressed: batch.suppressed, target: batch.target,
          }),
        };
      } catch {
        console.error('Fixerrors lifecycle plan blocked by captured evidence conflict; evidence retained.');
        batch.lifecycle = { state: 'blocked', reason: 'conflict', plan: null, receipts: {} };
      }
    }
    job.batch.lifecycle = batch.lifecycle.state;
    job.batch.lifecycleReason = batch.lifecycle.reason;
    return structuredClone(batch.lifecycle);
  });
  if (!saved || saved.state === 'applied') return saved?.state;
  if (saved.state === 'blocked' && !saved.plan) return saved.state;
  const receipts: Record<string, string> = {};
  let applied = false;
  let reason: ReturnType<typeof lifecycleBlocker> | undefined;
  try {
    if (saved.plan) {
      await withFixerrorsApplicationDatabase(async (client, target) => {
        await applyLifecyclePlan(client, saved.plan!, target, {
          writer: async (file, contents) => {
            const value = JSON.parse(contents);
            if (value.planHash !== hashLifecycleRecord(saved.plan)) throw new Error('Lifecycle receipt binding changed');
            await store.transact(({ state }) => {
              const current = state.jobs.find(entry => entry.id === jobId)?.privateBatch?.lifecycle;
              if (!current || hashLifecycleRecord(current.plan) !== hashLifecycleRecord(saved.plan)) {
                throw new Error('Retained lifecycle plan changed');
              }
              current.receipts[file] = contents;
            });
            receipts[file] = contents;
          },
        });
      });
    }
    applied = true;
  } catch (error) {
    // Retain the original plan for conflict inspection or exact idempotent
    // receipt recovery; never present a blocked transition as a resolved error.
    applied = false;
    reason = lifecycleBlocker(error);
    console.error(`Fixerrors batch lifecycle blocked: ${reason}; exact plan and evidence retained.`);
  }
  return store.transact(({ state, audit }) => {
    const job = state.jobs.find(entry => entry.id === jobId);
    const current = job?.privateBatch?.lifecycle;
    if (!job?.batch || !current || hashLifecycleRecord(current.plan) !== hashLifecycleRecord(saved.plan)) {
      throw new Error('Retained lifecycle plan changed');
    }
    Object.assign(current.receipts, receipts);
    if (current.state !== 'applied') current.state = applied ? 'applied' : 'blocked';
    if (current.state === 'applied') delete current.reason;
    else current.reason = reason;
    job.batch.lifecycle = current.state;
    job.batch.lifecycleReason = current.reason;
    audit({ at: Date.now(), actor: 'batch-lifecycle', event: applied ? 'batch-lifecycle-applied' : 'batch-lifecycle-blocked',
      jobId, deviceId: job.deviceId });
    return current.state;
  });
}
