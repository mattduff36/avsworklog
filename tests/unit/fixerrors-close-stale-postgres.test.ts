import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { DB_HOST, DB_NAME, DB_USER, deriveCheckoutIdentity, formatLocalTestDatabaseUrl } from '@/scripts/local-test-postgres';
import { closeStaleExactIds, hashRecord, hashBytes, parseClosureManifest, CONTRACT, type ClosureManifest } from '@/scripts/fixerrors-close-stale';
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002', C = '00000000-0000-4000-8000-000000000003';
describe('non-actionable exact-ID closure on disposable PostgreSQL', () => {
  let client: pg.Client;
  let available = false;
  const now = () => new Date();
  const writer = () => undefined;
  beforeAll(async () => {
    const port = deriveCheckoutIdentity(resolve(process.cwd())).hostPort;
    if (port === 5432) throw new Error('Refused default PostgreSQL port');
    client = new pg.Client({ connectionString: formatLocalTestDatabaseUrl(port), ssl: false, connectionTimeoutMillis: 1000 });
    try { await client.connect(); } catch { if (process.env.TEST_DATABASE_URL) throw new Error('Required disposable PostgreSQL unavailable'); return; }
    const identity = (await client.query('SELECT current_database() db, current_user usr, inet_server_addr()::text addr')).rows[0];
    expect({ ...identity, addr: identity.addr?.split('/')[0] }).toEqual({ db: DB_NAME, usr: DB_USER, addr: DB_HOST });
    expect((await client.query("SELECT to_regclass('public.error_logs') existing")).rows[0].existing).toBeNull();
    await client.query(`CREATE TABLE public.error_logs (id uuid PRIMARY KEY, error_message text, error_stack text, additional_data jsonb, status text, archived_at timestamptz, triage_state text, triaged_at timestamptz, triage_incident_id text, triage_summary text, triage_next_step text, triage_local_commit text, triage_live_verified_at timestamptz, triage_live_evidence jsonb)`);
    const migration = readFileSync('supabase/migrations/20260929_error_logs_triage_lifecycle.sql', 'utf8');
    const start = migration.indexOf('ALTER TABLE public.error_logs\n  ADD CONSTRAINT error_logs_lifecycle_check');
    const normalized = migration.replace(/\r/g, '');
    const constraint = normalized.slice(normalized.indexOf('ALTER TABLE public.error_logs\n  ADD CONSTRAINT error_logs_lifecycle_check'));
    expect(start >= 0 || constraint.startsWith('ALTER TABLE')).toBe(true);
    await client.query(constraint.slice(0, constraint.indexOf(';') + 1));
    available = true;
  });
  afterAll(async () => { if (available) await client.query('DROP TABLE public.error_logs'); await client?.end(); });
  beforeEach(async () => {
    if (!available) return;
    await client.query('TRUNCATE public.error_logs');
    await client.query(`INSERT INTO public.error_logs(id,error_message,error_stack,additional_data,status,triage_state,triaged_at,triage_incident_id,triage_summary,triage_next_step) SELECT x::uuid,'Original diagnostic','Original stack','{"args":["original"]}'::jsonb,'active','outstanding',now(),'incident','Reviewed original summary','Original next action' FROM unnest($1::text[]) x`, [[A, B]]);
  });
  async function manifest(): Promise<{ m: ClosureManifest; hash: string }> {
    const records = (await client.query('SELECT to_jsonb(e) record FROM public.error_logs e ORDER BY id')).rows;
    const bytes = JSON.stringify({ schemaVersion: 1, commandId: 'fixerrors-close-stale', safetyContract: CONTRACT, targetProjectRef: 'example-ref', createdAt: now().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), rows: records.map(({ record }) => ({ id: record.id, expectedRecordHash: hashRecord(record), reason: 'insufficient_evidence', summary: 'Historical diagnostics cannot establish a current defect.', evidence: 'Current source and focused tests reviewed without an actionable defect.' })) });
    return { m: parseClosureManifest(bytes), hash: hashBytes(bytes) };
  }
  it('archives exact rows preserving diagnostics, lifecycle and fresh untriaged recurrence', async context => {
    if (!available) return context.skip();
    const { m, hash } = await manifest();
    await client.query("INSERT INTO public.error_logs(id,error_message,status) VALUES($1,'New occurrence','active')", [C]);
    const artifacts: Record<string, string> = {};
    expect(await closeStaleExactIds(client, m, hash, { writer: (p, s) => { artifacts[p] = s; } })).toEqual({ closed: 2, active: 1 });
    const rows = (await client.query('SELECT * FROM public.error_logs ORDER BY id')).rows;
    for (const row of rows.slice(0, 2)) {
      expect(row).toMatchObject({ status: 'archived', triage_state: 'no_fix_required', error_message: 'Original diagnostic', error_stack: 'Original stack', triage_next_step: null, triage_live_evidence: null });
      expect(row.additional_data.args).toEqual(['original']);
      expect(row.additional_data.fixerrorsClosures[0].manifestHash).toBe(hash);
    }
    expect(rows[2].status).toBe('active');
    expect(artifacts['docs_private/error-run-summary.txt']).toContain(`${C}: untriaged`);
    expect(await closeStaleExactIds(client, m, hash, { refresh: true, writer })).toEqual({ closed: 2, active: 1 });
  });
  it.each(['drift', 'missing', 'local-evidence', 'pre-artifact', 'expiry', 'mixed-state', 'audit-shape'])('rolls back the whole set on %s', async (failure, context) => {
    if (!available) return context.skip();
    if (failure === 'local-evidence') await client.query("UPDATE public.error_logs SET triage_local_commit='local-proof' WHERE id=$1", [B]);
    if (failure === 'audit-shape') await client.query("UPDATE public.error_logs SET additional_data='{" + '"fixerrorsClosures":{}' + "}' WHERE id=$1", [B]);
    const { m, hash } = await manifest();
    if (failure === 'drift') await client.query("UPDATE public.error_logs SET error_stack='changed' WHERE id=$1", [B]);
    if (failure === 'missing') await client.query('DELETE FROM public.error_logs WHERE id=$1', [B]);
    if (failure === 'mixed-state') await client.query("UPDATE public.error_logs SET triage_state=NULL,triaged_at=NULL,triage_incident_id=NULL,triage_summary=NULL,triage_next_step=NULL WHERE id=$1", [B]);
    await expect(closeStaleExactIds(client, m, hash, { writer: failure === 'pre-artifact' ? () => { throw new Error('disk unavailable'); } : writer, now: failure === 'expiry' ? () => new Date(Date.now() + 7200000) : now })).rejects.toThrow();
    expect((await client.query("SELECT count(*)::int n FROM public.error_logs WHERE status='archived'")).rows[0].n).toBe(0);
  });
  it('recovers an acknowledged post-commit artifact failure with read-only refresh', async context => {
    if (!available) return context.skip();
    const { m, hash } = await manifest();
    await expect(closeStaleExactIds(client, m, hash, { writer: (p) => { if (p.includes('.post.')) throw new Error('disk unavailable'); } })).rejects.toThrow('Closure committed');
    const before = (await client.query('SELECT to_jsonb(e) record FROM public.error_logs e ORDER BY id')).rows;
    expect(await closeStaleExactIds(client, m, hash, { refresh: true, writer, now: () => new Date(Date.now() + 86400000) })).toEqual({ closed: 2, active: 0 });
    expect((await client.query('SELECT to_jsonb(e) record FROM public.error_logs e ORDER BY id')).rows).toEqual(before);
  });
  it('blocks on a competing row lock and refuses concurrently changed diagnostics', async context => {
    if (!available) return context.skip();
    const { m, hash } = await manifest();
    const blocker = new pg.Client({ connectionString: formatLocalTestDatabaseUrl(deriveCheckoutIdentity(resolve(process.cwd())).hostPort), ssl: false });
    await blocker.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query("UPDATE public.error_logs SET error_stack='Concurrent evidence' WHERE id=$1", [B]);
      let settled = false;
      const pending = closeStaleExactIds(client, m, hash, { writer }).then(() => { settled = true; return 'success'; }, () => { settled = true; return 'rejected'; });
      await new Promise(resolveWait => setTimeout(resolveWait, 150));
      expect(settled).toBe(false);
      await blocker.query('COMMIT');
      expect(await pending).toBe('rejected');
      expect((await client.query("SELECT count(*)::int n FROM public.error_logs WHERE status='archived'")).rows[0].n).toBe(0);
    } finally { await blocker.query('ROLLBACK'); await blocker.end(); }
  });
});
