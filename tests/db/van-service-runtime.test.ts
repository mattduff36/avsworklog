import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ID, createFixtureSchema, seedReady, type FixtureDb } from './van-service-fixture';
import { PROVENANCE_ENV_KEYS, validateLocalTestDatabaseUrl } from '../../scripts/local-test-postgres';
import { loadServiceConfig, saveServiceSettings, completeServiceWorkshopTask, correctServiceWorkshopTask } from '../../lib/server/asset-service';

// Substitute transport only: all queries/locks run in real, provenance-checked PostgreSQL.
vi.mock('pg', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pg')>();
  class LocalClient extends actual.Client {
    constructor() { super({ connectionString: process.env.TEST_DATABASE_URL, ssl: false }); }
  }
  return { ...actual, Client: LocalClient, default: { ...actual.default, Client: LocalClient } };
});
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('van service disposable PostgreSQL workflow', () => {
  let db: Client;
  let basicId: string;
  const sql = readFileSync('supabase/migrations/20261027_van_service_rotation.sql', 'utf8');
  const actor = randomUUID();
  beforeAll(async () => {
    const port = process.env[PROVENANCE_ENV_KEYS.port];
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    if (!port || !marker) throw new Error('Disposable PostgreSQL runner provenance required');
    validateLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL!, Number(port));
    db = new Client(); await db.connect();
    const identity = await db.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
    expect(identity.rows[0].marker).toBe(marker);
    const adapter: FixtureDb = {
      exec: async (statement) => db.query(statement),
      query: async <T,>(statement: string, params?: unknown[]) => ({ rows: (await db.query(statement, params)).rows as T[] }),
    };
    await createFixtureSchema(adapter); await seedReady(adapter); await db.query(sql);
    basicId = (await db.query("SELECT id FROM workshop_attachment_templates WHERE name='Basic Service A (Van)' ")).rows[0].id;
    await db.query(`
      ALTER TABLE maintenance_categories ADD COLUMN updated_at timestamptz;
      ALTER TABLE vehicle_maintenance ADD COLUMN last_updated_by uuid, ADD COLUMN updated_at timestamptz;
      ALTER TABLE workshop_task_attachments ADD COLUMN completed_at timestamptz;
      ALTER TABLE actions ADD COLUMN action_type text DEFAULT 'workshop_vehicle_task', ADD COLUMN title text,
        ADD COLUMN actioned boolean, ADD COLUMN actioned_at timestamptz, ADD COLUMN actioned_by uuid,
        ADD COLUMN actioned_comment text, ADD COLUMN actioned_signature_data text, ADD COLUMN actioned_signed_at timestamptz,
        ADD COLUMN asset_meter_reading integer, ADD COLUMN asset_meter_unit text, ADD COLUMN status_history jsonb,
        ADD COLUMN workshop_category_name_snapshot text, ADD COLUMN workshop_subcategory_name_snapshot text,
        ADD COLUMN logged_at timestamptz, ADD COLUMN logged_by uuid, ADD COLUMN logged_comment text,
        ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz;
      ALTER TABLE asset_service_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE asset_service_events ADD COLUMN task_id uuid, ADD COLUMN completed_rotation_step_id uuid,
        ADD COLUMN next_rotation_step_id uuid, ADD COLUMN meter_unit text, ADD COLUMN interval_value integer,
        ADD COLUMN interval_unit text, ADD COLUMN actor_id uuid, ADD COLUMN event_type text DEFAULT 'completion',
        ADD COLUMN corrects_event_id uuid;
      CREATE UNIQUE INDEX one_completion ON asset_service_events(task_id) WHERE event_type='completion';
      CREATE TABLE maintenance_history(id uuid DEFAULT gen_random_uuid(),van_id uuid,hgv_id uuid,plant_id uuid,
        field_name text,old_value text,new_value text,value_type text,comment text,updated_by uuid);
    `);
    vi.stubEnv('POSTGRES_URL_NON_POOLING', process.env.TEST_DATABASE_URL!);
  }, 30000);
  afterAll(async () => { vi.unstubAllEnvs(); await db?.end(); });
  async function task(templateId: string): Promise<string> {
    const id = randomUUID();
    await db.query("INSERT INTO actions(id,status,workshop_category_id,van_id,title) VALUES($1,'pending',$2,$3,'Fixture service')", [id, ID.vanWorkshop, ID.vanAsset]);
    await db.query("INSERT INTO workshop_task_attachments(id,task_id,template_id,status,template_name_snapshot) SELECT $1,$2,id,'completed',name FROM workshop_attachment_templates WHERE id=$3", [randomUUID(), id, templateId]);
    return id;
  }
  function completion(taskId: string, nextId: string, meter: number) {
    return { taskId, actorId: actor, completionMeter: meter, confirmedNextTemplateId: nextId,
      completedComment: 'Completed fixture service', completedAt: new Date().toISOString(), statusHistoryJson: [] };
  }
  it('alternates at actual mileage plus 10000 and duplicate submissions advance once', async () => {
    const basicTask = await task(basicId);
    const results = await Promise.all([
      completeServiceWorkshopTask(completion(basicTask, ID.vanTemplate, 12345)),
      completeServiceWorkshopTask(completion(basicTask, ID.vanTemplate, 12345)),
    ]);
    expect(results.filter((r) => 'alreadyCompleted' in r && r.alreadyCompleted)).toHaveLength(1);
    const state = async () => (await db.query('SELECT next_service_mileage,next_service_template_id FROM vehicle_maintenance WHERE id=$1', [ID.vmAmbiguous])).rows[0];
    expect(await state()).toMatchObject({ next_service_mileage: 22345, next_service_template_id: ID.vanTemplate });
    const fullTask = await task(ID.vanTemplate);
    await completeServiceWorkshopTask(completion(fullTask, basicId, 22500));
    expect(await state()).toMatchObject({ next_service_mileage: 32500, next_service_template_id: basicId });
    expect((await db.query('SELECT count(*)::int n FROM asset_service_events WHERE task_id=$1', [basicTask])).rows[0].n).toBe(1);
    await correctServiceWorkshopTask({ taskId: fullTask, actorId: actor, completionMeter: 22400,
      confirmedNextTemplateId: basicId, correctionComment: 'Corrected fixture odometer' });
    expect((await state()).next_service_mileage).toBe(32400);
  });
  it('preserves step IDs and unresolved choices on settings save and rejects destructive changes', async () => {
    const config = await loadServiceConfig(db, 'van');
    const input = { assetType: 'van' as const, intervalValue: 10000, intervalUnit: 'miles' as const,
      linkedTemplateIds: [basicId, ID.vanTemplate], compactLabels: { [basicId]: 'Basic A', [ID.vanTemplate]: 'Full' },
      rotationTemplateIds: [basicId, ID.vanTemplate] };
    await saveServiceSettings(input);
    expect((await loadServiceConfig(db, 'van')).steps.map(s => s.id)).toEqual(config.steps.map(s => s.id));
    expect((await db.query('SELECT next_service_template_id FROM vehicle_maintenance WHERE id=$1', [ID.vmNull])).rows[0].next_service_template_id).toBeNull();
    await expect(saveServiceSettings({ ...input, rotationTemplateIds: [ID.vanTemplate, basicId] })).rejects.toThrow('reviewed migration');
    await expect(saveServiceSettings({ ...input, linkedTemplateIds: [ID.hgvTemplateA], rotationTemplateIds: [ID.hgvTemplateA] })).rejects.toThrow('suitable for this asset');
  });
  it('serializes config writers and reruns without clearing later choices', async () => {
    const blocker = new Client(); await blocker.connect();
    try {
      await blocker.query('BEGIN'); await loadServiceConfig(blocker, 'van', true);
      const waiter = new Client(); await waiter.connect();
      try {
        await waiter.query('BEGIN'); await waiter.query("SET LOCAL lock_timeout='150ms'");
        await expect(loadServiceConfig(waiter, 'van', true)).rejects.toMatchObject({ code: '55P03' });
        await waiter.query('ROLLBACK');
      } finally { await waiter.end(); }
      await blocker.query('ROLLBACK');
    } finally { await blocker.end(); }
    const before = (await db.query('SELECT next_service_template_id,next_service_rotation_step_id,next_service_mileage FROM vehicle_maintenance ORDER BY id')).rows;
    await db.query(sql);
    expect((await db.query('SELECT next_service_template_id,next_service_rotation_step_id,next_service_mileage FROM vehicle_maintenance ORDER BY id')).rows).toEqual(before);
  });

  it('rejects rotation changes when the only reference is a next template with no cursor', async () => {
    const vmId = randomUUID();
    await db.query("INSERT INTO workshop_attachment_template_versions(id,template_id,version_number,status) VALUES($1,$2,1,'published')", [randomUUID(), ID.plantTemplate]);
    await db.query('INSERT INTO vehicle_maintenance(id,plant_id,next_service_template_id) VALUES($1,$2,$3)', [vmId, randomUUID(), ID.plantTemplate]);
    try {
      await expect(saveServiceSettings({ assetType: 'plant', intervalValue: 250, intervalUnit: 'hours',
        linkedTemplateIds: [ID.plantTemplate], compactLabels: {},
        rotationTemplateIds: [ID.plantTemplate, ID.plantTemplate] })).rejects.toThrow('reviewed migration');
    } finally {
      await db.query('DELETE FROM vehicle_maintenance WHERE id=$1', [vmId]);
    }
  });

  it('waits for an in-flight service writer before taking attachment table locks', async () => {
    const writer = new Client(); const migration = new Client();
    await writer.connect(); await migration.connect();
    let migrationResult: Promise<unknown> | undefined;
    try {
      await writer.query('BEGIN');
      await loadServiceConfig(writer, 'van', true);
      const pid = (await migration.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      // Attach rejection handling immediately so a failure cannot escape the test.
      migrationResult = migration.query(sql).then(() => null, (error: unknown) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const state = (await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
        if (state?.wait_event_type === 'Lock') { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      await writer.query("SET LOCAL lock_timeout='500ms'");
      // Old table-first ordering blocks this update while waiting on our config row.
      await writer.query('UPDATE workshop_task_attachments SET completed_at=now() WHERE id=$1', [ID.attachNamed]);
      await writer.query('COMMIT');
      expect(await migrationResult).toBeNull();
    } finally {
      await writer.query('ROLLBACK');
      await migrationResult;
      await writer.end(); await migration.end();
    }
  }, 10000);
});
