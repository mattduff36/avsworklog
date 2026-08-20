import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decideFinaliseMigrationLedgerAction,
  FINALISE_MIGRATION_LEDGER_SQL,
  type FinaliseMigrationFile,
  type FinaliseMigrationLedgerRow,
} from '@/scripts/finalise-migrations';
import {
  applyMigrationWithLedger,
  FINALISE_LEDGER_FILENAME_LOCK_SQL,
  FINALISE_LEDGER_GLOBAL_LOCK_SQL,
  FINALISE_LEDGER_INSERT_SQL,
  MIGRATION_LOCK_TIMEOUT_SQL,
  readMigrationLedgerRows,
  sanitizeMigrationExecutorError,
  SanitizedMigrationError,
  type MigrationQueryClient,
  type MigrationQueryResult,
} from '@/scripts/migration-executor';
import {
  assertGenericRunnerMigrationAllowed,
  formatChecksumPrefix,
  formatMigrationCliResult,
  MigrationCliError,
  parseMigrateCliArgs,
  resolveExplicitMigrationPath,
  runSqlMigrationMain,
  type MigrationPathFs,
} from '@/scripts/run-sql-migration';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'run-sql-migration-'));
  tempRoots.push(root);
  return root;
}

function writeMigration(
  repoRoot: string,
  filename: string,
  sql: string
): FinaliseMigrationFile {
  const relativePath = `supabase/migrations/${filename}`;
  const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, sql, 'utf8');
  return {
    relativePath,
    checksumSha256: createHash('sha256').update(sql, 'utf8').digest('hex'),
    phase: /finalise-phase\s*:\s*postdeploy/iu.test(sql) ? 'postdeploy' : 'predeploy',
    sql,
  };
}

