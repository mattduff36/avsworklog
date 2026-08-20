import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  DAILY_ALLOCATION_PROJECT_REF,
  DAILY_ALLOCATION_V2_GRANT_MIGRATION,
  REQUIRED_V2_PROCEDURES,
  REQUIRED_V2_RELATIONS,
  activateWithAutomaticDisable,
  requireDailyAllocationProductionTarget,
  snapshotsPreserveProtectedState,
  type RolloutSnapshot,
} from '../../scripts/manage-daily-allocation-v2-rollout';
import { fakePostgresUrl } from '@/tests/utils/fake-postgres-url';

const activationPath = resolve(
  process.cwd(),
  'scripts/supabase/activate-daily-allocation-v2.sql'
);
const disablePath = resolve(
  process.cwd(),
  'supabase/rollback/20260813_zzz_disable_daily_allocation_v2.sql'
);
const guidePath = resolve(
  process.cwd(),
  'docs/guides/DAILY_ALLOCATION_V2_ROLLOUT.md'
);
const packagePath = resolve(process.cwd(), 'package.json');
const operatorPath = resolve(
  process.cwd(),
  'scripts/manage-daily-allocation-v2-rollout.ts'
);
const grantMigrationPath = resolve(
  process.cwd(),
  DAILY_ALLOCATION_V2_GRANT_MIGRATION
);

function snapshot(
  boardEnabled: boolean,
  writesEnabled: boolean,
  overrides: Partial<RolloutSnapshot> = {}
): RolloutSnapshot {
  return {
    runtime: {
      boardEnabled,
      writesEnabled,
      updatedAt: '2026-08-14T15:00:00.000Z',
    },
    permissionFingerprint: 'permission-stable',
    v1Fingerprint: 'v1-stable',
    v2ContentFingerprint: 'v2-stable',
    v2Counts: {
      plan_days: 0,
      visits: 0,
    },
    ...overrides,
  };
}

