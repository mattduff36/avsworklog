import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFiles = [
  'supabase/migrations/20260325_fix_security_advisor_errors.sql',
  'supabase/migrations/20260325_fix_security_advisor_warnings.sql',
];

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🔒 Running Security Advisor Fixes Migration...\n');

  const url = new URL(connectionString!);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    for (const sqlFile of sqlFiles) {
      const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
      console.log(`📄 Executing ${sqlFile}...`);
      await client.query(migrationSQL);
      console.log(`✅ ${sqlFile} executed!`);
    }
    console.log('');

    // ── Verify: vehicle_inspections view is gone ──────────────────────────
    const viewCheck = await client.query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.views
      WHERE table_schema = 'public'
        AND table_name   = 'vehicle_inspections';
    `);
    const viewDropped = Number(viewCheck.rows[0].cnt) === 0;
    console.log(viewDropped
      ? '✅ vehicle_inspections view: DROPPED'
      : '⚠️  vehicle_inspections view still exists — investigate manually');

    // ── Verify: RLS enabled on absence_bulk_batches ───────────────────────
    const rlsCheck = await client.query(`
      SELECT rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename  = 'absence_bulk_batches';
    `);
    const rlsEnabled = rlsCheck.rows.length > 0 && rlsCheck.rows[0].rowsecurity;
    console.log(rlsEnabled
      ? '✅ absence_bulk_batches RLS: ENABLED'
      : '⚠️  absence_bulk_batches RLS not enabled — investigate manually');

    // ── Verify: policies on absence_bulk_batches ──────────────────────────
    const policyCheck = await client.query(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'absence_bulk_batches';
    `);
    console.log(`✅ absence_bulk_batches policies: ${policyCheck.rows.length} found`);
    for (const row of policyCheck.rows) {
      console.log(`   • ${row.policyname}`);
    }

    // ── Bonus: scan for other public tables without RLS ───────────────────
    console.log('\n── Additional check: public tables without RLS ──────────');
    const noRlsTables = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND rowsecurity = false
      ORDER BY tablename;
    `);
    if (noRlsTables.rows.length === 0) {
      console.log('✅ All public tables have RLS enabled');
    } else {
      console.log(`⚠️  ${noRlsTables.rows.length} public table(s) without RLS:`);
      for (const row of noRlsTables.rows) {
        console.log(`   • ${row.tablename}`);
      }
    }

    // ── Bonus: scan for Security Definer views ────────────────────────────
    console.log('\n── Additional check: Security Definer views ─────────────');
    const secDefViews = await client.query(`
      SELECT viewname
      FROM pg_views
      WHERE schemaname = 'public';
    `);
    if (secDefViews.rows.length === 0) {
      console.log('✅ No public views found (none to flag)');
    } else {
      console.log(`ℹ️  ${secDefViews.rows.length} public view(s) — check security_invoker setting:`);
      for (const row of secDefViews.rows) {
        console.log(`   • ${row.viewname}`);
      }
    }

    // ── Bonus: functions with mutable search_path ─────────────────────────
    console.log('\n── Additional check: SECURITY DEFINER funcs without fixed search_path ──');
    const unsafeFuncs = await client.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prosecdef = true
        AND (p.proconfig IS NULL OR NOT p.proconfig @> ARRAY['search_path=public'])
      ORDER BY p.proname;
    `);
    if (unsafeFuncs.rows.length === 0) {
      console.log('✅ All SECURITY DEFINER functions have a fixed search_path');
    } else {
      console.log(`⚠️  ${unsafeFuncs.rows.length} SECURITY DEFINER function(s) without fixed search_path:`);
      for (const row of unsafeFuncs.rows) {
        console.log(`   • ${row.proname}(${row.args})`);
      }
    }

    console.log('\n🎉 Security advisor fixes complete!\n');

  } catch (err: unknown) {
    console.error('\n❌ Migration failed:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
