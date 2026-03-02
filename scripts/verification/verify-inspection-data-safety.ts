// @ts-nocheck
/**
 * Data Safety Verification Script
 *
 * One-time (or repeatable) script to validate the inspection table split
 * produced correct, complete, and consistent data. Outputs a structured
 * PASS/FAIL report with counts, orphan checks, and FK integrity.
 *
 * Usage: npx tsx scripts/verification/verify-inspection-data-safety.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const POSTGRES_URL = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;

if (!POSTGRES_URL) {
  console.error('❌ POSTGRES_URL_NON_POOLING or DATABASE_URL not set in .env.local');
  process.exit(1);
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function pass(name: string, detail: string) {
  results.push({ name, passed: true, detail });
  console.log(`  ✅ ${name}: ${detail}`);
}

function fail(name: string, detail: string) {
  results.push({ name, passed: false, detail });
  console.error(`  ❌ ${name}: ${detail}`);
}

async function main() {
  const connectionString = POSTGRES_URL!;
  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  console.log('\n═══════════════════════════════════════════');
  console.log('  INSPECTION DATA SAFETY VERIFICATION');
  console.log('═══════════════════════════════════════════\n');

  // 1. Table existence
  console.log('─── Table Existence ───');
  const tables = ['van_inspections', 'plant_inspections'];
  for (const table of tables) {
    const { rows } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS exists`,
      [table]
    );
    if (rows[0].exists) {
      pass(`${table} exists`, 'Table found in public schema');
    } else {
      fail(`${table} exists`, 'TABLE NOT FOUND');
    }
  }

  // Check if old compatibility view still exists
  const { rows: viewRows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'vehicle_inspections') AS exists`
  );
  if (viewRows[0].exists) {
    console.log('  ⚠️  vehicle_inspections compatibility view still exists (expected if pre-drop)');
  } else {
    pass('vehicle_inspections view dropped', 'Compatibility view removed');
  }

  // 2. Row counts
  console.log('\n─── Row Counts ───');
  const { rows: vanCount } = await client.query('SELECT COUNT(*)::int AS cnt FROM van_inspections');
  const { rows: plantCount } = await client.query('SELECT COUNT(*)::int AS cnt FROM plant_inspections');
  const vanTotal = vanCount[0].cnt;
  const plantTotal = plantCount[0].cnt;

  pass('van_inspections count', `${vanTotal} rows`);
  pass('plant_inspections count', `${plantTotal} rows`);
  console.log(`  📊 Combined total: ${vanTotal + plantTotal}`);

  // 3. Data separation checks
  console.log('\n─── Data Separation ───');
  const { rows: vanWithPlantId } = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM van_inspections WHERE plant_id IS NOT NULL`
  );
  if (vanWithPlantId[0].cnt === 0) {
    pass('Van has no plant_id', 'All van_inspections.plant_id are NULL');
  } else {
    fail('Van has no plant_id', `${vanWithPlantId[0].cnt} van rows have plant_id set`);
  }

  const { rows: vanHiredPlant } = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM van_inspections WHERE is_hired_plant = true`
  );
  if (vanHiredPlant[0].cnt === 0) {
    pass('Van has no hired plant', 'All van_inspections.is_hired_plant are false');
  } else {
    fail('Van has no hired plant', `${vanHiredPlant[0].cnt} van rows are hired plant`);
  }

  const { rows: plantOrphanOwned } = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM plant_inspections WHERE plant_id IS NULL AND is_hired_plant = false`
  );
  if (plantOrphanOwned[0].cnt === 0) {
    pass('Plant has valid ownership', 'All plant rows have plant_id or are hired');
  } else {
    fail('Plant has valid ownership', `${plantOrphanOwned[0].cnt} plant rows have no plant_id and are not hired`);
  }

  // 4. Orphan checks for child tables
  console.log('\n─── Orphan Checks ───');
  const childTables = [
    { table: 'inspection_items', fk: 'inspection_id' },
    { table: 'inspection_daily_hours', fk: 'inspection_id' },
    { table: 'inspection_photos', fk: 'inspection_id' },
  ];

  for (const child of childTables) {
    try {
      const { rows: orphans } = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM ${child.table} c
        WHERE NOT EXISTS (SELECT 1 FROM van_inspections v WHERE v.id = c.${child.fk})
          AND NOT EXISTS (SELECT 1 FROM plant_inspections p WHERE p.id = c.${child.fk})
      `);
      if (orphans[0].cnt === 0) {
        pass(`No orphan ${child.table}`, 'All rows have a parent in van or plant inspections');
      } else {
        fail(`No orphan ${child.table}`, `${orphans[0].cnt} orphan rows found`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('does not exist')) {
        console.log(`  ⏭️  ${child.table} table does not exist (skipped)`);
      } else {
        fail(`No orphan ${child.table}`, `Query error: ${msg}`);
      }
    }
  }

  // Actions table orphan check (inspection_id can be null for non-inspection actions)
  try {
    const { rows: actionOrphans } = await client.query(`
      SELECT COUNT(*)::int AS cnt FROM actions a
      WHERE a.inspection_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM van_inspections v WHERE v.id = a.inspection_id)
        AND NOT EXISTS (SELECT 1 FROM plant_inspections p WHERE p.id = a.inspection_id)
    `);
    if (actionOrphans[0].cnt === 0) {
      pass('No orphan actions (inspection_id)', 'All actions with inspection_id have a parent');
    } else {
      fail('No orphan actions (inspection_id)', `${actionOrphans[0].cnt} orphan action rows`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('No orphan actions', `Query error: ${msg}`);
  }

  // 5. NULL FK integrity
  console.log('\n─── NULL FK Integrity ───');
  const { rows: vanNullUserId } = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM van_inspections WHERE user_id IS NULL`
  );
  if (vanNullUserId[0].cnt === 0) {
    pass('Van user_id not null', 'All van inspections have user_id');
  } else {
    fail('Van user_id not null', `${vanNullUserId[0].cnt} rows have NULL user_id`);
  }

  const { rows: plantNullUserId } = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM plant_inspections WHERE user_id IS NULL`
  );
  if (plantNullUserId[0].cnt === 0) {
    pass('Plant user_id not null', 'All plant inspections have user_id');
  } else {
    fail('Plant user_id not null', `${plantNullUserId[0].cnt} rows have NULL user_id`);
  }

  // 6. RLS enabled
  console.log('\n─── RLS Status ───');
  for (const table of tables) {
    const { rows: rls } = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = $1`,
      [table]
    );
    if (rls.length > 0 && rls[0].relrowsecurity) {
      pass(`${table} RLS enabled`, 'Row-level security is ON');
    } else {
      fail(`${table} RLS enabled`, 'RLS is NOT enabled');
    }
  }

  // 7. Constraints
  console.log('\n─── Constraints ───');
  for (const table of tables) {
    const { rows: constraints } = await client.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'`,
      [table]
    );
    const names = constraints.map((c: { conname: string }) => c.conname);
    if (names.length > 0) {
      pass(`${table} CHECK constraints`, `Found: ${names.join(', ')}`);
    } else {
      fail(`${table} CHECK constraints`, 'No CHECK constraints found');
    }
  }

  // 8. Indexes on plant_inspections
  console.log('\n─── Indexes ───');
  const { rows: plantIndexes } = await client.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'plant_inspections'`
  );
  const indexNames = plantIndexes.map((i: { indexname: string }) => i.indexname);
  if (indexNames.length >= 3) {
    pass('plant_inspections indexes', `Found ${indexNames.length}: ${indexNames.join(', ')}`);
  } else {
    fail('plant_inspections indexes', `Only ${indexNames.length} indexes found`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  if (failed === 0) {
    console.log(`  🎉 ALL CHECKS PASSED (${passed}/${total})`);
  } else {
    console.log(`  ⚠️  ${failed} CHECKS FAILED out of ${total}`);
  }
  console.log('═══════════════════════════════════════════\n');

  // Write JSON report
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed },
    counts: { van: vanTotal, plant: plantTotal, combined: vanTotal + plantTotal },
    checks: results,
  };

  const fs = await import('fs');
  const reportPath = resolve(process.cwd(), 'testsuite/reports/inspection-data-safety.json');
  fs.mkdirSync(resolve(process.cwd(), 'testsuite/reports'), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report written to: ${reportPath}`);

  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
