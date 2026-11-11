import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAdminCommand } from '@/lib/fixerrors/control';
import { batchHash, parseCapturedBatch } from '@/lib/fixerrors/batch';
import { reconcileBatchLifecycle } from '@/lib/server/fixerrors/batch-lifecycle';
import { hashLifecycleRecord, type LifecycleRecord } from '@/scripts/fixerrors-lifecycle';
import type { PgClientLike } from '@/scripts/fixerrors-safety';
import { capturedBatch } from './fixerrors-batch-fixtures';
import { actorId, deviceId, FixtureStore, now, workspace } from './fixerrors-control-fixtures';

const database = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/server/fixerrors/evidence', () => ({ withFixerrorsApplicationDatabase: database.run }));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); database.run.mockReset(); });

async function fixture() {
  const store = new FixtureStore();
  const id = randomUUID();
  const batch = capturedBatch(id);
  const row: LifecycleRecord = { ...batch.bindings[0].records[0],
    archived_at: null, triaged_at: null, triage_incident_id: null, triage_summary: null, triage_next_step: null,
    triage_local_commit: null, triage_live_verified_at: null, triage_live_evidence: null, additional_data: {} };
  batch.bindings[0].records[0] = row;
  const outcome = {
    runId: `fixerrors-${id}`, candidate: { baseHead: workspace.head, treeFingerprint: 'b'.repeat(64) },
    clusters: [{ id: 'cluster-1', status: 'held', reason: 'Inspect named source evidence',
      attempt: 'Scoped source investigation', tests: [], evidence: ['Source inspected'] }], decisions: [],
  };
  await store.transact(tx => applyAdminCommand(tx, actorId,
    { op: 'enqueue', action: 'repair', requestId: id, deviceId }, now, { checkout: workspace, batch, packet: null }));
  const retained = store.state.jobs[0].privateBatch!;
  retained.outcome = outcome;
  retained.checkpoint = { cursor: 1, checkpointSha256: batchHash('completed synthetic prefix') };
  let record = structuredClone(row);
  let staged: LifecycleRecord | undefined;
  let failCommit = false;
  let updates = 0;
  const sql: string[] = [];
  const client: PgClientLike = { async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    sql.push(text);
    let rows: Record<string, unknown>[] = [];
    if (text.includes('FROM pg_class')) rows = [
      { relkind: 'r', rules: false, triggers: false, cascading: false, inherits: false },
    ];
    if (text.includes('FOR UPDATE')) rows = [{ record }];
    if (text.includes('UPDATE public.error_logs')) {
      expect(Object.keys(store.state.jobs[0].privateBatch!.lifecycle!.receipts).some(file => file.endsWith('.pre.json'))).toBe(true);
      updates++;
      staged = { ...record, status: values[1], archived_at: values[2], triage_state: values[3], triaged_at: values[4],
        triage_incident_id: values[5], triage_summary: values[6], triage_next_step: values[7],
        triage_local_commit: values[8], triage_live_verified_at: values[9],
        triage_live_evidence: values[10] ? JSON.parse(String(values[10])) : null,
        additional_data: JSON.parse(String(values[11])) };
      rows = [{ record: staged }];
    }
    if (text === 'COMMIT') {
      if (staged) record = staged;
      staged = undefined;
      if (failCommit) { failCommit = false; throw new Error('Synthetic lost commit acknowledgement'); }
    }
    if (text === 'ROLLBACK') staged = undefined;
    return { rows: rows as T[], rowCount: rows.length };
  } };
  database.run.mockImplementation(async (work: (client: PgClientLike, target: string) => Promise<void>) =>
    work(client, batch.target));
  return { store, id, sql, updates: () => updates, record: () => record,
    loseCommit: () => { failCommit = true; }, lifecycle: () => store.state.jobs[0].privateBatch!.lifecycle! };
}

