import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteInspection, cleanupInspectionStorage } from '@/lib/server/inspection-deletion';
import { correctInspectionMeter } from '@/lib/server/inspection-meter-correction';
import type { InspectionAssetType } from '@/lib/inspections/meter-correction';
import {
  DATABASE_COMMENT_PREFIX, PROJECT_NAME_HASH_LENGTH, PROJECT_NAME_PREFIX,
  PROVENANCE_ENV_KEYS, STATE_VERSION, validateLocalTestDatabaseUrl,
} from '../../scripts/local-test-postgres';
import { readHgvInspectionSaveFunctionSql } from './hgv-inspection-save-rpc-harness';

const local = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const actor = '11111111-1111-4111-8111-111111111111';
const types = ['van', 'plant', 'hgv'] as const;
const sql = (name: string) => readFileSync(resolve(process.cwd(), 'supabase', 'migrations', name), 'utf8');
const assetTable = (kind: InspectionAssetType) => kind === 'plant' ? 'plant' : `${kind}s`;
const meter = (kind: InspectionAssetType) => kind === 'plant' ? 'current_hours' : 'current_mileage';
function sourceFunction(file: string, name: string) {
  const text = file === 'enable-audit-logging.sql'
    ? readFileSync(resolve('supabase', file), 'utf8') : sql(file);
  const start = new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.|private\\.)?${name}\\(`, 'iu').exec(text);
  if (!start) throw new Error(`Missing production function ${name}`);
  const open = text.indexOf('$$', start.index);
  const close = text.indexOf('$$', open + 2);
  return text.slice(start.index, text.indexOf(';', close + 2) + 1);
}

local('Daily Check deletion disposable PostgreSQL', () => {
  let db: Client;
  let other: Client;
  let observer: Client;
  let dbPid: number;
  let otherPid: number;
  const assets = { van: randomUUID(), plant: randomUUID(), hgv: randomUUID() };

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const marker = process.env[PROVENANCE_ENV_KEYS.marker] || '';
    const project = process.env[PROVENANCE_ENV_KEYS.project];
    const match = new RegExp(`^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`, 'u').exec(marker);
    if (!match || project !== `${PROJECT_NAME_PREFIX}${match[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`) {
      throw new Error('Disposable PostgreSQL provenance required');
    }
    validateLocalTestDatabaseUrl(url, Number(process.env[PROVENANCE_ENV_KEYS.port]));
    db = new Client({ connectionString: url, ssl: false });
    other = new Client({ connectionString: url, ssl: false });
    observer = new Client({ connectionString: url, ssl: false });
    await db.connect();
    await other.connect();
    await observer.connect();
    dbPid = (await db.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    otherPid = (await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const identity = await db.query("SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()");
    expect(identity.rows[0]).toEqual({ name: 'avsworklog_test', marker });
    await db.query(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
        $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS
        $$ SELECT nullif(current_setting('test.role', true), '') $$;
      CREATE FUNCTION public.effective_is_manager_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.effective_has_module_level(text, integer) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE TABLE public.vans (id uuid PRIMARY KEY);
      CREATE TABLE public.plant (id uuid PRIMARY KEY);
      CREATE TABLE public.hgvs (id uuid PRIMARY KEY, current_mileage integer);
      CREATE TABLE public.vehicle_maintenance (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), van_id uuid UNIQUE, plant_id uuid UNIQUE, hgv_id uuid UNIQUE,
        current_mileage integer, current_hours integer, last_mileage_update timestamptz, last_hours_update timestamptz,
        updated_at timestamptz DEFAULT now(), next_service_template_id uuid, next_service_rotation_step_id uuid,
        last_service_template_id uuid, next_service_mileage integer, last_service_mileage integer,
        next_service_hours integer, last_service_hours integer, last_updated_by uuid
      );
      CREATE TABLE public.maintenance_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), van_id uuid, plant_id uuid, hgv_id uuid,
        field_name text, old_value text, new_value text, value_type text, comment text,
        updated_by uuid, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text, record_id uuid, user_id uuid,
        action text, changes jsonb, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.inspection_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid NOT NULL, item_number integer,
        item_description text, day_of_week integer, status text, comments text
      );
      CREATE TABLE public.inspection_photos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid, photo_url text,
        item_number integer, day_of_week integer, caption text, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.inspection_daily_hours (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid, hours integer);
      CREATE TABLE public.actions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid,
        inspection_item_id uuid REFERENCES public.inspection_items ON DELETE SET NULL,
        van_id uuid, plant_id uuid, hgv_id uuid, status text DEFAULT 'pending',
        action_type text DEFAULT 'inspection_defect', description text, workshop_comments text,
        actioned boolean DEFAULT false, actioned_at timestamptz, actioned_by uuid, updated_at timestamptz DEFAULT now(),
        workshop_category_id uuid, workshop_subcategory_id uuid, asset_meter_reading numeric, asset_meter_unit text,
        title text, created_by uuid, logged_by uuid, created_at timestamptz DEFAULT now(), status_history jsonb
      );
      CREATE TABLE public.workshop_task_categories (id uuid PRIMARY KEY, slug text);
      CREATE TABLE public.workshop_task_subcategories (id uuid PRIMARY KEY, category_id uuid);
      CREATE TABLE public.maintenance_categories (id uuid PRIMARY KEY, workshop_category_id uuid, config_key text, is_active boolean);
      CREATE TABLE public.asset_service_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, event_type text);
      CREATE TABLE public.workshop_task_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid REFERENCES public.actions ON DELETE CASCADE, comment text);
      CREATE TABLE public.workshop_task_attachments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid REFERENCES public.actions ON DELETE CASCADE, file_url text);
      CREATE TABLE public.workshop_attachment_field_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), response_value text, response_json jsonb);
      CREATE TABLE public.reminder_actions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_type text, van_id uuid, plant_id uuid, hgv_id uuid, status text,
        resolved_at timestamptz, updated_at timestamptz DEFAULT now(), workflow_key text, source_type text,
        dedupe_key text, priority text, title text, description text, metadata jsonb, created_by uuid,
        first_detected_at timestamptz, last_detected_at timestamptz, due_at timestamptz
      );
      CREATE TABLE public.reminders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid REFERENCES public.reminder_actions, status text,
        actioned_at timestamptz, actioned_by uuid, updated_at timestamptz DEFAULT now()
      );
    `);
    for (const kind of types) await db.query(`CREATE TABLE public.${kind}_inspections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${kind}_id uuid REFERENCES public.${assetTable(kind)},
      user_id uuid, reviewed_by uuid, status text DEFAULT 'draft', current_mileage integer, inspection_date date DEFAULT current_date,
      inspection_end_date date, inspector_comments text, signature_data text, signed_at timestamptz,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), submitted_at timestamptz
    )`);
    await db.query(`ALTER TABLE plant_inspections ADD job_source_type text, ADD job_source_id uuid,
      ADD job_code text, ADD job_site_address text;
      CREATE SCHEMA private;
      CREATE TYPE private.allocation_job AS (source_type text, source_id uuid, job_code text,
        site_address text, customer_name text, title text, address_valid boolean);
      CREATE FUNCTION private.resolve_allocation_job(text, uuid, text) RETURNS SETOF private.allocation_job
      LANGUAGE sql AS $$ SELECT ROW($1, $2, coalesce($3, 'FIXTURE'), NULL, 'Fixture', 'Fixture job', false)::private.allocation_job $$;
      CREATE FUNCTION private.allocation_site_is_valid(text) RETURNS boolean LANGUAGE sql AS $$ SELECT length(coalesce($1, '')) > 5 $$;
      CREATE UNIQUE INDEX reminder_dedupe ON reminder_actions (dedupe_key) WHERE status = 'open';
      CREATE TABLE private.account_merge_retired (source_id uuid PRIMARY KEY, run_id uuid);
      CREATE TABLE private.account_merge_runs (run_id uuid, source_id uuid, phase text, source_before jsonb,
        fence_deleted_at timestamptz, retirement_xid text, maintenance_xid text);
    `);
    await db.query(readHgvInspectionSaveFunctionSql());
    await db.query(sql('20260322_split_maintenance_mileage_triggers.sql'));
    await db.query(sql('20261110_daily_check_deletion_effects.sql'));
    // Production lacks the legacy response table; apply the full migration in that layout first.
    await db.query('CREATE TABLE public.workshop_attachment_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), response_value text)');
    await db.query(sql('20261110_daily_check_deletion_effects.sql').match(/DO \$optional_photo_guard\$[\s\S]*?\$optional_photo_guard\$;/u)![0]);

    for (const [file, name] of [
      ['enable-audit-logging.sql', 'log_audit_changes'],
      ['20260114_workshop_task_taxonomy.sql', 'sync_workshop_category_from_subcategory'],
      ['20261102_supervisor_next_service_type.sql', 'protect_vehicle_maintenance_service_state'],
      ['20260808_asset_service_review_fixes.sql', 'prevent_completed_service_task_undo'],
      ['20260907_workshop_completed_task_corrections.sql', 'jsonb_array_is_prefix'],
      ['20260907_workshop_completed_task_corrections.sql', 'jsonb_preserves_correction_events'],
      ['20260907_workshop_completed_task_corrections.sql', 'is_unified_service_workshop_category'],
      ['20260907_workshop_completed_task_corrections.sql', 'prevent_unauthorised_completed_workshop_task_mutation'],
      ['20260817_plant_legacy_missing_site_actions.sql', 'compact_catalog_job_code'],
      ['20260925_plant_inspection_active_job_codes.sql', 'apply_plant_inspection_job_fields'],
      ['20261102_preserve_submitted_plant_check_job_snapshot.sql', 'guard_plant_inspection_job_fields'],
      ['20260925_plant_inspection_active_job_codes.sql', 'upsert_plant_missing_site_action'],
      ['20260925_plant_inspection_active_job_codes.sql', 'ensure_plant_legacy_missing_site_action'],
    ]) await db.query(sourceFunction(file, name));
    await db.query(readFileSync(resolve('tests', 'db', 'inspection-deletion-production-guards.sql'), 'utf8'));
    for (const table of ['van_inspections', 'plant_inspections', 'hgv_inspections', 'vehicle_maintenance', 'hgvs', 'inspection_items']) {
      await db.query(`CREATE TRIGGER production_audit AFTER INSERT OR UPDATE OR DELETE ON public.${table}
        FOR EACH ROW EXECUTE FUNCTION public.log_audit_changes()`);
    }
    for (const table of ['audit_log', 'inspection_items', 'inspection_daily_hours', 'van_inspections',
      'hgv_inspections', 'plant_inspections', 'maintenance_history', 'vehicle_maintenance', 'actions', 'inspection_photos']) {
      await db.query(`CREATE TRIGGER account_merge_actor BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON public.${table}
        FOR EACH STATEMENT EXECUTE FUNCTION private.account_merge_actor_guard()`);
    }
    for (const [table, fields] of [
      ['audit_log', "'user_id'"], ['van_inspections', "'reviewed_by','user_id'"], ['hgv_inspections', "'reviewed_by','user_id'"],
      ['plant_inspections', "'reviewed_by','user_id'"], ['maintenance_history', "'updated_by'"],
      ['vehicle_maintenance', "'last_updated_by'"], ['actions', "'actioned_by','created_by','logged_by'"],
    ]) await db.query(`CREATE TRIGGER account_merge_assignment BEFORE INSERT OR UPDATE ON public.${table}
      FOR EACH ROW EXECUTE FUNCTION private.account_merge_assignment_guard(${fields})`);
    await db.query(`
      CREATE TRIGGER trg_protect_vehicle_maintenance_service_state BEFORE INSERT OR UPDATE OF
        next_service_template_id, next_service_rotation_step_id, last_service_template_id, next_service_mileage,
        last_service_mileage, next_service_hours, last_service_hours ON vehicle_maintenance
        FOR EACH ROW EXECUTE FUNCTION protect_vehicle_maintenance_service_state();
      CREATE TRIGGER prevent_unauthorised_completed_workshop_task_mutation BEFORE UPDATE ON actions
        FOR EACH ROW EXECUTE FUNCTION prevent_unauthorised_completed_workshop_task_mutation();
      CREATE TRIGGER sync_workshop_category_trigger BEFORE INSERT OR UPDATE OF workshop_subcategory_id ON actions
        FOR EACH ROW EXECUTE FUNCTION sync_workshop_category_from_subcategory();
      CREATE TRIGGER trg_prevent_completed_service_task_undo BEFORE UPDATE OF status, actioned ON actions
        FOR EACH ROW EXECUTE FUNCTION prevent_completed_service_task_undo();
      CREATE TRIGGER plant_inspections_job_guard BEFORE INSERT OR UPDATE ON plant_inspections
        FOR EACH ROW EXECUTE FUNCTION private.guard_plant_inspection_job_fields();
      CREATE TRIGGER plant_inspections_legacy_missing_site_action AFTER INSERT OR UPDATE ON plant_inspections
        FOR EACH ROW EXECUTE FUNCTION private.ensure_plant_legacy_missing_site_action();
    `);
  });

  beforeEach(async () => {
    await db.query('ROLLBACK');
    await other.query('ROLLBACK');
    await observer.query('ROLLBACK');
    await db.query(`TRUNCATE private.daily_check_effects, private.daily_check_storage_cleanup,
      public.van_inspections, public.plant_inspections, public.hgv_inspections,
      public.inspection_photos, public.inspection_daily_hours, public.inspection_items,
      public.workshop_task_comments, public.workshop_task_attachments, public.actions,
      public.workshop_attachment_responses, public.workshop_attachment_field_responses,
      public.reminders, public.reminder_actions, public.vehicle_maintenance,
      public.maintenance_history, public.audit_log, public.vans, public.plant, public.hgvs CASCADE`);
    await db.query('TRUNCATE public.asset_service_events, public.workshop_task_categories, public.workshop_task_subcategories, private.account_merge_retired');
    for (const kind of types) {
      await db.query(`INSERT INTO public.${assetTable(kind)} (id) VALUES ($1)`, [assets[kind]]);
      await db.query(`INSERT INTO public.vehicle_maintenance (${kind}_id, ${meter(kind)}, ${kind === 'plant' ? 'last_hours_update' : 'last_mileage_update'})
        VALUES ($1, 100, '2026-01-01')`, [assets[kind]]);
    }
    await db.query('UPDATE public.hgvs SET current_mileage = 100');
  });

  afterAll(async () => {
    await observer?.query('ROLLBACK');
    await Promise.all([db?.end(), other?.end(), observer?.end()]);
  });

  async function check(kind: InspectionAssetType, reading = 200, status = 'submitted') {
    const id = randomUUID();
    await db.query(`INSERT INTO public.${kind}_inspections
      (id, ${kind}_id, user_id, status, current_mileage${kind === 'plant' ? ', job_source_type, job_source_id, job_code' : ''})
      VALUES ($1, $2, $3, $4, $5${kind === 'plant' ? ", 'project_number', $2, 'FIXTURE'" : ''})`,
    [id, assets[kind], actor, status, reading]);
    return id;
  }
  async function reading(kind: InspectionAssetType) {
    return (await db.query(`SELECT ${meter(kind)} AS reading FROM public.vehicle_maintenance WHERE ${kind}_id = $1`, [assets[kind]])).rows[0].reading;
  }
  async function task(kind: InspectionAssetType, checkId: string | null) {
    return (await db.query(`INSERT INTO public.actions (${kind}_id, inspection_id) VALUES ($1, $2) RETURNING id`,
      [assets[kind], checkId])).rows[0].id as string;
  }
  async function waitForBlocked(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if ((await observer.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid])).rows[0].blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected PostgreSQL session did not wait for its competing transaction');
  }
  async function competeDuringDeletion(kind: InspectionAssetType, id: string, compete: () => Promise<unknown>) {
    await db.query(`CREATE FUNCTION pause_deletion_audit() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN IF NEW.action = 'daily_check_deleted' THEN PERFORM pg_advisory_xact_lock(987654321); END IF; RETURN NEW; END $$;
      CREATE TRIGGER pause_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pause_deletion_audit()`);
    await observer.query('BEGIN');
    await observer.query('SELECT pg_advisory_xact_lock(987654321)');
    const deletion = deleteInspection(db, kind, id, actor);
    let contender: Promise<{ value?: unknown; error?: unknown }> | undefined;
    try {
      await waitForBlocked(dbPid);
      contender = compete().then(value => ({ value }), error => ({ error }));
      await waitForBlocked(otherPid);
      await observer.query('COMMIT');
      await deletion;
      return await contender;
    } finally {
      await observer.query('ROLLBACK');
      await deletion.catch(() => undefined);
      await contender;
      await db.query('DROP TRIGGER pause_audit ON audit_log; DROP FUNCTION pause_deletion_audit()');
    }
  }

  it.each(types)('restores a verified manual baseline and all children atomically for %s', async kind => {
    const id = await check(kind);
    await db.query('INSERT INTO inspection_items (inspection_id) VALUES ($1)', [id]);
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/x.jpg`]);
    await db.query('INSERT INTO inspection_daily_hours (inspection_id, hours) VALUES ($1, 8)', [id]);
    const owned = await task(kind, id);
    const result = await deleteInspection(db, kind, id, actor);
    expect(result.success).toBe(true);
    expect(result.storageCleanupPending).toBe(1);
    expect(await reading(kind)).toBe(100);
    for (const table of [`${kind}_inspections`, 'inspection_items', 'inspection_photos', 'inspection_daily_hours', 'actions']) {
      expect((await db.query(`SELECT 1 FROM public.${table} WHERE ${table === 'actions' ? 'id' : table.endsWith('_inspections') ? 'id' : 'inspection_id'} = $1`,
        [table === 'actions' ? owned : id])).rowCount).toBe(0);
    }
    expect((await db.query("SELECT changes->'inspection'->>'id' AS id FROM audit_log WHERE action = 'daily_check_deleted'")).rows[0].id).toBe(id);
    expect((await db.query('SELECT 1 FROM maintenance_history WHERE daily_check_id = $1', [id])).rowCount).toBe(0);
    if (kind === 'hgv') expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(100);
  });

  it.each(types)('preserves later workshop/manual inputs including identical values for %s', async kind => {
    const id = await check(kind);
    await db.query(`UPDATE vehicle_maintenance SET ${meter(kind)} = 200 WHERE ${kind}_id = $1`, [assets[kind]]);
    if (kind === 'hgv') await db.query('UPDATE hgvs SET current_mileage = 200');
    await deleteInspection(db, kind, id, actor);
    expect(await reading(kind)).toBe(200);
    if (kind === 'hgv') expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(200);
  });

  it.each(types)('supports older and successive deletions without restoring voided readings for %s', async kind => {
    const older = await check(kind, 200);
    const later = await check(kind, 300);
    await deleteInspection(db, kind, older, actor);
    expect(await reading(kind)).toBe(300);
    await deleteInspection(db, kind, later, actor);
    expect(await reading(kind)).toBe(100);
  });

  it.each(types)('restores previous check and workshop readings for %s', async kind => {
    await check(kind, 150);
    const id = await check(kind, 200);
    const result = await deleteInspection(db, kind, id, actor);
    expect(result.warnings.filter(warning => !warning.includes('reminder'))).toEqual([]);
    expect(await reading(kind)).toBe(150);
    await db.query(`UPDATE vehicle_maintenance SET ${meter(kind)} = 175 WHERE ${kind}_id = $1`, [assets[kind]]);
    const next = await check(kind, 250);
    await deleteInspection(db, kind, next, actor);
    expect(await reading(kind)).toBe(175);
  });

  it.each(types.flatMap(kind => ['draft', 'submitted', 'rejected', 'approved'].map(status => ({ kind, status }))))
  ('deletes $kind status $status without changing the server permission', async ({ kind, status }) => {
    const id = await check(kind, 200, status);
    expect((await deleteInspection(db, kind, id, actor)).success).toBe(true);
  });

  it('does not fabricate a missing baseline and actually recovers a verified legacy baseline', async () => {
    await db.query('DELETE FROM vehicle_maintenance WHERE van_id = $1', [assets.van]);
    const id = await check('van');
    const result = await deleteInspection(db, 'van', id, actor);
    expect(await reading('van')).toBe(200);
    expect(result.warnings.join(' ')).toContain('No verified previous meter');
    const legacy = await check('plant');
    await db.query('TRUNCATE private.daily_check_effects');
    const historical = await deleteInspection(db, 'plant', legacy, actor);
    expect(await reading('plant')).toBe(100);
    expect(historical.warnings.join(' ')).not.toContain('RECONCILIATION REQUIRED');
  });

  it('does not invent an insertion baseline from a later timestamp-only event', async () => {
    await db.query('DELETE FROM vehicle_maintenance WHERE van_id = $1', [assets.van]);
    const id = await check('van');
    await db.query("UPDATE vehicle_maintenance SET last_mileage_update = '2026-11-11' WHERE van_id = $1", [assets.van]);
    const outcome = await deleteInspection(db, 'van', id, actor);
    expect(await reading('van')).toBe(200);
    expect(outcome.warnings.join(' ')).toContain('No verified previous meter');
  });

  async function forgetLegacyJournal() {
    await db.query('TRUNCATE private.daily_check_effects');
    await db.query('DELETE FROM maintenance_history WHERE daily_check_id IS NOT NULL');
  }

  it.each(types)('recovers real legacy prior-check and manual/workshop histories for %s', async kind => {
    await check(kind, 140);
    await db.query(`UPDATE vehicle_maintenance SET ${meter(kind)} = 175 WHERE ${kind}_id = $1`, [assets[kind]]);
    await db.query(`INSERT INTO maintenance_history (${kind}_id, field_name, old_value, new_value, comment)
      VALUES ($1, $2, '140', '175', 'Workshop meter entry')`, [assets[kind], meter(kind)]);
    const id = await check(kind, 900);
    await forgetLegacyJournal();
    const outcome = await deleteInspection(db, kind, id, actor);
    expect(await reading(kind)).toBe(175);
    expect(outcome.warnings.join(' ')).not.toContain('RECONCILIATION REQUIRED');
    if (kind === 'hgv') expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(140);
  });

  it.each(types)('preserves later independent legacy writes rather than the inspection updated_at for %s', async kind => {
    const id = await check(kind, 900);
    await db.query(`UPDATE vehicle_maintenance SET ${meter(kind)} = 250 WHERE ${kind}_id = $1`, [assets[kind]]);
    if (kind === 'hgv') await db.query('UPDATE hgvs SET current_mileage = 250');
    await db.query(`INSERT INTO maintenance_history (${kind}_id, field_name, old_value, new_value, comment)
      VALUES ($1, $2, '900', '250', 'Manual meter correction')`, [assets[kind], meter(kind)]);
    await db.query(`UPDATE ${kind}_inspections SET inspector_comments = 'Later review', updated_at = now() + interval '1 day' WHERE id = $1`, [id]);
    await forgetLegacyJournal();
    await deleteInspection(db, kind, id, actor);
    expect(await reading(kind)).toBe(250);
  });

  it('preserves a later explicit equal-valued legacy manual reading', async () => {
    const id = await check('van', 900);
    await db.query(`INSERT INTO maintenance_history (van_id, field_name, old_value, new_value, comment)
      VALUES ($1, 'current_mileage', '900', '900', 'Manual reading independently confirmed')`, [assets.van]);
    await forgetLegacyJournal();
    await deleteInspection(db, 'van', id, actor);
    expect(await reading('van')).toBe(900);
  });

  it.each(['manual', 'prior-check'])('recovers a missing legacy before-image from verified %s history', async source => {
    if (source === 'prior-check') await check('van', 150);
    else await db.query(`INSERT INTO maintenance_history (van_id, field_name, new_value, comment, created_at)
      VALUES ($1, 'current_mileage', '175', 'Workshop reading', now() - interval '1 day')`, [assets.van]);
    await db.query('BEGIN');
    const id = await check('van', 900);
    await db.query(`DELETE FROM audit_log WHERE table_name = 'vehicle_maintenance'
      AND record_id = (SELECT id FROM vehicle_maintenance WHERE van_id = $1)
      AND changes->'current_mileage'->>'new' <> '900'`, [assets.van]);
    await db.query(`UPDATE audit_log SET changes = jsonb_set(changes, '{current_mileage}',
      (changes->'current_mileage') - 'old') WHERE table_name = 'vehicle_maintenance'
      AND changes->'current_mileage'->>'new' = '900'`);
    await db.query('COMMIT');
    await forgetLegacyJournal();
    const outcome = await deleteInspection(db, 'van', id, actor);
    expect(outcome.warnings.filter(warning => warning.includes('RECONCILIATION REQUIRED'))).toEqual([]);
    expect(await reading('van')).toBe(source === 'manual' ? 175 : 150);
    expect(outcome.warnings.join(' ')).not.toContain('RECONCILIATION REQUIRED');
  });

  it.each(types)('restores known null before-images instead of treating them as absent for %s', async kind => {
    await db.query(`UPDATE vehicle_maintenance SET ${meter(kind)} = NULL WHERE ${kind}_id = $1`, [assets[kind]]);
    if (kind === 'hgv') await db.query('UPDATE hgvs SET current_mileage = NULL');
    const id = await check(kind);
    await deleteInspection(db, kind, id, actor);
    expect(await reading(kind)).toBeNull();
    const legacy = await check(kind);
    await forgetLegacyJournal();
    await deleteInspection(db, kind, legacy, actor);
    expect(await reading(kind)).toBeNull();
  });

  it('rebases the new journal after legacy deletion so subsequent deletion cannot restore the erroneous baseline', async () => {
    const legacy = await check('van', 900);
    await forgetLegacyJournal();
    const recent = await check('van', 300);
    await deleteInspection(db, 'van', legacy, actor);
    expect(await reading('van')).toBe(300);
    await deleteInspection(db, 'van', recent, actor);
    expect(await reading('van')).toBe(100);
  });

  it('does not resurrect readings from successively deleted legacy checks', async () => {
    const earlier = await check('van', 900);
    const later = await check('van', 950);
    await forgetLegacyJournal();
    await deleteInspection(db, 'van', later, actor);
    expect(await reading('van')).toBe(900);
    await deleteInspection(db, 'van', earlier, actor);
    expect(await reading('van')).toBe(100);
  });

  it.each(['missing-source', 'revised-source', 'ambiguous-source'])(
    'records a durable explicit reconciliation workflow for %s audit evidence', async reason => {
      const id = await check('van', 900);
      await forgetLegacyJournal();
      if (reason === 'missing-source') await db.query("DELETE FROM audit_log WHERE record_id = $1 AND table_name = 'van_inspections'", [id]);
      if (reason === 'revised-source') await db.query("UPDATE audit_log SET user_id = $2 WHERE record_id = $1", [id, actor]);
      if (reason === 'ambiguous-source') {
        await db.query(`INSERT INTO audit_log (table_name, record_id, changes, created_at)
          SELECT table_name, record_id, changes, created_at FROM audit_log WHERE record_id = $1`, [id]);
      }
      const outcome = await deleteInspection(db, 'van', id, actor);
      expect(await reading('van')).toBe(900);
      expect(outcome.warnings.join(' ')).toContain('RECONCILIATION REQUIRED');
      expect((await db.query(`SELECT comment FROM maintenance_history WHERE van_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [assets.van])).rows[0].comment).toContain('audited manual meter correction');
      const repeated = await deleteInspection(db, 'van', id, actor);
      expect(repeated.warnings).toEqual(outcome.warnings);
    });

  it('rejects timestamp/value coincidence without an actual shared audit transaction', async () => {
    const id = await check('van', 900);
    await forgetLegacyJournal();
    await db.query(`UPDATE audit_log SET created_at = (SELECT created_at FROM audit_log
      WHERE table_name = 'vehicle_maintenance' AND changes->'current_mileage'->>'new' = '900')
      WHERE table_name = 'van_inspections' AND record_id = $1`, [id]);
    const result = await deleteInspection(db, 'van', id, actor);
    expect(await reading('van')).toBe(900);
    expect(result.warnings.join(' ')).toContain('RECONCILIATION REQUIRED');
  });

  it('replays task field deltas without carrying an inherited completion through a description edit', async () => {
    const earlier = await check('van', 150);
    const id = await check('van');
    const taskId = await task('van', earlier);
    await db.query(`UPDATE actions SET status = 'completed', actioned = true, daily_check_source_id = $1,
      daily_check_source_type = 'van' WHERE id = $2`, [id, taskId]);
    await db.query("UPDATE actions SET description = 'Independent description' WHERE id = $1", [taskId]);
    await deleteInspection(db, 'van', id, actor);
    expect((await db.query('SELECT status, actioned, description FROM actions WHERE id = $1', [taskId])).rows[0])
      .toEqual({ status: 'pending', actioned: false, description: 'Independent description' });
  });

  it.each(['description', 'comment'])('preserves later %s work on a check-created task without retaining the check completion', async work => {
    const id = await check('van');
    const taskId = await task('van', id);
    await db.query(`UPDATE actions SET status = 'completed', actioned = true,
      daily_check_source_id = $1, daily_check_source_type = 'van' WHERE id = $2`, [id, taskId]);
    if (work === 'description') await db.query("UPDATE actions SET description = 'Later work' WHERE id = $1", [taskId]);
    else await db.query("INSERT INTO workshop_task_comments (task_id, comment) VALUES ($1, 'Later work')", [taskId]);
    await deleteInspection(db, 'van', id, actor);
    expect((await db.query('SELECT status, actioned, inspection_id FROM actions WHERE id = $1', [taskId])).rows[0])
      .toEqual({ status: 'pending', actioned: false, inspection_id: null });
    if (work === 'comment') expect((await db.query('SELECT comment FROM workshop_task_comments WHERE task_id = $1', [taskId])).rows[0].comment).toBe('Later work');
    else expect((await db.query('SELECT description FROM actions WHERE id = $1', [taskId])).rows[0].description).toBe('Later work');
  });

  it('does not carry a voided reading through a later timestamp-only delta', async () => {
    const id = await check('van');
    await db.query("UPDATE vehicle_maintenance SET last_mileage_update = '2026-11-11' WHERE van_id = $1", [assets.van]);
    await deleteInspection(db, 'van', id, actor);
    expect(await reading('van')).toBe(100);
    expect((await db.query('SELECT last_mileage_update::date::text AS stamp FROM vehicle_maintenance WHERE van_id = $1',
      [assets.van])).rows[0].stamp).toBe('2026-11-11');
  });

  it('keeps an explicitly equal-valued check as the meter source for correction and deletion', async () => {
    await check('van', 200);
    const id = await check('van', 200);
    const row = (await db.query('SELECT updated_at::text AS version FROM van_inspections WHERE id = $1', [id])).rows[0];
    await correctInspectionMeter(db, actor, { assetType: 'van', inspectionId: id, reading: 180, expectedReading: 200, expectedVersion: row.version });
    expect(await reading('van')).toBe(180);
    await deleteInspection(db, 'van', id, actor);
    expect(await reading('van')).toBe(200);
  });

  it('exercises actual service/workshop/category guards without updating unrelated snapshot columns', async () => {
    const id = await check('van');
    const taskId = await task('van', null);
    const category = randomUUID(), subcategory = randomUUID();
    await db.query('INSERT INTO workshop_task_subcategories (id, category_id) VALUES ($1, $2)', [subcategory, category]);
    await db.query(`UPDATE actions SET workshop_subcategory_id = $2, action_type = 'workshop_vehicle_task',
      status = 'completed', actioned = true, daily_check_source_id = $3, daily_check_source_type = 'van'
      WHERE id = $1`, [taskId, subcategory, id]);
    await db.query("INSERT INTO asset_service_events (task_id, event_type) VALUES ($1, 'completion')", [taskId]);
    await expect(db.query("UPDATE actions SET status = 'pending', actioned = false WHERE id = $1", [taskId]))
      .rejects.toMatchObject({ code: '42501' });
    await db.query("SELECT set_config('test.role', 'authenticated', false)");
    try {
      await expect(db.query("UPDATE actions SET description = 'Denied' WHERE id = $1", [taskId]))
        .rejects.toThrow('Completed workshop task fields cannot be mutated directly');
      await expect(db.query('UPDATE vehicle_maintenance SET last_service_mileage = 99 WHERE van_id = $1', [assets.van]))
        .rejects.toMatchObject({ code: '42501' });
    } finally { await db.query("SELECT set_config('test.role', '', false)"); }
    const result = await deleteInspection(db, 'van', id, actor);
    expect(result.warnings.join(' ')).toContain('Completed Service work was preserved');
    expect((await db.query('SELECT status, workshop_category_id FROM actions WHERE id = $1', [taskId])).rows[0])
      .toEqual({ status: 'completed', workshop_category_id: category });
  });

  it('keeps actual account-merge actor and assignment guards enforced on the deletion transaction', async () => {
    const id = await check('van');
    const retired = randomUUID();
    await db.query('INSERT INTO private.account_merge_retired (source_id) VALUES ($1)', [retired]);
    await db.query("SELECT set_config('test.actor', $1, false)", [retired]);
    try {
      await expect(deleteInspection(db, 'van', id, actor)).rejects.toMatchObject({ code: '42501' });
    } finally { await db.query("SELECT set_config('test.actor', '', false)"); }
    await expect(deleteInspection(db, 'van', id, retired)).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('SELECT 1 FROM van_inspections WHERE id = $1', [id])).rowCount).toBe(1);
    expect((await deleteInspection(db, 'van', id, actor)).success).toBe(true);
  });

  it('restores causal task completions and reminders while preserving subsequent real workshop work', async () => {
    const earlier = await check('van', 150);
    const id = await check('van');
    const resolved = await task('van', earlier);
    const protectedTask = await task('van', id);
    const shared = await task('van', id);
    await db.query(`UPDATE actions SET status = 'completed', actioned = true,
      daily_check_source_id = $1, daily_check_source_type = 'van' WHERE id = $2`, [id, resolved]);
    await db.query("UPDATE actions SET status = 'completed', workshop_comments = 'Work completed independently' WHERE id = $1", [protectedTask]);
    await db.query('INSERT INTO workshop_task_attachments (task_id) VALUES ($1)', [shared]);
    const reminderAction = (await db.query(`INSERT INTO reminder_actions (asset_type, van_id, status) VALUES ('van', $1, 'open') RETURNING id`, [assets.van])).rows[0].id;
    const reminder = (await db.query(`INSERT INTO reminders (action_id, status) VALUES ($1, 'pending') RETURNING id`, [reminderAction])).rows[0].id;
    await db.query(`UPDATE reminders SET status = 'actioned', actioned_by = $3,
      daily_check_source_id = $1, daily_check_source_type = 'van' WHERE id = $2`, [id, reminder, actor]);
    await db.query(`UPDATE reminder_actions SET status = 'resolved',
      daily_check_source_id = $1, daily_check_source_type = 'van' WHERE id = $2`, [id, reminderAction]);
    await deleteInspection(db, 'van', id, actor);
    expect((await db.query('SELECT status, actioned FROM actions WHERE id = $1', [resolved])).rows[0]).toEqual({ status: 'pending', actioned: false });
    expect((await db.query('SELECT status, inspection_id FROM actions WHERE id = $1', [protectedTask])).rows[0]).toEqual({ status: 'completed', inspection_id: null });
    expect((await db.query('SELECT 1 FROM workshop_task_attachments WHERE task_id = $1', [shared])).rowCount).toBe(1);
    expect((await db.query('SELECT status, actioned_by FROM reminders WHERE id = $1', [reminder])).rows[0]).toEqual({ status: 'pending', actioned_by: null });
    expect((await db.query('SELECT status FROM reminder_actions WHERE id = $1', [reminderAction])).rows[0].status).toBe('open');
  });

  it('rolls back parent, effects, history, children and outbox when accountability fails', async () => {
    const id = await check('van');
    await db.query('INSERT INTO inspection_items (inspection_id) VALUES ($1)', [id]);
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)',
      [id, `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/rollback.jpg`]);
    await db.query('INSERT INTO inspection_daily_hours (inspection_id, hours) VALUES ($1, 8)', [id]);
    const ownedTask = await task('van', id);
    await db.query(`CREATE FUNCTION reject_deletion_audit() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'synthetic audit fault'; END $$;
      CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_deletion_audit()`);
    try {
      await expect(deleteInspection(db, 'van', id, actor)).rejects.toThrow('synthetic audit fault');
      expect(await reading('van')).toBe(200);
      expect((await db.query('SELECT 1 FROM van_inspections WHERE id = $1', [id])).rowCount).toBe(1);
      expect((await db.query('SELECT 1 FROM inspection_items WHERE inspection_id = $1', [id])).rowCount).toBe(1);
      expect((await db.query('SELECT 1 FROM inspection_photos WHERE inspection_id = $1', [id])).rowCount).toBe(1);
      expect((await db.query('SELECT 1 FROM inspection_daily_hours WHERE inspection_id = $1', [id])).rowCount).toBe(1);
      expect((await db.query('SELECT inspection_id FROM actions WHERE id = $1', [ownedTask])).rows[0].inspection_id).toBe(id);
      expect((await db.query('SELECT 1 FROM maintenance_history WHERE daily_check_id = $1', [id])).rowCount).toBe(1);
      expect((await db.query('SELECT 1 FROM private.daily_check_storage_cleanup WHERE source_id = $1', [id])).rowCount).toBe(0);
      expect((await db.query("SELECT 1 FROM audit_log WHERE action = 'daily_check_deleted'")).rowCount).toBe(0);
      expect((await db.query('SELECT 1 FROM private.daily_check_effects WHERE source_id = $1 AND voided_at IS NOT NULL', [id])).rowCount).toBe(0);
    } finally {
      await db.query('DROP TRIGGER reject_audit ON audit_log; DROP FUNCTION reject_deletion_audit()');
    }
  });

  it('serializes a real concurrent meter writer and rejects stale child creation after deletion', async () => {
    const id = await check('van');
    await other.query('BEGIN');
    await other.query('UPDATE vehicle_maintenance SET current_mileage = 350 WHERE van_id = $1', [assets.van]);
    const deletion = deleteInspection(db, 'van', id, actor);
    await waitForBlocked(dbPid);
    await other.query('COMMIT');
    await deletion;
    expect(await reading('van')).toBe(350);
    await expect(other.query('INSERT INTO inspection_items (inspection_id) VALUES ($1)', [id])).rejects.toMatchObject({ code: '23503' });
  });

  it('serializes two actual deletions and creates exactly one permanent audit', async () => {
    const id = await check('plant');
    const outcome = await competeDuringDeletion('plant', id, () => deleteInspection(other, 'plant', id, actor));
    expect(outcome.error).toBeUndefined();
    expect(outcome.value).toMatchObject({ alreadyDeleted: true, success: true });
    expect((await db.query("SELECT 1 FROM audit_log WHERE action = 'daily_check_deleted'")).rowCount).toBe(1);
    await expect(deleteInspection(db, 'van', randomUUID(), actor)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects a child insert already waiting on a deleting parent', async () => {
    const id = await check('van');
    const outcome = await competeDuringDeletion('van', id, () =>
      other.query('INSERT INTO inspection_items (inspection_id) VALUES ($1)', [id]));
    expect(outcome.error).toMatchObject({ code: '23503' });
    expect((await db.query('SELECT 1 FROM inspection_items WHERE inspection_id = $1', [id])).rowCount).toBe(0);
  });
  it('rejects a late causal task update instead of leaving an unjournaled completion', async () => {
    const id = await check('van');
    const taskId = await task('van', null);
    const outcome = await competeDuringDeletion('van', id, () => other.query(`UPDATE actions
      SET status = 'completed', daily_check_source_id = $1, daily_check_source_type = 'van' WHERE id = $2`, [id, taskId]));
    expect(outcome.error).toMatchObject({ code: '23503' });
    expect((await db.query('SELECT status FROM actions WHERE id = $1', [taskId])).rows[0].status).toBe('pending');
  });
  it('protects a shared photo committed while deletion waits for its URL lock', async () => {
    const id = await check('van');
    const sharing = await check('van', 250);
    const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/shared.jpg`;
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
    await other.query('BEGIN');
    await other.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [sharing, photo]);
    const deletion = deleteInspection(db, 'van', id, actor);
    await waitForBlocked(dbPid);
    await other.query('COMMIT');
    expect((await deletion).storageCleanupPending).toBe(1);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
    const remove = vi.fn().mockResolvedValue({ error: null });
    try {
      expect(await cleanupInspectionStorage(db, 'van', id, { from: () => ({ remove }) })).toBe(1);
      expect(remove).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it('rejects a new shared-photo reference waiting behind deletion', async () => {
    const id = await check('van');
    const sharing = await check('van', 250);
    const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/shared.jpg`;
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
    const outcome = await competeDuringDeletion('van', id, () =>
      other.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [sharing, photo]));
    expect(outcome.error).toMatchObject({ code: '23503' });
  });
  it('waits for in-flight JSON evidence before deciding whether Storage is unreferenced', async () => {
    const id = await check('van');
    const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/shared.jpg`;
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
    await other.query('BEGIN');
    await other.query('INSERT INTO workshop_attachment_field_responses (response_json) VALUES ($1::jsonb)', [JSON.stringify({ photo })]);
    await deleteInspection(db, 'van', id, actor);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
    const remove = vi.fn().mockResolvedValue({ error: null });
    const cleanup = cleanupInspectionStorage(db, 'van', id, { from: () => ({ remove }) });
    try {
      await waitForBlocked(dbPid);
      await other.query('COMMIT');
      expect(await cleanup).toBe(1);
      expect(remove).not.toHaveBeenCalled();
    } finally {
      await other.query('ROLLBACK');
      await cleanup;
      vi.unstubAllEnvs();
    }
  });
  it.each([false, true])('handles optional photo table absent or unguarded: %s', async unguarded => {
    const id = await check('van');
    const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/optional.jpg`;
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
    await deleteInspection(db, 'van', id, actor);
    await db.query(unguarded
      ? 'ALTER TABLE workshop_attachment_responses DISABLE TRIGGER daily_check_workshop_photo_guard'
      : 'ALTER TABLE workshop_attachment_responses RENAME TO optional_responses_fixture');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
    const remove = vi.fn().mockResolvedValue({ error: null });
    try {
      const cleanup = cleanupInspectionStorage(db, 'van', id, { from: () => ({ remove }) });
      if (unguarded) {
        await expect(cleanup).rejects.toThrow('Optional photo reference table is not guarded');
        expect((await db.query('SELECT 1 FROM private.daily_check_storage_cleanup WHERE source_id = $1 AND completed_at IS NULL', [id])).rowCount).toBe(1);
      } else expect(await cleanup).toBe(0);
      expect(remove).toHaveBeenCalledTimes(unguarded ? 0 : 1);
    } finally {
      await db.query(unguarded
        ? 'ALTER TABLE workshop_attachment_responses ENABLE TRIGGER daily_check_workshop_photo_guard'
        : 'ALTER TABLE optional_responses_fixture RENAME TO workshop_attachment_responses');
      vi.unstubAllEnvs();
    }
  });

  it('rejects JSON evidence inserted after the cleanup reference check', async () => {
    const id = await check('van');
    const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/late.jpg`;
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
    await deleteInspection(db, 'van', id, actor);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
    const remove = vi.fn().mockImplementation(async () => {
      await expect(other.query('INSERT INTO workshop_attachment_responses (response_value) VALUES ($1)', [photo]))
        .rejects.toMatchObject({ code: '23503' });
      return { error: null };
    });
    try {
      expect(await cleanupInspectionStorage(db, 'van', id, { from: () => ({ remove }) })).toBe(0);
      expect(remove).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllEnvs(); }
  });

  const aliases = ['signed', 'encoded', 'relative'] as const;
  function photoAlias(id: string, alias: typeof aliases[number]) {
    const path = `${id}/shared.jpg`;
    if (alias === 'relative') return path;
    if (alias === 'encoded') return `https://fixture.test/storage/v1/object/sign/inspection-photos/${id}%2f%73hared.jpg?token=fixture`;
    return `https://fixture.test/storage/v1/object/sign/inspection-photos/${path}?token=fixture`;
  }
  it.each(aliases)('preserves surviving %s photo aliases in workshop evidence', async alias => {
    const id = await check('van');
    const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/shared.jpg`;
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
    await db.query('INSERT INTO workshop_attachment_field_responses (response_json) VALUES ($1::jsonb)',
      [JSON.stringify({ photo: photoAlias(id, alias) })]);
    await deleteInspection(db, 'van', id, actor);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
    const remove = vi.fn().mockResolvedValue({ error: null });
    try {
      expect(await cleanupInspectionStorage(db, 'van', id, { from: () => ({ remove }) })).toBe(1);
      expect(remove).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(['inspection_photos', 'workshop_task_check_photos', 'workshop_attachment_responses',
    'workshop_attachment_field_responses', 'workshop_task_comments', 'workshop_task_attachments', 'actions'])(
    'rejects new aliased evidence on %s during Storage removal', async table => {
      const id = await check('van');
      const sharing = await check('van', 250);
      const taskId = await task('van', null);
      const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/shared.jpg`;
      await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
      await deleteInspection(db, 'van', id, actor);
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
      const remove = vi.fn().mockImplementation(async () => {
        for (const alias of aliases) {
          const value = photoAlias(id, alias);
          const insert = table === 'inspection_photos'
            ? () => other.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [sharing, value])
            : table === 'workshop_task_check_photos'
              ? () => other.query(`INSERT INTO workshop_task_check_photos (task_id, id, inspection_id, photo_url)
                VALUES ($1, gen_random_uuid(), $2, $3)`, [taskId, id, value])
              : table === 'workshop_task_comments'
                ? () => other.query('INSERT INTO workshop_task_comments (task_id, comment) VALUES ($1, $2)', [taskId, value])
                : table === 'workshop_task_attachments'
                  ? () => other.query('INSERT INTO workshop_task_attachments (task_id, file_url) VALUES ($1, $2)', [taskId, value])
                  : table === 'actions'
                    ? () => other.query("INSERT INTO actions (description) VALUES ($1)", [value])
                    : () => other.query(`INSERT INTO ${table} (response_value) VALUES ($1)`, [value]);
          await expect(insert()).rejects.toMatchObject({ code: '23503' });
        }
        return { error: null };
      });
      try {
        expect(await cleanupInspectionStorage(db, 'van', id, { from: () => ({ remove }) })).toBe(0);
        expect(remove).toHaveBeenCalledTimes(1);
      } finally { vi.unstubAllEnvs(); }
    });

  it('rejects false causal attribution to an unrelated asset or another inspector', async () => {
    const id = await check('van');
    const unrelated = await task('plant', null);
    await expect(db.query(`UPDATE actions SET daily_check_source_id = $1,
      daily_check_source_type = 'van' WHERE id = $2`, [id, unrelated])).rejects.toMatchObject({ code: '23514' });
    const owned = await task('van', null);
    await db.query("SELECT set_config('test.actor', $1, false)", [randomUUID()]);
    try {
      await expect(db.query(`UPDATE actions SET daily_check_source_id = $1,
        daily_check_source_type = 'van' WHERE id = $2`, [id, owned])).rejects.toMatchObject({ code: '42501' });
    } finally { await db.query("SELECT set_config('test.actor', '', false)"); }
  });

  it('loads the actual HGV save RPC and removes its repeated causal mileage write', async () => {
    const result = await db.query(`SELECT public.save_hgv_inspection($1, false, $1, $2, '2026-11-10',
      NULL, NULL, 'submitted', 250, NULL, 'synthetic-signature',
      '[{"item_number":1,"day_of_week":2,"status":"ok","item_description":"Lights"}]'::jsonb) AS saved`, [actor, assets.hgv]);
    const id = result.rows[0].saved.id as string;
    expect(await reading('hgv')).toBe(250);
    await deleteInspection(db, 'hgv', id, actor);
    expect(await reading('hgv')).toBe(100);
    expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(100);
  });

  it('preserves independent HGV values through correction and later deletion', async () => {
    const id = await check('hgv');
    await db.query("UPDATE vehicle_maintenance SET current_mileage = 350, last_mileage_update = clock_timestamp() + interval '1 second' WHERE hgv_id = $1", [assets.hgv]);
    await db.query('UPDATE hgvs SET current_mileage = 350');
    const row = (await db.query('SELECT current_mileage, updated_at::text AS version FROM hgv_inspections WHERE id = $1', [id])).rows[0];
    await correctInspectionMeter(db, actor, { assetType: 'hgv', inspectionId: id, reading: 180, expectedReading: row.current_mileage, expectedVersion: row.version });
    expect(await reading('hgv')).toBe(350);
    expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(350);
    await deleteInspection(db, 'hgv', id, actor);
    expect(await reading('hgv')).toBe(350);
    expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(350);
  });
  it.each(types)('restores the actual baseline after correcting then deleting the current %s check', async kind => {
    const id = await check(kind);
    const row = (await db.query(`SELECT updated_at::text AS version FROM ${kind}_inspections WHERE id = $1`, [id])).rows[0];
    await correctInspectionMeter(db, actor, { assetType: kind, inspectionId: id, reading: 180, expectedReading: 200, expectedVersion: row.version });
    expect(await reading(kind)).toBe(180);
    await deleteInspection(db, kind, id, actor);
    expect(await reading(kind)).toBe(100);
    if (kind === 'hgv') expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(100);
  });
  it.each(types)('keeps the later %s check when correcting and deleting an older check', async kind => {
    const id = await check(kind);
    const later = await check(kind, 300);
    await db.query(`UPDATE ${kind}_inspections SET inspection_date = current_date + 1 WHERE id = $1`, [later]);
    const row = (await db.query(`SELECT updated_at::text AS version FROM ${kind}_inspections WHERE id = $1`, [id])).rows[0];
    await correctInspectionMeter(db, actor, { assetType: kind, inspectionId: id, reading: 180, expectedReading: 200, expectedVersion: row.version });
    await deleteInspection(db, kind, id, actor);
    expect(await reading(kind)).toBe(300);
    await deleteInspection(db, kind, later, actor);
    expect(await reading(kind)).toBe(100);
  });
  it('retains photo evidence on surviving worked tasks after removing their check and items', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
    const id = await check('van');
    const item = (await db.query(`INSERT INTO inspection_items (inspection_id, item_number, day_of_week)
      VALUES ($1, 2, 1) RETURNING id`, [id])).rows[0].id;
    const taskId = await task('van', id);
    await db.query(`UPDATE actions SET inspection_item_id = $1, status = 'completed' WHERE id = $2`, [item, taskId]);
    const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/worked.jpg`;
    await db.query(`INSERT INTO inspection_photos (inspection_id, item_number, day_of_week, photo_url)
      VALUES ($1, 2, 1, $2)`, [id, photo]);
    try {
      await deleteInspection(db, 'van', id, actor);
      expect((await db.query('SELECT inspection_id, inspection_item_id FROM actions WHERE id = $1', [taskId])).rows[0])
        .toEqual({ inspection_id: null, inspection_item_id: null });
      expect((await db.query('SELECT photo_url FROM workshop_task_check_photos WHERE task_id = $1', [taskId])).rows[0].photo_url).toBe(photo);
      const remove = vi.fn().mockResolvedValue({ error: null });
      expect(await cleanupInspectionStorage(db, 'van', id, { from: () => ({ remove }) })).toBe(1);
      expect(remove).not.toHaveBeenCalled();
      expect((await db.query(`SELECT has_table_privilege('authenticated', 'public.workshop_task_check_photos', 'SELECT') AS allowed`)).rows[0].allowed).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });

  it('keeps failed Storage cleanup durable and retryable after committed deletion', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
    const id = await check('van');
    const photo = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/general/1/x.jpg`;
    await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
    await deleteInspection(db, 'van', id, actor);
    const remove = vi.fn().mockResolvedValueOnce({ error: { message: 'Synthetic storage failure' } }).mockResolvedValue({ error: null });
    const storage = { from: vi.fn().mockReturnValue({ remove }) };
    expect(await cleanupInspectionStorage(db, 'van', id, storage)).toBe(1);
    expect((await deleteInspection(db, 'van', id, actor)).storageCleanupPending).toBe(1);
    expect(await cleanupInspectionStorage(db, 'van', id, storage)).toBe(0);
    expect(remove).toHaveBeenLastCalledWith([`${id}/general/1/x.jpg`]);
    expect((await db.query('SELECT attempts FROM private.daily_check_storage_cleanup')).rows[0].attempts).toBe(2);
    vi.unstubAllEnvs();
  });

  it('protects shared photo objects and records malformed paths and thrown Storage errors', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.test');
    const id = await check('van');
    const shared = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/shared.jpg`;
    const bad = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/%ZZ.jpg`;
    const throws = `https://fixture.test/storage/v1/object/public/inspection-photos/${id}/throws.jpg`;
    for (const photo of [shared, bad, throws]) {
      await db.query('INSERT INTO inspection_photos (inspection_id, photo_url) VALUES ($1, $2)', [id, photo]);
    }
    await db.query('INSERT INTO workshop_attachment_field_responses (response_json) VALUES ($1::jsonb)', [JSON.stringify({ photo: shared })]);
    await deleteInspection(db, 'van', id, actor);
    const remove = vi.fn().mockRejectedValue(new Error('Synthetic Storage network failure'));
    const storage = { from: vi.fn().mockReturnValue({ remove }) };
    expect(await cleanupInspectionStorage(db, 'van', id, storage)).toBe(3);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([`${id}/throws.jpg`]);
    const errors = (await db.query('SELECT last_error FROM private.daily_check_storage_cleanup')).rows.map(row => row.last_error);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('still referenced'), expect.stringContaining('Malformed'), expect.stringContaining('threw'),
    ]));
    vi.unstubAllEnvs();
  });
});
