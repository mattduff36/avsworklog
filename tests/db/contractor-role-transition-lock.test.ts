import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripOuterMigrationTransaction } from '../../scripts/finalise-migrations';
import {
  DATABASE_COMMENT_PREFIX,
  PROJECT_NAME_HASH_LENGTH,
  PROJECT_NAME_PREFIX,
  PROVENANCE_ENV_KEYS,
  STATE_VERSION,
  isInheritedDatabaseUrlKey,
  validateLocalTestDatabaseUrl,
} from '../../scripts/local-test-postgres';
import {
  CONTRACTOR_TRANSITION_BASE_PATH,
  CONTRACTOR_TRANSITION_IDS as IDS,
  CONTRACTOR_TRANSITION_MIGRATION_PATH,
} from './contractor-role-transition-pglite-harness';

const describeConcurrency = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function requireRunnerProvenance(connectionString: string): void {
  const marker = process.env[PROVENANCE_ENV_KEYS.marker];
  const projectName = process.env[PROVENANCE_ENV_KEYS.project];
  const portText = process.env[PROVENANCE_ENV_KEYS.port];
  if (!marker || !projectName || !portText || !/^[0-9]+$/u.test(portText)) {
    throw new Error('LTDB-SAFE-001: disposable local PostgreSQL runner provenance is required');
  }
  const leakedDatabaseKeys = Object.keys(process.env).filter(
    (key) => key !== 'TEST_DATABASE_URL' && isInheritedDatabaseUrlKey(key)
  );
  if (leakedDatabaseKeys.length > 0) {
    throw new Error(`LTDB-NATIVE-ENV-001: inherited database variables: ${leakedDatabaseKeys.join(', ')}`);
  }

  const hostPort = Number.parseInt(portText, 10);
  validateLocalTestDatabaseUrl(connectionString, hostPort);
  const markerMatch = new RegExp(
    `^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`,
    'u'
  ).exec(marker);
  if (
    !markerMatch
    || projectName !== `${PROJECT_NAME_PREFIX}${markerMatch[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`
  ) {
    throw new Error('LTDB-SAFE-001: runner provenance is inconsistent');
  }
}

async function waitUntilBlockedBy(
  watcher: Client,
  blockedPid: number,
  blockerPid: number
): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const result = await watcher.query<{ blocked: boolean }>(
      'SELECT $1::int = ANY (pg_blocking_pids($2::int)) AS blocked',
      [blockerPid, blockedPid]
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Expected pid ${blockedPid} to be blocked by ${blockerPid}`);
}

describeConcurrency('Contractor transition disposable PostgreSQL locking', () => {
  const connectionString = process.env.TEST_DATABASE_URL || '';
  const clients: Client[] = [];
  let setup: Client;
  let transition: Client;
  let writer: Client;
  let transitionPid = 0;
  let writerPid = 0;

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString, ssl: false });
    await client.connect();
    clients.push(client);
    return client;
  }

  async function seedProfile(): Promise<{ profileId: string; absenceId: string }> {
    const profileId = randomUUID();
    const absenceId = randomUUID();
    const futureDate = new Date();
    futureDate.setUTCDate(futureDate.getUTCDate() + 30);
    await setup.query(
      `INSERT INTO public.profiles (
         id, role_id, full_name, annual_holiday_allowance_days
       ) VALUES ($1, $2, 'Lock Test User', 28)`,
      [profileId, IDS.employeeRole]
    );
    await setup.query(
      `INSERT INTO public.absences (
         id, profile_id, date, reason_id, status, is_bank_holiday, auto_generated
       ) VALUES ($1, $2, $3, $4, 'approved', true, true)`,
      [absenceId, profileId, futureDate.toISOString().slice(0, 10), IDS.annualLeave]
    );
    return { profileId, absenceId };
  }

  beforeAll(async () => {
    requireRunnerProvenance(connectionString);
    setup = await connect();
    transition = await connect();
    writer = await connect();

    await setup.query(readFileSync(resolve(process.cwd(), CONTRACTOR_TRANSITION_BASE_PATH), 'utf8'));
    await setup.query(
      `INSERT INTO public.roles (id, name, display_name)
       VALUES ($1, 'employee', 'Employee'), ($2, 'contractor', 'Contractor')`,
      [IDS.employeeRole, IDS.contractorRole]
    );
    await setup.query(
      `INSERT INTO public.absence_reasons (id, name)
       VALUES ($1, 'Annual Leave'), ($2, 'Unpaid Leave')`,
      [IDS.annualLeave, IDS.unpaidLeave]
    );
    await setup.query(
      stripOuterMigrationTransaction(
        readFileSync(resolve(process.cwd(), CONTRACTOR_TRANSITION_MIGRATION_PATH), 'utf8')
      )
    );
    await transition.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
    await transition.query(`SET lock_timeout = '8s'`);
    await transition.query(`SET statement_timeout = '10s'`);
    await writer.query(`SET lock_timeout = '8s'`);
    await writer.query(`SET statement_timeout = '10s'`);

    transitionPid = (
      await transition.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    ).rows[0]?.pid ?? 0;
    writerPid = (
      await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    ).rows[0]?.pid ?? 0;
  }, 60_000);

  afterAll(async () => {
    for (const client of clients) {
      await client.end().catch(() => undefined);
    }
  });

  it('serializes snapshot evidence in both transaction orders', async () => {
    const evidenceFirst = await seedProfile();
    await writer.query('BEGIN');
    await writer.query(
      `INSERT INTO public.timesheet_entry_leave_snapshots (absence_id) VALUES ($1)`,
      [evidenceFirst.absenceId]
    );

    const blockedTransition = transition.query(
      `SELECT public.transition_profile_to_contractor($1, $2, $3)`,
      [evidenceFirst.profileId, IDS.employeeRole, IDS.contractorRole]
    );
    await waitUntilBlockedBy(setup, transitionPid, writerPid);
    await writer.query('COMMIT');
    await expect(blockedTransition).rejects.toThrow(/timesheet evidence/);

    const transitionFirst = await seedProfile();
    await transition.query('BEGIN');
    await transition.query(
      `SELECT public.transition_profile_to_contractor($1, $2, $3)`,
      [transitionFirst.profileId, IDS.employeeRole, IDS.contractorRole]
    );

    const blockedSnapshot = writer.query(
      `INSERT INTO public.timesheet_entry_leave_snapshots (absence_id) VALUES ($1)`,
      [transitionFirst.absenceId]
    );
    await waitUntilBlockedBy(setup, writerPid, transitionPid);
    await transition.query('COMMIT');
    await expect(blockedSnapshot).rejects.toThrow(/missing absence/);

    const finalState = await setup.query<{ role_id: string; absence_count: number; snapshot_count: number }>(
      `SELECT
         p.role_id::text,
         (SELECT COUNT(*)::int FROM public.absences a WHERE a.profile_id = p.id) AS absence_count,
         (SELECT COUNT(*)::int FROM public.timesheet_entry_leave_snapshots s
           WHERE s.absence_id = $2) AS snapshot_count
       FROM public.profiles p
       WHERE p.id = $1`,
      [transitionFirst.profileId, transitionFirst.absenceId]
    );
    expect(finalState.rows[0]).toEqual({
      role_id: IDS.contractorRole,
      absence_count: 0,
      snapshot_count: 0,
    });
  }, 45_000);
});