describe('server exact-row batch lifecycle durability (mock application DB)', () => {
  it('records lifecycle audit events using the enrolled device UUID required by production', async () => {
    const f = await fixture();
    const transact = f.store.transact.bind(f.store);
    vi.spyOn(f.store, 'transact').mockImplementation(work => transact(tx => work({ ...tx,
      audit(event) {
        expect(event.actor).toBe(deviceId);
        expect(event.actor).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u);
        tx.audit(event);
      },
    })));
    expect(await reconcileBatchLifecycle(f.store, f.id)).toBe('applied');
    expect(f.store.events.at(-1)).toMatchObject({ actor: deviceId, event: 'batch-lifecycle-applied' });
  });

  it('awaits durable queue pre-receipt persistence before the first application update', async () => {
    const f = await fixture();
    const transact = f.store.transact.bind(f.store);
    let persisted!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { persisted = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    vi.spyOn(f.store, 'transact').mockImplementation(async work => {
      const result = await transact(work);
      if (!held && Object.keys(f.lifecycle().receipts).some(file => file.endsWith('.pre.json'))) {
        held = true;
        persisted();
        await gate;
      }
      return result;
    });
    const pending = reconcileBatchLifecycle(f.store, f.id);
    await ready;
    expect(f.updates()).toBe(0);
    release();
    expect(await pending).toBe('applied');
    expect(f.updates()).toBe(1);
    expect(f.record()).toMatchObject({ status: 'active', triage_state: 'outstanding' });
    expect(Object.keys(f.lifecycle().receipts)).toHaveLength(2);
  });

  it('rolls back without application mutation when queue pre-receipt persistence fails', async () => {
    const f = await fixture();
    const transact = f.store.transact.bind(f.store);
    vi.spyOn(f.store, 'transact').mockImplementation(work => transact(tx => {
      const result = work(tx);
      if (Object.keys(tx.state.jobs[0].privateBatch!.lifecycle!.receipts).some(file => file.endsWith('.pre.json'))) {
        throw new Error('Synthetic private queue unavailable');
      }
      return result;
    }));
    expect(await reconcileBatchLifecycle(f.store, f.id)).toBe('blocked');
    expect(f.updates()).toBe(0);
    expect(f.sql).toContain('ROLLBACK');
    expect(f.lifecycle()).toMatchObject({ reason: 'unavailable', receipts: {}, plan: expect.any(Object) });
  });

  it.each(['commit', 'post-receipt'])('retains and idempotently retries the identical plan after uncertain %s', async failure => {
    const f = await fixture();
    if (failure === 'commit') f.loseCommit();
    else {
      const transact = f.store.transact.bind(f.store);
      let failed = false;
      vi.spyOn(f.store, 'transact').mockImplementation(work => transact(tx => {
        const result = work(tx);
        if (!failed && Object.keys(tx.state.jobs[0].privateBatch!.lifecycle!.receipts).some(file => file.endsWith('.post.json'))) {
          failed = true;
          throw new Error('Synthetic lost post-receipt persistence');
        }
        return result;
      }));
    }
    expect(await reconcileBatchLifecycle(f.store, f.id)).toBe('blocked');
    expect(f.lifecycle().reason).toBe('uncertain');
    const planHash = hashLifecycleRecord(f.lifecycle().plan);
    expect(Object.keys(f.lifecycle().receipts).some(file => file.endsWith('.pre.json'))).toBe(true);
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, reorder(item)]));
      return value;
    };
    f.store.state.jobs[0].privateBatch = parseCapturedBatch({
      ...f.store.state.jobs[0].privateBatch, lifecycle: { ...f.lifecycle(), plan: reorder(f.lifecycle().plan) },
    }, f.id);
    expect(hashLifecycleRecord(f.lifecycle().plan)).toBe(planHash);
    vi.setSystemTime(now + 31 * 60_000);
    expect(await reconcileBatchLifecycle(f.store, f.id)).toBe('applied');
    expect(f.updates()).toBe(1);
    expect(hashLifecycleRecord(f.lifecycle().plan)).toBe(planHash);
    expect(Object.values(f.lifecycle().receipts).some(value => JSON.parse(value).alreadyApplied === 1)).toBe(true);
  });
});
