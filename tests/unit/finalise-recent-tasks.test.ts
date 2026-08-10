import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkippableFinaliseTasks } from '@/scripts/finalise-recent-tasks';
import {
  canReuseOrdinaryFinaliseStep,
  getOrdinaryFinaliseCachePath,
  markOrdinaryFinaliseStep,
} from '@/scripts/automation/finalise-checkpoint';
import type { AutomationRunLog, AutomationStepLog } from '@/scripts/automation/types';

const NOW = new Date('2026-05-28T12:00:00.000Z');
const COMPLETED_AT = new Date('2026-05-28T11:55:00.000Z');
const STARTED_AT = new Date('2026-05-28T11:54:00.000Z');

let tempRoots: string[] = [];
let environmentSnapshot: NodeJS.ProcessEnv | null = null;

function useControlledFinaliseEnvironment(): void {
  environmentSnapshot = { ...process.env };
  const preserved = Object.entries(process.env).filter(([key]) => {
    const normalized = key.toUpperCase();
    return (
      [
        'COMSPEC',
        'HOME',
        'PATH',
        'PATHEXT',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'TMPDIR',
        'USERPROFILE',
      ].includes(normalized) || normalized.startsWith('VITEST')
    );
  });
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, Object.fromEntries(preserved), { NODE_ENV: 'test' });
}

function createTempRoot(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'finalise-recent-tasks-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeRepoFile(repoRoot: string, relativePath: string, mtime: Date): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, 'test', 'utf8');
  utimesSync(absolutePath, mtime, mtime);
}

function writeSuccessfulTerminalCommand(terminalDirectory: string, command: string): void {
  mkdirSync(terminalDirectory, { recursive: true });
  writeFileSync(path.join(terminalDirectory, '1.txt'), [
    '---',
    `last_command: ${command}`,
    'last_exit_code: 0',
    `started_at: ${STARTED_AT.toISOString()}`,
    '---',
    'command output',
    '---',
    'exit_code: 0',
    'elapsed_ms: 60000',
    '---',
  ].join('\n'), 'utf8');
}

function writeBuildArtifact(repoRoot: string): string {
  const buildArtifactPath = path.join(repoRoot, '.next', 'BUILD_ID');
  mkdirSync(path.dirname(buildArtifactPath), { recursive: true });
  writeFileSync(buildArtifactPath, 'build-id', 'utf8');
  return buildArtifactPath;
}

function initializeGitRepo(repoRoot: string): void {
  spawnSync('git', ['init'], { cwd: repoRoot, encoding: 'utf8' });
  spawnSync('git', ['add', '.'], { cwd: repoRoot, encoding: 'utf8' });
  spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
}

function createAutomationLog(
  steps: AutomationStepLog[],
  status: AutomationRunLog['status'] = 'passed'
): AutomationRunLog {
  return {
    id: 'run-1',
    scriptName: 'finalise',
    mode: 'standard',
    args: [],
    startedAt: STARTED_AT.toISOString(),
    endedAt: COMPLETED_AT.toISOString(),
    durationMs: 60_000,
    status,
    metadata: {
      branch: 'feature/test',
      commit: 'abc123',
      dirtyFileCount: 1,
      nodeVersion: 'v20.0.0',
      npmVersion: '10.0.0',
      platform: 'win32',
    },
    expectedArtifacts: [],
    artifacts: [],
    steps,
  };
}

afterEach(() => {
  if (environmentSnapshot) {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, environmentSnapshot);
    environmentSnapshot = null;
  }
  for (const tempRoot of tempRoots) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  tempRoots = [];
});

