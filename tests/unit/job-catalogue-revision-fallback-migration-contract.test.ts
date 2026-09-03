import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadFinaliseMigrationFiles,
  stripOuterMigrationTransaction,
} from '@/scripts/finalise-migrations';
import {
  assertGenericRunnerMigrationAllowed,
  runSqlMigrationMain,
} from '@/scripts/run-sql-migration';

const MIGRATION_RELATIVE = 'supabase/migrations/20260903_job_catalogue_revision_fallback.sql';
const ROLLBACK_RELATIVE = 'supabase/rollback/20260903_job_catalogue_revision_fallback.sql';
const HISTORIC_RELATIVE = 'supabase/migrations/20260813_daily_allocation_module.sql';

function readSql(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('job catalogue revision fallback migration contract', () => {
  it('SQL-001 / FD-CODE-001: new migration encodes pre-send fallback without changing 20260813', () => {
    const sql = readSql(MIGRATION_RELATIVE);
    const historic = readSql(HISTORIC_RELATIVE);

    expect(sql).toContain('-- finalise-phase: predeploy');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION private.allocation_live_quote_thread_representative');
    expect(sql).toContain(
      "UPPER(COALESCE(NULLIF(BTRIM(quotes.base_quote_reference), ''), NULLIF(BTRIM(quotes.quote_reference), ''), '')) = v_code"
    );
    expect(sql).toContain("'draft'");
    expect(sql).toContain("'pending_internal_approval'");
    expect(sql).toContain("'approved'");
    expect(sql).toContain("'changes_requested'");
    expect(sql).toContain('revision_number DESC');
    expect(sql).toContain('created_at DESC');
    expect(sql).toContain('id DESC');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION private.resolve_allocation_job');
    expect(sql).toContain('REVOKE ALL ON FUNCTION private.allocation_live_quote_thread_representative(UUID) FROM PUBLIC, anon, authenticated');
    expect(sql).not.toContain('GRANT EXECUTE ON FUNCTION private.allocation_live_quote_thread_representative');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION private.allocation_quote_is_catalogue_eligible');

    expect(historic).toContain('CREATE OR REPLACE FUNCTION private.allocation_quote_is_catalogue_eligible');
    expect(historic).toContain('COALESCE(p_is_latest, FALSE)');
    expect(historic).not.toContain('allocation_live_quote_thread_representative');
  });

  it('MIG-001: migration and recovery SQL parse transactionally and dry-run reports predeploy', async () => {
    const sql = readSql(MIGRATION_RELATIVE);
    const rollbackSql = readSql(ROLLBACK_RELATIVE);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/COMMIT;/);
    expect(rollbackSql).toMatch(/BEGIN;/);
    expect(rollbackSql).toMatch(/COMMIT;/);
    expect(rollbackSql).toContain('DROP FUNCTION IF EXISTS private.allocation_live_quote_thread_representative');
    expect(() => stripOuterMigrationTransaction(sql)).not.toThrow();
    expect(() => stripOuterMigrationTransaction(rollbackSql)).not.toThrow();

    const [migration] = loadFinaliseMigrationFiles(process.cwd(), [MIGRATION_RELATIVE]);
    expect(migration.phase).toBe('predeploy');
    expect(() => assertGenericRunnerMigrationAllowed(migration)).not.toThrow();

    const lines: string[] = [];
    const exitCode = await runSqlMigrationMain({
      repoRoot: process.cwd(),
      argv: [MIGRATION_RELATIVE],
      loadEnvLocal: () => {
        throw new Error('dry-run must not load env');
      },
      getEnv: () => {
        throw new Error('dry-run must not read env');
      },
      createClient: async () => {
        throw new Error('dry-run must not construct a client');
      },
      writeLine: (line) => lines.push(line),
      writeError: (line) => lines.push(line),
    });

    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('outcome=validated');
    expect(lines.join('\n')).toContain('phase=predeploy');
  });
});
