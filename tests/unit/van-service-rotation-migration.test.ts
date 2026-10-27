import { ID, createFixtureSchema, seedReady } from '../db/van-service-fixture';
import { readFileSync } from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PREVIEW_SQL,
  assertPreviewInvocationReadOnly,
  collectVanServiceRotationPreview,
  type Queryable,
} from '@/scripts/preview-van-service-rotation';

const MIGRATION_PATH = 'supabase/migrations/20261027_van_service_rotation.sql';
const migrationSql = readFileSync(path.join(process.cwd(), MIGRATION_PATH), 'utf8');

const databases: PGlite[] = [];

function readOnly(pg: PGlite): Queryable {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      if (/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/i.test(sql)) {
        throw new Error(`preview emitted a mutation: ${sql.slice(0, 120)}`);
      }
      const result = await pg.query<T>(sql, params);
      return { rows: result.rows };
    },
  };
}

async function createDatabase(): Promise<PGlite> {
  const pg = new PGlite();
  databases.push(pg);
  await createFixtureSchema(pg);
  return pg;
}

async function expectRollback(pg: PGlite, pattern: RegExp): Promise<void> {
  let failed = false;
  try {
    await pg.exec(migrationSql);
  } catch (error) {
    failed = true;
    expect(String(error)).toMatch(pattern);
  }
  expect(failed).toBe(true);
  await pg.exec('ROLLBACK').catch(() => undefined);
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((pg) => pg.close()));
});

