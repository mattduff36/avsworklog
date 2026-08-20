import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decideFinaliseMigrationLedgerAction,
  FINALISE_MIGRATION_LEDGER_SQL,
  getFinaliseMigrationDiscoveryPaths,
  getFinaliseMigrationFilesFromPaths,
  getSafeDatabaseProjectRef,
  getSafeDatabaseTargetIdentity,
  getValidatedMigrationEvidencePaths,
  loadFinaliseMigrationFiles,
  parseFinaliseMigrationPhase,
  requireSafeMigrationConnectionString,
  stripOuterMigrationTransaction,
  type FinaliseMigrationLedgerRow,
} from '@/scripts/finalise-migrations';
import { fakePostgresUrl } from '@/tests/utils/fake-postgres-url';

function fakeMigrationUrl(parts?: { port?: string; username?: string; hostname?: string; database?: string }): string {
  return fakePostgresUrl({
    username: parts?.username ?? 'postgres.projectref',
    password: 'redacted-test-password',
    hostname: parts?.hostname ?? 'aws-0-eu.pooler.supabase.com',
    port: parts?.port,
    database: parts?.database,
  });
}

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'finalise-migrations-'));
  tempRoots.push(root);
  return root;
}

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  expect(result.status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

function writeRepoFile(repoRoot: string, relativePath: string, content = 'SELECT 1;\n'): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function commitAll(repoRoot: string, message: string): void {
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, [
    '-c',
    'user.name=Finalise Test',
    '-c',
    'user.email=finalise@example.com',
    'commit',
    '-m',
    message,
  ]);
}

