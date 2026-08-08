/**
 * Run Unify Asset Service Scheduling migration + HGV screenshot backfill.
 *
 * Usage: npx tsx scripts/run-unify-asset-service-scheduling-migration.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260808_unify_asset_service_scheduling.sql';
const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING');
  process.exit(1);
}

interface ScreenshotRow {
  regNumber: string;
  engineServiceDue: number | null;
  lastServiceLabel: 'Full' | 'Basic A' | 'Basic B' | null;
  nextServiceLabel: 'Full' | 'Basic A' | 'Basic B' | null;
}

/** Real HGV rows from the supplied schedule screenshot (excludes TEST-HGV). */
const SCREENSHOT_ROWS: ScreenshotRow[] = [
  { regNumber: 'AS71 AVS', engineServiceDue: 300402, lastServiceLabel: 'Full', nextServiceLabel: 'Basic A' },
  { regNumber: 'C517773', engineServiceDue: null, lastServiceLabel: null, nextServiceLabel: null },
  { regNumber: 'DS71 AVS', engineServiceDue: 306993, lastServiceLabel: 'Full', nextServiceLabel: 'Basic A' },
  { regNumber: 'ES71 AVS', engineServiceDue: 302137, lastServiceLabel: 'Full', nextServiceLabel: 'Basic A' },
  { regNumber: 'FL21 TVE', engineServiceDue: null, lastServiceLabel: null, nextServiceLabel: null },
  { regNumber: 'KS21 AVS', engineServiceDue: 420000, lastServiceLabel: 'Full', nextServiceLabel: 'Basic A' },
  { regNumber: 'KS71 AVS', engineServiceDue: 90000, lastServiceLabel: 'Basic B', nextServiceLabel: 'Basic A' },
  { regNumber: 'PS71 AVS', engineServiceDue: 341633, lastServiceLabel: 'Basic A', nextServiceLabel: 'Full' },
  { regNumber: 'SS15 AVS', engineServiceDue: 650000, lastServiceLabel: 'Full', nextServiceLabel: 'Basic A' },
  { regNumber: 'TS71 AVS', engineServiceDue: 260000, lastServiceLabel: 'Basic A', nextServiceLabel: 'Basic B' },
  { regNumber: 'VS71 AVS', engineServiceDue: 325906, lastServiceLabel: 'Full', nextServiceLabel: 'Basic A' },
  { regNumber: 'XT71 AVS', engineServiceDue: 170000, lastServiceLabel: 'Full', nextServiceLabel: 'Basic A' },
];

const LABEL_TO_TEMPLATE: Record<string, string> = {
  'Full': 'Full Service (HGV)',
  'Basic A': 'Basic Service A (HGV)',
  'Basic B': 'Basic Service B (HGV)',
};

function normalizeReg(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function createClient(): pg.Client {
  const url = new URL(connectionString!);
  // Pooler hosts omit the project ref; username is typically postgres.<project-ref>.
  if (
    !connectionString!.includes(TARGET_PROJECT_REF) &&
    !url.hostname.includes('localhost')
  ) {
    throw new Error(
      `Refusing migration: connection string does not include expected project ref ${TARGET_PROJECT_REF}`,
    );
  }
  return new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
}

async function resolveTemplateIds(client: pg.Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; name: string }>(`
    SELECT id, name
    FROM public.workshop_attachment_templates
    WHERE LOWER(name) IN (
      LOWER('Basic Service A (HGV)'),
      LOWER('Basic Service B (HGV)'),
      LOWER('Full Service (HGV)')
    )
  `);
  const map = new Map(rows.map((row) => [row.name, row.id]));
  for (const required of Object.values(LABEL_TO_TEMPLATE)) {
    if (![...map.keys()].some((name) => name.toLowerCase() === required.toLowerCase())) {
      throw new Error(`Missing required template: ${required}`);
    }
  }
  // Normalize keys to exact expected names
  const byLower = new Map(rows.map((row) => [row.name.toLowerCase(), row.id]));
  return new Map(
    Object.values(LABEL_TO_TEMPLATE).map((name) => [name, byLower.get(name.toLowerCase())!]),
  );
}

