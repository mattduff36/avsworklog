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
  validateLocalTestDatabaseUrl,
} from '../../scripts/local-test-postgres';
import {
  DELETE_USER_LEAVE_IDS as IDS,
  DELETE_USER_LEAVE_MIGRATION_PATH,
  DELETE_USER_LEAVE_PGLITE_BASE_PATH,
} from './delete-user-annual-leave-pglite-harness';

const describeConcurrency = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function currentFinancialYearStartYear(now = new Date()): number {
  return now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() < 6)
    ? now.getFullYear() - 1
    : now.getFullYear();
}

function openYearDate(): string {
  return `${currentFinancialYearStartYear()}-06-01`;
}

async function waitUntilBlockedBy(
  watcher: Client,
  blockedPid: number,
  blockerPid: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const result = await watcher.query<{ blocked: boolean }>(
      'SELECT $1::int = ANY (pg_blocking_pids($2::int)) AS blocked',
      [blockerPid, blockedPid]
    );
    if (result.rows[0]?.blocked) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  const activity = await watcher.query<{
    pid: number;
    state: string | null;
    wait_event_type: string | null;
    wait_event: string | null;
    query: string | null;
  }>(
    `SELECT pid, state, wait_event_type, wait_event, left(query, 160) AS query
     FROM pg_stat_activity
     WHERE pid = ANY($1::int[])`,
    [[blockedPid, blockerPid]]
  );
  throw new Error(
    `${label}: pid ${blockedPid} was not blocked by ${blockerPid}. activity=${JSON.stringify(activity.rows)}`
  );
}

