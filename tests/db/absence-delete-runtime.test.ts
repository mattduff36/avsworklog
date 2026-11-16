import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DATABASE_COMMENT_PREFIX, PROJECT_NAME_HASH_LENGTH, PROJECT_NAME_PREFIX,
  PROVENANCE_ENV_KEYS, STATE_VERSION, isInheritedDatabaseUrlKey, validateLocalTestDatabaseUrl,
} from '../../scripts/local-test-postgres';

const local = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const actor = '11111111-1111-4111-8111-111111111111';
const employee = '22222222-2222-4222-8222-222222222222';
const version = '2026-11-16T20:00:00Z';
const sql = (name: string) => readFileSync(resolve(process.cwd(), 'supabase', 'migrations', name), 'utf8');
function sourceFunction(file: string, name: string) {
  const text = sql(file);
  const start = new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\(`, 'iu').exec(text);
  if (!start) throw new Error(`Missing production function ${name}`);
  const open = text.indexOf('$$', start.index);
  const close = text.indexOf('$$', open + 2);
  return text.slice(start.index, text.indexOf(';', close + 2) + 1);
}

local('atomic single absence deletion on disposable PostgreSQL', () => {
  let db: Client;
  let writer: Client;
  let observer: Client;
  const clients: Client[] = [];
  let dbPid: number;
  let writerPid: number;
  let absenceId: string;
  let timesheetId: string;
  let entryId: string;

  async function connect() {
    const client = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
    await client.connect();
    clients.push(client);
    await client.query("SET lock_timeout = '8s'; SET statement_timeout = '12s'");
    return client;
  }

  async function authenticate(client: Client, options: {
    user?: string; admin?: boolean; authorise?: boolean; edit?: boolean;
  } = {}) {
    await client.query(`SELECT set_config('test.actor', $1, false),
      set_config('test.admin', $2, false), set_config('test.authorise', $3, false),
      set_config('test.edit', $4, false)`,
    [options.user ?? actor, options.admin === false ? 'off' : 'on',
      options.authorise === false ? 'off' : 'on', options.edit === false ? 'off' : 'on']);
    await client.query('SET ROLE authenticated');
  }

  async function remove(client = db, expectedVersion: string | null = version) {
    return client.query('SELECT public.delete_absence_with_timesheet_effects($1, $2) AS id', [absenceId, expectedVersion]);
  }

  async function currentVersion(): Promise<string> {
    return (await observer.query('SELECT updated_at::text FROM public.absences WHERE id = $1', [absenceId])).rows[0].updated_at;
  }

  async function state() {
    return (await observer.query(`SELECT
      (SELECT to_jsonb(a) FROM public.absences a WHERE id = $1) AS absence,
      (SELECT to_jsonb(e) FROM public.timesheet_entries e WHERE id = $2) AS entry,
      (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]') FROM public.timesheet_entry_leave_snapshots s) AS snapshots,
      (SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.timesheet_entry_id, j.display_order), '[]') FROM public.timesheet_entry_job_codes j) AS jobs`,
    [absenceId, entryId])).rows[0];
  }

  async function unchangedAfterFailure(message: RegExp) {
    const before = await state();
    await expect(remove()).rejects.toThrow(message);
    expect(await state()).toEqual(before);
  }

  async function blocked(blockedPid: number, blockerPid: number) {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      if ((await observer.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', [blockerPid, blockedPid])).rows[0].blocked) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error('Expected competing PostgreSQL sessions to block');
  }

  beforeAll(async () => {
    const marker = process.env[PROVENANCE_ENV_KEYS.marker] || '';
    const project = process.env[PROVENANCE_ENV_KEYS.project];
    const match = new RegExp(`^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`, 'u').exec(marker);
    if (!match || project !== `${PROJECT_NAME_PREFIX}${match[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`
        || process.env.AVSWORKLOG_TEST_SKIP_DOTENV !== '1'
        || Object.keys(process.env).some((key) => key !== 'TEST_DATABASE_URL' && isInheritedDatabaseUrlKey(key))) {
      throw new Error('Disposable PostgreSQL runner provenance required');
    }
    validateLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL!, Number(process.env[PROVENANCE_ENV_KEYS.port]));
    db = await connect();
    writer = await connect();
    observer = await connect();
    dbPid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const identity = await db.query("SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()");
    expect(identity.rows[0]).toEqual({ name: 'avsworklog_test', marker });
    await db.query(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
        $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
      CREATE FUNCTION public.effective_is_admin() RETURNS boolean LANGUAGE sql AS
        $$ SELECT coalesce(current_setting('test.admin', true), '') = 'on' $$;
      CREATE FUNCTION public.effective_is_manager_admin() RETURNS boolean LANGUAGE sql AS
        $$ SELECT public.effective_is_admin() $$;
      CREATE FUNCTION public.effective_has_admin_full_access() RETURNS boolean LANGUAGE sql AS
        $$ SELECT public.effective_is_admin() $$;
      CREATE FUNCTION public.permission_alignment_effective_module_access_level(text) RETURNS integer LANGUAGE sql AS
        $$ SELECT CASE WHEN current_setting('test.authorise', true) = 'on' THEN 3 ELSE 0 END $$;
      CREATE FUNCTION public.effective_accounts_timesheet_full_visibility_override() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.permission_alignment_absence_secondary_effective_cell(text) RETURNS boolean LANGUAGE sql AS
        $$ SELECT $1 = 'authorise_bookings_all' AND current_setting('test.authorise', true) = 'on' $$;
      CREATE FUNCTION public.are_effective_actor_and_target_in_same_team(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
      CREATE TABLE public.profiles (id uuid PRIMARY KEY);
      CREATE TABLE public.absence_reasons (id uuid PRIMARY KEY, name text, is_paid boolean);
      CREATE TABLE public.absences (
        id uuid PRIMARY KEY, profile_id uuid NOT NULL, date date NOT NULL, end_date date,
        reason_id uuid NOT NULL REFERENCES public.absence_reasons, duration_days numeric DEFAULT 1,
        is_half_day boolean DEFAULT false, half_day_session text, status text DEFAULT 'approved', notes text,
        is_bank_holiday boolean DEFAULT false, auto_generated boolean DEFAULT false, bulk_batch_id uuid,
        allow_timesheet_work_on_leave boolean DEFAULT false, created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT '${version}'
      );
      CREATE TABLE public.absence_financial_year_closures (financial_year_start_year integer PRIMARY KEY);
      CREATE TABLE public.timesheets (
        id uuid PRIMARY KEY, user_id uuid NOT NULL, week_ending date NOT NULL, status text DEFAULT 'draft'
      );
      CREATE TABLE public.timesheet_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), timesheet_id uuid NOT NULL REFERENCES public.timesheets,
        day_of_week integer NOT NULL, time_started time, time_finished time, job_number text,
        working_in_yard boolean DEFAULT false, did_not_work boolean DEFAULT false, daily_total numeric, remarks text,
        night_shift boolean DEFAULT false, bank_holiday boolean DEFAULT false, subsistence_payment_required boolean DEFAULT false,
        operator_travel_hours numeric, operator_yard_hours numeric, operator_working_hours numeric,
        machine_travel_hours numeric, machine_start_time time, machine_finish_time time, machine_working_hours numeric,
        machine_standing_hours numeric, machine_operator_hours numeric, maintenance_breakdown_hours numeric
      );
      CREATE TABLE public.timesheet_entry_job_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        timesheet_entry_id uuid REFERENCES public.timesheet_entries ON DELETE CASCADE, job_number text,
        display_order integer, UNIQUE(timesheet_entry_id, display_order)
      );
      CREATE TABLE public.timesheet_bank_holiday_work_confirmations (timesheet_id uuid, work_date date, absence_id uuid);
      ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;
      CREATE POLICY read_absence ON public.absences FOR SELECT TO authenticated USING (true);
      CREATE POLICY lock_absence ON public.absences FOR UPDATE TO authenticated USING (true);
      CREATE POLICY delete_absence ON public.absences FOR DELETE TO authenticated USING (
        current_setting('test.edit', true) = 'on'
        OR (profile_id = auth.uid() AND status = 'pending' AND date >= current_date)
      );
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT SELECT, UPDATE, DELETE ON public.absences TO authenticated;
      CREATE TRIGGER update_absence BEFORE UPDATE ON public.absences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    `);
    for (const [file, name] of [
      ['20260313_absence_fy_apr1_cutover.sql', 'absence_financial_year_start_year'],
      ['20260313_absence_fy_apr1_cutover.sql', 'absence_is_closed_financial_year'],
      ['20260312_absence_fy_archival.sql', 'guard_absence_closed_financial_year_mutation'],
      ['20260326_absence_year_closure_carryover_flow.sql', 'is_absence_financial_year_closed'],
      ['20260327_timesheet_absence_guardrails.sql', 'resolve_timesheet_entry_date'],
      ['20260804_absence_historic_delete_guard.sql', 'guard_absence_historic_delete'],
      ['20260806_permission_alignment_absence_and_admin_auth.sql', 'can_actor_authorise_timesheet'],
      ['20260903_timesheet_dual_gate_approval.sql', 'reject_approved_timesheet_entry_mutation'],
      ['20260903_timesheet_dual_gate_approval.sql', 'reject_approved_timesheet_entry_job_code_mutation'],
    ]) await db.query(sourceFunction(file, name));
    await db.query(sql('20260427_timesheet_entry_leave_snapshots.sql'));
    await db.query(sql('20260908180000_timesheet_bank_holiday_confirmation_grant.sql'));
    await db.query(`
      CREATE TRIGGER trg_guard_absence_historic_delete BEFORE DELETE ON public.absences
        FOR EACH ROW EXECUTE FUNCTION public.guard_absence_historic_delete();
      CREATE TRIGGER trg_guard_absence_closed_fy_delete BEFORE DELETE ON public.absences
        FOR EACH ROW EXECUTE FUNCTION public.guard_absence_closed_financial_year_mutation();
      CREATE TRIGGER entry_lock BEFORE INSERT OR UPDATE OR DELETE ON public.timesheet_entries
        FOR EACH ROW EXECUTE FUNCTION public.reject_approved_timesheet_entry_mutation();
      CREATE TRIGGER job_lock BEFORE INSERT OR UPDATE OR DELETE ON public.timesheet_entry_job_codes
        FOR EACH ROW EXECUTE FUNCTION public.reject_approved_timesheet_entry_job_code_mutation();
    `);
    await db.query(sql('20261116_atomic_absence_delete.sql'));
  });

  beforeEach(async () => {
    for (const client of [db, writer]) await client.query('ROLLBACK; RESET ROLE');
    await observer.query(`TRUNCATE public.timesheet_entry_leave_snapshots, public.timesheet_entry_job_codes,
      public.timesheet_entries, public.timesheets, public.absences, public.absence_reasons, public.profiles,
      public.absence_financial_year_closures CASCADE`);
    absenceId = randomUUID();
    timesheetId = randomUUID();
    entryId = randomUUID();
    const reasonId = randomUUID();
    await observer.query('INSERT INTO public.profiles VALUES ($1), ($2)', [actor, employee]);
    await observer.query("INSERT INTO public.absence_reasons VALUES ($1, 'Annual Leave', true)", [reasonId]);
    await observer.query(`INSERT INTO public.absences (id, profile_id, date, reason_id) VALUES ($1, $2, current_date + 1, $3)`,
      [absenceId, employee, reasonId]);
    await observer.query(`INSERT INTO public.timesheets (id, user_id, week_ending)
      SELECT $1, profile_id, date + (7 - extract(isodow FROM date)::integer) FROM public.absences WHERE id = $2`,
    [timesheetId, absenceId]);
    // Seed the pre-leave work row without running the coercion trigger.
    await observer.query('ALTER TABLE public.timesheet_entries DISABLE TRIGGER timesheet_entries_enforce_absence_rules');
    await observer.query(`INSERT INTO public.timesheet_entries (id, timesheet_id, day_of_week, time_started, time_finished,
      job_number, daily_total, remarks) SELECT $1, $2, extract(isodow FROM date)::int, '08:00', '17:00', 'JOB-A', 9, 'Original'
      FROM public.absences WHERE id = $3`, [entryId, timesheetId, absenceId]);
    await observer.query(`INSERT INTO public.timesheet_entry_leave_snapshots (
      absence_id, timesheet_id, timesheet_entry_id, day_of_week, had_entry, original_entry, original_job_numbers, applied_entry)
      SELECT $1, timesheet_id, id, day_of_week, true,
        to_jsonb(e) - ARRAY['id', 'timesheet_id', 'day_of_week', 'subsistence_payment_required'],
        ARRAY['JOB-A', 'JOB-B'],
        '{"time_started":null,"time_finished":null,"job_number":null,"working_in_yard":false,
          "did_not_work":true,"daily_total":9,"remarks":"Annual Leave","night_shift":false,"bank_holiday":false}'::jsonb
      FROM public.timesheet_entries e WHERE id = $2`, [absenceId, entryId]);
    await observer.query('ALTER TABLE public.timesheet_entries ENABLE TRIGGER timesheet_entries_enforce_absence_rules');
    await observer.query('UPDATE public.timesheet_entries SET remarks = remarks WHERE id = $1', [entryId]);
    await authenticate(db);
    await authenticate(writer);
  });

  afterAll(async () => {
    for (const client of clients) {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('atomically deletes the booking, restores original work/job order, and consumes the snapshot', async () => {
    expect((await remove()).rows[0]).toEqual({ id: absenceId });
    const result = await state();
    expect(result.absence).toBeNull();
    expect(result.entry).toMatchObject({ time_started: '08:00:00', time_finished: '17:00:00', remarks: 'Original', did_not_work: false });
    expect(result.jobs.map((job: { job_number: string; display_order: number }) => [job.job_number, job.display_order]))
      .toEqual([['JOB-A', 0], ['JOB-B', 1]]);
    expect(result.snapshots).toEqual([]);
  });

  it('deletes only an unchanged auto-created entry when no work row preceded leave', async () => {
    await observer.query('UPDATE public.timesheet_entry_leave_snapshots SET had_entry = false, original_entry = null, original_job_numbers = ARRAY[]::text[]');
    await remove();
    expect(await state()).toMatchObject({ absence: null, entry: null, snapshots: [], jobs: [] });
  });

  it('restores a half-day snapshot without losing worked hours or job codes', async () => {
    await observer.query(`UPDATE public.absences SET is_half_day = true, half_day_session = 'AM' WHERE id = $1`, [absenceId]);
    await observer.query(`UPDATE public.timesheet_entries SET time_started = '08:00', time_finished = '17:00',
      job_number = 'JOB-A', did_not_work = false, daily_total = 13.5, remarks = 'Annual Leave (AM)' WHERE id = $1`, [entryId]);
    await observer.query(`INSERT INTO public.timesheet_entry_job_codes (timesheet_entry_id, job_number, display_order)
      VALUES ($1, 'JOB-A', 0), ($1, 'JOB-B', 1)`, [entryId]);
    await observer.query(`UPDATE public.timesheet_entry_leave_snapshots SET
      applied_entry = '{"did_not_work":false,"daily_total":13.5,"remarks":"Annual Leave (AM)"}'`);
    const fresh = await currentVersion();
    await remove(db, fresh);
    expect((await state()).entry).toMatchObject({ time_started: '08:00:00', daily_total: 9, remarks: 'Original' });
  });

  it('restores plant fields cleared by database coercion but omitted from the applied payload', async () => {
    await observer.query(`UPDATE public.timesheet_entry_leave_snapshots SET original_entry = original_entry ||
      '{"operator_working_hours":7.5,"machine_start_time":"08:00:00","machine_finish_time":"16:00:00",
        "machine_working_hours":8}'::jsonb`);
    await remove();
    expect((await state()).entry).toMatchObject({
      operator_working_hours: 7.5, machine_start_time: '08:00:00',
      machine_finish_time: '16:00:00', machine_working_hours: 8,
    });
  });

  it('rolls back deletion, restoration, and snapshots if any later write fails', async () => {
    await observer.query(`CREATE FUNCTION public.fail_job_restore() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'fixture job restoration failure'; END $$;
      CREATE TRIGGER fail_restore BEFORE INSERT ON public.timesheet_entry_job_codes FOR EACH ROW EXECUTE FUNCTION public.fail_job_restore()`);
    try {
      await unchangedAfterFailure(/fixture job restoration failure/);
    } finally {
      await observer.query('DROP TRIGGER fail_restore ON public.timesheet_entry_job_codes; DROP FUNCTION public.fail_job_restore()');
    }
  });

  it('rolls back completed reconciliation if a later absence trigger rejects deletion', async () => {
    await observer.query(`CREATE FUNCTION public.fail_absence_delete() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'fixture final delete failure'; END $$;
      CREATE TRIGGER zz_fail_delete AFTER DELETE ON public.absences FOR EACH ROW EXECUTE FUNCTION public.fail_absence_delete()`);
    try {
      await unchangedAfterFailure(/fixture final delete failure/);
    } finally {
      await observer.query('DROP TRIGGER zz_fail_delete ON public.absences; DROP FUNCTION public.fail_absence_delete()');
    }
  });

  it('preserves delete RLS rather than converting an invisible DELETE into success', async () => {
    await db.query("SELECT set_config('test.edit', 'off', false)");
    await unchangedAfterFailure(/permission to delete/);
  });

  it('denies cleanup when the absence editor lacks timesheet authorisation', async () => {
    await db.query("SELECT set_config('test.authorise', 'off', false)");
    await unchangedAfterFailure(/cannot change this employee/);
  });

  it('denies anonymous execution and keeps the privileged trigger uncallable', async () => {
    await db.query("SELECT set_config('test.actor', '', false)");
    await unchangedAfterFailure(/Not authenticated/);
    await db.query('RESET ROLE; SET ROLE anon');
    await expect(remove()).rejects.toThrow(/permission denied for function/);
    await expect(db.query('SELECT public.reconcile_deleted_absence_timesheets()')).rejects.toThrow(/permission denied for function/);
  });

  it.each(['approved', 'processed', 'adjusted'])('fails closed for a %s timesheet', async (status) => {
    await observer.query('UPDATE public.timesheets SET status = $1 WHERE id = $2', [status, timesheetId]);
    await unchangedAfterFailure(/locked timesheets/);
  });

  it.each(['draft', 'rejected', 'submitted', 'manager_approved'])('preserves %s header status while reconciling', async (status) => {
    await observer.query('UPDATE public.timesheets SET status = $1 WHERE id = $2', [status, timesheetId]);
    await remove();
    expect((await observer.query('SELECT status FROM public.timesheets WHERE id = $1', [timesheetId])).rows[0].status).toBe(status);
  });

  it('retains the historic guard under an effective non-admin role', async () => {
    await db.query("SELECT set_config('test.admin', 'off', false)");
    await unchangedAfterFailure(/approved or processed absences without admin/);
  });

  it('retains the past-date guard for an effective non-admin deleting pending leave', async () => {
    await observer.query("UPDATE public.absences SET date = current_date - 1, status = 'pending' WHERE id = $1", [absenceId]);
    await db.query("SELECT set_config('test.admin', 'off', false)");
    const before = await state();
    await expect(remove(db, await currentVersion())).rejects.toThrow(/past absences without admin/);
    expect(await state()).toEqual(before);
  });

  it('prevents a non-admin from individually deleting a bulk booking', async () => {
    await observer.query("UPDATE public.absences SET status = 'pending', bulk_batch_id = $2 WHERE id = $1", [absenceId, randomUUID()]);
    await db.query("SELECT set_config('test.admin', 'off', false)");
    const before = await state();
    await expect(remove(db, await currentVersion())).rejects.toThrow(/Bulk company leave bookings/);
    expect(await state()).toEqual(before);
  });

  it('preserves explicit financial-year closure for employee bookings', async () => {
    await observer.query("UPDATE public.absences SET status = 'pending' WHERE id = $1", [absenceId]);
    await observer.query('INSERT INTO public.absence_financial_year_closures SELECT public.absence_financial_year_start_year(date) FROM public.absences WHERE id = $1', [absenceId]);
    await db.query("SELECT set_config('test.admin', 'off', false)");
    const before = await state();
    await expect(remove(db, await currentVersion())).rejects.toThrow(/closed for employee bookings/);
    expect(await state()).toEqual(before);
  });

  it('retains the closed-financial-year trigger even for full admins', async () => {
    await observer.query("UPDATE public.absences SET date = (current_date - interval '2 years')::date WHERE id = $1", [absenceId]);
    const fresh = await currentVersion();
    const before = await state();
    await expect(remove(db, fresh)).rejects.toThrow(/closed financial year/);
    expect(await state()).toEqual(before);
  });

  it.each(['is_bank_holiday', 'auto_generated'])('protects %s records in the database', async (field) => {
    await observer.query(`UPDATE public.absences SET ${field} = true WHERE id = $1`, [absenceId]);
    const fresh = await currentVersion();
    const before = await state();
    await expect(remove(db, fresh)).rejects.toThrow(/cannot be deleted individually/);
    expect(await state()).toEqual(before);
  });

  it('allows self deletion of a pending future booking without touching unrelated timesheet data', async () => {
    await observer.query("UPDATE public.absences SET profile_id = $2, status = 'pending' WHERE id = $1", [absenceId, actor]);
    await observer.query('DELETE FROM public.timesheet_entry_leave_snapshots');
    await authenticate(db, { edit: false, admin: false, authorise: false });
    const fresh = await currentVersion();
    const before = await state();
    await remove(db, fresh);
    expect((await state()).entry).toEqual(before.entry);
  });

  it('clears only the exact legacy auto-leave shape when no snapshot exists', async () => {
    await observer.query('DELETE FROM public.timesheet_entry_leave_snapshots');
    await remove();
    expect((await state()).entry).toMatchObject({ did_not_work: false, remarks: null, daily_total: null });
  });

  it('fails closed instead of guessing half-day legacy hours', async () => {
    await observer.query('DELETE FROM public.timesheet_entry_leave_snapshots');
    await observer.query("UPDATE public.absences SET is_half_day = true WHERE id = $1", [absenceId]);
    const fresh = await currentVersion();
    const before = await state();
    await expect(remove(db, fresh)).rejects.toThrow(/restoration evidence is incomplete/);
    expect(await state()).toEqual(before);
  });

  it('does not overwrite a manually changed job code or payment', async () => {
    await observer.query("INSERT INTO public.timesheet_entry_job_codes (timesheet_entry_id, job_number, display_order) VALUES ($1, 'NEW-JOB', 0)", [entryId]);
    await unchangedAfterFailure(/entries have changed/);
    await observer.query('DELETE FROM public.timesheet_entry_job_codes');
    await observer.query('ALTER TABLE public.timesheet_entries DISABLE TRIGGER timesheet_entries_enforce_absence_rules');
    await observer.query('UPDATE public.timesheet_entries SET subsistence_payment_required = true WHERE id = $1', [entryId]);
    await observer.query('ALTER TABLE public.timesheet_entries ENABLE TRIGGER timesheet_entries_enforce_absence_rules');
    await unchangedAfterFailure(/entries have changed/);
  });

  it.each(['training', 'annual leave override'])('leaves unrelated work unchanged for %s with no snapshots', async (kind) => {
    await observer.query('DELETE FROM public.timesheet_entry_leave_snapshots');
    if (kind === 'training') {
      await observer.query("UPDATE public.absence_reasons SET name = 'Training'");
    } else {
      await observer.query('UPDATE public.absences SET allow_timesheet_work_on_leave = true WHERE id = $1', [absenceId]);
    }
    const before = await state();
    await remove(db, await currentVersion());
    expect((await state()).entry).toEqual(before.entry);
  });

  it('rejects incomplete applied restoration evidence without deleting anything', async () => {
    await observer.query("UPDATE public.timesheet_entry_leave_snapshots SET applied_entry = '{}'::jsonb");
    await unchangedAfterFailure(/restoration evidence is incomplete/);
  });

  it('rejects an incomplete original snapshot rather than losing its restoration baseline', async () => {
    await observer.query("UPDATE public.timesheet_entry_leave_snapshots SET original_entry = '{}'::jsonb");
    await unchangedAfterFailure(/restoration evidence is incomplete/);
  });

  it.each([true, false])('preserves another blocking booking when had_entry is %s', async (hadEntry) => {
    await observer.query(`INSERT INTO public.absences (id, profile_id, date, reason_id)
      SELECT gen_random_uuid(), profile_id, date, reason_id FROM public.absences WHERE id = $1`, [absenceId]);
    await observer.query('UPDATE public.timesheet_entry_leave_snapshots SET had_entry = $1', [hadEntry]);
    await unchangedAfterFailure(/Another leave booking/);
  });

  it('rejects a snapshot referencing another employee rather than using privileged cleanup there', async () => {
    await observer.query('UPDATE public.timesheets SET user_id = $2 WHERE id = $1', [timesheetId, actor]);
    await unchangedAfterFailure(/snapshot no longer matches/);
  });

  it('rejects null/stale versions and a repeated delete without a successful no-op', async () => {
    const before = await state();
    await expect(remove(db, null)).rejects.toThrow(/absence has changed/);
    expect(await state()).toEqual(before);
    await remove();
    const deleted = await state();
    await expect(remove()).rejects.toThrow(/Absence record not found/);
    expect(await state()).toEqual(deleted);
  });

  it('waits for a concurrent absence edit, then rejects the stale version without cleanup', async () => {
    await writer.query('BEGIN; RESET ROLE');
    await writer.query("UPDATE public.absences SET notes = 'Concurrent edit' WHERE id = $1", [absenceId]);
    const pending = remove();
    await blocked(dbPid, writerPid);
    await writer.query('COMMIT');
    await expect(pending).rejects.toThrow(/absence has changed/);
    expect((await state()).absence.notes).toBe('Concurrent edit');
    expect((await state()).snapshots).toHaveLength(1);
  });

  it('waits for a concurrent payroll lock, then aborts deletion with all effects retained', async () => {
    await writer.query('BEGIN; RESET ROLE');
    await writer.query("UPDATE public.timesheets SET status = 'approved' WHERE id = $1", [timesheetId]);
    const pending = remove();
    await blocked(dbPid, writerPid);
    await writer.query('COMMIT');
    await expect(pending).rejects.toThrow(/locked timesheets/);
    expect((await state()).absence).not.toBeNull();
    expect((await state()).snapshots).toHaveLength(1);
  });

  it('waits for a concurrent entry writer, then retains that edit and rejects stale restoration', async () => {
    await writer.query('BEGIN; RESET ROLE');
    await writer.query('SELECT 1 FROM public.timesheets WHERE id = $1 FOR SHARE', [timesheetId]);
    await writer.query('ALTER TABLE public.timesheet_entries DISABLE TRIGGER timesheet_entries_enforce_absence_rules');
    await writer.query("UPDATE public.timesheet_entries SET remarks = 'Concurrent work edit' WHERE id = $1", [entryId]);
    await writer.query('ALTER TABLE public.timesheet_entries ENABLE TRIGGER timesheet_entries_enforce_absence_rules');
    const pending = remove();
    await blocked(dbPid, writerPid);
    await writer.query('COMMIT');
    await expect(pending).rejects.toThrow(/entries have changed/);
    expect((await state()).entry.remarks).toBe('Concurrent work edit');
    expect((await state()).absence).not.toBeNull();
  });

  it('rejects partial original snapshots with no partial delete', async () => {
    await observer.query("UPDATE public.timesheet_entry_leave_snapshots SET original_entry = original_entry - 'remarks'");
    await unchangedAfterFailure(/restoration evidence is incomplete/);
  });

  it('rejects an older repeatable-read snapshot instead of missing concurrent inserts', async () => {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await expect(remove()).rejects.toThrow(/read committed isolation/);
    await db.query('ROLLBACK');
    expect((await state()).absence).not.toBeNull();
  });

  it('waits for a newly inserted timesheet and reconciles its leave row after commit', async () => {
    const sheet = randomUUID();
    const entry = randomUUID();
    await writer.query('BEGIN; RESET ROLE');
    await writer.query(`INSERT INTO public.timesheets (id,user_id,week_ending,status)
      SELECT $1,user_id,week_ending,'draft' FROM public.timesheets WHERE id=$2`, [sheet,timesheetId]);
    await writer.query(`INSERT INTO public.timesheet_entries (id,timesheet_id,day_of_week)
      SELECT $1,$2,day_of_week FROM public.timesheet_entries WHERE id=$3`, [entry,sheet,entryId]);
    const pending = remove();
    await blocked(dbPid,writerPid);
    await writer.query('COMMIT');
    await pending;
    expect((await observer.query('SELECT did_not_work,remarks FROM public.timesheet_entries WHERE id=$1',[entry])).rows[0])
      .toEqual({did_not_work:false,remarks:null});
    expect((await state()).absence).toBeNull();
  });

  it('blocks a new timesheet writer until deletion commits and the absence is gone', async () => {
    const sheet = randomUUID();
    await db.query('BEGIN');
    await remove();
    await writer.query('BEGIN; RESET ROLE');
    const pending = writer.query(`INSERT INTO public.timesheets (id,user_id,week_ending,status)
      SELECT $1,user_id,week_ending,'draft' FROM public.timesheets WHERE id=$2`, [sheet,timesheetId]);
    await blocked(writerPid,dbPid);
    await db.query('COMMIT');
    await pending;
    const entry = randomUUID();
    await writer.query(`INSERT INTO public.timesheet_entries (id,timesheet_id,day_of_week)
      SELECT $1,$2,day_of_week FROM public.timesheet_entries WHERE id=$3`, [entry,sheet,entryId]);
    await writer.query('COMMIT');
    expect((await observer.query('SELECT did_not_work FROM public.timesheet_entries WHERE id=$1',[entry])).rows[0].did_not_work).toBe(false);
  });

  it('holds payroll/status writers until deletion and restoration commit together', async () => {
    await db.query('BEGIN');
    await remove();
    // A separate session still sees both the booking and its applied row.
    expect((await state()).absence).not.toBeNull();
    expect((await state()).entry.remarks).toBe('Annual Leave');
    await writer.query('RESET ROLE');
    const pending = writer.query("UPDATE public.timesheets SET status = 'approved' WHERE id = $1", [timesheetId]);
    await blocked(writerPid, dbPid);
    await db.query('COMMIT');
    await pending;
    expect((await state()).absence).toBeNull();
    expect((await state()).entry.remarks).toBe('Original');
  });
});