describe('finalise recent task detection', () => {
  it('marks a recent successful build as skippable when changed files are older', () => {
    const repoRoot = createTempRoot();
    const terminalDirectory = path.join(repoRoot, 'terminals');
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() - 10_000));
    writeSuccessfulTerminalCommand(terminalDirectory, 'npm run build');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory,
      automationRunDirectory: path.join(repoRoot, 'automation-runs'),
      buildArtifactPath,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build?.command).toBe('npm run build');
  });

  it('does not skip a build when a changed file is newer than the prior build', () => {
    const repoRoot = createTempRoot();
    const terminalDirectory = path.join(repoRoot, 'terminals');
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() + 10_000));
    writeSuccessfulTerminalCommand(terminalDirectory, 'npm run build');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory,
      automationRunDirectory: path.join(repoRoot, 'automation-runs'),
      buildArtifactPath,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build).toBeUndefined();
  });

  it('does not skip a build when the Next build artifact is missing', () => {
    const repoRoot = createTempRoot();
    const terminalDirectory = path.join(repoRoot, 'terminals');
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() - 10_000));
    writeSuccessfulTerminalCommand(terminalDirectory, 'npm run build');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory,
      automationRunDirectory: path.join(repoRoot, 'automation-runs'),
      buildArtifactPath: path.join(repoRoot, '.next', 'BUILD_ID'),
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build).toBeUndefined();
  });

  it('does not treat related npm scripts as equivalent finalise tasks', () => {
    const repoRoot = createTempRoot();
    const terminalDirectory = path.join(repoRoot, 'terminals');
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() - 10_000));
    writeSuccessfulTerminalCommand(terminalDirectory, 'npm run build:analyze');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory,
      automationRunDirectory: path.join(repoRoot, 'automation-runs'),
      buildArtifactPath,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build).toBeUndefined();
  });

  it('marks a recently logged clean production build as skippable', () => {
    const repoRoot = createTempRoot();
    const automationRunDirectory = path.join(repoRoot, 'automation-runs');
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    writeRepoFile(repoRoot, 'app/page.tsx', new Date(COMPLETED_AT.getTime() - 10_000));
    mkdirSync(automationRunDirectory, { recursive: true });
    const log = createAutomationLog([{
      name: 'Run clean production build',
      status: 'passed',
      startedAt: STARTED_AT.toISOString(),
      endedAt: COMPLETED_AT.toISOString(),
      durationMs: 60_000,
    }]);
    writeFileSync(path.join(automationRunDirectory, 'run-1.json'), JSON.stringify(log), 'utf8');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: ['app/page.tsx'],
      terminalDirectory: path.join(repoRoot, 'terminals'),
      automationRunDirectory,
      buildArtifactPath,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.build?.source).toBe('automation-log');
  });

  it('marks recently logged pending migrations as skippable only when all pending files match', () => {
    const repoRoot = createTempRoot();
    const automationRunDirectory = path.join(repoRoot, 'automation-runs');
    const migrationFile = 'supabase/migrations/20260528_example.sql';
    writeRepoFile(repoRoot, migrationFile, new Date(COMPLETED_AT.getTime() - 10_000));
    mkdirSync(automationRunDirectory, { recursive: true });
    const log = createAutomationLog([{
        name: 'Run pending local migrations',
        status: 'passed',
        startedAt: STARTED_AT.toISOString(),
        endedAt: COMPLETED_AT.toISOString(),
        durationMs: 60_000,
        metadata: { migrationFiles: [migrationFile] },
    }]);
    writeFileSync(path.join(automationRunDirectory, 'run-1.json'), JSON.stringify(log), 'utf8');

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      changedFiles: [migrationFile],
      pendingMigrationFiles: [migrationFile],
      terminalDirectory: path.join(repoRoot, 'terminals'),
      automationRunDirectory,
      now: NOW,
      allowLegacyMtimeFallback: true,
    });

    expect(tasks.migrations?.source).toBe('automation-log');
  });

  it('TEE-V2-FINALISE-REUSE-001 reuses exact passed evidence independent of age', () => {
    useControlledFinaliseEnvironment();
    const repoRoot = createTempRoot();
    writeRepoFile(repoRoot, 'package.json', NOW);
    writeRepoFile(repoRoot, 'package-lock.json', NOW);
    writeRepoFile(repoRoot, 'tsconfig.json', NOW);
    writeRepoFile(repoRoot, 'next.config.ts', NOW);
    writeRepoFile(repoRoot, 'app/page.tsx', NOW);
    writeRepoFile(repoRoot, '.gitignore', NOW);
    initializeGitRepo(repoRoot);
    const buildArtifactPath = writeBuildArtifact(repoRoot);

    markOrdinaryFinaliseStep({
      repoRoot,
      mode: 'finalise',
      task: 'build',
      status: 'passed',
      command: 'npm run build',
      exitCode: 0,
      artifactPaths: [buildArtifactPath],
    });

    const tasks = getSkippableFinaliseTasks({
      repoRoot,
      mode: 'finalise',
      changedFiles: [],
      buildArtifactPath,
      now: new Date('2036-01-01T00:00:00.000Z'),
    });
    expect(tasks.build?.source).toBe('exact-cache');
  });

  it('TEE-V2-FINALISE-INVALIDATE-001 invalidates relevant source/config but not docs', () => {
    useControlledFinaliseEnvironment();
    const repoRoot = createTempRoot();
    for (const file of [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'next.config.ts',
      'app/page.tsx',
      '.gitignore',
    ]) {
      writeRepoFile(repoRoot, file, NOW);
    }
    initializeGitRepo(repoRoot);
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    markOrdinaryFinaliseStep({
      repoRoot,
      mode: 'finalise',
      task: 'build',
      status: 'passed',
      command: 'npm run build',
      artifactPaths: [buildArtifactPath],
    });

    writeRepoFile(repoRoot, 'docs/note.md', NOW);
    expect(
      getSkippableFinaliseTasks({
        repoRoot,
        mode: 'finalise',
        changedFiles: ['docs/note.md'],
        buildArtifactPath,
      }).build
    ).toBeTruthy();

    writeFileSync(path.join(repoRoot, 'app/page.tsx'), 'changed', 'utf8');
    expect(
      getSkippableFinaliseTasks({
        repoRoot,
        mode: 'finalise',
        changedFiles: ['app/page.tsx'],
        buildArtifactPath,
      }).build
    ).toBeUndefined();
  });

  it('invalidates test reuse for Cursor policy and public environment changes', () => {
    useControlledFinaliseEnvironment();
    const repoRoot = createTempRoot();
    writeRepoFile(repoRoot, 'package.json', NOW);
    writeRepoFile(repoRoot, 'package-lock.json', NOW);
    initializeGitRepo(repoRoot);
    markOrdinaryFinaliseStep({
      repoRoot,
      mode: 'finalise',
      task: 'test-run',
      status: 'passed',
      command: 'npm run test:run',
    });
    writeRepoFile(repoRoot, '.cursor/commands/finalise.md', NOW);
    expect(
      getSkippableFinaliseTasks({
        repoRoot,
        mode: 'finalise',
        changedFiles: ['.cursor/commands/finalise.md'],
      })['test-run']
    ).toBeUndefined();

    const envKey = 'NEXT_PUBLIC_TEE_CACHE_TEST';
    const previous = process.env[envKey];
    try {
      process.env[envKey] = 'before';
      markOrdinaryFinaliseStep({
        repoRoot,
        mode: 'finalise',
        task: 'test-run',
        status: 'passed',
        command: 'npm run test:run',
      });
      process.env[envKey] = 'after';
      expect(
        getSkippableFinaliseTasks({
          repoRoot,
          mode: 'finalise',
          changedFiles: ['.cursor/commands/finalise.md'],
        })['test-run']
      ).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env[envKey];
      else process.env[envKey] = previous;
    }
  });

  it('TEE2-CACHE-002 disables reuse for an unknown private application environment key', () => {
    useControlledFinaliseEnvironment();
    const repoRoot = createTempRoot();
    writeRepoFile(repoRoot, 'package.json', NOW);
    writeRepoFile(repoRoot, 'package-lock.json', NOW);
    writeRepoFile(repoRoot, '.gitignore', NOW);
    writeFileSync(path.join(repoRoot, '.gitignore'), '.env.local\n', 'utf8');
    const initialEnvLocal =
      'KNOWN_PRIVATE_CACHE_TEST=\nUNEXPORTED_PRIVATE_CACHE_TEST=before\n';
    writeFileSync(path.join(repoRoot, '.env.local'), initialEnvLocal, 'utf8');
    initializeGitRepo(repoRoot);
    process.env.NEXT_PUBLIC_TEE_CACHE_TEST = 'public-value';
    process.env.NODE_OPTIONS = '--no-warnings';
    process.env.NPM_CONFIG_TEE_CACHE_TEST = 'ambient-value';
    process.env.KNOWN_PRIVATE_CACHE_TEST = 'private-value';
    markOrdinaryFinaliseStep({
      repoRoot,
      mode: 'finalise',
      task: 'test-run',
      status: 'passed',
      command: 'npm run test:run',
    });

    const reuseResult = () =>
      canReuseOrdinaryFinaliseStep({
        repoRoot,
        mode: 'finalise',
        task: 'test-run',
        command: 'npm run test:run',
      });

    expect(reuseResult()).toMatchObject({ reusable: true, reason: 'exact-match' });

    const persistedCache = readFileSync(
      getOrdinaryFinaliseCachePath(repoRoot, 'finalise'),
      'utf8'
    );
    for (const rawValue of ['public-value', 'private-value', 'ambient-value']) {
      expect(persistedCache).not.toContain(rawValue);
    }

    process.env.NEXT_PUBLIC_TEE_CACHE_TEST = 'changed';
    expect(reuseResult()).toMatchObject({
      reusable: false,
      reason: 'input-fingerprint-mismatch',
    });
    process.env.NEXT_PUBLIC_TEE_CACHE_TEST = 'public-value';

    process.env.NODE_OPTIONS = '--trace-warnings';
    expect(reuseResult()).toMatchObject({
      reusable: false,
      reason: 'input-fingerprint-mismatch',
    });
    process.env.NODE_OPTIONS = '--no-warnings';

    process.env.KNOWN_PRIVATE_CACHE_TEST = 'changed-private-value';
    expect(reuseResult()).toMatchObject({
      reusable: false,
      reason: 'input-fingerprint-mismatch',
    });
    process.env.KNOWN_PRIVATE_CACHE_TEST = 'private-value';

    process.env.NPM_CONFIG_TEE_CACHE_TEST = 'changed-ambient-value';
    expect(reuseResult()).toMatchObject({
      reusable: false,
      reason: 'input-fingerprint-mismatch',
    });
    process.env.NPM_CONFIG_TEE_CACHE_TEST = 'ambient-value';

    writeFileSync(
      path.join(repoRoot, '.env.local'),
      'KNOWN_PRIVATE_CACHE_TEST=\nUNEXPORTED_PRIVATE_CACHE_TEST=after\n',
      'utf8'
    );
    expect(reuseResult()).toMatchObject({
      reusable: false,
      reason: 'input-fingerprint-mismatch',
    });
    writeFileSync(path.join(repoRoot, '.env.local'), initialEnvLocal, 'utf8');

    const expectEnvironmentUnsupported = (key: string, value: string): void => {
      const previous = process.env[key];
      try {
        process.env[key] = value;
        expect(reuseResult()).toEqual({
          reusable: false,
          reason: 'ordinary-reuse-environment-unsupported',
        });
      } finally {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
      expect(reuseResult()).toMatchObject({ reusable: true, reason: 'exact-match' });
    };
    expectEnvironmentUnsupported('CI', 'true');
    expectEnvironmentUnsupported('VERCEL', '1');
    expectEnvironmentUnsupported('NODE_ENV', 'production');

    process.env.PRIVATE_APPLICATION_CACHE_TEST = 'not-persisted';
    expect(reuseResult()).toEqual({
      reusable: false,
      reason: 'ordinary-reuse-environment-unsupported',
    });
  });

  it('TEE-V2-FINALISE-STALE-001 rejects failed and corrupt exact evidence', () => {
    useControlledFinaliseEnvironment();
    const repoRoot = createTempRoot();
    writeRepoFile(repoRoot, 'package.json', NOW);
    writeRepoFile(repoRoot, 'package-lock.json', NOW);
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    markOrdinaryFinaliseStep({
      repoRoot,
      mode: 'finalise',
      task: 'build',
      status: 'failed',
      command: 'npm run build',
      artifactPaths: [buildArtifactPath],
    });
    expect(
      getSkippableFinaliseTasks({
        repoRoot,
        mode: 'finalise',
        changedFiles: [],
        buildArtifactPath,
      }).build
    ).toBeUndefined();

    writeFileSync(getOrdinaryFinaliseCachePath(repoRoot, 'finalise'), '{', 'utf8');
    expect(
      getSkippableFinaliseTasks({
        repoRoot,
        mode: 'finalise',
        changedFiles: [],
        buildArtifactPath,
      }).build
    ).toBeUndefined();
  });

  it('TEE-V2-ROLLBACK-001 disables reuse cleanly when the exact cache is removed', () => {
    useControlledFinaliseEnvironment();
    const repoRoot = createTempRoot();
    writeRepoFile(repoRoot, 'package.json', NOW);
    writeRepoFile(repoRoot, 'package-lock.json', NOW);
    const buildArtifactPath = writeBuildArtifact(repoRoot);
    markOrdinaryFinaliseStep({
      repoRoot,
      mode: 'finalise',
      task: 'build',
      status: 'passed',
      command: 'npm run build',
      artifactPaths: [buildArtifactPath],
    });
    expect(
      getSkippableFinaliseTasks({
        repoRoot,
        mode: 'finalise',
        changedFiles: [],
        buildArtifactPath,
      }).build
    ).toBeDefined();

    rmSync(getOrdinaryFinaliseCachePath(repoRoot, 'finalise'));
    expect(
      getSkippableFinaliseTasks({
        repoRoot,
        mode: 'finalise',
        changedFiles: [],
        buildArtifactPath,
      }).build
    ).toBeUndefined();
  });
});