describeConcurrency('delete-user annual leave disposable PostgreSQL lock', () => {
  const connectionString = process.env.TEST_DATABASE_URL || '';
  const clients: Client[] = [];
  let setupClient: Client;
  let writerClient: Client;
  let tombstoneClient: Client;
  let setupPid = 0;
  let writerPid = 0;
  let tombstonePid = 0;

  function requireRunnerProvenance(): { hostPort: number } {
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    const projectName = process.env[PROVENANCE_ENV_KEYS.project];
    const portText = process.env[PROVENANCE_ENV_KEYS.port];
    if (!marker || !projectName || !portText || !/^[0-9]+$/u.test(portText)) {
      throw new Error('LTDB-SAFE-001: disposable local PostgreSQL runner provenance is required');
    }

    const hostPort = Number.parseInt(portText, 10);
    validateLocalTestDatabaseUrl(connectionString, hostPort);

    const markerPattern = new RegExp(
      `^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`,
      'u'
    );
    const markerMatch = markerPattern.exec(marker);
    if (
      !markerMatch ||
      projectName !== `${PROJECT_NAME_PREFIX}${markerMatch[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`
    ) {
      throw new Error('LTDB-SAFE-001: runner project and database marker provenance disagree');
    }

    return { hostPort };
  }

  async function connectClient(): Promise<Client> {
    const client = new Client({ connectionString, ssl: false });
    await client.connect();
    clients.push(client);
    return client;
  }

  async function setAuthRole(client: Client, role: string): Promise<void> {
    await client.query(`SELECT set_config('request.jwt.claim.role', $1, false)`, [role]);
  }

  async function seedProfile(fullName: string): Promise<string> {
    const profileId = randomUUID();
    await setupClient.query(
      `INSERT INTO public.profiles (id, full_name, deleted_at, created_at, updated_at)
       VALUES ($1, $2, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [profileId, fullName]
    );
    return profileId;
  }

  beforeAll(async () => {
    requireRunnerProvenance();
    setupClient = await connectClient();
    writerClient = await connectClient();
    tombstoneClient = await connectClient();

    await setupClient.query(readFileSync(resolve(process.cwd(), DELETE_USER_LEAVE_PGLITE_BASE_PATH), 'utf8'));
    await setupClient.query(
      stripOuterMigrationTransaction(
        readFileSync(resolve(process.cwd(), DELETE_USER_LEAVE_MIGRATION_PATH), 'utf8')
      )
    );
    await setupClient.query(`INSERT INTO public.absence_reasons (id, name) VALUES ($1, 'Annual Leave'), ($2, 'Unpaid leave')`, [
      IDS.annualLeave,
      IDS.unpaidLeave,
    ]);

    await setAuthRole(setupClient, 'service_role');
    await setAuthRole(writerClient, 'authenticated');
    await setAuthRole(tombstoneClient, 'service_role');

    for (const client of [writerClient, tombstoneClient]) {
      await client.query(`SET lock_timeout = '8s'`);
      await client.query(`SET statement_timeout = '10s'`);
    }

    const pids = await Promise.all(
      [setupClient, writerClient, tombstoneClient].map((client) =>
        client.query<{ backend_pid: number }>('SELECT pg_backend_pid() AS backend_pid')
      )
    );
    setupPid = pids[0]?.rows[0]?.backend_pid ?? 0;
    writerPid = pids[1]?.rows[0]?.backend_pid ?? 0;
    tombstonePid = pids[2]?.rows[0]?.backend_pid ?? 0;
  }, 60_000);

  afterAll(async () => {
    for (const client of clients) {
      await client.end().catch(() => undefined);
    }
  });

  it('DEL-AL-08: FOR SHARE conflicts with tombstone; in-flight open-year annual leave cannot survive cleanup', async () => {
    expect([setupPid, writerPid, tombstonePid].every((pid) => Number.isInteger(pid) && pid > 0)).toBe(true);
    expect(new Set([setupPid, writerPid, tombstonePid]).size).toBe(3);

    const openDate = openYearDate();

    const writerFirstId = await seedProfile('Lock Writer First');
    await setupClient.query(
      `INSERT INTO public.absences (id, profile_id, date, reason_id, status)
       VALUES ($1, $2, $3, $4, 'approved')`,
      [randomUUID(), writerFirstId, openDate, IDS.unpaidLeave]
    );

    await writerClient.query('BEGIN');
    await writerClient.query(
      `INSERT INTO public.absences (id, profile_id, date, reason_id, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [randomUUID(), writerFirstId, openDate, IDS.annualLeave]
    );

    const tombstoneAfterWriter = tombstoneClient.query(
      `UPDATE public.profiles
          SET deleted_at = NOW(),
              full_name = full_name || ' (Deleted User)'
        WHERE id = $1`,
      [writerFirstId]
    );
    await waitUntilBlockedBy(
      setupClient,
      tombstonePid,
      writerPid,
      'writer-holds-share lock'
    );
    await writerClient.query('COMMIT');
    await tombstoneAfterWriter;
    const removedAfterWriter = await setupClient.query<{
      delete_profile_open_year_annual_leave_bookings: number;
    }>('SELECT public.delete_profile_open_year_annual_leave_bookings($1)', [writerFirstId]);
    expect(removedAfterWriter.rows[0]?.delete_profile_open_year_annual_leave_bookings).toBe(1);

    const leftoverAfterWriter = await setupClient.query<{ reason_id: string; count: number }>(
      `SELECT reason_id::text, COUNT(*)::int AS count
         FROM public.absences
        WHERE profile_id = $1
        GROUP BY reason_id
        ORDER BY reason_id`,
      [writerFirstId]
    );
    expect(leftoverAfterWriter.rows).toEqual([{ reason_id: IDS.unpaidLeave, count: 1 }]);

    const tombstoneFirstId = await seedProfile('Lock Tombstone First');
    await tombstoneClient.query('BEGIN');
    await tombstoneClient.query(
      `UPDATE public.profiles
          SET deleted_at = NOW(),
              full_name = full_name || ' (Deleted User)'
        WHERE id = $1`,
      [tombstoneFirstId]
    );
    const writerAfterTombstone = writerClient.query(
      `INSERT INTO public.absences (id, profile_id, date, reason_id, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [randomUUID(), tombstoneFirstId, openDate, IDS.annualLeave]
    );
    await waitUntilBlockedBy(
      setupClient,
      writerPid,
      tombstonePid,
      'tombstone-holds-update lock'
    );
    await tombstoneClient.query('COMMIT');
    await expect(writerAfterTombstone).rejects.toThrow(/deleted profile/);

    const leftoverAfterTombstone = await setupClient.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.absences WHERE profile_id = $1`,
      [tombstoneFirstId]
    );
    expect(leftoverAfterTombstone.rows[0]?.count).toBe(0);

    const reassignWriterFirstTarget = await seedProfile('Reassign Writer First Target');
    const reassignWriterFirstSource = await seedProfile('Reassign Writer First Source');
    const reassignWriterFirstAbsence = randomUUID();
    await setupClient.query(
      `INSERT INTO public.absences (id, profile_id, date, reason_id, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [reassignWriterFirstAbsence, reassignWriterFirstSource, openDate, IDS.annualLeave]
    );
    await writerClient.query('BEGIN');
    await writerClient.query(
      `UPDATE public.absences SET profile_id = $1 WHERE id = $2`,
      [reassignWriterFirstTarget, reassignWriterFirstAbsence]
    );
    const tombstoneAfterReassign = tombstoneClient.query(
      `UPDATE public.profiles
          SET deleted_at = NOW(),
              full_name = full_name || ' (Deleted User)'
        WHERE id = $1`,
      [reassignWriterFirstTarget]
    );
    await waitUntilBlockedBy(
      setupClient,
      tombstonePid,
      writerPid,
      'reassign-writer-holds-share lock'
    );
    await writerClient.query('COMMIT');
    await tombstoneAfterReassign;
    const removedAfterReassign = await setupClient.query<{
      delete_profile_open_year_annual_leave_bookings: number;
    }>('SELECT public.delete_profile_open_year_annual_leave_bookings($1)', [
      reassignWriterFirstTarget,
    ]);
    expect(removedAfterReassign.rows[0]?.delete_profile_open_year_annual_leave_bookings).toBe(1);
    const leftoverAfterReassign = await setupClient.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.absences WHERE id = $1`,
      [reassignWriterFirstAbsence]
    );
    expect(leftoverAfterReassign.rows[0]?.count).toBe(0);

    const reassignTombstoneFirstTarget = await seedProfile('Reassign Tombstone First Target');
    const reassignTombstoneFirstSource = await seedProfile('Reassign Tombstone First Source');
    const reassignTombstoneFirstAbsence = randomUUID();
    await setupClient.query(
      `INSERT INTO public.absences (id, profile_id, date, reason_id, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [reassignTombstoneFirstAbsence, reassignTombstoneFirstSource, openDate, IDS.annualLeave]
    );
    await tombstoneClient.query('BEGIN');
    await tombstoneClient.query(
      `UPDATE public.profiles
          SET deleted_at = NOW(),
              full_name = full_name || ' (Deleted User)'
        WHERE id = $1`,
      [reassignTombstoneFirstTarget]
    );
    const writerAfterReassignTombstone = writerClient.query(
      `UPDATE public.absences SET profile_id = $1 WHERE id = $2`,
      [reassignTombstoneFirstTarget, reassignTombstoneFirstAbsence]
    );
    await waitUntilBlockedBy(
      setupClient,
      writerPid,
      tombstonePid,
      'reassign-tombstone-holds-update lock'
    );
    await tombstoneClient.query('COMMIT');
    await expect(writerAfterReassignTombstone).rejects.toThrow(/deleted profile/);
    const leftoverAfterReassignTombstone = await setupClient.query<{
      profile_id: string;
      count: number;
    }>(
      `SELECT profile_id::text, COUNT(*)::int AS count
         FROM public.absences
        WHERE id = $1
        GROUP BY profile_id`,
      [reassignTombstoneFirstAbsence]
    );
    expect(leftoverAfterReassignTombstone.rows).toEqual([
      { profile_id: reassignTombstoneFirstSource, count: 1 },
    ]);
  }, 45_000);
});