afterEach(() => {
  tempRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('MIG-CLI-001 argument parsing', () => {
  it('rejects missing, multiple, conflicting, duplicate, and unknown arguments and defaults to dry-run', () => {
    expect(parseMigrateCliArgs([])).toEqual({
      ok: false,
      message: 'missing migration path',
    });
    expect(
      parseMigrateCliArgs([
        'supabase/migrations/a.sql',
        'supabase/migrations/b.sql',
      ])
    ).toEqual({
      ok: false,
      message: 'multiple migration paths',
    });
    expect(
      parseMigrateCliArgs(['supabase/migrations/a.sql', '--confirm-target', 'proj'])
    ).toEqual({
      ok: false,
      message: '--confirm-target requires --apply',
    });
    expect(parseMigrateCliArgs(['supabase/migrations/a.sql', '--apply'])).toEqual({
      ok: false,
      message: '--apply requires --confirm-target',
    });
    expect(
      parseMigrateCliArgs([
        'supabase/migrations/a.sql',
        '--apply',
        '--apply',
        '--confirm-target',
        'proj',
      ])
    ).toEqual({
      ok: false,
      message: 'duplicate --apply flag',
    });
    expect(
      parseMigrateCliArgs([
        'supabase/migrations/a.sql',
        '--apply',
        '--confirm-target',
        'proj',
        '--confirm-target',
        'proj',
      ])
    ).toEqual({
      ok: false,
      message: 'duplicate --confirm-target flag',
    });
    expect(parseMigrateCliArgs(['supabase/migrations/a.sql', '--force'])).toEqual({
      ok: false,
      message: 'unknown flag',
    });
    expect(JSON.stringify(parseMigrateCliArgs(['supabase/migrations/a.sql', '--super-secret-pass']))).not.toContain(
      'super-secret-pass'
    );

    const dryRun = parseMigrateCliArgs(['supabase/migrations/a.sql']);
    expect(dryRun).toEqual({
      ok: true,
      inputPath: 'supabase/migrations/a.sql',
      apply: false,
      confirmTarget: undefined,
    });
  });
});

describe('MIG-PATH-001 path containment', () => {
  it('accepts a canonical valid path and rejects unsafe aliases', () => {
    const repoRoot = makeTempRoot();
    const migration = writeMigration(repoRoot, '20260101_ok.sql', 'SELECT 1;\n');

    expect(
      resolveExplicitMigrationPath(repoRoot, 'supabase/migrations/20260101_ok.sql')
    ).toMatchObject({ canonicalPath: migration.relativePath });
    expect(
      resolveExplicitMigrationPath(
        repoRoot,
        'supabase\\migrations\\20260101_ok.sql'
      ).canonicalPath
    ).toBe(migration.relativePath);

    expect(() =>
      resolveExplicitMigrationPath(repoRoot, '/tmp/20260101_ok.sql')
    ).toThrow(/absolute/iu);
    expect(() =>
      resolveExplicitMigrationPath(repoRoot, 'C:\\tmp\\20260101_ok.sql')
    ).toThrow(/drive-qualified/iu);
    expect(() =>
      resolveExplicitMigrationPath(repoRoot, '\\\\server\\share\\20260101_ok.sql')
    ).toThrow(/UNC/iu);
    expect(() =>
      resolveExplicitMigrationPath(
        repoRoot,
        'supabase/migrations/../secrets.sql'
      )
    ).toThrow(/traversal/iu);
    expect(() =>
      resolveExplicitMigrationPath(repoRoot, 'supabase/migrations/missing.sql')
    ).toThrow(/does not exist/iu);
    expect(() => resolveExplicitMigrationPath(repoRoot, 'supabase/migrations')).toThrow(
      /regular file|lowercase \.sql|inside supabase\/migrations/iu
    );
    expect(() =>
      resolveExplicitMigrationPath(repoRoot, 'supabase/migrations/20260101_ok.txt')
    ).toThrow(/lowercase \.sql/iu);
    expect(() =>
      resolveExplicitMigrationPath(repoRoot, 'supabase/migrations/20260101_ok.SQL')
    ).toThrow(/lowercase \.sql/iu);

    const fsOps: MigrationPathFs = {
      existsSync: () => true,
      statSync: () => ({
        isFile: () => true,
        isDirectory: () => false,
      }),
      lstatSync: () => ({ isSymbolicLink: () => false }),
      realpathSync: (targetPath) => {
        if (targetPath.toLowerCase().includes('20260101_ok.sql')) {
          return path.join(repoRoot, 'supabase', 'migrations', '20260101_ok.sql');
        }
        if (targetPath.toLowerCase().includes(path.join('supabase', 'migrations'))) {
          return path.join(repoRoot, 'supabase', 'migrations');
        }
        return repoRoot;
      },
    };
    expect(() =>
      resolveExplicitMigrationPath(
        repoRoot,
        'supabase/migrations/20260101_OK.sql',
        fsOps
      )
    ).toThrow(/case alias/iu);

    const escapeFs: MigrationPathFs = {
      existsSync: () => true,
      statSync: () => ({
        isFile: () => true,
        isDirectory: () => false,
      }),
      lstatSync: () => ({ isSymbolicLink: () => false }),
      realpathSync: (targetPath) => {
        if (targetPath.includes('escape.sql')) {
          return path.join(os.tmpdir(), 'outside-escape.sql');
        }
        if (targetPath.endsWith('migrations')) {
          return path.join(repoRoot, 'supabase', 'migrations');
        }
        return repoRoot;
      },
    };
    expect(() =>
      resolveExplicitMigrationPath(
        repoRoot,
        'supabase/migrations/escape.sql',
        escapeFs
      )
    ).toThrow(/symlink escape/iu);
  });
});

describe('MIG-PHASE-001 sql rejection', () => {
  it('rejects postdeploy, ledger targeting, leftover transaction control, and non-transactional SQL', () => {
    const repoRoot = makeTempRoot();
    const accepted = writeMigration(
      repoRoot,
      '20260101_outer.sql',
      '-- finalise-phase: predeploy\nBEGIN;\nSELECT 1;\nCOMMIT;\n'
    );
    expect(() => assertGenericRunnerMigrationAllowed(accepted)).not.toThrow();

    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(
          repoRoot,
          '20260102_post.sql',
          '-- finalise-phase: postdeploy\nSELECT 1;\n'
        )
      )
    ).toThrow(/postdeploy/iu);

    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(
          repoRoot,
          '20260103_ledger.sql',
          'SELECT * FROM private.finalise_migration_ledger;\n'
        )
      )
    ).toThrow(/ledger/iu);

    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(
          repoRoot,
          '20260104_txn.sql',
          'BEGIN;\nSELECT 1;\nCOMMIT;\nROLLBACK;\n'
        )
      )
    ).toThrow(/transaction-control/iu);

    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(
          repoRoot,
          '20260105_concurrent.sql',
          'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_x ON t(id);\n'
        )
      )
    ).toThrow(/non-transactional/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260106_vacuum.sql', 'VACUUM;\n')
      )
    ).toThrow(/non-transactional/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260107_system.sql', 'ALTER SYSTEM SET a = 1;\n')
      )
    ).toThrow(/non-transactional/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260108_db.sql', 'CREATE DATABASE other;\n')
      )
    ).toThrow(/non-transactional/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260109_comment.sql', 'SELECT 1;\nCOMMIT /*comment*/;\n')
      )
    ).toThrow(/transaction-control/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260110_chain.sql', 'SELECT 1;\nCOMMIT AND CHAIN;\n')
      )
    ).toThrow(/transaction-control/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260111_end.sql', 'SELECT 1;\nEND;\n')
      )
    ).toThrow(/transaction-control/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260112_end_txn.sql', 'SELECT 1;\nEND TRANSACTION;\n')
      )
    ).toThrow(/transaction-control/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260113_end_work.sql', 'SELECT 1;\nEND WORK;\n')
      )
    ).toThrow(/transaction-control/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260114_end_chain.sql', 'SELECT 1;\nEND AND CHAIN;\n')
      )
    ).toThrow(/transaction-control/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260116_no_chain.sql', 'SELECT 1;\nCOMMIT AND NO CHAIN;\n')
      )
    ).toThrow(/transaction-control/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260117_prepare.sql', "PREPARE TRANSACTION 'x';\n")
      )
    ).toThrow(/transaction-control/iu);
    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(repoRoot, '20260118_comment_dollar.sql', '-- $$\nCOMMIT;\n-- $$\n')
      )
    ).toThrow(/transaction-control/iu);

    expect(() =>
      assertGenericRunnerMigrationAllowed(
        writeMigration(
          repoRoot,
          '20260115_do_block.sql',
          `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='my_table' AND column_name='new_column'
  ) THEN
    ALTER TABLE my_table ADD COLUMN new_column TEXT;
  END IF;
END $$;
`
        )
      )
    ).not.toThrow();
  });
});

