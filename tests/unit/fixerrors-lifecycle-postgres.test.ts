import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DB_HOST, DB_NAME, DB_USER, deriveCheckoutIdentity, formatLocalTestDatabaseUrl } from '@/scripts/local-test-postgres';
import {
  applyLifecyclePlan, fetchLifecycleRecords, makeLifecyclePlan, readLifecycle, reviewLifecycleRow,
  type LifecyclePlan, type LifecycleRecord,
} from '@/scripts/fixerrors-lifecycle';
import { type PgClientLike } from '@/scripts/fixerrors-safety';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';
const target = 'c'.repeat(64);
const writer = () => {};
describe('automatic lifecycle on disposable real PostgreSQL only', () => {
  let client: pg.Client;
  const port = deriveCheckoutIdentity(resolve(process.cwd())).hostPort;
  const now = () => new Date();
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL || port === 5432) throw new Error('Required disposable PostgreSQL runner identity missing');
    client = new pg.Client({ connectionString: formatLocalTestDatabaseUrl(port), ssl: false, connectionTimeoutMillis: 3000 });
    await client.connect();
    const identity = (await client.query('SELECT current_database() db,current_user usr,inet_server_addr()::text addr')).rows[0];
    expect({ ...identity, addr: identity.addr?.split('/')[0] }).toEqual({ db: DB_NAME, usr: DB_USER, addr: DB_HOST });
    expect((await client.query("SELECT to_regclass('public.error_logs') existing")).rows[0].existing).toBeNull();
    await client.query(`CREATE TABLE public.error_logs(
      id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), timestamp timestamptz NOT NULL DEFAULT now(),
      error_message text, error_stack text, additional_data jsonb, status text, archived_at timestamptz,
      triage_state text, triaged_at timestamptz, triage_incident_id text, triage_summary text, triage_next_step text,
      triage_local_commit text, triage_live_verified_at timestamptz, triage_live_evidence jsonb);
      CREATE TABLE public.error_log_alerts(id int PRIMARY KEY, error_log_id uuid REFERENCES public.error_logs(id) ON DELETE CASCADE);
      CREATE TABLE public.unreviewed_effects(id uuid)`);
    const migration = readFileSync('supabase/migrations/20260929_error_logs_triage_lifecycle.sql', 'utf8').replace(/\r/g, '');
    const constraint = migration.slice(migration.indexOf('ALTER TABLE public.error_logs\n  ADD CONSTRAINT error_logs_lifecycle_check'));
    expect(constraint.startsWith('ALTER TABLE')).toBe(true);
    await client.query(constraint.slice(0, constraint.indexOf(';') + 1));
  });
  afterAll(async () => {
    if (client) {
      await client.query('DROP TABLE IF EXISTS public.error_log_alerts,public.error_logs,public.unreviewed_effects CASCADE');
      await client.query('DROP FUNCTION IF EXISTS public.unreviewed_account_merge()');
      await client.end();
    }
  });
  beforeEach(async () => {
    await client.query('DROP TRIGGER IF EXISTS account_merge_guard ON public.error_logs');
    await client.query('TRUNCATE public.error_log_alerts,public.error_logs,public.unreviewed_effects');
    await client.query(`INSERT INTO public.error_logs(id,error_message,error_stack,additional_data,status)
      SELECT id::uuid,'Original diagnostic','Original stack','{"args":["original"]}'::jsonb,'active'
      FROM unnest($1::text[]) id`, [[A, B]]);
    await client.query('INSERT INTO public.error_log_alerts(id,error_log_id) VALUES(1,$1)', [A]);
  });
  async function plan(state: 'awaiting-evidence' | 'awaiting-deployment' | 'actionable' | 'resolved-no-fix' = 'awaiting-evidence'): Promise<LifecyclePlan> {
    const at = now();
    const records = await fetchLifecycleRecords(client, [A, B]);
    return makeLifecyclePlan(target, records.map(record => reviewLifecycleRow(record, {
      fingerprint: 'a'.repeat(64), state, nextStep: 'Inspect exact source and targeted diagnostic evidence',
      closureReason: state === 'resolved-no-fix' ? 'expected_behavior' : null,
      attempt: { id: 'attempt-one', reviewedAt: at.toISOString(), diagnosis: 'Reviewed label formatting failure',
        attempt: 'Inspected current source and targeted tests', tests: ['tests/unit/display-label.test.ts: passed'],
        result: state === 'awaiting-deployment' ? 'verified-local' : state === 'resolved-no-fix' ? 'no-fix' : 'blocked',
        evidence: ['Source and targeted regression evidence'],
        ...(state === 'awaiting-deployment' ? { verifiedCandidate: { baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) } } : {}) },
    })), at);
  }
  async function records(): Promise<LifecycleRecord[]> {
    return fetchLifecycleRecords(client, [A, B]);
  }
  it('moves every exact reviewed row through existing lifecycle columns and preserves diagnostics/dependents/new errors', async () => {
    const p = await plan();
    await client.query("INSERT INTO public.error_logs(id,error_message,status) VALUES($1,'New independent occurrence','active')", [C]);
    const artifacts = new Map<string, string>();
    expect(await applyLifecyclePlan(client, p, target, { writer: (file, contents) => { artifacts.set(file, contents); } }))
      .toEqual({ updated: 2, alreadyApplied: 0 });
    for (const record of await records()) {
      expect(record).toMatchObject({ status: 'active', triage_state: 'outstanding', error_message: 'Original diagnostic', error_stack: 'Original stack' });
      expect(record.additional_data).toMatchObject({ args: ['original'] });
      expect(readLifecycle(record)?.state).toBe('awaiting-evidence');
    }
    expect((await client.query('SELECT count(*)::int n FROM public.error_log_alerts')).rows[0].n).toBe(1);
    expect((await fetchLifecycleRecords(client, [C]))[0].triage_state).toBeNull();
    expect([...artifacts.keys()].some(file => file.endsWith('.pre.json'))).toBe(true);
    expect([...artifacts.keys()].some(file => file.endsWith('.post.json'))).toBe(true);
    expect(await applyLifecyclePlan(client, p, target, { writer, now: () => new Date(Date.now() + 86400000) }))
      .toEqual({ updated: 0, alreadyApplied: 2 });
    expect((await records())[0].additional_data).toMatchObject({ fixerrorsLifecycle: { history: [expect.anything()] } });
  });
  it('records verified local repairs as awaiting deployment, never fixed live', async () => {
    await applyLifecyclePlan(client, await plan('awaiting-deployment'), target, { writer });
    for (const record of await records()) {
      expect(record).toMatchObject({ status: 'active', triage_state: 'outstanding', triage_live_verified_at: null, triage_live_evidence: null });
      expect(readLifecycle(record)?.state).toBe('awaiting-deployment');
    }
  });
  it('closes no-fix rows separately without deleting their history', async () => {
    await applyLifecyclePlan(client, await plan('resolved-no-fix'), target, { writer });
    for (const record of await records()) {
      expect(record).toMatchObject({ status: 'archived', triage_state: 'no_fix_required', triage_next_step: null,
        error_message: 'Original diagnostic', error_stack: 'Original stack' });
      expect(readLifecycle(record)).toMatchObject({ state: 'resolved-no-fix', closureReason: 'expected_behavior' });
    }
  });
  it('expires only evidence gaps after thirty days and preserves a case with exact new evidence', async () => {
    const started = new Date(Date.now() - 31 * 86400000).toISOString();
    const first = (await records()).map(record => reviewLifecycleRow(record, {
      fingerprint: 'a'.repeat(64), state: 'awaiting-evidence', nextStep: 'Inspect named diagnostics',
      attempt: { id: 'first-review', reviewedAt: started, diagnosis: 'Insufficient historical runtime context',
        attempt: 'Inspected source and targeted diagnostic evidence', tests: [], result: 'blocked', evidence: ['Sanitized source evidence reviewed'] },
    }));
    await applyLifecyclePlan(client, makeLifecyclePlan(target, first), target, { writer });
    const at = now();
    const revisited = (await records()).map(record => reviewLifecycleRow(record, {
      fingerprint: 'a'.repeat(64), state: 'awaiting-evidence', nextStep: 'Inspect new named diagnostics',
      matchingNewEvidenceAt: record.id === A ? at.toISOString() : undefined,
      attempt: { id: 'repeat-review', reviewedAt: at.toISOString(), diagnosis: 'Reviewed exact current evidence',
        attempt: 'Revisited source and matching evidence', tests: [], result: 'blocked', evidence: ['Exact fingerprint evidence checked'] },
    }));
    await applyLifecyclePlan(client, makeLifecyclePlan(target, revisited, at), target, { writer });
    const current = await records();
    expect(current.find(record => record.id === A)).toMatchObject({ status: 'active', triage_state: 'outstanding' });
    const expired = current.find(record => record.id === B)!;
    expect(expired).toMatchObject({ status: 'archived', triage_state: 'no_fix_required', error_stack: 'Original stack' });
    expect(readLifecycle(expired)).toMatchObject({ closureReason: 'evidence_gap_expired', lastMatchingEvidenceAt: started });
    expect(readLifecycle(expired)?.history).toHaveLength(2);
  });
  it.each(['trigger', 'disabled-trigger', 'drift', 'missing', 'expiry', 'target', 'pre-receipt', 'local-evidence', 'forged-history'])(
    'fails closed and rolls back every row on %s', async failure => {
      const p = await plan(failure === 'local-evidence' ? 'resolved-no-fix' : 'awaiting-evidence');
      if (failure === 'trigger' || failure === 'disabled-trigger') await client.query(`CREATE OR REPLACE FUNCTION public.unreviewed_account_merge() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.unreviewed_effects VALUES(NEW.id); RETURN NEW; END $$;
        CREATE TRIGGER account_merge_guard BEFORE UPDATE ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.unreviewed_account_merge()`);
      if (failure === 'disabled-trigger') await client.query('ALTER TABLE public.error_logs DISABLE TRIGGER account_merge_guard');
      if (failure === 'drift') await client.query("UPDATE public.error_logs SET error_stack='Concurrent evidence' WHERE id=$1", [B]);
      if (failure === 'missing') await client.query('DELETE FROM public.error_logs WHERE id=$1', [B]);
      if (failure === 'local-evidence') {
        await client.query("UPDATE public.error_logs SET triage_state='outstanding',triaged_at=now(),triage_incident_id='incident',triage_summary='Local repair',triage_next_step='Deploy',triage_local_commit='local-proof' WHERE id=$1", [B]);
      }
      if (failure === 'forged-history') p.rows[0].metadata.history.unshift({ ...p.rows[0].metadata.history[0], id: 'forged' });
      await expect(applyLifecyclePlan(client, p, failure === 'target' ? 'd'.repeat(64) : target, {
        writer: failure === 'pre-receipt' ? () => { throw new Error('disk unavailable'); } : writer,
        now: failure === 'expiry' ? () => new Date(Date.now() + 3600000) : now,
      })).rejects.toThrow();
      expect((await client.query("SELECT count(*)::int n FROM public.error_logs WHERE additional_data ? 'fixerrorsLifecycle'")).rows[0].n).toBe(0);
      expect((await client.query('SELECT count(*)::int n FROM public.unreviewed_effects')).rows[0].n).toBe(0);
    });
  it('recovers an acknowledged post-commit receipt failure with an identical idempotent retry', async () => {
    const p = await plan();
    await expect(applyLifecyclePlan(client, p, target, {
      writer: file => { if (file.endsWith('.post.json')) throw new Error('post-receipt unavailable'); },
    })).rejects.toThrow('retry the identical saved plan');
    const before = await records();
    expect(await applyLifecyclePlan(client, p, target, { writer })).toEqual({ updated: 0, alreadyApplied: 2 });
    expect(await records()).toEqual(before);
    await client.query("UPDATE public.error_logs SET error_stack='Changed after commit' WHERE id=$1", [B]);
    await expect(applyLifecyclePlan(client, p, target, { writer })).rejects.toThrow('retry state changed');
  });
  it('preserves uncertain commit recovery even if rollback acknowledgement also fails', async () => {
    const p = await plan();
    const uncertain: PgClientLike = {
      async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
        if (text === 'ROLLBACK') throw new Error('Connection acknowledgement unavailable');
        const result = await client.query<T>(text, values);
        if (text === 'COMMIT') throw new Error('Commit acknowledgement unavailable');
        return result;
      },
    };
    await expect(applyLifecyclePlan(uncertain, p, target, { writer })).rejects.toThrow('retry the identical saved plan');
    expect(await applyLifecyclePlan(client, p, target, { writer })).toEqual({ updated: 0, alreadyApplied: 2 });
  });
  it('rejects mixed applied/unapplied rows instead of authorizing partial recovery', async () => {
    const p = await plan();
    await applyLifecyclePlan(client, p, target, { writer });
    await client.query(`UPDATE public.error_logs SET status='active',archived_at=NULL,triage_state=NULL,triaged_at=NULL,
      triage_incident_id=NULL,triage_summary=NULL,triage_next_step=NULL,triage_local_commit=NULL,
      triage_live_verified_at=NULL,triage_live_evidence=NULL,additional_data='{"args":["original"]}'::jsonb WHERE id=$1`, [B]);
    const before = await records();
    await expect(applyLifecyclePlan(client, p, target, { writer })).rejects.toThrow('Mixed applied and unapplied');
    expect(await records()).toEqual(before);
  });
  it('blocks behind concurrent writes and rejects stale current-row evidence atomically', async () => {
    const p = await plan();
    const competing = new pg.Client({ connectionString: formatLocalTestDatabaseUrl(port), ssl: false });
    await competing.connect();
    try {
      await competing.query('BEGIN');
      await competing.query("UPDATE public.error_logs SET error_stack='Concurrent evidence' WHERE id=$1", [B]);
      let settled = false;
      const pending = applyLifecyclePlan(client, p, target, { writer }).then(() => { settled = true; return 'passed'; },
        () => { settled = true; return 'rejected'; });
      await new Promise(resolveWait => setTimeout(resolveWait, 150));
      expect(settled).toBe(false);
      await competing.query('COMMIT');
      expect(await pending).toBe('rejected');
      expect((await client.query("SELECT count(*)::int n FROM public.error_logs WHERE triage_state='outstanding'")).rows[0].n).toBe(0);
    } finally { await competing.query('ROLLBACK'); await competing.end(); }
  });
});
