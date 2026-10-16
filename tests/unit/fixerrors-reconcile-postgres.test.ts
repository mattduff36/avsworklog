import net from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DB_HOST,
  DB_NAME,
  DB_USER,
  deriveCheckoutIdentity,
  formatLocalTestDatabaseUrl,
} from '@/scripts/local-test-postgres';
import {
  hashManifestBytes,
  parseFixedLiveManifest,
  reconcileFixedLiveExactIds,
} from '@/scripts/fixerrors-reconcile';

const ROW_A = '00000000-0000-4000-8000-0000000000a1';
const ROW_B = '00000000-0000-4000-8000-0000000000b2';
const COMMIT = 'b'.repeat(40);
const NOW = new Date('2026-10-16T00:00:00.000Z');

type Capability =
  | { status: 'available'; client: pg.Client }
  | { status: 'unavailable'; reason: string };

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolveOpen) => {
    const socket = net.connect({ host: DB_HOST, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveOpen(open);
    };
    socket.setTimeout(400);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function loadDisposablePostgres(): Promise<Capability> {
  const inherited = process.env.TEST_DATABASE_URL;
  if (inherited) {
    try {
      const host = new URL(inherited).hostname;
      if (host !== DB_HOST) {
        return { status: 'unavailable', reason: 'inherited database URL is not loopback; ignored' };
      }
    } catch {
      return { status: 'unavailable', reason: 'inherited database URL is not usable; ignored' };
    }
  }
  const identity = deriveCheckoutIdentity(resolve(process.cwd()));
  if (identity.hostPort === 5432) {
    return { status: 'unavailable', reason: 'derived port collided with 5432' };
  }
  const open = await portOpen(identity.hostPort);
  if (!open) {
    return {
      status: 'unavailable',
      reason: 'no disposable PostgreSQL is listening on the checkout loopback port',
    };
  }
  const client = new pg.Client({
    connectionString: formatLocalTestDatabaseUrl(identity.hostPort),
    ssl: false,
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    const identityResult = await client.query<{ db: string; usr: string; addr: string | null }>(
      'SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS addr'
    );
    const row = identityResult.rows[0];
    if (row?.db !== DB_NAME || row.usr !== DB_USER || row.addr?.split('/')[0] !== DB_HOST) {
      await client.end();
      return { status: 'unavailable', reason: 'loopback server identity did not match the disposable test database' };
    }
    const existing = await client.query<{ present: string | null }>(
      "SELECT to_regclass('public.error_logs')::text AS present"
    );
    if (existing.rows[0]?.present) {
      await client.end();
      return { status: 'unavailable', reason: 'refused existing public.error_logs on the disposable database' };
    }
    return { status: 'available', client };
  } catch {
    try {
      await client.end();
    } catch {
      // The failed probe must not surface connection details.
    }
    return { status: 'unavailable', reason: 'loopback connection failed' };
  }
}

function manifestContents(): string {
  return JSON.stringify({
    schemaVersion: 1,
    commandId: 'fixerrors-fixed-live',
    safetyContract: 'fixerrors-fixed-live-exact-id-v1',
    targetProjectRef: 'project-ref',
    deployedCommit: COMMIT,
    deploymentId: 'dpl_example_not_evidence',
    check: 'npm test usage-events-route passed',
    result: 'passed',
    verifiedAt: '2026-01-15T12:00:00.000Z',
    rows: [ROW_A, ROW_B].map((id) => ({
      id,
      expected: {
        status: 'active',
        triageState: 'outstanding',
        triageIncidentId: 'cluster-pg',
        triageSummary: 'Synthetic outstanding row',
        triageNextStep: 'Verify on disposable PostgreSQL.',
        triageLocalCommit: null,
      },
    })),
  });
}

describe('fixerrors fixed-live disposable PostgreSQL', () => {
  let capability: Capability = {
    status: 'unavailable',
    reason: 'capability probe has not run',
  };
  let createdTable = false;

  beforeAll(async () => {
    capability = await loadDisposablePostgres();
    if (process.env.TEST_DATABASE_URL && capability.status !== 'available') throw new Error(capability.reason);
    if (capability.status !== 'available') return;
    await capability.client.query(`
      CREATE TABLE public.error_logs (
        id uuid PRIMARY KEY,
        error_message text NOT NULL,
        status text NOT NULL,
        archived_at timestamptz,
        triage_state text,
        triaged_at timestamptz,
        triage_incident_id text,
        triage_summary text,
        triage_next_step text,
        triage_local_commit text,
        triage_live_verified_at timestamptz,
        triage_live_evidence jsonb
      )
    `);
    createdTable = true;
  }, 20_000);

  afterAll(async () => {
    if (capability.status !== 'available') return;
    if (createdTable) await capability.client.query('DROP TABLE IF EXISTS public.error_logs');
    await capability.client.end();
  });

  it('FXERR-FL-PG-000 records loopback capability without using production', () => {
    expect(DB_HOST).toBe('127.0.0.1');
    if (capability.status === 'unavailable') {
      expect(capability.reason.length).toBeGreaterThan(0);
      expect(capability.reason).not.toMatch(/postgres:\/\//u);
      return;
    }
    expect(capability.status).toBe('available');
  });

  it('FXERR-FL-PG-001 blocks on FOR UPDATE and commits only the exact outstanding rows', async (context) => {
    if (capability.status !== 'available') {
      context.skip();
      return;
    }
    const client = capability.client;
    await client.query(
      `
        INSERT INTO public.error_logs (
          id, error_message, status, triage_state, triage_incident_id, triage_summary, triage_next_step
        ) VALUES
          ($1::uuid, 'synthetic a', 'active', 'outstanding', 'cluster-pg', 'Synthetic outstanding row', 'Verify on disposable PostgreSQL.'),
          ($2::uuid, 'synthetic b', 'active', 'outstanding', 'cluster-pg', 'Synthetic outstanding row', 'Verify on disposable PostgreSQL.')
      `,
      [ROW_A, ROW_B]
    );
    const locker = new pg.Client({
      connectionString: formatLocalTestDatabaseUrl(deriveCheckoutIdentity(resolve(process.cwd())).hostPort),
      ssl: false,
    });
    await locker.connect();
    let release: (() => Promise<void>) | null = null;
    try {
      await locker.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await locker.query('SELECT id FROM public.error_logs WHERE id = $1::uuid FOR UPDATE', [ROW_A]);
      const contents = manifestContents();
      const pending = reconcileFixedLiveExactIds({
        client,
        manifest: parseFixedLiveManifest(contents, NOW),
        manifestHash: hashManifestBytes(contents),
        confirmed: true,
        writeArtifact: () => undefined,
      });
      const raced = await Promise.race([
        pending.then(() => 'finished' as const),
        new Promise<'blocked'>((resolveBlocked) => {
          setTimeout(() => resolveBlocked('blocked'), 800);
        }),
      ]);
      expect(raced).toBe('blocked');
      await locker.query('ROLLBACK');
      release = async () => {
        await locker.end();
      };
      const result = await pending;
      expect(result.transactionIsolation).toBe('serializable');
      expect(result.updatedIds).toEqual([ROW_A, ROW_B].sort());
      const remaining = await client.query<{ id: string; error_message: string; status: string; triage_state: string }>(
        `
          SELECT id::text AS id, error_message, status, triage_state
          FROM public.error_logs
          ORDER BY id
        `
      );
      expect(remaining.rows).toEqual([
        { id: ROW_A, error_message: 'synthetic a', status: 'archived', triage_state: 'fixed_live' },
        { id: ROW_B, error_message: 'synthetic b', status: 'archived', triage_state: 'fixed_live' },
      ]);
    } finally {
      if (release) await release();
      else {
        await locker.query('ROLLBACK').catch(() => undefined);
        await locker.end().catch(() => undefined);
      }
    }
  }, 20_000);

  it('FXERR-FL-PG-002 rolls back the exact set when one row drifted', async (context) => {
    if (capability.status !== 'available') {
      context.skip();
      return;
    }
    const client = capability.client;
    await client.query('TRUNCATE public.error_logs');
    await client.query(
      `
        INSERT INTO public.error_logs (
          id, error_message, status, triage_state, triage_incident_id, triage_summary, triage_next_step
        ) VALUES
          ($1::uuid, 'synthetic a', 'active', 'outstanding', 'cluster-pg', 'Synthetic outstanding row', 'Verify on disposable PostgreSQL.'),
          ($2::uuid, 'synthetic b', 'active', 'outstanding', 'other-incident', 'Synthetic outstanding row', 'Verify on disposable PostgreSQL.')
      `,
      [ROW_A, ROW_B]
    );
    const contents = manifestContents();
    await expect(
      reconcileFixedLiveExactIds({
        client,
        manifest: parseFixedLiveManifest(contents, NOW),
        manifestHash: hashManifestBytes(contents),
        confirmed: true,
        writeArtifact: () => undefined,
      })
    ).rejects.toThrow(/state drifted/u);
    const remaining = await client.query<{ id: string; status: string; triage_state: string; triage_incident_id: string }>(
      'SELECT id::text AS id, status, triage_state, triage_incident_id FROM public.error_logs ORDER BY id'
    );
    expect(remaining.rows).toEqual([
      { id: ROW_A, status: 'active', triage_state: 'outstanding', triage_incident_id: 'cluster-pg' },
      { id: ROW_B, status: 'active', triage_state: 'outstanding', triage_incident_id: 'other-incident' },
    ]);
  }, 20_000);
});
