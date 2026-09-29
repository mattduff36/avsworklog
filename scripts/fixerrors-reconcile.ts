import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

export type ReconcileError = { id: string; error_message: string };
export type ReconcileCluster = {
  id: string;
  action: string;
  normalizedMessage: string;
};

export function proveOutstandingIds(input: {
  errors: ReconcileError[];
  clusters: ReconcileCluster[];
}): { ids: string[]; unverifiedClusterIds: string[] } {
  const ids: string[] = [];
  const claimed = new Set<string>();
  const unverifiedClusterIds: string[] = [];
  for (const cluster of input.clusters) {
    if (cluster.action !== 'fix' && cluster.action !== 'manual-investigation') continue;
    const needle = cluster.normalizedMessage.trim().slice(0, 80);
    if (needle.length < 12) {
      unverifiedClusterIds.push(cluster.id);
      continue;
    }
    const matches = input.errors.filter((error) => error.error_message.includes(needle));
    if (matches.length === 0 || matches.some((error) => claimed.has(error.id))) {
      unverifiedClusterIds.push(cluster.id);
      continue;
    }
    for (const match of matches) {
      claimed.add(match.id);
      ids.push(match.id);
    }
  }
  return { ids, unverifiedClusterIds };
}

function manifestChecksum(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const confirm = process.argv.find((arg) => arg.startsWith('--confirm-target='))?.slice('--confirm-target='.length);
  const snapshot = JSON.parse(readFileSync('docs_private/error-snapshot.json', 'utf8')) as {
    errors?: ReconcileError[];
  };
  const retrieval = JSON.parse(readFileSync('docs_private/error-analysis-retrieval.json', 'utf8')) as {
    clusters?: Array<{ id: string; query?: { normalizedMessage?: string } }>;
  };
  const decision = JSON.parse(readFileSync('docs_private/error-analysis-decision.json', 'utf8')) as {
    clusters?: Array<{ id: string; action: string }>;
  };
  const decisionById = new Map((decision.clusters ?? []).map((cluster) => [cluster.id, cluster.action]));
  const proved = proveOutstandingIds({
    errors: snapshot.errors ?? [],
    clusters: (retrieval.clusters ?? []).map((cluster) => ({
      id: cluster.id,
      action: decisionById.get(cluster.id) ?? 'report-only',
      normalizedMessage: cluster.query?.normalizedMessage ?? '',
    })),
  });
  const checksum = manifestChecksum(proved.ids);
  console.log(`Proven outstanding rows: ${proved.ids.length}`);
  console.log(`Unverified clusters: ${proved.unverifiedClusterIds.length}`);
  console.log(`Manifest checksum: ${checksum}`);
  if (!apply) {
    console.log('Dry run only. Pass --apply --confirm-target=<project-ref> to reopen proven rows.');
    return;
  }
  if (proved.ids.length === 0) {
    throw new Error('No proven outstanding rows; reconcile did not change the database');
  }
  if (!confirm) throw new Error('Reconcile apply requires --confirm-target');
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) throw new Error('POSTGRES_URL_NON_POOLING is required');
  const url = new URL(connectionString);
  const projectRef = decodeURIComponent(url.username).replace(/^postgres\./u, '');
  if (projectRef !== confirm) throw new Error('Confirm-target does not match the configured database');
  const client = new pg.Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.replace(/^\/+/u, '') || 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const locked = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM public.error_logs
        WHERE id = ANY($1::uuid[])
          AND status = 'archived'
          AND triage_state IS NULL
        FOR UPDATE
      `,
      [proved.ids]
    );
    if (locked.rows.length !== proved.ids.length) {
      throw new Error('Proven rows are missing or not untouched legacy archives; reconcile rolled back');
    }
    const updated = await client.query(
      `
        UPDATE public.error_logs
        SET status = 'active',
            archived_at = NULL,
            triage_state = 'outstanding',
            triaged_at = NOW(),
            triage_incident_id = 'reconciled-outstanding',
            triage_summary = 'Diagnosed earlier and not live-verified',
            triage_next_step = 'Deploy the local fix and verify it against production, or record why no code fix is required.',
            triage_local_commit = NULL,
            triage_live_verified_at = NULL,
            triage_live_evidence = NULL
        WHERE id = ANY($1::uuid[])
          AND status = 'archived'
          AND triage_state IS NULL
      `,
      [proved.ids]
    );
    if (updated.rowCount !== proved.ids.length) {
      throw new Error('Reconcile update count did not match the proven ID set');
    }
    await client.query('COMMIT');
    console.log(`Reopened outstanding rows: ${updated.rowCount}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