function createMockClient(options?: {
  ledgerRow?: FinaliseMigrationLedgerRow | null;
  failOn?: (sql: string) => Error | null;
}): {
  client: MigrationQueryClient;
  queries: Array<{ sql: string; values?: unknown[] }>;
} {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client: MigrationQueryClient = {
    async query<T = Record<string, unknown>>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      const injected = options?.failOn?.(sql);
      if (injected) throw injected;
      if (sql.includes('to_regclass')) {
        return { rows: [{ ledger: 'private.finalise_migration_ledger' }] } as MigrationQueryResult<T>;
      }
      if (sql.includes('FROM private.finalise_migration_ledger')) {
        return {
          rows: options?.ledgerRow ? [options.ledgerRow] : [],
        } as MigrationQueryResult<T>;
      }
      return { rows: [] } as MigrationQueryResult<T>;
    },
  };
  return { client, queries };
}

describe('MIG-LEDGER-001 lock and ledger sequence', () => {
  it('applies, reuses, rolls back drift, and sets a bounded lock timeout', async () => {
    const repoRoot = makeTempRoot();
    const migration = writeMigration(repoRoot, '20260101_ledger.sql', 'SELECT 1;\n');

    const applyMock = createMockClient();
    const applied = await applyMigrationWithLedger(applyMock.client, migration);
    expect(applied.action).toBe('apply');
    expect(applyMock.queries.map((entry) => entry.sql)).toEqual([
      'BEGIN',
      MIGRATION_LOCK_TIMEOUT_SQL,
      FINALISE_LEDGER_GLOBAL_LOCK_SQL,
      FINALISE_MIGRATION_LEDGER_SQL,
      FINALISE_LEDGER_FILENAME_LOCK_SQL,
      'SELECT to_regclass($1) AS ledger',
      `SELECT filename, checksum_sha256, phase, applied_at
     FROM private.finalise_migration_ledger
     WHERE filename = ANY($1::text[])`,
      'SELECT 1;\n',
      FINALISE_LEDGER_INSERT_SQL,
      'COMMIT',
    ]);
    expect(applyMock.queries[4]?.values).toEqual([migration.relativePath]);
    expect(applyMock.queries[8]?.values).toEqual([
      migration.relativePath,
      migration.checksumSha256,
      'predeploy',
    ]);

    const reuseRow: FinaliseMigrationLedgerRow = {
      filename: migration.relativePath,
      checksum_sha256: migration.checksumSha256,
      phase: 'predeploy',
      applied_at: '2026-08-20T00:00:00.000Z',
    };
    const reuseMock = createMockClient({ ledgerRow: reuseRow });
    await expect(applyMigrationWithLedger(reuseMock.client, migration)).resolves.toEqual({
      action: 'reuse',
    });
    expect(reuseMock.queries.some((entry) => entry.sql === FINALISE_LEDGER_INSERT_SQL)).toBe(
      false
    );
    expect(reuseMock.queries.at(-1)?.sql).toBe('COMMIT');

    const driftMock = createMockClient({
      ledgerRow: { ...reuseRow, checksum_sha256: '0'.repeat(64) },
    });
    await expect(applyMigrationWithLedger(driftMock.client, migration)).rejects.toBeInstanceOf(
      SanitizedMigrationError
    );
    expect(driftMock.queries.at(-1)?.sql).toBe('ROLLBACK');
    expect(driftMock.queries.some((entry) => entry.sql === FINALISE_LEDGER_INSERT_SQL)).toBe(
      false
    );

    const failMock = createMockClient({
      failOn: (sql) => (sql.includes('SELECT 1') ? new Error('boom') : null),
    });
    await expect(applyMigrationWithLedger(failMock.client, migration)).rejects.toMatchObject({
      category: 'apply_failed',
    });
    expect(failMock.queries.at(-1)?.sql).toBe('ROLLBACK');

    const timeoutMock = createMockClient({
      failOn: (sql) =>
        sql === FINALISE_LEDGER_GLOBAL_LOCK_SQL
          ? new Error('canceling statement due to lock timeout')
          : null,
    });
    await expect(applyMigrationWithLedger(timeoutMock.client, migration)).rejects.toMatchObject({
      category: 'lock_timeout',
    });

    expect(
      decideFinaliseMigrationLedgerAction(migration, reuseRow)
    ).toBe('reuse');
    const empty = await readMigrationLedgerRows(
      {
        async query<T = Record<string, unknown>>() {
          return { rows: [{ ledger: null }] } as MigrationQueryResult<T>;
        },
      },
      [migration]
    );
    expect(empty.size).toBe(0);
  });
});