afterEach(() => {
  tempRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('finalise migration discovery', () => {
  it('does not treat the finalise migration helper as an executable runner', () => {
    const root = makeTempRoot();
    writeRepoFile(
      root,
      'scripts/finalise-migrations.ts',
      "const excluded = 'supabase/schema.sql';\n"
    );
    writeRepoFile(root, 'supabase/schema.sql');

    expect(
      getFinaliseMigrationFilesFromPaths(root, ['scripts/finalise-migrations.ts'])
    ).toEqual([]);
  });

  it('MIG-DISCOVERY-001 finds committed branch and workspace migrations without history', () => {
    const root = makeTempRoot();
    const remoteRoot = path.join(root, 'remote.git');
    const repoRoot = path.join(root, 'repo');
    mkdirSync(repoRoot);
    runGit(root, ['init', '--bare', remoteRoot]);
    runGit(repoRoot, ['init', '-b', 'main']);

    const historical = 'supabase/migrations/20260101_historical.sql';
    const workspaceModified = 'supabase/migrations/20260102_workspace_modified.sql';
    writeRepoFile(repoRoot, historical);
    writeRepoFile(repoRoot, workspaceModified);
    commitAll(repoRoot, 'baseline');
    runGit(repoRoot, ['remote', 'add', 'origin', remoteRoot]);
    runGit(repoRoot, ['push', '-u', 'origin', 'main']);

    const branchMigration = 'supabase/migrations/20260202_branch.sql';
    writeRepoFile(repoRoot, branchMigration);
    commitAll(repoRoot, 'branch migration');

    const stagedMigration = 'supabase/migrations/20260303_staged.sql';
    const untrackedMigration = 'supabase/migrations/20260404_untracked.sql';
    writeRepoFile(repoRoot, stagedMigration);
    runGit(repoRoot, ['add', stagedMigration]);
    writeRepoFile(repoRoot, workspaceModified, 'SELECT 2;\n');
    writeRepoFile(repoRoot, untrackedMigration);

    const discoveredPaths = getFinaliseMigrationDiscoveryPaths(repoRoot);
    const migrationFiles = getFinaliseMigrationFilesFromPaths(repoRoot, discoveredPaths);

    expect(migrationFiles).toEqual([
      workspaceModified,
      branchMigration,
      stagedMigration,
      untrackedMigration,
    ]);
    expect(migrationFiles).not.toContain(historical);
  });

  it('uses the remote default base when the branch has no upstream', () => {
    const root = makeTempRoot();
    const remoteRoot = path.join(root, 'remote.git');
    const repoRoot = path.join(root, 'repo');
    mkdirSync(repoRoot);
    runGit(root, ['init', '--bare', remoteRoot]);
    runGit(repoRoot, ['init', '-b', 'main']);
    const historical = 'supabase/migrations/20260501_historical.sql';
    writeRepoFile(repoRoot, historical);
    commitAll(repoRoot, 'baseline');
    runGit(repoRoot, ['remote', 'add', 'origin', remoteRoot]);
    runGit(repoRoot, ['push', '-u', 'origin', 'main']);
    runGit(repoRoot, ['checkout', '-b', 'feature/no-upstream']);

    const committedMigration = 'supabase/migrations/20260505_no_upstream.sql';
    const workspaceMigration = 'supabase/migrations/20260506_workspace.sql';
    writeRepoFile(repoRoot, committedMigration);
    commitAll(repoRoot, 'feature migration');
    writeRepoFile(repoRoot, workspaceMigration);

    expect(
      getFinaliseMigrationFilesFromPaths(
        repoRoot,
        getFinaliseMigrationDiscoveryPaths(repoRoot)
      )
    ).toEqual([committedMigration, workspaceMigration]);
  });
});

describe('MIG-REGRESSION-001 finalise migration metadata and ledger', () => {
  it('parses explicit phase metadata and defaults to predeploy', () => {
    expect(parseFinaliseMigrationPhase('-- finalise-phase: postdeploy\nSELECT 1;')).toBe(
      'postdeploy'
    );
    expect(
      parseFinaliseMigrationPhase(
        '\uFEFF-- migration description\n-- FINALISE-PHASE: predeploy\nSELECT 1;'
      )
    ).toBe('predeploy');
    expect(parseFinaliseMigrationPhase('SELECT 1;')).toBe('predeploy');
    expect(() =>
      parseFinaliseMigrationPhase('-- finalise-phase: later\nSELECT 1;')
    ).toThrow(/Invalid finalise-phase/iu);
  });

  it('applies new files, reuses exact ledger entries, and rejects checksum drift', () => {
    const repoRoot = makeTempRoot();
    const relativePath = 'supabase/migrations/20260606_ledger.sql';
    writeRepoFile(repoRoot, relativePath, '-- finalise-phase: predeploy\nSELECT 1;\n');
    const migration = loadFinaliseMigrationFiles(repoRoot, [relativePath])[0]!;
    const exactRow: FinaliseMigrationLedgerRow = {
      filename: relativePath,
      checksum_sha256: migration.checksumSha256,
      phase: migration.phase,
      applied_at: '2026-08-13T00:00:00.000Z',
    };

    expect(decideFinaliseMigrationLedgerAction(migration, null)).toBe('apply');
    expect(decideFinaliseMigrationLedgerAction(migration, exactRow)).toBe('reuse');
    expect(() =>
      decideFinaliseMigrationLedgerAction(migration, {
        ...exactRow,
        checksum_sha256: '0'.repeat(64),
      })
    ).toThrow(/checksum drift/iu);
    expect(() =>
      decideFinaliseMigrationLedgerAction(migration, {
        ...exactRow,
        phase: 'postdeploy',
      })
    ).toThrow(/phase drift/iu);
  });

  it('retains reused migrations as database-validation evidence after a failed run', () => {
    expect(
      getValidatedMigrationEvidencePaths({
        applied: [],
        reused: ['supabase/migrations/20260813_expand.sql'],
      })
    ).toEqual(['supabase/migrations/20260813_expand.sql']);
  });

  it('defines a protected private ledger with required immutable evidence', () => {
    expect(FINALISE_MIGRATION_LEDGER_SQL).toMatch(
      /CREATE SCHEMA IF NOT EXISTS private/iu
    );
    expect(FINALISE_MIGRATION_LEDGER_SQL).toMatch(
      /REVOKE ALL ON TABLE private\.finalise_migration_ledger FROM PUBLIC/iu
    );
    for (const column of ['filename', 'checksum_sha256', 'phase', 'applied_at']) {
      expect(FINALISE_MIGRATION_LEDGER_SQL).toContain(column);
    }
  });

  it('removes a migration-owned outer transaction for atomic ledger wrapping', () => {
    const sql =
      '-- finalise-phase: predeploy\nBEGIN;\nCREATE TABLE example(id int);\nCOMMIT;\n';
    const stripped = stripOuterMigrationTransaction(sql);
    expect(stripped).not.toMatch(/\bBEGIN\s*;/iu);
    expect(stripped).not.toMatch(/\bCOMMIT\s*;/iu);
    expect(stripped).toContain('CREATE TABLE example');
  });

  it('reports only a non-secret Supabase project identity', () => {
    expect(getSafeDatabaseProjectRef(fakeMigrationUrl({ port: '5432' }))).toBe('projectref');
    expect(getSafeDatabaseTargetIdentity(fakeMigrationUrl({ port: '5432' }))).toBe(
      'Supabase project projectref'
    );
    expect(
      getSafeDatabaseTargetIdentity(
        fakeMigrationUrl({
          username: 'user',
          hostname: 'internal.example',
          database: 'db',
        })
      )
    ).toBeNull();
    expect(
      getSafeDatabaseProjectRef(
        fakeMigrationUrl({
          username: 'user',
          hostname: 'internal.example',
          database: 'db',
        })
      )
    ).toBeNull();
  });

  it('requires a non-transaction-pool migration connection', () => {
    const sessionPooler = fakeMigrationUrl({ port: '5432' });
    expect(requireSafeMigrationConnectionString(sessionPooler)).toBe(sessionPooler);
    expect(() => requireSafeMigrationConnectionString(undefined)).toThrow(
      /POSTGRES_URL_NON_POOLING/iu
    );
    expect(() =>
      requireSafeMigrationConnectionString(fakeMigrationUrl({ port: '6543' }))
    ).toThrow(/transaction mode/iu);
  });
});
