import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import pg from 'pg';
import {
  TRUSTED_OPERATIONAL_ACTIONS,
  classifyOperationalAction,
} from './automation/trusted-operational-actions';
import {
  fetchOutstandingErrorLogSummaries,
  writeAndVerifyTextArtifactAtomic,
  type PgClientLike,
} from './fixerrors-safety';
import { renderFixerrorsRunSummary } from './fixerrors-summary';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

export const FIXED_LIVE_COMMAND_ID = TRUSTED_OPERATIONAL_ACTIONS['fixerrors-fixed-live'].commandId;
export const FIXED_LIVE_SAFETY_CONTRACT =
  TRUSTED_OPERATIONAL_ACTIONS['fixerrors-fixed-live'].safetyContract;
export const FIXED_LIVE_PRE_RECEIPT = 'docs_private/fixerrors-fixed-live-receipt.pre.json';
export const FIXED_LIVE_POST_RECEIPT = 'docs_private/fixerrors-fixed-live-receipt.post.json';
export const FIXED_LIVE_SUMMARY = 'docs_private/error-run-summary.txt';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const MANIFEST_KEYS = [
  'schemaVersion',
  'commandId',
  'safetyContract',
  'targetProjectRef',
  'deployedCommit',
  'deploymentId',
  'check',
  'result',
  'verifiedAt',
  'rows',
] as const;
const ROW_KEYS = ['id', 'expected'] as const;
const EXPECTED_KEYS = [
  'status',
  'triageState',
  'triageIncidentId',
  'triageSummary',
  'triageNextStep',
  'triageLocalCommit',
] as const;

export type ReconcileError = { id: string; error_message: string };
export type ReconcileCluster = {
  id: string;
  action: string;
  normalizedMessage: string;
};

export type FixedLiveExpectedPrior = {
  status: 'active';
  triageState: 'outstanding';
  triageIncidentId: string;
  triageSummary: string;
  triageNextStep: string;
  triageLocalCommit: string | null;
};

export type FixedLiveManifestRow = {
  id: string;
  expected: FixedLiveExpectedPrior;
};

export type FixedLiveManifest = {
  schemaVersion: 1;
  commandId: typeof FIXED_LIVE_COMMAND_ID;
  safetyContract: typeof FIXED_LIVE_SAFETY_CONTRACT;
  targetProjectRef: string;
  deployedCommit: string;
  deploymentId: string;
  check: string;
  result: 'passed';
  verifiedAt: string;
  rows: FixedLiveManifestRow[];
};

export type FixedLivePriorAudit = {
  id: string;
  errorMessage: string;
  status: 'active';
  triageState: 'outstanding';
  triageIncidentId: string;
  triageSummary: string;
  triageNextStep: string;
  triageLocalCommit: string | null;
};

export type FixedLiveArtifactWriter = (artifactPath: string, content: string) => void;

type LockedErrorRow = {
  id: string;
  error_message: string;
  status: string;
  triage_state: string | null;
  triage_incident_id: string | null;
  triage_summary: string | null;
  triage_next_step: string | null;
  triage_local_commit: string | null;
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

export function hashManifestBytes(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const actual = Object.keys(value);
  const extra = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !actual.includes(key));
  if (extra.length > 0) throw new Error(`Fixed-live manifest contains an unknown field on ${label}`);
  if (missing.length > 0) throw new Error('Fixed-live manifest is missing evidence');
}

function requiredText(value: unknown, field: string, minimum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.trim().length < minimum) {
    throw new Error(`Fixed-live manifest field ${field} is missing`);
  }
  return value;
}

function isExactIsoTimestamp(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString() === value;
}