async function resolveRotationSteps(client: pg.Client): Promise<Array<{ id: string; position: number; template_id: string }>> {
  const { rows } = await client.query<{ id: string; position: number; template_id: string }>(`
    SELECT s.id, s.position, s.attachment_template_id AS template_id
    FROM public.service_rotation_steps s
    JOIN public.maintenance_categories mc ON mc.id = s.maintenance_category_id
    WHERE mc.config_key = 'service_hgv'
    ORDER BY s.position
  `);
  if (rows.length !== 4) {
    throw new Error(`Expected 4 HGV rotation steps, found ${rows.length}`);
  }
  return rows;
}

/**
 * Resolve next rotation step given last/next labels.
 * Rotation: 1=A, 2=B, 3=A, 4=Full
 */
function resolveNextStepId(
  steps: Array<{ id: string; position: number; template_id: string }>,
  templateIds: Map<string, string>,
  lastLabel: ScreenshotRow['lastServiceLabel'],
  nextLabel: ScreenshotRow['nextServiceLabel'],
): { nextTemplateId: string | null; nextStepId: string | null; lastTemplateId: string | null } {
  if (!nextLabel) {
    return {
      nextTemplateId: null,
      nextStepId: null,
      lastTemplateId: lastLabel ? templateIds.get(LABEL_TO_TEMPLATE[lastLabel]) ?? null : null,
    };
  }

  const nextTemplateName = LABEL_TO_TEMPLATE[nextLabel];
  const nextTemplateId = templateIds.get(nextTemplateName)!;
  const lastTemplateId = lastLabel ? templateIds.get(LABEL_TO_TEMPLATE[lastLabel]) ?? null : null;

  let nextStep = steps.find((step) => step.template_id === nextTemplateId);

  // Duplicate Basic A: pick the occurrence that follows the last service type.
  if (nextLabel === 'Basic A') {
    if (lastLabel === 'Basic B') {
      nextStep = steps.find((step) => step.position === 3) ?? nextStep;
    } else if (lastLabel === 'Full' || lastLabel === null) {
      nextStep = steps.find((step) => step.position === 1) ?? nextStep;
    } else if (lastLabel === 'Basic A') {
      // Unusual; prefer second A if last was also A
      nextStep = steps.find((step) => step.position === 3) ?? nextStep;
    }
  } else if (nextLabel === 'Basic B') {
    nextStep = steps.find((step) => step.position === 2) ?? nextStep;
  } else if (nextLabel === 'Full') {
    nextStep = steps.find((step) => step.position === 4) ?? nextStep;
  }

  return {
    nextTemplateId,
    nextStepId: nextStep?.id ?? null,
    lastTemplateId,
  };
}

