import 'server-only';
import { Client } from 'pg';
import { queueStateSchema } from '@/lib/fixerrors/protocol';
import { parseCapturedBatch } from '@/lib/fixerrors/batch';
import type { AuditEvent, QueueStore } from '@/lib/fixerrors/control';
import { getFixerrorsLocalDatabaseUrl, getFixerrorsProductionDatabaseSsl, getFixerrorsProductionDatabaseUrl } from './config';

export function createLocalFixerrorsDbClient(): Client {
  const url = new URL(getFixerrorsLocalDatabaseUrl());
  return new Client({
    host: url.hostname.replace(/^\[|\]$/gu, ''), port: Number(url.port || 5432),
    database: 'squires_fixerrors_local',
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: false, connectionTimeoutMillis: 3000, query_timeout: 5000,
    statement_timeout: 5000, application_name: 'squires-fixerrors-local',
  });
}

function createProductionFixerrorsDbClient(): Client {
  const url = getFixerrorsProductionDatabaseUrl();
  return new Client({
    host: url.hostname, port: 5432, database: 'postgres',
    user: url.username, password: decodeURIComponent(url.password),
    ssl: getFixerrorsProductionDatabaseSsl(), connectionTimeoutMillis: 3000, query_timeout: 5000,
    statement_timeout: 5000, application_name: 'squires-fixerrors-production',
  });
}

function queueStore(connect: () => Client, scope: 'local' | 'production'): QueueStore {
  const schema = scope === 'production' ? 'squires_fixerrors' : 'private';
  const stateTable = `${schema}.fixerrors_${scope}_state`;
  const auditTable = `${schema}.fixerrors_${scope}_audit`;
  return {
    async transact(work) {
      const client = connect();
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL synchronous_commit = 'on'");
        const row = await client.query<{ state: unknown }>(
          `SELECT state FROM ${stateTable} WHERE id = 1 FOR UPDATE`,
        );
        if (row.rows.length !== 1) throw new Error('Fixerrors queue schema is not provisioned');
        const state = queueStateSchema.parse(row.rows[0].state);
        for (const job of state.jobs) {
          if (job.privateBatch) job.privateBatch = parseCapturedBatch(job.privateBatch, job.id);
        }
        const events: AuditEvent[] = [];
        const result = work({ state, audit: (event) => events.push(event) });
        for (const job of state.jobs) {
          if (job.privateBatch) job.privateBatch = parseCapturedBatch(job.privateBatch, job.id);
        }
        await client.query(`UPDATE ${stateTable} SET state = $1::jsonb WHERE id = 1`, [
          JSON.stringify(queueStateSchema.parse(state)),
        ]);
        for (const event of events) {
          await client.query(
            `INSERT INTO ${auditTable} (at_ms, actor, event, job_id, device_id, candidate) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
            [event.at, event.actor, event.event, event.jobId, event.deviceId, JSON.stringify(event.preapproval
              ? { preapproval: event.preapproval } : event.candidate
                ? { ...event.candidate, ...(event.releaseMode ? { releaseMode: event.releaseMode } : {}) } : null)],
          );
        }
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.end();
      }
    },
  };
}

export const localFixerrorsStore = queueStore(createLocalFixerrorsDbClient, 'local');
export const productionFixerrorsStore = queueStore(createProductionFixerrorsDbClient, 'production');