export function parseFixedLiveManifest(contents: string, now = new Date()): FixedLiveManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('Fixed-live manifest is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Fixed-live manifest contains an unknown field on manifest');
  }
  const raw = parsed as Record<string, unknown>;
  assertExactKeys(raw, MANIFEST_KEYS, 'manifest');
  if (raw.schemaVersion !== 1) throw new Error('Fixed-live manifest schema version is not supported');
  if (raw.commandId !== FIXED_LIVE_COMMAND_ID || raw.safetyContract !== FIXED_LIVE_SAFETY_CONTRACT) {
    throw new Error('Fixed-live manifest command is not the registered contract');
  }
  const targetProjectRef = requiredText(raw.targetProjectRef, 'targetProjectRef', 3);
  if (!/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/u.test(targetProjectRef)) {
    throw new Error('Fixed-live manifest field targetProjectRef is missing');
  }
  if (typeof raw.deployedCommit !== 'string' || !FULL_COMMIT_PATTERN.test(raw.deployedCommit)) {
    throw new Error('Fixed-live deployed commit must be a full SHA');
  }
  const deployedCommit = raw.deployedCommit;
  const deploymentId = requiredText(raw.deploymentId, 'deploymentId', 4);
  if (/\s/u.test(deploymentId)) throw new Error('Fixed-live manifest field deploymentId is missing');
  const check = requiredText(raw.check, 'check', 12);
  if (!/\s/u.test(check) || /^(ok|pass|passed|todo|tbd|n\/a|none|test)$/iu.test(check)) {
    throw new Error('Fixed-live verification check is missing');
  }
  if (raw.result !== 'passed') throw new Error('Fixed-live result must be passed');
  const verifiedAt = requiredText(raw.verifiedAt, 'verifiedAt', 20);
  if (!isExactIsoTimestamp(verifiedAt)) {
    throw new Error('Fixed-live verification timestamp is invalid');
  }
  if (Date.parse(verifiedAt) > now.getTime()) {
    throw new Error('Fixed-live verification timestamp is in the future');
  }
  if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
    throw new Error('Fixed-live manifest has no rows');
  }
  const seen = new Set<string>();
  const rows: FixedLiveManifestRow[] = raw.rows.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Fixed-live manifest contains an unknown field on row');
    }
    const row = entry as Record<string, unknown>;
    assertExactKeys(row, ROW_KEYS, 'row');
    if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)) {
      throw new Error('Fixed-live manifest row id is not a UUID');
    }
    const id = row.id.toLowerCase();
    if (seen.has(id)) throw new Error('Fixed-live manifest repeats an exact ID');
    seen.add(id);
    if (!row.expected || typeof row.expected !== 'object' || Array.isArray(row.expected)) {
      throw new Error('Fixed-live manifest contains an unknown field on expected');
    }
    const expected = row.expected as Record<string, unknown>;
    assertExactKeys(expected, EXPECTED_KEYS, 'expected');
    if (expected.status !== 'active' || expected.triageState !== 'outstanding') {
      throw new Error('Fixed-live manifest prior state must be active outstanding');
    }
    const triageIncidentId = requiredText(expected.triageIncidentId, 'triageIncidentId', 3);
    const triageSummary = requiredText(expected.triageSummary, 'triageSummary', 3);
    const triageNextStep = requiredText(expected.triageNextStep, 'triageNextStep', 3);
    let triageLocalCommit: string | null;
    if (expected.triageLocalCommit === null) {
      triageLocalCommit = null;
    } else if (
      typeof expected.triageLocalCommit === 'string' &&
      FULL_COMMIT_PATTERN.test(expected.triageLocalCommit)
    ) {
      triageLocalCommit = expected.triageLocalCommit;
    } else {
      throw new Error('Fixed-live manifest field triageLocalCommit is missing');
    }
    return {
      id,
      expected: {
        status: 'active',
        triageState: 'outstanding',
        triageIncidentId,
        triageSummary,
        triageNextStep,
        triageLocalCommit,
      },
    };
  });
  rows.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    commandId: FIXED_LIVE_COMMAND_ID,
    safetyContract: FIXED_LIVE_SAFETY_CONTRACT,
    targetProjectRef,
    deployedCommit,
    deploymentId,
    check,
    result: 'passed',
    verifiedAt,
    rows,
  };
}