async function backfillScreenshotRows(client: pg.Client) {
  console.log('\nStaging HGV screenshot backfill...');

  const templateIds = await resolveTemplateIds(client);
  const steps = await resolveRotationSteps(client);

  const { rows: liveHgvs } = await client.query<{ id: string; reg_number: string }>(`
    SELECT id, reg_number FROM public.hgvs
  `);

  const liveByNorm = new Map(
    liveHgvs.map((row) => [normalizeReg(row.reg_number), row]),
  );

  // Guard: TEST-HGV must not be in the staged set
  if (SCREENSHOT_ROWS.some((row) => normalizeReg(row.regNumber) === 'TE57HGV')) {
    throw new Error('Preflight failed: TEST-HGV must be excluded from backfill set');
  }

  const matched: Array<{ hgvId: string; row: ScreenshotRow }> = [];
  const unmatched: string[] = [];

  for (const row of SCREENSHOT_ROWS) {
    const live = liveByNorm.get(normalizeReg(row.regNumber));
    if (!live) {
      unmatched.push(row.regNumber);
      continue;
    }
    matched.push({ hgvId: live.id, row });
  }

  if (unmatched.length > 0) {
    throw new Error(`Preflight failed: unmatched registrations: ${unmatched.join(', ')}`);
  }
  if (matched.length !== 12) {
    throw new Error(`Preflight failed: expected 12 matches, found ${matched.length}`);
  }

  // Ensure no duplicates
  const uniqueIds = new Set(matched.map((item) => item.hgvId));
  if (uniqueIds.size !== 12) {
    throw new Error('Preflight failed: duplicate HGV matches');
  }

  try {
    let updated = 0;
    let protectedRows = 0;
    for (const { hgvId, row } of matched) {
      const { rows: serviceEvents } = await client.query<{ exists: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1
          FROM public.asset_service_events
          WHERE hgv_id = $1
            AND event_type = 'completion'
        ) AS exists
        `,
        [hgvId],
      );
      if (serviceEvents[0]?.exists) {
        protectedRows += 1;
        console.log(`  ↷ ${row.regNumber}: preserved newer completed service state`);
        continue;
      }

      const resolved = resolveNextStepId(
        steps,
        templateIds,
        row.lastServiceLabel,
        row.nextServiceLabel,
      );

      // Ensure vehicle_maintenance row exists
      await client.query(
        `
        INSERT INTO public.vehicle_maintenance (hgv_id, next_service_mileage, last_service_template_id, next_service_template_id, next_service_rotation_step_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (hgv_id) DO UPDATE SET
          next_service_mileage = EXCLUDED.next_service_mileage,
          last_service_template_id = EXCLUDED.last_service_template_id,
          next_service_template_id = EXCLUDED.next_service_template_id,
          next_service_rotation_step_id = EXCLUDED.next_service_rotation_step_id,
          updated_at = NOW()
        `,
        [
          hgvId,
          row.engineServiceDue,
          resolved.lastTemplateId,
          resolved.nextTemplateId,
          resolved.nextStepId,
        ],
      );

      // Dual-write Engine/Service custom value for rollback window (when due is set)
      if (row.engineServiceDue != null) {
        const updatedCustom = await client.query(
          `
          UPDATE public.asset_maintenance_category_values cv
          SET due_mileage = $2,
              last_updated_at = NOW(),
              updated_at = NOW()
          FROM public.maintenance_categories mc
          WHERE cv.maintenance_category_id = mc.id
            AND mc.config_key = 'service_hgv'
            AND cv.hgv_id = $1::uuid
          `,
          [hgvId, row.engineServiceDue],
        );
        if ((updatedCustom.rowCount ?? 0) === 0) {
          await client.query(
            `
            INSERT INTO public.asset_maintenance_category_values (
              maintenance_category_id, hgv_id, due_mileage, last_updated_at
            )
            SELECT mc.id, $1::uuid, $2::integer, NOW()
            FROM public.maintenance_categories mc
            WHERE mc.config_key = 'service_hgv'
            LIMIT 1
            `,
            [hgvId, row.engineServiceDue],
          );
        }
      }

      updated += 1;
      console.log(
        `  ✓ ${row.regNumber}: due=${row.engineServiceDue ?? 'null'} last=${row.lastServiceLabel ?? 'null'} next=${row.nextServiceLabel ?? 'null'}`,
      );
    }

    // Assert TEST-HGV untouched if present
    const { rows: testRows } = await client.query<{ next_service_template_id: string | null }>(`
      SELECT vm.next_service_template_id
      FROM public.hgvs h
      LEFT JOIN public.vehicle_maintenance vm ON vm.hgv_id = h.id
      WHERE UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) = 'TE57HGV'
         OR LOWER(h.nickname) = 'test-hgv'
    `);
    for (const testRow of testRows) {
      if (testRow.next_service_template_id) {
        throw new Error('Backfill assertion failed: TEST-HGV received a next service template');
      }
    }

    if (updated + protectedRows !== 12) {
      throw new Error(
        `Backfill assertion failed: reconciled ${updated + protectedRows}, expected 12`,
      );
    }

    console.log(`Backfill staged for ${updated} HGVs; preserved ${protectedRows}`);
  } catch (error) {
    throw error;
  }
}

async function verify(client: pg.Client) {
  console.log('\nVerifying schema and seeds...');

  const checks = await client.query<{ check: string; ok: boolean; detail: string }>(`
    SELECT 'tables' AS check,
      (
        to_regclass('public.workshop_category_attachment_templates') IS NOT NULL
        AND to_regclass('public.service_rotation_steps') IS NOT NULL
        AND to_regclass('public.asset_service_events') IS NOT NULL
      ) AS ok,
      'core tables exist' AS detail
    UNION ALL
    SELECT 'config_keys',
      (
        SELECT COUNT(*) = 3 FROM public.maintenance_categories
        WHERE config_key IN ('service_van', 'service_hgv', 'service_plant') AND is_active = true
      ),
      'active service config keys'
    UNION ALL
    SELECT 'hgv_service_km',
      EXISTS (
        SELECT 1 FROM public.maintenance_categories
        WHERE config_key = 'service_hgv'
          AND period_unit = 'km'
          AND period_value = 25000
          AND field_key = 'next_service_mileage'
          AND LOWER(name) = 'service'
      ),
      'HGV Service 25000 km system field'
    UNION ALL
    SELECT 'full_service_inactive',
      EXISTS (
        SELECT 1 FROM public.maintenance_categories
        WHERE config_key = 'legacy_full_service_hgv' AND is_active = false
      ),
      'Full Service deactivated'
    UNION ALL
    SELECT 'hgv_rotation',
      (
        SELECT COUNT(*) = 4 FROM public.service_rotation_steps s
        JOIN public.maintenance_categories mc ON mc.id = s.maintenance_category_id
        WHERE mc.config_key = 'service_hgv'
      ),
      'HGV has 4 rotation steps'
    UNION ALL
    SELECT 'van_template_scope',
      EXISTS (
        SELECT 1 FROM public.workshop_attachment_templates
        WHERE LOWER(name) = 'van service' AND applies_to = ARRAY['van']::text[]
      ),
      'Van Service applies_to=van'
    UNION ALL
    SELECT 'subcategories_inactive',
      NOT EXISTS (
        SELECT 1 FROM public.workshop_task_subcategories WHERE is_active = true
      ),
      'no active subcategories'
    UNION ALL
    SELECT 'historical_subcategory_refs',
      (
        SELECT COUNT(*) >= 30 FROM public.actions
        WHERE workshop_subcategory_id IS NOT NULL
      ),
      'historical subcategory FKs retained'
    UNION ALL
    SELECT 'service_links',
      (
        SELECT COUNT(*) FROM public.workshop_category_attachment_templates w
        JOIN public.workshop_task_categories c ON c.id = w.category_id
        WHERE LOWER(c.name) = 'service (hgv)'
      ) = 3,
      'Service (HGV) has 3 linked templates'
    UNION ALL
    SELECT 'hgv_backfill_types',
      (
        SELECT COUNT(*) FROM public.vehicle_maintenance vm
        JOIN public.hgvs h ON h.id = vm.hgv_id
        WHERE vm.next_service_template_id IS NOT NULL
          AND UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) <> 'TE57HGV'
      ) = 10,
      '10 HGVs with next service type (2 Not Set remain null)'
  `);

  let failed = false;
  for (const row of checks.rows) {
    const mark = row.ok ? '✓' : '✗';
    console.log(`  ${mark} ${row.check}: ${row.detail}`);
    if (!row.ok) failed = true;
  }

  // Rotation order check
  const { rows: rotation } = await client.query<{ position: number; name: string }>(`
    SELECT s.position, t.name
    FROM public.service_rotation_steps s
    JOIN public.maintenance_categories mc ON mc.id = s.maintenance_category_id
    JOIN public.workshop_attachment_templates t ON t.id = s.attachment_template_id
    WHERE mc.config_key = 'service_hgv'
    ORDER BY s.position
  `);
  const expected = [
    'Basic Service A (HGV)',
    'Basic Service B (HGV)',
    'Basic Service A (HGV)',
    'Full Service (HGV)',
  ];
  const actual = rotation.map((row) => row.name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.log(`  ✗ rotation_order: expected ${expected.join(' → ')}, got ${actual.join(' → ')}`);
    failed = true;
  } else {
    console.log('  ✓ rotation_order: A → B → A → Full');
  }

  if (failed) {
    throw new Error('Verification failed');
  }
  console.log('All verification checks passed.');
}

async function run() {
  console.log('Running Unify Asset Service Scheduling migration...\n');
  const client = createClient();

  try {
    await client.connect();
    console.log('Connected to database');

    await client.query('BEGIN');
    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSQL);
    console.log('Schema migration executed');

    await backfillScreenshotRows(client);
    await verify(client);
    await client.query('COMMIT');

    console.log('\nMigration complete.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

run();
