import { mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAdminCommand, fulfillPreapprovedDeploy, hash } from '@/lib/fixerrors/control';
import { actorId, candidate, credential, deviceId, harness, initialState, now, workspace } from './fixerrors-control-fixtures';
import { capturedBatch } from './fixerrors-batch-fixtures';
import { preapprovedFixture } from './fixerrors-preapproval-fixtures';

const adapter = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => {};
    end = async () => {};
    query = adapter.query;
  },
}));
import { localFixerrorsStore } from '@/lib/server/fixerrors/store';

let database: PGlite;
let directory: string;
const migration = readFileSync(path.resolve('scripts\\automation\\local-migrations\\20261109_fixerrors_control.sql'), 'utf8');
beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('SQUIRES_FIXERRORS_LOCAL_ENABLED', '1');
  vi.stubEnv('SQUIRES_FIXERRORS_LOCAL_DATABASE_URL', 'postgresql://fixture:fixture@127.0.0.1:15432/squires_fixerrors_local');
  directory = mkdtempSync(path.join(os.tmpdir(), 'squires-fixerrors-proof-'));
  database = new PGlite({ dataDir: directory, relaxedDurability: false });
  await database.exec('CREATE DATABASE squires_fixerrors_local');
  await database.close();
  database = new PGlite({ dataDir: directory, database: 'squires_fixerrors_local', relaxedDurability: false });
  await database.exec(migration);
  await database.query('UPDATE private.fixerrors_local_state SET state = $1::jsonb WHERE id = 1', [JSON.stringify(initialState())]);
  adapter.query.mockReset().mockImplementation((sql: string, params?: unknown[]) => database.query(sql, params));
});
afterEach(async () => {
  await database?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('private local queue persistence (PGlite adapter, not native concurrency proof)', () => {
  it('atomically consumes persisted authority once after restart, with rollback on a consumed-audit failure', async () => {
    const f = await preapprovedFixture();
    await f.ready();
    await database.query('UPDATE private.fixerrors_local_state SET state = $1::jsonb WHERE id = 1', [JSON.stringify(f.store.state)]);
    await database.close();
    database = new PGlite({ dataDir: directory, database: 'squires_fixerrors_local', relaxedDurability: false });
    adapter.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('INSERT INTO private.fixerrors_local_audit') && params?.[2] === 'deploy-preapproval-consumed') {
        throw new Error('Synthetic consumed audit failure');
      }
      return database.query(sql, params);
    });
    const fulfill = () => localFixerrorsStore.transact(tx => fulfillPreapprovedDeploy(tx, f.id, true, f.time()));
    await expect(fulfill()).rejects.toThrow('consumed audit failure');
    expect(await localFixerrorsStore.transact(tx => ({
      state: tx.state.jobs[0].autoDeployPreapproval?.state, count: tx.state.jobs.length,
    }))).toEqual({ state: 'pending', count: 1 });
    expect((await database.query('SELECT event FROM private.fixerrors_local_audit')).rows).toEqual([]);
    adapter.query.mockImplementation((sql: string, params?: unknown[]) => database.query(sql, params));
    await fulfill();
    await database.close();
    database = new PGlite({ dataDir: directory, database: 'squires_fixerrors_local', relaxedDurability: false });
    await fulfill();
    expect(await localFixerrorsStore.transact(tx => tx.state.jobs)).toHaveLength(2);
    expect((await database.query("SELECT event FROM private.fixerrors_local_audit WHERE event = 'deploy-preapproval-consumed'")).rows)
      .toHaveLength(1);
  });

  it('retains one-run authority and its audit across restart, rolling back both on an audit write failure', async () => {
    const id = randomUUID();
    await localFixerrorsStore.transact(tx => applyAdminCommand(tx, actorId, {
      op: 'enqueue', action: 'repair', deviceId, requestId: id, requestedReleaseMode: 'targeted', autoDeployConfirmation: true,
    }, now, { checkout: workspace, packet: null, batch: capturedBatch(id) }));
    await database.close();
    database = new PGlite({ dataDir: directory, database: 'squires_fixerrors_local', relaxedDurability: false });
    const grant = await localFixerrorsStore.transact(tx => tx.state.jobs[0].autoDeployPreapproval);
    expect(grant).toMatchObject({ state: 'pending', runId: id, actorId, releaseMode: 'targeted' });
    const audit = await database.query<{ candidate: unknown }>(
      "SELECT candidate FROM private.fixerrors_local_audit WHERE event = 'deploy-preapproval-granted'",
    );
    expect(audit.rows).toEqual([{ candidate: { preapproval: grant } }]);
    adapter.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('INSERT INTO private.fixerrors_local_audit')) throw new Error('Synthetic audit write failure');
      return database.query(sql, params);
    });
    await expect(localFixerrorsStore.transact(tx => applyAdminCommand(tx, actorId,
      { op: 'revoke-preapproval', jobId: id }, now + 1))).rejects.toThrow('audit write failure');
    adapter.query.mockImplementation((sql: string, params?: unknown[]) => database.query(sql, params));
    expect(await localFixerrorsStore.transact(tx => tx.state.jobs[0].autoDeployPreapproval)).toEqual(grant);
    await localFixerrorsStore.transact(tx => applyAdminCommand(tx, actorId,
      { op: 'revoke-preapproval', jobId: id }, now + 2));
    expect(await localFixerrorsStore.transact(tx => tx.state.jobs[0].autoDeployPreapproval?.state)).toBe('revoked');
    expect((await database.query("SELECT event FROM private.fixerrors_local_audit WHERE event = 'deploy-preapproval-revoked'")).rows)
      .toHaveLength(1);
  });

  it.each(['full', 'targeted'] as const)('persists %s approval mode, replay ids and credential revocation across clean restart', async (releaseMode) => {
    const h = harness(localFixerrorsStore);
    const id = await h.testedRepair();
    await h.approve(id, releaseMode);
    await h.admin({ op: 'revoke-device', deviceId });
    await database.close();
    database = new PGlite({ dataDir: directory, database: 'squires_fixerrors_local', relaxedDurability: false });
    const snapshot = await localFixerrorsStore.transact((tx) => tx.state);
    expect(snapshot.jobs).toHaveLength(2);
    expect(snapshot.jobs[1].approval?.releaseMode).toBe(releaseMode);
    expect(snapshot.devices[0]).toMatchObject({ revoked: true, credentialSha256: hash(credential) });
    await expect(h.enqueue('repair', id)).rejects.toThrow('Duplicate');
    const audit = await database.query<{ candidate: unknown }>(
      "SELECT candidate FROM private.fixerrors_local_audit WHERE event = 'exact-candidate-deploy-confirmed'",
    );
    expect(audit.rows).toEqual([{ candidate: { ...candidate, releaseMode } }]);
    expect(adapter.query).toHaveBeenCalledWith('SELECT state FROM private.fixerrors_local_state WHERE id = 1 FOR UPDATE');
  });

  it('rolls back state and audit together, and prevents audit changes or migration replay', async () => {
    await expect(localFixerrorsStore.transact((tx) => {
      tx.state.devices[0].revoked = true;
      tx.audit({ at: 1, actor: actorId, event: 'fixture', deviceId, jobId: null });
      throw new Error('fixture failure');
    })).rejects.toThrow('fixture failure');
    expect(await localFixerrorsStore.transact((tx) => tx.state.devices[0].revoked)).toBe(false);
    await database.query(
      "INSERT INTO private.fixerrors_local_audit(at_ms,actor,event,device_id,candidate) VALUES(1,$1,'fixture',$2,'null'::jsonb)", [actorId, deviceId],
    );
    await expect(database.exec('DELETE FROM private.fixerrors_local_audit')).rejects.toThrow('append-only');
    await expect(database.exec('TRUNCATE private.fixerrors_local_audit')).rejects.toThrow('append-only');
    await expect(database.exec(migration)).rejects.toThrow('already exists');
    await database.exec('ROLLBACK');
  });

  it('enables RLS without browser policies and keeps storage in the private schema', async () => {
    const result = await database.query<{ name: string; enabled: boolean; policies: number }>(`
      SELECT c.relname AS name, c.relrowsecurity AS enabled,
        (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relname IN ('fixerrors_local_state', 'fixerrors_local_audit')
      ORDER BY c.relname
    `);
    expect(result.rows).toEqual([
      { name: 'fixerrors_local_audit', enabled: true, policies: 0 },
      { name: 'fixerrors_local_state', enabled: true, policies: 0 },
    ]);
  });
});