export function assertNonPoolingTarget(
  connectionString: string,
  options: { confirmTarget: string; allowLoopback: boolean }
): { projectRef: string; hostname: string; port: number } {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('POSTGRES_URL_NON_POOLING is not a valid database URL');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('POSTGRES_URL_NON_POOLING is not a valid database URL');
  }
  const hostname = url.hostname.toLowerCase();
  const port = Number(url.port || '5432');
  if (port === 6543 || url.searchParams.get('pgbouncer') === 'true' || (hostname !== '127.0.0.1' && port !== 5432)) {
    throw new Error('Fixed-live reconcile refuses a pooled database URL');
  }
  if (hostname === 'localhost' || (hostname === '127.0.0.1' && !options.allowLoopback)) {
    throw new Error('Fixed-live reconcile refuses loopback outside tests');
  }
  if (options.allowLoopback && hostname !== '127.0.0.1') {
    throw new Error('Fixed-live test target must be loopback 127.0.0.1');
  }
  const username = decodeURIComponent(url.username);
  const projectRef = username.startsWith('postgres.') ? username.slice('postgres.'.length) : username;
  if (!projectRef || projectRef !== options.confirmTarget) {
    throw new Error('Confirm-target does not match the configured database');
  }
  return { projectRef, hostname, port };
}

export function assertFixedLiveApplyConfirmation(input: {
  manifest: FixedLiveManifest;
  manifestHash: string;
  confirmTarget?: string;
  confirmManifest?: string;
}): void {
  if (!input.confirmTarget) throw new Error('Fixed-live reconcile requires exact target confirmation');
  if (!input.confirmManifest) throw new Error('Fixed-live reconcile requires manifest hash confirmation');
  if (input.confirmTarget !== input.manifest.targetProjectRef) {
    throw new Error('Confirm-target does not match the manifest target');
  }
  if (input.confirmManifest.toLowerCase() !== input.manifestHash) {
    throw new Error('Fixed-live manifest hash does not match');
  }
}

export function assertFixedLiveTrusted(manifest: FixedLiveManifest, confirmed: boolean): void {
  const registered = TRUSTED_OPERATIONAL_ACTIONS['fixerrors-fixed-live'];
  const classification = classifyOperationalAction({
    commandId: manifest.commandId,
    safetyContract: manifest.safetyContract,
    intent: 'execute',
    explicitlyRequested: true,
    confirmationBoundToSnapshot: confirmed,
    runtimeSafetyChecksPassed: true,
    requestedMutations: registered.allowedMutations,
  });
  if (!classification.trusted || classification.safetyContract !== registered.safetyContract) {
    throw new Error(`Fixed-live reconcile is not a trusted execution: ${classification.reason}`);
  }
}

function sameCommit(actual: string | null, expected: string | null): boolean {
  return actual === expected;
}

function priorFromLock(row: LockedErrorRow, expected: FixedLiveExpectedPrior): FixedLivePriorAudit {
  if (
    row.status !== 'active' ||
    row.triage_state !== 'outstanding' ||
    row.triage_incident_id !== expected.triageIncidentId ||
    row.triage_summary !== expected.triageSummary ||
    row.triage_next_step !== expected.triageNextStep ||
    !sameCommit(row.triage_local_commit, expected.triageLocalCommit)
  ) {
    throw new Error('Fixed-live row state drifted; reconcile rolled back');
  }
  return {
    id: row.id,
    errorMessage: row.error_message,
    status: 'active',
    triageState: 'outstanding',
    triageIncidentId: expected.triageIncidentId,
    triageSummary: expected.triageSummary,
    triageNextStep: expected.triageNextStep,
    triageLocalCommit: expected.triageLocalCommit,
  };
}

function receiptDocument(
  phase: 'pre' | 'post',
  manifest: FixedLiveManifest,
  manifestHash: string,
  prior: FixedLivePriorAudit[]
): string {
  return `${JSON.stringify(
    {
      phase,
      commandId: manifest.commandId,
      safetyContract: manifest.safetyContract,
      manifestHash,
      targetProjectRef: manifest.targetProjectRef,
      deployedCommit: manifest.deployedCommit,
      deploymentId: manifest.deploymentId,
      check: manifest.check,
      verifiedAt: manifest.verifiedAt,
      rows: prior.map((row) => ({
        id: row.id,
        errorMessage: row.errorMessage,
        priorTriage: {
          status: row.status,
          triageState: row.triageState,
          triageIncidentId: row.triageIncidentId,
          triageSummary: row.triageSummary,
          triageNextStep: row.triageNextStep,
          triageLocalCommit: row.triageLocalCommit,
        },
        outcome: phase === 'post' ? 'fixed_live' : 'pending',
      })),
    },
    null,
    2
  )}\n`;
}