describe('van service rotation migration', () => {
  it('publishes Basic A, preserves Full history, and reruns without clearing a later explicit choice', async () => {
    const pg = await createDatabase();
    await seedReady(pg);
    const beforePreview = await collectVanServiceRotationPreview(readOnly(pg));
    expect(beforePreview.inference_applied).toBe(false);
    expect(beforePreview.proposed_next).toEqual(expect.arrayContaining([
      expect.objectContaining({ maintenance_id: ID.vmAmbiguous, proposed_next: 'clear_ambiguous_next' }),
      expect.objectContaining({ maintenance_id: ID.vmNull, proposed_next: 'retain_null' }),
      expect.objectContaining({ maintenance_id: ID.vmExplicit, proposed_next: 'retain_explicit' }),
    ]));
    expect(beforePreview.ambiguous_service_notes).toEqual([
      expect.objectContaining({
        maintenance_id: ID.vmAmbiguous,
        has_maintenance_notes: true,
        has_event_notes: true,
        completed_template_name: 'Van Service',
      }),
    ]);
    expect(beforePreview.attachments.pending_count).toBe(2);
    expect(beforePreview.attachments.inconsistent_version_count).toBe(1);
    expect(beforePreview.open_service_tasks).toEqual(expect.objectContaining({
      available: true,
      count: 1,
      rows: [expect.objectContaining({ task_id: ID.taskOpen, status: 'pending' })],
    }));
    expect(JSON.stringify(beforePreview)).not.toMatch(/actioned_by|created_by|email/i);

    await pg.exec(migrationSql);

    const full = await pg.query<{ id: string; name: string; description: string; applies_to: string[] }>(
      `SELECT id, name, description, applies_to FROM public.workshop_attachment_templates WHERE id = $1`,
      [ID.vanTemplate]
    );
    expect(full.rows[0]).toMatchObject({
      id: ID.vanTemplate,
      name: 'Full Service (Van)',
      description: 'Historic van checklist',
      applies_to: ['van'],
    });

    const oil = await pg.query<{ id: string; label: string; field_key: string }>(
      `SELECT id, label, field_key FROM public.workshop_attachment_template_fields WHERE id = $1`,
      [ID.oilField]
    );
    expect(oil.rows[0]).toEqual({
      id: ID.oilField,
      label: 'Label engine_oil_and_filter',
      field_key: 'engine_oil_and_filter',
    });

    const basicFields = await pg.query<{
      field_key: string;
      label: string;
      help_text: string;
      field_type: string;
      is_required: boolean;
      options_json: { code: string };
      section_key: string;
      description: string;
    }>(`
      SELECT f.field_key, f.label, f.help_text, f.field_type::text AS field_type, f.is_required,
             f.options_json, s.section_key, s.description
      FROM public.workshop_attachment_templates t
      JOIN public.workshop_attachment_template_versions v ON v.template_id = t.id
      JOIN public.workshop_attachment_template_sections s ON s.version_id = v.id
      JOIN public.workshop_attachment_template_fields f ON f.section_id = s.id
      WHERE t.name = 'Basic Service A (Van)'
      ORDER BY s.sort_order, f.sort_order
    `);
    expect(basicFields.rows.map((row) => row.field_key)).toEqual([
      'engine_oil_and_filter',
      'check_fuel_filter',
      'check_clean_air_filter',
      'check_clean_pollen_filter',
      'check_gearbox_oil_and_filter',
      'condition_of_all_belts',
      'engine_transmission_mountings',
      'oil_leaks',
      'fuel_tanks_and_systems',
      'check_brakes_front_and_rear',
      'check_all_suspension_components_for_any_wear',
      'check_seering_for_any_wear',
      'cooling_systems',
      'exhaust_systems',
      'check_tyres',
      'road_wheels_and_hubs',
      'check_all_lights_and_horn',
      'check_washers_and_wipers',
      'check_interior_and_exterior_including_mirrors',
      'check_for_any_fault_codes',
      'check_first_aid_kit_dates',
      'check_fire_extinguisher',
      'vehicle_trailer_coupling',
    ]);
    const fuel = basicFields.rows.find((row) => row.field_key === 'check_fuel_filter');
    expect(fuel).toMatchObject({
      label: 'Check fuel filter',
      help_text: 'Help for change_fuel_filter',
      field_type: 'marking_code',
      options_json: { code: 'change_fuel_filter' },
      section_key: 'fluids_and_filters',
    });
    expect(fuel?.description).toContain('check or clean only');
    expect(fuel?.description).toContain('Engine servicing, fluid levels, and filter changes.');
    expect(fuel?.description).toContain('Transmission, braking, and steering checks.');
    expect(basicFields.rows.find((row) => row.field_key === 'check_tyres')?.is_required).toBe(true);
    expect(basicFields.rows.find((row) => row.field_key === 'check_fire_extinguisher')?.is_required).toBe(false);
    expect(basicFields.rows.some((row) => row.description.includes('Do not copy this sign-off section.'))).toBe(false);
    expect(basicFields.rows.some((row) => row.field_key === 'technician_signature' || row.field_key === 'change_spark_plugs')).toBe(false);

    const fullKeys = await pg.query<{ field_key: string }>(
      `SELECT field_key FROM public.workshop_attachment_template_fields f
       JOIN public.workshop_attachment_template_sections s ON s.id = f.section_id
       WHERE s.version_id = $1 AND field_key IN ('change_fuel_filter', 'technician_signature', 'change_spark_plugs')
       ORDER BY field_key`,
      [ID.vanVersion]
    );
    expect(fullKeys.rows.map((row) => row.field_key)).toEqual([
      'change_fuel_filter',
      'change_spark_plugs',
      'technician_signature',
    ]);

    const rotation = await pg.query<{ id: string; position: number; name: string }>(
      `SELECT s.id, s.position, t.name
       FROM public.service_rotation_steps s
       JOIN public.workshop_attachment_templates t ON t.id = s.attachment_template_id
       WHERE s.maintenance_category_id = $1
       ORDER BY s.position`,
      [ID.vanCategory]
    );
    expect(rotation.rows).toEqual([
      expect.objectContaining({ position: 1, name: 'Basic Service A (Van)' }),
      { id: ID.fullStep, position: 2, name: 'Full Service (Van)' },
    ]);

    const hgvSteps = await pg.query<{ id: string; position: number; attachment_template_id: string }>(
      `SELECT id, position, attachment_template_id
       FROM public.service_rotation_steps
       WHERE maintenance_category_id = $1
       ORDER BY position`,
      [ID.hgvCategory]
    );
    expect(hgvSteps.rows).toEqual([
      { id: ID.hgvStep1, position: 1, attachment_template_id: ID.hgvTemplateA },
      { id: ID.hgvStep2, position: 2, attachment_template_id: ID.hgvTemplateB },
    ]);

    const periods = await pg.query<{ config_key: string; period_value: number; period_unit: string }>(
      `SELECT config_key, period_value, period_unit FROM public.maintenance_categories ORDER BY config_key`
    );
    expect(periods.rows).toEqual([
      { config_key: 'service_hgv', period_value: 25000, period_unit: 'km' },
      { config_key: 'service_plant', period_value: 250, period_unit: 'hours' },
      { config_key: 'service_van', period_value: 10000, period_unit: 'miles' },
    ]);

    const maintenance = await pg.query<{
      id: string;
      current_mileage: number | null;
      last_service_mileage: number | null;
      next_service_mileage: number | null;
      last_service_template_id: string | null;
      next_service_template_id: string | null;
      next_service_rotation_step_id: string | null;
      notes: string | null;
    }>(`SELECT id, current_mileage, last_service_mileage, next_service_mileage, last_service_template_id, next_service_template_id, next_service_rotation_step_id, notes FROM public.vehicle_maintenance ORDER BY id`);
    expect(maintenance.rows).toEqual([
      {
        id: ID.vmAmbiguous,
        current_mileage: 1000,
        last_service_mileage: 9000,
        next_service_mileage: 19000,
        last_service_template_id: ID.vanTemplate,
        next_service_template_id: null,
        next_service_rotation_step_id: null,
        notes: 'fleet note without a person',
      },
      {
        id: ID.vmNull,
        current_mileage: null,
        last_service_mileage: null,
        next_service_mileage: null,
        last_service_template_id: null,
        next_service_template_id: null,
        next_service_rotation_step_id: null,
        notes: null,
      },
      {
        id: ID.vmExplicit,
        current_mileage: 50,
        last_service_mileage: 60,
        next_service_mileage: 70,
        last_service_template_id: ID.otherTemplate,
        next_service_template_id: ID.otherTemplate,
        next_service_rotation_step_id: null,
        notes: null,
      },
      {
        id: ID.vmHgv,
        current_mileage: 5,
        last_service_mileage: 15,
        next_service_mileage: 25,
        last_service_template_id: ID.hgvTemplateA,
        next_service_template_id: ID.hgvTemplateA,
        next_service_rotation_step_id: ID.hgvStep1,
        notes: 'hgv stays',
      },
    ]);

    const attachments = await pg.query<{ id: string; template_name_snapshot: string | null }>(
      `SELECT id, template_name_snapshot FROM public.workshop_task_attachments ORDER BY id`
    );
    expect(attachments.rows).toEqual([
      { id: ID.attachNull, template_name_snapshot: 'Van Service' },
      { id: ID.attachNamed, template_name_snapshot: 'Historic Van Service Label' },
      { id: ID.attachInconsistent, template_name_snapshot: 'Van Service' },
    ]);
    const snapshot = await pg.query<{ snapshot_json: { keep: string } }>(
      `SELECT snapshot_json FROM public.workshop_attachment_schema_snapshots WHERE id = $1`,
      [ID.snapNamed]
    );
    expect(snapshot.rows[0]?.snapshot_json).toEqual({ keep: 'historical-van' });
    const response = await pg.query<{ response_value: string }>(
      `SELECT response_value FROM public.workshop_attachment_field_responses WHERE id = $1`,
      [ID.responseNamed]
    );
    expect(response.rows[0]?.response_value).toBe('HISTORIC_OK');
    const event = await pg.query<{ completed_template_name: string; resulting_due_meter: number; notes: string }>(
      `SELECT completed_template_name, resulting_due_meter, notes FROM public.asset_service_events WHERE id = $1`,
      [ID.eventAmbiguous]
    );
    expect(event.rows[0]).toEqual({
      completed_template_name: 'Van Service',
      resulting_due_meter: 19000,
      notes: 'latest ambiguous note',
    });

    const link = await pg.query<{ id: string; sort_order: number; compact_label: string; template_id: string }>(
      `SELECT id, sort_order, compact_label, template_id FROM public.workshop_category_attachment_templates WHERE id = $1`,
      [ID.fullLink]
    );
    expect(link.rows[0]).toEqual({
      id: ID.fullLink,
      sort_order: 2,
      compact_label: 'Full',
      template_id: ID.vanTemplate,
    });

    await pg.exec(`
      UPDATE public.vehicle_maintenance
      SET next_service_template_id = '${ID.vanTemplate}',
          next_service_rotation_step_id = '${ID.fullStep}'
      WHERE id = '${ID.vmAmbiguous}';
      UPDATE public.workshop_category_attachment_templates
      SET compact_label = 'Operator Full'
      WHERE id = '${ID.fullLink}';
    `);
    await pg.exec(migrationSql);

    const afterRerun = await pg.query<{
      next_service_template_id: string | null;
      next_service_rotation_step_id: string | null;
      next_service_mileage: number | null;
    }>(
      `SELECT next_service_template_id, next_service_rotation_step_id, next_service_mileage
       FROM public.vehicle_maintenance WHERE id = $1`,
      [ID.vmAmbiguous]
    );
    expect(afterRerun.rows[0]).toEqual({
      next_service_template_id: ID.vanTemplate,
      next_service_rotation_step_id: ID.fullStep,
      next_service_mileage: 19000,
    });
    const label = await pg.query<{ compact_label: string }>(
      `SELECT compact_label FROM public.workshop_category_attachment_templates WHERE id = $1`,
      [ID.fullLink]
    );
    expect(label.rows[0]?.compact_label).toBe('Operator Full');
    const basicCount = await pg.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.workshop_attachment_templates WHERE name = 'Basic Service A (Van)'`
    );
    expect(basicCount.rows[0]?.count).toBe(1);
    const hgvAfter = await pg.query<{ period_value: number }>(
      `SELECT period_value FROM public.maintenance_categories WHERE config_key = 'service_hgv'`
    );
    expect(hgvAfter.rows[0]?.period_value).toBe(25000);

    const afterPreview = await collectVanServiceRotationPreview(readOnly(pg));
    expect(afterPreview.proposed_next.find((row) => row.maintenance_id === ID.vmAmbiguous)?.proposed_next).toBe('retain_explicit');
    expect(afterPreview.inference_applied).toBe(false);
    expect(afterPreview.migration.present).toBe(true);
    expect(afterPreview.migration.phase).toBe('predeploy');
    expect(afterPreview.migration.ledger).toEqual({ state: 'not_present' });
  });

  it('rolls back when the source template or a required field is missing', async () => {
    const missing = await createDatabase();
    await seedReady(missing, { skipVanTemplate: true });
    await expectRollback(missing, /Expected exactly one Van Service or Full Service \(Van\) template, found van=0 full=0/);
    const templates = await missing.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.workshop_attachment_templates
       WHERE LOWER(name) IN ('van service', 'full service (van)', 'basic service a (van)')`
    );
    expect(templates.rows[0]?.count).toBe(0);

    const missingField = await createDatabase();
    await seedReady(missingField, { omitKey: 'check_tyres' });
    await expectRollback(missingField, /missing required field check_tyres/);
    const name = await missingField.query<{ name: string }>(
      `SELECT name FROM public.workshop_attachment_templates WHERE id = $1`,
      [ID.vanTemplate]
    );
    expect(name.rows[0]?.name).toBe('Van Service');
    const steps = await missingField.query<{ position: number }>(
      `SELECT position FROM public.service_rotation_steps WHERE id = $1`,
      [ID.fullStep]
    );
    expect(steps.rows[0]?.position).toBe(1);
  });

  it('rolls back conflicting schema, rotation, and interval without renaming Van Service', async () => {
    const schema = await createDatabase();
    await seedReady(schema, { conflictingBasic: true });
    await expectRollback(schema, /conflicting published schema/);
    const schemaName = await schema.query<{ name: string }>(`SELECT name FROM public.workshop_attachment_templates WHERE id = $1`, [ID.vanTemplate]);
    expect(schemaName.rows[0]?.name).toBe('Van Service');
    const wrong = await schema.query<{ field_key: string }>(
      `SELECT field_key FROM public.workshop_attachment_template_fields WHERE field_key = 'wrong_field'`
    );
    expect(wrong.rows).toHaveLength(1);

    const rotation = await createDatabase();
    await seedReady(rotation, { extraRotation: true });
    await expectRollback(rotation, /rotation conflicts/);
    const rotationName = await rotation.query<{ name: string }>(`SELECT name FROM public.workshop_attachment_templates WHERE id = $1`, [ID.vanTemplate]);
    expect(rotationName.rows[0]?.name).toBe('Van Service');

    const interval = await createDatabase();
    await seedReady(interval, { periodValue: 8000 });
    await expectRollback(interval, /interval conflicts with 10000 miles/);
    const period = await interval.query<{ period_value: number }>(
      `SELECT period_value FROM public.maintenance_categories WHERE config_key = 'service_van'`
    );
    expect(period.rows[0]?.period_value).toBe(8000);
    const intervalName = await interval.query<{ name: string }>(`SELECT name FROM public.workshop_attachment_templates WHERE id = $1`, [ID.vanTemplate]);
    expect(intervalName.rows[0]?.name).toBe('Van Service');
  });

  it('keeps the preview script read-only', () => {
    expect(migrationSql).toContain('LOCK TABLE public.workshop_attachment_templates');
    expect(migrationSql).not.toContain('DELETE FROM');
    expect(migrationSql).not.toContain('UPDATE public.workshop_attachment_schema_snapshots');
    expect(migrationSql).not.toContain('UPDATE public.workshop_attachment_template_fields');
    expect(migrationSql).not.toContain('UPDATE public.asset_service_events');
    expect(migrationSql).not.toContain('UPDATE public.workshop_attachment_field_responses');
    const previewSource = readFileSync(path.join(process.cwd(), 'scripts/preview-van-service-rotation.ts'), 'utf8');
    expect(previewSource).toContain('BEGIN READ ONLY');
    expect(previewSource).toContain('POSTGRES_URL_NON_POOLING');
    expect(previewSource).not.toMatch(/POSTGRES_URL(?!_NON_POOLING)/);
    expect(PREVIEW_SQL.join('\n')).not.toMatch(/\b(insert|update|delete|alter|drop)\b/i);
    expect(() => assertPreviewInvocationReadOnly(['--apply'])).toThrow(/read-only/);
  });
});
