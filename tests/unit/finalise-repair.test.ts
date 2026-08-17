import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getFinaliseFailurePath,
  writeFinaliseFailureArtifact,
} from '@/scripts/automation/finalise-failure';
import {
  getRepairSafetyEnvironmentEntries,
  readOrdinaryFinaliseCache,
} from '@/scripts/automation/finalise-checkpoint';
import {
  getWorkflowPaths,
  loadWorkflowReviewState,
} from '@/scripts/automation/workflow-events';

const roots: string[] = [];
const ENV_FINGERPRINT_TEST_KEY = 'FINALISE_REPAIR_TEST_SECRET';
const MEANINGFUL_TEST_ENV_KEY = 'TEST_DATABASE_URL';

function makeRepo(): string {
  const root = path.join(
    tmpdir(),
    `finalise-repair-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(path.join(root, 'app'), { recursive: true });
  const packageJson = {
    name: 'repair-fixture',
    private: true,
    scripts: {
      build:
        "node -e \"const fs=require('fs');fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/BUILD_ID','ok')\"",
    },
  };
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson), 'utf8');
  writeFileSync(path.join(root, 'package-lock.json'), '{}', 'utf8');
  writeFileSync(path.join(root, 'tsconfig.json'), '{}', 'utf8');
  writeFileSync(path.join(root, 'app', 'page.tsx'), 'export default null;', 'utf8');
  roots.push(root);
  return root;
}

function runRepair(repoRoot: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(process.cwd(), 'scripts', 'finalise-repair.ts'),
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
      shell: false,
    }
  );
}

afterEach(() => {
  delete process.env[ENV_FINGERPRINT_TEST_KEY];
  delete process.env[MEANINGFUL_TEST_ENV_KEY];
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('targeted finalise repair', () => {
  it('TEE-V2-REPAIR-001 reruns only the allowlisted failed step and records exact success', () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });
    writeFileSync(path.join(repoRoot, 'app', 'page.tsx'), 'export default 1;', 'utf8');

    const result = runRepair(repoRoot);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(path.join(repoRoot, '.next', 'BUILD_ID'))).toBe(true);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(false);
    expect(readOrdinaryFinaliseCache(repoRoot, 'finalise')?.steps.build?.status).toBe('passed');
  }, 15_000);

  it('loads declared environment values before checking the safety fingerprint', () => {
    const repoRoot = makeRepo();
    writeFileSync(
      path.join(repoRoot, '.env.local'),
      `${ENV_FINGERPRINT_TEST_KEY}=stable-value\n`,
      'utf8'
    );
    process.env[ENV_FINGERPRINT_TEST_KEY] = 'stable-value';
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });
    delete process.env[ENV_FINGERPRINT_TEST_KEY];

    const result = runRepair(repoRoot);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(path.join(repoRoot, '.next', 'BUILD_ID'))).toBe(true);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(false);
  }, 15_000);

  it('TEE-V2-REPAIR-002 ignores npm lifecycle and shell bookkeeping drift', () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'ffap',
      failedStep: 'build',
      command: 'npm run build',
    });

    const result = runRepair(repoRoot, {
      ...process.env,
      npm_lifecycle_event: 'finalise:repair',
      npm_lifecycle_script: 'tsx scripts/finalise-repair.ts',
      _: 'different-command',
      OLDPWD: path.join(repoRoot, 'different-directory'),
      SHLVL: '99',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(path.join(repoRoot, '.next', 'BUILD_ID'))).toBe(true);
  }, 15_000);

  it('preserves case-sensitive environment names on POSIX', () => {
    const upperCase = getRepairSafetyEnvironmentEntries(
      { TEST_DATABASE_URL: 'postgresql://test' },
      'linux'
    );
    const lowerCase = getRepairSafetyEnvironmentEntries(
      { test_database_url: 'postgresql://test' },
      'linux'
    );

    expect(upperCase).toEqual([['TEST_DATABASE_URL', 'postgresql://test']]);
    expect(lowerCase).toEqual([['test_database_url', 'postgresql://test']]);
    expect(lowerCase).not.toEqual(upperCase);
  });

  it('TEE-V2-REPAIR-003 still refuses real toolchain changes', () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    ) as Record<string, unknown>;
    packageJson.changedAfterFailure = true;
    writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify(packageJson), 'utf8');

    const result = runRepair(repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/safety fingerprint changed/iu);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(true);
  }, 15_000);

  it('refuses task-specific test configuration changes', () => {
    const repoRoot = makeRepo();
    const workspacePath = path.join(repoRoot, 'vitest.workspace.ts');
    writeFileSync(workspacePath, 'export default [];\n', 'utf8');
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise-full',
      failedStep: 'test-run',
      command: 'npm run test:run',
    });
    writeFileSync(workspacePath, 'export default [{ test: { testTimeout: 1 } }];\n', 'utf8');

    const result = runRepair(repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/safety fingerprint changed/iu);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(true);
  }, 15_000);

  it('refuses meaningful test environment changes', () => {
    const repoRoot = makeRepo();
    process.env[MEANINGFUL_TEST_ENV_KEY] = 'postgresql://original';
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise-full',
      failedStep: 'test-run',
      command: 'npm run test:run',
    });
    const changedEnvironment = { ...process.env };
    delete changedEnvironment[MEANINGFUL_TEST_ENV_KEY];

    const result = runRepair(repoRoot, changedEnvironment);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/safety fingerprint changed/iu);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(true);
  }, 15_000);

  it('refuses execution-relevant npm configuration changes', () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });

    const result = runRepair(repoRoot, {
      ...process.env,
      npm_config_script_shell: 'different-script-shell',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/safety fingerprint changed/iu);
    expect(existsSync(getFinaliseFailurePath(repoRoot))).toBe(true);
  }, 15_000);

  it('refuses database and stale failure artifacts', () => {
    const repoRoot = makeRepo();
    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'migrations',
      command: 'run-pending-migrations',
    });
    expect(runRepair(repoRoot).status).not.toBe(0);

    writeFinaliseFailureArtifact({
      repoRoot,
      originalMode: 'finalise',
      failedStep: 'build',
      command: 'npm run build',
    });
    const failurePath = getFinaliseFailurePath(repoRoot);
    const stale = JSON.parse(readFileSync(failurePath, 'utf8')) as { createdAt: string };
    stale.createdAt = '2020-01-01T00:00:00.000Z';
    writeFileSync(failurePath, JSON.stringify(stale), 'utf8');
    const staleResult = runRepair(repoRoot);
    expect(staleResult.status).not.toBe(0);
    expect(staleResult.stderr).toMatch(/stale/iu);
  }, 15_000);

  it('persists repeated repair-cycle history after successful targeted checks', () => {
    const repoRoot = makeRepo();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      writeFinaliseFailureArtifact({
        repoRoot,
        originalMode: 'finalise',
        failedStep: 'build',
        command: 'npm run build',
      });
      const result = runRepair(repoRoot);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    }
    const state = loadWorkflowReviewState(getWorkflowPaths(repoRoot).statePath);
    expect(state.pendingAnomalySignals?.[0]?.flags).toContain(
      'targeted-repair-cycle-exceeded'
    );
  }, 25_000);
});