function defaultArtifactWriter(artifactPath: string, content: string): void {
  writeAndVerifyTextArtifactAtomic(resolve(process.cwd(), artifactPath), content);
}

export async function reconcileFixedLiveExactIds(options: {
  client: PgClientLike;
  manifest: FixedLiveManifest;
  manifestHash: string;
  confirmed: boolean;
  writeArtifact?: FixedLiveArtifactWriter;
}): Promise<{ updatedIds: string[]; transactionIsolation: string; summary: string }> {
  assertFixedLiveTrusted(options.manifest, options.confirmed);
  const writeArtifact = options.writeArtifact ?? defaultArtifactWriter;
  const manifest = options.manifest;
  const ids = manifest.rows.map((row) => row.id);
  let began = false;
  let committed = false;
  try {
    await options.client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    began = true;
    const isolation = await options.client.query<{ transaction_isolation: string }>(
      'SHOW transaction_isolation'
    );
    const transactionIsolation = String(isolation.rows[0]?.transaction_isolation ?? '');
    if (transactionIsolation !== 'serializable') {
      throw new Error('Fixed-live reconcile requires SERIALIZABLE');
    }
    const locked = await options.client.query<LockedErrorRow>(
      `
        /* fixerrors-fixed-live:lock */
        SELECT
          id::text AS id,
          error_message,
          status::text AS status,
          triage_state,
          triage_incident_id,
          triage_summary,
          triage_next_step,
          triage_local_commit
        FROM public.error_logs
        WHERE id = ANY($1::uuid[])
        FOR UPDATE
      `,
      [ids]
    );
    if (locked.rows.length !== ids.length) {
      throw new Error('Fixed-live rows are missing; reconcile rolled back');
    }
    const lockedById = new Map(locked.rows.map((row) => [row.id.toLowerCase(), row]));
    if (lockedById.size !== ids.length) {
      throw new Error('Fixed-live rows are missing; reconcile rolled back');
    }
    const prior = manifest.rows.map((row) => {
      const current = lockedById.get(row.id);
      if (!current) throw new Error('Fixed-live rows are missing; reconcile rolled back');
      return priorFromLock(current, row.expected);
    });
    writeArtifact(FIXED_LIVE_PRE_RECEIPT, receiptDocument('pre', manifest, options.manifestHash, prior));
    const evidence = {
      deployedCommit: manifest.deployedCommit,
      deploymentId: manifest.deploymentId,
      check: manifest.check,
      result: manifest.result,
      verifiedAt: manifest.verifiedAt,
    };
    const updated = await options.client.query<{
      id: string;
      error_message: string;
      status: string;
      triage_state: string;
      triage_incident_id: string | null;
      triage_summary: string | null;
      triage_local_commit: string | null;
      triage_next_step: string | null;
    }>(
      `
        /* fixerrors-fixed-live:update */
        UPDATE public.error_logs AS error_log
        SET status = 'archived',
            archived_at = NOW(),
            triage_state = 'fixed_live',
            triaged_at = NOW(),
            triage_next_step = NULL,
            triage_live_verified_at = $6::timestamptz,
            triage_live_evidence = $7::jsonb
        FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
          AS expected(id, incident_id, summary, next_step, local_commit)
        WHERE error_log.id = expected.id
          AND error_log.status = 'active'
          AND error_log.triage_state = 'outstanding'
          AND error_log.archived_at IS NULL
          AND error_log.triage_incident_id = expected.incident_id
          AND error_log.triage_summary = expected.summary
          AND error_log.triage_next_step = expected.next_step
          AND error_log.triage_local_commit IS NOT DISTINCT FROM expected.local_commit
        RETURNING
          error_log.id::text AS id,
          error_log.error_message,
          error_log.status,
          error_log.triage_state,
          error_log.triage_incident_id,
          error_log.triage_summary,
          error_log.triage_local_commit,
          error_log.triage_next_step
      `,
      [
        ids,
        manifest.rows.map((row) => row.expected.triageIncidentId),
        manifest.rows.map((row) => row.expected.triageSummary),
        manifest.rows.map((row) => row.expected.triageNextStep),
        manifest.rows.map((row) => row.expected.triageLocalCommit),
        manifest.verifiedAt,
        JSON.stringify(evidence),
      ]
    );
    if (updated.rowCount !== ids.length || updated.rows.length !== ids.length) {
      throw new Error('Fixed-live update count did not match the exact ID set');
    }
    const updatedById = new Map(updated.rows.map((row) => [row.id.toLowerCase(), row]));
    for (const row of prior) {
      const current = updatedById.get(row.id);
      if (
        !current ||
        current.error_message !== row.errorMessage ||
        current.status !== 'archived' ||
        current.triage_state !== 'fixed_live' ||
        current.triage_next_step !== null ||
        current.triage_incident_id !== row.triageIncidentId ||
        current.triage_summary !== row.triageSummary ||
        !sameCommit(current.triage_local_commit, row.triageLocalCommit)
      ) {
        throw new Error('Fixed-live update count did not match the exact ID set');
      }
    }
    await options.client.query('COMMIT');
    committed = true;
    began = false;
    const outstanding = await fetchOutstandingErrorLogSummaries(options.client);
    const summary = renderFixerrorsRunSummary({
      found: [],
      fixedLive: prior.map((row) => ({
        id: row.id,
        title: `Deployed fix verified (${row.triageIncidentId})`,
        count: 1,
        nextStep: null,
      })),
      outstanding: outstanding.map((row) => ({
        id: row.id,
        title: row.summary,
        count: 1,
        nextStep: row.nextStep,
      })),
    });
    writeArtifact(FIXED_LIVE_POST_RECEIPT, receiptDocument('post', manifest, options.manifestHash, prior));
    writeArtifact(FIXED_LIVE_SUMMARY, summary);
    return { updatedIds: ids, transactionIsolation, summary };
  } catch (error) {
    if (began) await options.client.query('ROLLBACK');
    else if (committed) throw new Error('Database closure committed, but report refresh failed. Run the same manifest with --refresh (no --apply) to recover reports.');
    throw error;
  }
}

