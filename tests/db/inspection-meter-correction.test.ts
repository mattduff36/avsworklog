import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { validateLocalTestDatabaseUrl, PROVENANCE_ENV_KEYS } from '../../scripts/local-test-postgres';
import { correctInspectionMeter, getInspectionMeterSnapshot } from '../../lib/server/inspection-meter-correction';
import type { InspectionAssetType } from '../../lib/inspections/meter-correction';

const assetId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const checkId = '33333333-3333-4333-8333-333333333333';
const newerId = '44444444-4444-4444-8444-444444444444';
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite('Daily Check corrections in disposable PostgreSQL', () => {
  let db: Client;
  let second: Client;
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const port = Number(process.env[PROVENANCE_ENV_KEYS.port]);
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    if (!marker || !port) throw new Error('Disposable PostgreSQL runner provenance is required.');
    validateLocalTestDatabaseUrl(url, port);
    db = new Client({ connectionString: url, ssl: false });
    second = new Client({ connectionString: url, ssl: false });
    await db.connect();
    await second.connect();
    const actual = await db.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()");
    expect(actual.rows[0].marker).toBe(marker);
    await db.query(`
      CREATE TABLE profiles (id uuid PRIMARY KEY, full_name text);
      CREATE TABLE hgvs (id uuid PRIMARY KEY, current_mileage integer);
      CREATE TABLE vehicle_maintenance (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), van_id uuid UNIQUE, plant_id uuid UNIQUE, hgv_id uuid UNIQUE,
        current_mileage integer, current_hours integer, last_mileage_update timestamptz, last_hours_update timestamptz,
        updated_at timestamptz DEFAULT now());
      CREATE TABLE audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL,
        record_id uuid NOT NULL, user_id uuid REFERENCES profiles(id), action text NOT NULL, changes jsonb,
        created_at timestamptz DEFAULT now());
      CREATE TABLE van_inspections (id uuid PRIMARY KEY, van_id uuid, user_id uuid, current_mileage integer,
        status text, inspection_date date, submitted_at timestamptz, created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(), signature_data text DEFAULT 'original-signature', inspector_comments text DEFAULT 'original-comment',
        job_source_type text DEFAULT 'live_quote', job_source_id uuid DEFAULT '11111111-1111-4111-8111-111111111111',
        job_code text DEFAULT 'TEST-001', job_site_address text DEFAULT 'Original site');
      CREATE TABLE plant_inspections (LIKE van_inspections INCLUDING ALL);
      ALTER TABLE plant_inspections RENAME COLUMN van_id TO plant_id;
      CREATE TABLE hgv_inspections (LIKE van_inspections INCLUDING ALL);
      ALTER TABLE hgv_inspections RENAME COLUMN van_id TO hgv_id;
      CREATE SCHEMA private;
      CREATE TYPE private.allocation_job AS (source_type text, source_id uuid, job_code text,
        site_address text, customer_name text, title text, address_valid boolean);
      CREATE TABLE private.test_jobs (job private.allocation_job, active boolean);
      CREATE FUNCTION private.resolve_allocation_job(text, uuid, text) RETURNS SETOF private.allocation_job
        LANGUAGE sql AS 'SELECT (job).* FROM private.test_jobs WHERE active AND (job).source_type = $1 AND (job).source_id = $2';
      CREATE FUNCTION private.compact_catalog_job_code(text) RETURNS text LANGUAGE sql
        AS 'SELECT NULLIF(upper(regexp_replace($1, ''[[:space:]]'', '''', ''g'')), '''')';
    `);
    // Test the real existing trigger functions, rather than a mock of their side effects.
    await db.query(readFileSync('supabase/migrations/20260322_split_maintenance_mileage_triggers.sql', 'utf8'));
    const jobSql = readFileSync('supabase/migrations/20260925_plant_inspection_active_job_codes.sql', 'utf8');
    const start = jobSql.indexOf('CREATE OR REPLACE FUNCTION private.apply_plant_inspection_job_fields(');
    const end = jobSql.indexOf('CREATE OR REPLACE FUNCTION private.upsert_plant_missing_site_action(', start);
    await db.query(jobSql.slice(start, end));
    await db.query(readFileSync('supabase/migrations/20261102_preserve_submitted_plant_check_job_snapshot.sql', 'utf8'));
    await db.query(`CREATE TRIGGER plant_inspections_job_guard BEFORE INSERT OR UPDATE ON plant_inspections
      FOR EACH ROW EXECUTE FUNCTION private.guard_plant_inspection_job_fields()`);
  });
  afterAll(async () => { await second?.end(); await db?.end(); });
  beforeEach(async () => {
    await db.query('TRUNCATE audit_log, profiles, hgvs, vehicle_maintenance, van_inspections, plant_inspections, hgv_inspections');
    await db.query('TRUNCATE private.test_jobs');
    await db.query(`INSERT INTO private.test_jobs VALUES (ROW('live_quote', $1::uuid, 'TEST-001', 'Original site', 'Test company', 'Test job', true), true)`, [assetId]);
    await db.query('INSERT INTO profiles VALUES ($1, $2)', [actorId, 'Test manager']);
    await db.query('INSERT INTO hgvs VALUES ($1, 100)', [assetId]);
  });
  async function seed(assetType: InspectionAssetType = 'van', id = checkId, reading = 100, date = '2026-11-01', linkedAsset: string | null = assetId) {
    await db.query(`INSERT INTO ${assetType}_inspections
      (id, ${assetType}_id, user_id, current_mileage, status, inspection_date, submitted_at)
      VALUES ($1, $2, $3, $4, 'submitted', $5::date, $5::date::timestamptz)`, [id, linkedAsset, actorId, reading, date]);
  }
  async function input(assetType: InspectionAssetType = 'van', reading = 90) {
    const snapshot = await getInspectionMeterSnapshot(db, assetType, checkId);
    return { assetType, inspectionId: checkId, reading, expectedReading: snapshot.reading, expectedVersion: snapshot.version };
  }
  it.each(['van', 'plant', 'hgv'] as const)('corrects %s, syncs its asset, and records an optional blank comment', async assetType => {
    await seed(assetType);
    const result = await correctInspectionMeter(db, actorId, await input(assetType, 0));
    expect(result).toEqual({ reading: 0, assetReadingUpdated: true });
    const snapshot = await getInspectionMeterSnapshot(db, assetType, checkId);
    expect(snapshot.reading).toBe(0);
    expect(snapshot.history[0]).toMatchObject({ actor_name: 'Test manager', changes: { old_reading: 100, new_reading: 0, comment: null } });
    expect((await db.query(`SELECT ${assetType === 'plant' ? 'current_hours' : 'current_mileage'} AS meter FROM vehicle_maintenance`)).rows[0].meter).toBe(0);
    const check = (await db.query(`SELECT * FROM ${assetType}_inspections`)).rows[0];
    expect(check).toMatchObject({ status: 'submitted', signature_data: 'original-signature', inspector_comments: 'original-comment', user_id: actorId });
    if (assetType === 'hgv') expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(0);
  });
  it('keeps a newer submitted reading when correcting an older check', async () => {
    await seed();
    await seed('van', newerId, 200, '2026-11-02');
    const before = (await db.query('SELECT current_mileage, last_mileage_update FROM vehicle_maintenance')).rows[0];
    await correctInspectionMeter(db, actorId, { ...await input(), comment: 'Typing mistake' });
    expect((await db.query('SELECT current_mileage, last_mileage_update FROM vehicle_maintenance')).rows[0]).toEqual(before);
    expect((await getInspectionMeterSnapshot(db, 'van', checkId)).history[0].changes.comment).toBe('Typing mistake');
  });
  it('recalculates a stale asset from the latest submitted check', async () => {
    await seed();
    await seed('van', newerId, 200, '2026-11-02');
    await db.query('UPDATE vehicle_maintenance SET current_mileage = 100, last_mileage_update = (SELECT updated_at FROM van_inspections WHERE id = $1)', [checkId]);
    await correctInspectionMeter(db, actorId, await input());
    expect((await db.query('SELECT current_mileage FROM vehicle_maintenance')).rows[0].current_mileage).toBe(200);
  });
  it('preserves an independent current maintenance reading', async () => {
    await seed();
    await db.query('UPDATE vehicle_maintenance SET current_mileage = 300');
    await correctInspectionMeter(db, actorId, await input());
    expect((await db.query('SELECT current_mileage FROM vehicle_maintenance')).rows[0].current_mileage).toBe(300);
  });
  it.each(['van', 'plant', 'hgv'] as const)('preserves a newer independent %s reading even when its number is unchanged', async assetType => {
    await seed(assetType);
    const timestamp = assetType === 'plant' ? 'last_hours_update' : 'last_mileage_update';
    await db.query(`UPDATE vehicle_maintenance SET ${timestamp} = NOW() + INTERVAL '1 minute'`);
    const before = (await db.query('SELECT current_mileage, current_hours, last_mileage_update, last_hours_update FROM vehicle_maintenance')).rows[0];
    await correctInspectionMeter(db, actorId, await input(assetType));
    expect((await db.query('SELECT current_mileage, current_hours, last_mileage_update, last_hours_update FROM vehicle_maintenance')).rows[0]).toEqual(before);
    if (assetType === 'hgv') expect((await db.query('SELECT current_mileage FROM hgvs')).rows[0].current_mileage).toBe(100);
  });
  it('corrects hired plant with no asset link', async () => {
    await seed('plant', checkId, 100, '2026-11-01', null);
    expect((await correctInspectionMeter(db, actorId, await input('plant'))).assetReadingUpdated).toBe(false);
    expect((await db.query('SELECT * FROM vehicle_maintenance')).rowCount).toBe(0);
  });
  it('preserves historical plant job data when the job closes or its catalogue fields change', async () => {
    await seed('plant');
    await db.query('UPDATE private.test_jobs SET active = false');
    await correctInspectionMeter(db, actorId, await input('plant'));
    expect((await db.query('SELECT job_code, job_site_address FROM plant_inspections')).rows[0]).toEqual({ job_code: 'TEST-001', job_site_address: 'Original site' });
    await expect(db.query("UPDATE plant_inspections SET job_code = 'OTHER'")).rejects.toThrow('JOB_NOT_FOUND');
    await db.query("UPDATE private.test_jobs SET active = true, job = ROW('live_quote', $1::uuid, 'NEW-002', 'New site', 'Test company', 'Test job', true)", [assetId]);
    await correctInspectionMeter(db, actorId, await input('plant', 80));
    expect((await db.query('SELECT job_code, job_site_address FROM plant_inspections')).rows[0]).toEqual({ job_code: 'TEST-001', job_site_address: 'Original site' });
  });
  it('handles a missing original reading and maintenance row', async () => {
    await seed();
    await db.query('UPDATE van_inspections SET current_mileage = NULL');
    await db.query('DELETE FROM vehicle_maintenance');
    await correctInspectionMeter(db, actorId, await input());
    expect((await db.query('SELECT current_mileage FROM vehicle_maintenance')).rows[0].current_mileage).toBe(90);
    expect((await getInspectionMeterSnapshot(db, 'van', checkId)).history[0].changes.old_reading).toBeNull();
  });
  it('rejects draft, missing, unchanged, and stale checks', async () => {
    await seed();
    const original = await input();
    await expect(correctInspectionMeter(db, actorId, { ...original, reading: 100 })).rejects.toThrow('different reading');
    await correctInspectionMeter(db, actorId, original);
    await expect(correctInspectionMeter(db, actorId, original)).rejects.toThrow('changed since');
    await db.query("UPDATE van_inspections SET status = 'draft'");
    await expect(correctInspectionMeter(db, actorId, original)).rejects.toThrow('Only submitted');
    await db.query('DELETE FROM van_inspections');
    await expect(correctInspectionMeter(db, actorId, original)).rejects.toThrow('not found');
  });
  it('rolls back the check and trigger side effects if the audit insert fails', async () => {
    await seed();
    const original = await input();
    await expect(correctInspectionMeter(db, newerId, original)).rejects.toThrow();
    expect((await getInspectionMeterSnapshot(db, 'van', checkId)).reading).toBe(100);
    expect((await db.query('SELECT current_mileage FROM vehicle_maintenance')).rows[0].current_mileage).toBe(100);
    expect((await db.query('SELECT * FROM audit_log')).rowCount).toBe(0);
  });
  it('serializes simultaneous corrections and rejects the stale writer', async () => {
    await seed();
    const original = await input();
    const results = await Promise.allSettled([
      correctInspectionMeter(db, actorId, original),
      correctInspectionMeter(second, actorId, { ...original, reading: 80 }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.query('SELECT * FROM audit_log')).rowCount).toBe(1);
    const check = await getInspectionMeterSnapshot(db, 'van', checkId);
    expect((await db.query('SELECT current_mileage FROM vehicle_maintenance')).rows[0].current_mileage).toBe(check.reading);
  });
});