describe('MIG-DRY-001 and MIG-APPLY-001 CLI orchestration', () => {
  it('dry-run never loads connection configuration or constructs a client', async () => {
    const repoRoot = makeTempRoot();
    writeMigration(repoRoot, '20260101_ok.sql', 'SELECT 1;\n');
    const lines: string[] = [];
    let loadedEnv = false;
    let readEnv = false;
    let createdClient = false;

    const code = await runSqlMigrationMain({
      repoRoot,
      argv: ['supabase/migrations/20260101_ok.sql'],
      loadEnvLocal: () => {
        loadedEnv = true;
      },
      getEnv: () => {
        readEnv = true;
        return 'postgresql://postgres.projectref:secret@aws-0-eu.pooler.supabase.com:5432/postgres';
      },
      createClient: async () => {
        createdClient = true;
        throw new Error('client must not be constructed');
      },
      writeLine: (line) => lines.push(line),
      writeError: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(loadedEnv).toBe(false);
    expect(readEnv).toBe(false);
    expect(createdClient).toBe(false);
    expect(lines.join('\n')).toContain('outcome=validated');
    expect(lines.join('\n')).not.toContain('applied');
    expect(lines.join('\n')).not.toContain('reused');
  });

  it('apply requires confirmation and a safe known target before connection', async () => {
    const repoRoot = makeTempRoot();
    writeMigration(repoRoot, '20260101_ok.sql', 'SELECT 1;\n');
    const output: string[] = [];
    let createdClient = false;

    const run = (
      argv: string[],
      env: Record<string, string | undefined>
    ) =>
      runSqlMigrationMain({
        repoRoot,
        argv,
        loadEnvLocal: () => undefined,
        getEnv: (name) => env[name],
        createClient: async () => {
          createdClient = true;
          throw new Error('client must not be constructed yet');
        },
        writeLine: (line) => output.push(line),
        writeError: (line) => output.push(line),
      });

    expect(await run(['supabase/migrations/20260101_ok.sql', '--apply'], {})).toBe(1);
    expect(createdClient).toBe(false);

    expect(
      await run(
        ['supabase/migrations/20260101_ok.sql', '--apply', '--confirm-target', 'projectref'],
        {}
      )
    ).toBe(1);
    expect(output.join('\n')).toMatch(/POSTGRES_URL_NON_POOLING/u);
    expect(createdClient).toBe(false);

    expect(
      await run(
        ['supabase/migrations/20260101_ok.sql', '--apply', '--confirm-target', 'projectref'],
        {
          POSTGRES_URL_NON_POOLING:
            'postgresql://postgres.projectref:secret@aws-0-eu.pooler.supabase.com:6543/postgres',
        }
      )
    ).toBe(1);
    expect(output.join('\n')).toMatch(/6543/u);
    expect(createdClient).toBe(false);

    expect(
      await run(
        ['supabase/migrations/20260101_ok.sql', '--apply', '--confirm-target', 'projectref'],
        {
          POSTGRES_URL_NON_POOLING:
            'postgresql://user:secret@aws-0-eu.pooler.supabase.com:5432/db',
        }
      )
    ).toBe(1);
    expect(output.join('\n')).toMatch(/known project ref/u);
    expect(createdClient).toBe(false);

    expect(
      await run(
        ['supabase/migrations/20260101_ok.sql', '--apply', '--confirm-target', 'otherref'],
        {
          POSTGRES_URL_NON_POOLING:
            'postgresql://postgres.projectref:secret@aws-0-eu.pooler.supabase.com:5432/postgres',
        }
      )
    ).toBe(1);
    expect(output.join('\n')).toMatch(/Confirm-target/u);
    expect(createdClient).toBe(false);

    expect(
      await run(
        ['supabase/migrations/20260101_ok.sql', '--apply', '--confirm-target', 'projectref'],
        {
          POSTGRES_URL_NON_POOLING:
            'postgresql://postgres.projectref:secret@evil.example.com:5432/postgres',
        }
      )
    ).toBe(1);
    expect(output.join('\n')).toMatch(/known Supabase hostname/u);
    expect(createdClient).toBe(false);

    const applyOutput: string[] = [];
    const code = await runSqlMigrationMain({
      repoRoot,
      argv: [
        'supabase/migrations/20260101_ok.sql',
        '--apply',
        '--confirm-target',
        'projectref',
      ],
      loadEnvLocal: () => undefined,
      getEnv: () =>
        'postgresql://postgres.projectref:secret@aws-0-eu.pooler.supabase.com:5432/postgres',
      createClient: async () => {
        createdClient = true;
        const mock = createMockClient();
        return mock.client;
      },
      writeLine: (line) => applyOutput.push(line),
      writeError: (line) => applyOutput.push(line),
    });
    expect(code).toBe(0);
    expect(createdClient).toBe(true);
    expect(applyOutput.join('\n')).toContain('outcome=applied');
    expect(applyOutput.join('\n')).toContain('target=Supabase project projectref');
  });
});

describe('MIG-SECRET-001 sanitized output', () => {
  it('omits passwords, URLs, keys, raw SQL, and raw error fields', async () => {
    const repoRoot = makeTempRoot();
    writeMigration(
      repoRoot,
      '20260101_ok.sql',
      "SELECT 'secret-sql-payload';\n"
    );
    const secretUrl =
      'postgresql://postgres.projectref:super-secret-pass@db.projectref.supabase.co:5432/postgres';
    const output: string[] = [];

    const success = await runSqlMigrationMain({
      repoRoot,
      argv: [
        'supabase/migrations/20260101_ok.sql',
        '--apply',
        '--confirm-target',
        'projectref',
      ],
      loadEnvLocal: () => undefined,
      getEnv: () => secretUrl,
      createClient: async () => createMockClient().client,
      writeLine: (line) => output.push(line),
      writeError: (line) => output.push(line),
    });
    expect(success).toBe(0);

    const failure = await runSqlMigrationMain({
      repoRoot,
      argv: [
        'supabase/migrations/20260101_ok.sql',
        '--apply',
        '--confirm-target',
        'projectref',
      ],
      loadEnvLocal: () => undefined,
      getEnv: () => secretUrl,
      createClient: async () =>
        createMockClient({
          failOn: (sql) => {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return null;
            const error = new Error(
              `password=super-secret-pass url=${secretUrl} sql=SELECT 1`
            );
            Object.assign(error, {
              detail: 'raw-detail-super-secret-pass',
              code: 'XX000',
              stack: 'secret-stack',
            });
            return error;
          },
        }).client,
      writeLine: (line) => output.push(line),
      writeError: (line) => output.push(line),
    });
    expect(failure).toBe(1);

    const text = output.join('\n');
    expect(text).not.toContain('super-secret-pass');
    expect(text).not.toContain(secretUrl);
    expect(text).not.toContain('postgresql://');
    expect(text).not.toContain('secret-sql-payload');
    expect(text).not.toContain('raw-detail-super-secret-pass');
    expect(text).not.toContain('secret-stack');
    expect(text).not.toContain('XX000');
    expect(text).toContain('outcome=applied');
    expect(text).toContain('outcome=rejected');

    const flagged: string[] = [];
    await runSqlMigrationMain({
      repoRoot,
      argv: ['supabase/migrations/20260101_ok.sql', '--super-secret-pass'],
      loadEnvLocal: () => undefined,
      getEnv: () => secretUrl,
      createClient: async () => {
        throw new Error('client must not be constructed');
      },
      writeLine: (line) => flagged.push(line),
      writeError: (line) => flagged.push(line),
    });
    expect(flagged.join('\n')).not.toContain('super-secret-pass');
    expect(flagged.join('\n')).toContain('unknown flag');

    const drift = sanitizeMigrationExecutorError(
      new Error('Migration checksum drift detected for supabase/migrations/x.sql; password=super-secret-pass')
    );
    expect(drift.message).toBe('Migration ledger drift detected');
    expect(drift.message).not.toContain('super-secret-pass');
    expect(formatMigrationCliResult({ outcome: 'rejected', message: 'safe' })).not.toContain(
      'password'
    );
    expect(() => {
      throw new MigrationCliError('safe');
    }).toThrow(MigrationCliError);
    expect(formatChecksumPrefix('abc123def4567890')).toBe('abc123def456');
  });
});

describe('MIG-DOCS-001 active migration docs', () => {
  it('agrees on non-pooling URL, finalise, confirmation, generic scope, and forward-only correction', () => {
    const root = process.cwd();
    const docs = [
      'docs/DEVELOPMENT.md',
      'docs/guides/HOW_TO_RUN_MIGRATIONS.md',
      'docs/guides/MIGRATIONS_GUIDE.md',
      'scripts/README.md',
    ].map((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));

    for (const text of docs) {
      expect(text).toContain('POSTGRES_URL_NON_POOLING');
      expect(text).toMatch(/finalise/i);
      expect(text).toContain('--confirm-target');
      expect(text).toMatch(/predeploy/i);
      expect(text).toMatch(/transaction/i);
      expect(text).toMatch(/forward-only/i);
    }

    const scriptsReadme = readFileSync(path.join(root, 'scripts/README.md'), 'utf8');
    expect(scriptsReadme).toMatch(/dry-run does not load `\.env\.local`/i);
  });
});