export async function refreshFixedLiveReports(options: {
  client: PgClientLike;
  manifest: FixedLiveManifest;
  manifestHash: string;
  writeArtifact?: FixedLiveArtifactWriter;
}): Promise<string> {
  const { client, manifest, manifestHash } = options;
  const writeArtifact = options.writeArtifact ?? defaultArtifactWriter;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const rows = await client.query<LockedErrorRow & { triage_live_evidence: Record<string, unknown> }>(
      `/* fixerrors-fixed-live:refresh */ SELECT id::text, error_message, status::text, triage_state, triage_incident_id,
              triage_summary, triage_next_step, triage_local_commit, triage_live_evidence
       FROM public.error_logs WHERE id = ANY($1::uuid[])`,
      [manifest.rows.map(row => row.id)]
    );
    if (rows.rows.length !== manifest.rows.length) throw new Error('Recovery exact IDs missing');
    const prior = manifest.rows.map(row => {
      const current = rows.rows.find(value => value.id === row.id);
      const evidence = current?.triage_live_evidence;
      if (!current || current.status !== 'archived' || current.triage_state !== 'fixed_live' ||
          current.triage_next_step !== null || current.triage_incident_id !== row.expected.triageIncidentId ||
          current.triage_summary !== row.expected.triageSummary || current.triage_local_commit !== row.expected.triageLocalCommit ||
          !evidence || evidence.deployedCommit !== manifest.deployedCommit || evidence.deploymentId !== manifest.deploymentId ||
          evidence.check !== manifest.check || evidence.result !== 'passed' || evidence.verifiedAt !== manifest.verifiedAt) {
        throw new Error('Recovery state or evidence mismatch; no report refreshed');
      }
      return { id: row.id, errorMessage: current.error_message, ...row.expected };
    });
    const outstanding = await fetchOutstandingErrorLogSummaries(client);
    const summary = renderFixerrorsRunSummary({found: [], fixedLive: prior.map(row => ({
      id: row.id, title: `Deployed fix verified (${row.triageIncidentId})`, count: 1, nextStep: null,
    })), outstanding: outstanding.map(row => ({id: row.id, title: row.summary, count: 1, nextStep: row.nextStep}))});
    await client.query('COMMIT');
    writeArtifact(FIXED_LIVE_POST_RECEIPT, receiptDocument('post', manifest, manifestHash, prior));
    writeArtifact(FIXED_LIVE_SUMMARY, summary);
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function assertPrivateManifestPath(manifestPath: string): string {
  const root = resolve(process.cwd(), 'docs_private');
  const full = resolve(process.cwd(), manifestPath);
  const fromRoot = relative(root, full);
  if (fromRoot.startsWith('..') || resolve(fromRoot) === fromRoot) {
    throw new Error('Fixed-live manifest must live under docs_private');
  }
  return full;
}

function createReconcileClient(
  connectionString: string,
  target: { hostname: string; port: number }
): pg.Client {
  const url = new URL(connectionString);
  return new pg.Client({
    host: target.hostname,
    port: target.port,
    database: url.pathname.replace(/^\/+/u, '') || 'postgres',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: target.hostname === '127.0.0.1' ? false : { rejectUnauthorized: false },
  });
}

async function runFixedLiveMode(): Promise<void> {
  const manifestArg = process.argv.find((arg) => arg.startsWith('--manifest='))?.slice('--manifest='.length);
  if (!manifestArg) throw new Error('Fixed-live reconcile requires --manifest');
  const contents = readFileSync(assertPrivateManifestPath(manifestArg), 'utf8');
  const manifestHash = hashManifestBytes(contents);
  const manifest = parseFixedLiveManifest(contents);
  const apply = process.argv.includes('--apply');
  const refresh = process.argv.includes('--refresh');
  if (apply && refresh) throw new Error('Choose apply or read-only refresh, not both');
  console.log(`Fixed-live exact IDs: ${manifest.rows.length}`);
  console.log(`Manifest checksum: ${manifestHash}`);
  console.log(`Registered contract: ${manifest.commandId} ${manifest.safetyContract}`);
  if (!apply && !refresh) {
    console.log(
      'Dry run only. No database connection. Apply requires --apply --confirm-target=<project-ref> --confirm-manifest=<sha256>.'
    );
    return;
  }
  const confirm = process.argv.find((arg) => arg.startsWith('--confirm-target='))?.slice('--confirm-target='.length);
  const confirmManifest = process.argv
    .find((arg) => arg.startsWith('--confirm-manifest='))
    ?.slice('--confirm-manifest='.length)
    ?.toLowerCase();
  assertFixedLiveApplyConfirmation({
    manifest,
    manifestHash,
    confirmTarget: confirm,
    confirmManifest,
  });
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) throw new Error('POSTGRES_URL_NON_POOLING is required');
  const target = assertNonPoolingTarget(connectionString, {
    confirmTarget: manifest.targetProjectRef,
    allowLoopback: false,
  });
  if (target.projectRef !== manifest.targetProjectRef) {
    throw new Error('Confirm-target does not match the configured database');
  }
  assertFixedLiveTrusted(manifest, true);
  const client = createReconcileClient(connectionString, target);
  await client.connect();
  try {
    if (refresh) {
      console.log(await refreshFixedLiveReports({client, manifest, manifestHash}));
      return;
    }
    const result = await reconcileFixedLiveExactIds({
      client,
      manifest,
      manifestHash,
      confirmed: true,
    });
    console.log(`Archived fixed-live rows: ${result.updatedIds.length}`);
    console.log(result.summary.trimEnd());
  } finally {
    await client.end();
  }
}

async function reopenLegacyOutstanding(): Promise<void> {
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

async function main(): Promise<void> {
  const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length);
  if (mode === 'fixed-live') {
    await runFixedLiveMode();
    return;
  }
  if (mode) throw new Error('Reconcile mode is not registered');
  await reopenLegacyOutstanding();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