describe('Daily Allocation v2 production rollout controls', () => {
  it('DA2A-ROLL-001 keeps disable runtime-only, locked, asserted, and idempotent', () => {
    const disable = readFileSync(disablePath, 'utf8').replace(/\r\n/gu, '\n');

    expect(disable).toContain('FOR UPDATE');
    expect(disable).toContain('board_enabled = FALSE');
    expect(disable).toContain('writes_enabled = FALSE');
    expect(disable).toContain('IS DISTINCT FROM FALSE');
    expect(disable).toContain('expected exactly one runtime singleton');
    expect(disable).toContain('failed to reach closed state');
    expect(disable).not.toMatch(
      /permission_modules|team_module_permissions|user_module_permissions|role_permissions/iu
    );
    expect(disable).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/iu);
  });

  it('DA2A-ACT-001 validates the complete object and procedure/grant contract', () => {
    const activation = readFileSync(activationPath, 'utf8').replace(/\r\n/gu, '\n');

    for (const relation of REQUIRED_V2_RELATIONS) {
      expect(activation).toContain(`'${relation}'`);
    }
    for (const procedure of REQUIRED_V2_PROCEDURES) {
      expect(activation).toContain(`'${procedure}'`);
    }

    expect(activation).toContain('private.require_daily_allocation_v2_writer()');
    expect(activation).toContain('prosecdef = TRUE');
    expect(activation).toContain("has_function_privilege('authenticated'");
    expect(activation).toContain("has_function_privilege('service_role'");
    expect(activation).toContain("has_function_privilege('anon'");
    expect(activation).toContain('has_table_privilege');
    expect(activation).toContain('has_any_column_privilege');
    expect(activation).toContain("relkind IN ('r', 'p')");
    expect(activation).toContain('relrowsecurity = TRUE');
    expect(activation).toContain('FOR UPDATE');
    expect(activation).toContain('board_enabled = TRUE');
    expect(activation).toContain('writes_enabled = TRUE');
    expect(activation).toContain('failed to reach enabled state');
  });

  it('DA2A-GRANT-001 applies a forward RPC-only table and column grant correction', () => {
    const migration = readFileSync(grantMigrationPath, 'utf8').replace(/\r\n/gu, '\n');

    expect(migration).toContain('-- finalise-phase: predeploy');
    for (const relation of REQUIRED_V2_RELATIONS) {
      expect(migration).toContain(`'${relation}'`);
    }
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
    expect(migration).toContain('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s)');
    expect(migration).toContain("has_table_privilege('authenticated'");
    expect(migration).toContain("has_any_column_privilege('authenticated'");
    expect(migration).toContain("has_any_column_privilege('anon'");
    expect(migration).toContain("'SELECT'");
    expect(migration).toContain('relrowsecurity = TRUE');
    expect(migration).not.toMatch(/\bGRANT\s+(INSERT|UPDATE|DELETE)\b/iu);
  });

  it('DA2A-PERM-001 detects permission, v1, and same-row-count v2 content drift', () => {
    const before = snapshot(false, false);
    expect(snapshotsPreserveProtectedState(before, snapshot(true, true))).toBe(true);
    expect(
      snapshotsPreserveProtectedState(
        before,
        snapshot(true, true, { permissionFingerprint: 'changed' })
      )
    ).toBe(false);
    expect(
      snapshotsPreserveProtectedState(
        before,
        snapshot(true, true, { v1Fingerprint: 'changed' })
      )
    ).toBe(false);
    expect(
      snapshotsPreserveProtectedState(
        before,
        snapshot(true, true, { v2ContentFingerprint: 'changed' })
      )
    ).toBe(false);
  });

  it('DA2A-AUTO-001 automatically disables and verifies state after smoke failure', async () => {
    let current = snapshot(false, false);
    const disable = vi.fn(async () => {
      current = snapshot(false, false);
    });

    await expect(
      activateWithAutomaticDisable({
        captureSnapshot: async () => current,
        executeActivation: async () => {
          current = snapshot(true, true);
        },
        executeDisable: disable,
        runSmokeChecks: async () => {
          throw new Error('induced smoke failure');
        },
        cancelSmoke: async () => undefined,
      }, 100)
    ).rejects.toThrow(/automatically disabled.*induced smoke failure/iu);

    expect(disable).toHaveBeenCalledOnce();
    expect(current.runtime).toMatchObject({
      boardEnabled: false,
      writesEnabled: false,
    });
  });

  it('DA2A-AUTO-001 automatically disables after a bounded smoke timeout', async () => {
    let current = snapshot(false, false);
    const disable = vi.fn(async () => {
      current = snapshot(false, false);
    });
    let rejectSmoke: ((error: Error) => void) | undefined;
    const cancelSmoke = vi.fn(async () => {
      rejectSmoke?.(new Error('smoke cancelled'));
    });

    await expect(
      activateWithAutomaticDisable({
        captureSnapshot: async () => current,
        executeActivation: async () => {
          current = snapshot(true, true);
        },
        executeDisable: disable,
        runSmokeChecks: () => new Promise<void>((_, reject) => {
          rejectSmoke = reject;
        }),
        cancelSmoke,
      }, 5)
    ).rejects.toThrow(/automatically disabled.*timed out/iu);

    expect(disable).toHaveBeenCalledOnce();
    expect(cancelSmoke).toHaveBeenCalledOnce();
  });

  it('returns enabled state only after successful smoke and unchanged fingerprints', async () => {
    let current = snapshot(false, false);
    const disable = vi.fn(async () => {
      current = snapshot(false, false);
    });

    const result = await activateWithAutomaticDisable({
      captureSnapshot: async () => current,
      executeActivation: async () => {
        current = snapshot(true, true);
      },
      executeDisable: disable,
      runSmokeChecks: async () => undefined,
      cancelSmoke: async () => undefined,
    }, 100);

    expect(result.runtime).toMatchObject({
      boardEnabled: true,
      writesEnabled: true,
    });
    expect(disable).not.toHaveBeenCalled();
  });

  it('fails closed unless the direct database target is the approved production project', () => {
    const approved = fakePostgresUrl({
      username: 'postgres',
      password: 'redacted-test-password',
      hostname: `db.${DAILY_ALLOCATION_PROJECT_REF}.supabase.co`,
      port: '5432',
    });
    expect(requireDailyAllocationProductionTarget(approved)).toBe(approved);
    const approvedSession = fakePostgresUrl({
      username: `postgres.${DAILY_ALLOCATION_PROJECT_REF}`,
      password: 'redacted-test-password',
      hostname: 'aws-0-eu-west-2.pooler.supabase.com',
      port: '5432',
    });
    expect(requireDailyAllocationProductionTarget(approvedSession)).toBe(approvedSession);

    expect(() =>
      requireDailyAllocationProductionTarget(
        fakePostgresUrl({
          username: 'postgres',
          password: 'redacted-test-password',
          hostname: 'db.wrongproject.supabase.co',
          port: '5432',
        })
      )
    ).toThrow(/expected Supabase project/iu);
    expect(() =>
      requireDailyAllocationProductionTarget(
        fakePostgresUrl({
          username: `postgres.${DAILY_ALLOCATION_PROJECT_REF}`,
          password: 'redacted-test-password',
          hostname: 'pooler.supabase.com',
          port: '6543',
        })
      )
    ).toThrow(/port 6543|port 5432/iu);
    expect(() =>
      requireDailyAllocationProductionTarget(
        fakePostgresUrl({
          username: `postgres.${DAILY_ALLOCATION_PROJECT_REF}`,
          password: 'redacted-test-password',
          hostname: 'attacker.example',
          port: '5432',
        })
      )
    ).toThrow(/expected Supabase project/iu);
    expect(() => requireDailyAllocationProductionTarget(undefined)).toThrow(
      /POSTGRES_URL_NON_POOLING/iu
    );
  });

  it('DA2A-CTRL-001 binds artifacts and handles lock, cancellation, and signals', () => {
    const operator = readFileSync(operatorPath, 'utf8');
    expect(operator).toContain('pg_try_advisory_lock');
    expect(operator).toContain('pg_cancel_backend');
    expect(operator).toContain("process.once('SIGINT'");
    expect(operator).toContain("process.once('SIGTERM'");
    expect(operator).toContain("'git',");
    expect(operator).toContain("'diff', '--quiet'");
    expect(operator).toContain('DAILY_ALLOCATION_ROLLOUT_ARTIFACTS');
  });

  it('DA2A-SIGNAL-001 prevents enable when a child process is signalled before activation', () => {
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve(
          process.cwd(),
          'tests/fixtures/daily-allocation-v2-signal-child.ts'
        ),
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
      }
    );
    expect(child.status, child.stderr).toBe(0);
    const evidenceLine = child.stdout
      .split(/\r?\n/u)
      .find((line) => line.startsWith('{'));
    expect(evidenceLine).toBeTruthy();
    const evidence = JSON.parse(evidenceLine || '{}') as {
      boardEnabled: boolean;
      writesEnabled: boolean;
      activationCalls: number;
      disableCalls: number;
      cancelCalls: number;
      exitCode: number;
    };
    expect(evidence).toMatchObject({
      boardEnabled: false,
      writesEnabled: false,
      activationCalls: 0,
      disableCalls: 1,
      cancelCalls: 1,
      exitCode: 143,
    });
  });

  it('wires explicit rollout commands and documents fail-closed operation', () => {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['daily-allocation:v2:status']).toContain(' status');
    expect(packageJson.scripts['daily-allocation:v2:preflight']).toContain(' preflight');
    expect(packageJson.scripts['daily-allocation:v2:activate']).toContain(' activate');
    expect(packageJson.scripts['daily-allocation:v2:disable']).toContain(' disable');

    const guide = readFileSync(guidePath, 'utf8');
    expect(guide).toContain('POSTGRES_URL_NON_POOLING');
    expect(guide).toContain('exact deployed SHA');
    expect(guide).toContain('existing permissions matrix');
    expect(guide).toContain('automatic disable');
    expect(guide).toContain('disable-and-forward-fix');
  });
});
