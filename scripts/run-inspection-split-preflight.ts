/**
 * Preflight Audit: Vehicle Inspections Table Split
 *
 * Read-only script that validates data integrity before the
 * vehicle_inspections → van_inspections + plant_inspections migration.
 *
 * Checks:
 *  1. Row classification counts (van / owned-plant / hired-plant)
 *  2. Ambiguous or dirty rows that violate the 3-way discriminator
 *  3. Orphan child rows (inspection_items, inspection_photos, inspection_daily_hours)
 *  4. FK constraint inventory on vehicle_inspections
 *  5. RLS policy inventory
 *  6. Trigger inventory
 *
 * Exit codes:
 *   0 = clean – safe to proceed
 *   1 = dirty data found – migration MUST NOT run
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

async function run() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('📡 Connected to database\n');

  let hasFatal = false;

  // ── 1. Row classification counts ──────────────────────────────────────
  console.log('═══ 1. ROW CLASSIFICATION ═══');

  const { rows: counts } = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE vehicle_id IS NOT NULL AND plant_id IS NULL AND is_hired_plant = FALSE) AS van_count,
      COUNT(*) FILTER (WHERE vehicle_id IS NULL AND plant_id IS NOT NULL AND is_hired_plant = FALSE) AS owned_plant_count,
      COUNT(*) FILTER (WHERE vehicle_id IS NULL AND plant_id IS NULL AND is_hired_plant = TRUE)      AS hired_plant_count,
      COUNT(*) AS total
    FROM vehicle_inspections;
  `);

  const { van_count, owned_plant_count, hired_plant_count, total } = counts[0];
  const classifiedTotal =
    Number(van_count) + Number(owned_plant_count) + Number(hired_plant_count);

  console.log(`  Total rows          : ${total}`);
  console.log(`  Van rows            : ${van_count}`);
  console.log(`  Owned-plant rows    : ${owned_plant_count}`);
  console.log(`  Hired-plant rows    : ${hired_plant_count}`);
  console.log(`  Classified total    : ${classifiedTotal}`);
  console.log(`  Unclassified        : ${Number(total) - classifiedTotal}`);

  if (Number(total) !== classifiedTotal) {
    console.error('\n❌ FATAL: Unclassified rows detected. Migration cannot proceed.');
    hasFatal = true;
  } else {
    console.log('  ✅ All rows cleanly classified\n');
  }

  // ── 2. Ambiguous / dirty rows ─────────────────────────────────────────
  console.log('═══ 2. DIRTY DATA CHECK ═══');

  const { rows: dirty } = await client.query(`
    SELECT id, vehicle_id, plant_id, is_hired_plant
    FROM vehicle_inspections
    WHERE NOT (
      (vehicle_id IS NOT NULL AND plant_id IS NULL AND is_hired_plant = FALSE)
      OR (vehicle_id IS NULL AND plant_id IS NOT NULL AND is_hired_plant = FALSE)
      OR (vehicle_id IS NULL AND plant_id IS NULL AND is_hired_plant = TRUE)
    )
    LIMIT 20;
  `);

  if (dirty.length > 0) {
    console.error(`  ❌ FATAL: ${dirty.length} ambiguous rows found (showing up to 20):`);
    dirty.forEach((r) =>
      console.error(
        `    id=${r.id}  vehicle_id=${r.vehicle_id}  plant_id=${r.plant_id}  is_hired_plant=${r.is_hired_plant}`
      )
    );
    hasFatal = true;
  } else {
    console.log('  ✅ No ambiguous rows\n');
  }

  // ── 3. Orphan child rows ──────────────────────────────────────────────
  console.log('═══ 3. ORPHAN CHILD ROWS ═══');

  for (const childTable of [
    'inspection_items',
    'inspection_photos',
    'inspection_daily_hours',
  ]) {
    const { rows: orphans } = await client.query(`
      SELECT COUNT(*) AS cnt
      FROM ${childTable} c
      LEFT JOIN vehicle_inspections vi ON vi.id = c.inspection_id
      WHERE vi.id IS NULL;
    `);
    const cnt = Number(orphans[0].cnt);
    if (cnt > 0) {
      console.error(`  ❌ WARNING: ${cnt} orphan rows in ${childTable}`);
    } else {
      console.log(`  ✅ ${childTable}: 0 orphans`);
    }
  }

  // Actions with inspection_id pointing to missing inspection
  const { rows: actionOrphans } = await client.query(`
    SELECT COUNT(*) AS cnt
    FROM actions a
    WHERE a.inspection_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.id = a.inspection_id);
  `);
  const actionOrphanCnt = Number(actionOrphans[0].cnt);
  if (actionOrphanCnt > 0) {
    console.error(
      `  ❌ WARNING: ${actionOrphanCnt} actions with orphan inspection_id`
    );
  } else {
    console.log('  ✅ actions: 0 orphan inspection_ids');
  }
  console.log();

  // ── 4. FK constraints referencing vehicle_inspections ──────────────────
  console.log('═══ 4. FK CONSTRAINTS REFERENCING vehicle_inspections ═══');

  const { rows: fks } = await client.query(`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS child_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'vehicle_inspections'
    ORDER BY tc.table_name;
  `);

  if (fks.length === 0) {
    console.log('  (none found)');
  }
  fks.forEach((fk) =>
    console.log(
      `  ${fk.child_table}.${fk.child_column} → vehicle_inspections  [${fk.constraint_name}]`
    )
  );
  console.log();

  // ── 5. CHECK constraints on vehicle_inspections ───────────────────────
  console.log('═══ 5. CHECK CONSTRAINTS ON vehicle_inspections ═══');

  const { rows: checks } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'vehicle_inspections'::regclass
      AND contype = 'c';
  `);

  checks.forEach((c) => console.log(`  ${c.conname}: ${c.definition}`));
  if (checks.length === 0) console.log('  (none)');
  console.log();

  // ── 6. RLS policies on vehicle_inspections ────────────────────────────
  console.log('═══ 6. RLS POLICIES ON vehicle_inspections ═══');

  const { rows: policies } = await client.query(`
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE tablename = 'vehicle_inspections';
  `);

  policies.forEach((p) =>
    console.log(`  [${p.cmd}] ${p.policyname}`)
  );
  if (policies.length === 0) console.log('  (none)');
  console.log();

  // ── 7. Triggers on vehicle_inspections ────────────────────────────────
  console.log('═══ 7. TRIGGERS ON vehicle_inspections ═══');

  const { rows: triggers } = await client.query(`
    SELECT tgname, pg_get_triggerdef(oid) AS definition
    FROM pg_trigger
    WHERE tgrelid = 'vehicle_inspections'::regclass
      AND NOT tgisinternal;
  `);

  triggers.forEach((t) => console.log(`  ${t.tgname}`));
  if (triggers.length === 0) console.log('  (none)');
  console.log();

  // ── 8. Indexes on vehicle_inspections ─────────────────────────────────
  console.log('═══ 8. INDEXES ON vehicle_inspections ═══');

  const { rows: indexes } = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'vehicle_inspections';
  `);

  indexes.forEach((i) => console.log(`  ${i.indexname}`));
  if (indexes.length === 0) console.log('  (none)');
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('════════════════════════════════════════');
  if (hasFatal) {
    console.error(
      '❌ PREFLIGHT FAILED – fix dirty data before running migration'
    );
    await client.end();
    process.exit(1);
  }

  console.log('✅ PREFLIGHT PASSED – safe to run migration');
  console.log(`\nBaseline snapshot:`);
  console.log(`  van_inspections rows (after split) : ${van_count}`);
  console.log(`  plant_inspections rows (after split): ${Number(owned_plant_count) + Number(hired_plant_count)}`);
  console.log(`  total                              : ${total}`);

  await client.end();
  process.exit(0);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
