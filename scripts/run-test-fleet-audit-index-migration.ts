import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from 'dotenv';
import { assertExactConfirmedSupabaseTarget, defaultCreateMigrationClient } from './run-sql-migration';
import { requireSafeMigrationConnectionString } from './finalise-migrations';
import type { MigrationQueryClient } from './migration-executor';
import { TEST_FLEET_AUDIT_INDEX_NAME, TEST_FLEET_AUDIT_REFERENCES_SQL, TEST_FLEET_AUDIT_PREDICATE_SQL } from '../lib/server/test-fleet-audit-index';

export const INDEX_SQL = `CREATE INDEX CONCURRENTLY ${TEST_FLEET_AUDIT_INDEX_NAME} ON public.audit_log USING gin ((${TEST_FLEET_AUDIT_REFERENCES_SQL})) WHERE ${TEST_FLEET_AUDIT_PREDICATE_SQL}`;
type IndexShape = { valid: boolean; ready: boolean; method: string; expression: string; predicate: string; opclass: string; keys: number; attributes: number; unique_index: boolean; table_name: string };
async function inspect(db: MigrationQueryClient, name: string): Promise<IndexShape | undefined> {
  const result = await db.query<IndexShape>(`SELECT i.indisvalid AS valid,i.indisready AS ready,a.amname AS method,
    pg_get_expr(i.indexprs,i.indrelid) AS expression,pg_get_expr(i.indpred,i.indrelid) AS predicate,
    o.opcname AS opclass,i.indnkeyatts AS keys,i.indnatts AS attributes,i.indisunique AS unique_index,
    i.indrelid::regclass::text AS table_name
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam
    JOIN pg_opclass o ON o.oid=i.indclass[0] WHERE i.indexrelid=to_regclass($1)`, [name]);
  return result.rows[0];
}
export async function ensureTestFleetAuditIndex(db: MigrationQueryClient): Promise<'created' | 'reused'> {
  await db.query("SET lock_timeout='5s'; SET statement_timeout='180s'");
  const lock = await db.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('test-fleet-audit-index',0)) AS locked");
  if (!lock.rows[0]?.locked) throw new Error('Another Test Fleet index migration is running.');
  try {
    // Let this PostgreSQL version canonicalise the exact requested expression.
    // This empty temporary table/index contains no production records.
    await db.query('CREATE TEMP TABLE test_fleet_audit_expected(changes jsonb,action text,table_name text)');
    await db.query(`CREATE INDEX test_fleet_audit_expected_idx ON pg_temp.test_fleet_audit_expected USING gin ((${TEST_FLEET_AUDIT_REFERENCES_SQL})) WHERE ${TEST_FLEET_AUDIT_PREDICATE_SQL}`);
    const expected = await inspect(db, 'pg_temp.test_fleet_audit_expected_idx');
    if (!expected) throw new Error('Could not verify the expected index shape.');
    const check = (actual: IndexShape) => {
      if (!actual.valid || !actual.ready || actual.table_name !== 'audit_log' && actual.table_name !== 'public.audit_log' ||
        (['method','expression','predicate','opclass','keys','attributes','unique_index'] as const).some(key => actual[key] !== expected[key])) {
        throw new Error('Existing Test Fleet audit index is invalid or differs from the reviewed definition. No index was dropped or replaced.');
      }
    };
    const existing = await inspect(db, `public.${TEST_FLEET_AUDIT_INDEX_NAME}`);
    if (existing) { check(existing); await db.query('ANALYZE public.audit_log'); return 'reused'; }
    await db.query(INDEX_SQL);
    const created = await inspect(db, `public.${TEST_FLEET_AUDIT_INDEX_NAME}`);
    if (!created) throw new Error('Test Fleet audit index was not created.');
    check(created);
    // Expression statistics are required for multi-ID historical lookups.
    await db.query('ANALYZE public.audit_log');
    return 'created';
  } finally {
    await db.query('DROP TABLE IF EXISTS pg_temp.test_fleet_audit_expected');
    await db.query("SELECT pg_advisory_unlock(hashtextextended('test-fleet-audit-index',0))");
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.log(`Validated concurrent index definition: ${TEST_FLEET_AUDIT_INDEX_NAME}. No database connection. Use --apply --confirm-target <project-ref>.`); return; }
  if (args.length !== 3 || args[0] !== '--apply' || args[1] !== '--confirm-target') throw new Error('Expected --apply --confirm-target <project-ref>.');
  config({ path: path.resolve('.env.local'), quiet: true });
  const connection = requireSafeMigrationConnectionString(process.env.POSTGRES_URL_NON_POOLING);
  assertExactConfirmedSupabaseTarget(connection, args[2]);
  const db = await defaultCreateMigrationClient(connection);
  try { console.log(`${await ensureTestFleetAuditIndex(db)}: ${TEST_FLEET_AUDIT_INDEX_NAME}; valid and ready. No records deleted.`); }
  finally { await db.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : 'Index migration failed.'); process.exitCode = 1; });
}
