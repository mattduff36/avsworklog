import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import { assertNonPoolingTarget } from './fixerrors-reconcile';
import { rejectSensitiveText } from './fixerrors-knowledge';
import { writeAndVerifyTextArtifactAtomic, type PgClientLike } from './fixerrors-safety';
import { TRUSTED_OPERATIONAL_ACTIONS, classifyOperationalAction } from './automation/trusted-operational-actions';

export const CONTRACT = 'fixerrors-close-stale-exact-id-v1';
export type ClosureRow = { id: string; expectedRecordHash: string; reason: 'expected_behavior' | 'insufficient_evidence'; summary: string; evidence: string };
export type ClosureManifest = { schemaVersion: 1; commandId: 'fixerrors-close-stale'; safetyContract: typeof CONTRACT; targetProjectRef: string; createdAt: string; expiresAt: string; rows: ClosureRow[] };
export const hashBytes = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const hashRecord = (record: unknown): string => hashBytes(JSON.stringify(record));
const exactKeys = (o: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(o).sort().join(',') !== keys.sort().join(',')) throw new Error('Unexpected manifest fields');
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object');
  return v as Record<string, unknown>;
};
export function validateExpiry(manifest: ClosureManifest, now = new Date()): void {
  const created = Date.parse(manifest.createdAt), expires = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || new Date(created).toISOString() !== manifest.createdAt || new Date(expires).toISOString() !== manifest.expiresAt || created > now.getTime() || expires <= now.getTime() || expires <= created || expires - created > 86400000) throw new Error('Manifest timestamps are invalid or expired');
}
export function parseClosureManifest(bytes: string, now = new Date()): ClosureManifest {
  const v = object(JSON.parse(bytes));
  exactKeys(v, ['schemaVersion', 'commandId', 'safetyContract', 'targetProjectRef', 'createdAt', 'expiresAt', 'rows']);
  if (v.schemaVersion !== 1 || v.commandId !== 'fixerrors-close-stale' || v.safetyContract !== CONTRACT || typeof v.targetProjectRef !== 'string' || !/^[a-z0-9-]{3,80}$/.test(v.targetProjectRef) || typeof v.createdAt !== 'string' || typeof v.expiresAt !== 'string' || !Array.isArray(v.rows) || !v.rows.length || v.rows.length > 100) throw new Error('Invalid closure manifest');
  const ids = new Set<string>();
  for (const entry of v.rows) {
    const row = object(entry);
    exactKeys(row, ['id', 'expectedRecordHash', 'reason', 'summary', 'evidence']);
    if (typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id) || ids.has(row.id) || typeof row.expectedRecordHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.expectedRecordHash) || !['expected_behavior', 'insufficient_evidence'].includes(String(row.reason))) throw new Error('Invalid or duplicate closure row');
    ids.add(row.id);
    for (const key of ['summary', 'evidence']) {
      const text = row[key];
      if (typeof text !== 'string' || text.trim().length < 12 || text.length > 2000 || /[\r\n\x00-\x1f]/.test(text)) throw new Error(`Invalid ${key}`);
      rejectSensitiveText(text, key);
    }
  }
  const manifest = v as unknown as ClosureManifest;
  validateExpiry(manifest, now);
  return manifest;
}
export function assertClosureConfirmation(manifest: ClosureManifest, hash: string, target?: string, confirmation?: string): void {
  if (target !== manifest.targetProjectRef || confirmation !== hash) throw new Error('Exact target and manifest hash confirmations are required');
}
type Locked = { id: string; status: string; triage_state: string | null; record: Record<string, unknown> };
type Writer = (path: string, contents: string) => void;
export async function closeStaleExactIds(client: PgClientLike, manifest: ClosureManifest, manifestHash: string, options: { refresh?: boolean; writer?: Writer; now?: () => Date } = {}): Promise<{ closed: number; active: number }> {
  const writer = options.writer ?? writeAndVerifyTextArtifactAtomic;
  const now = options.now ?? (() => new Date());
  const registered = TRUSTED_OPERATIONAL_ACTIONS['fixerrors-close-stale'];
  if (!classifyOperationalAction({ commandId: manifest.commandId, safetyContract: manifest.safetyContract, intent: 'execute', explicitlyRequested: true, confirmationBoundToSnapshot: true, runtimeSafetyChecksPassed: true, requestedMutations: registered.allowedMutations }).trusted) throw new Error('Closure operational trust failed');
  const ids = manifest.rows.map(r => r.id).sort();
  let committed = false;
  await client.query(options.refresh ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    const locked = await client.query<Locked>(`SELECT id::text, status::text, triage_state, to_jsonb(e) AS record FROM public.error_logs e WHERE id = ANY($1::uuid[]) ORDER BY id${options.refresh ? '' : ' FOR UPDATE'}`, [ids]);
    if (locked.rows.length !== ids.length) throw new Error('Exact closure row set is missing');
    if (!options.refresh) validateExpiry(manifest, now());
    for (const row of locked.rows) {
      const expected = manifest.rows.find(r => r.id === row.id)!;
      if (options.refresh) {
        const audits = object(row.record.additional_data).fixerrorsClosures;
        if (row.status !== 'archived' || row.triage_state !== 'no_fix_required' || !Array.isArray(audits) || !audits.some(a => { if (!a || typeof a !== 'object' || Array.isArray(a)) return false; const audit = a as Record<string, unknown>; return audit.contract === CONTRACT && audit.id === expected.id && audit.manifestHash === manifestHash && audit.expectedRecordHash === expected.expectedRecordHash && audit.reason === expected.reason && audit.summary === expected.summary && audit.evidence === expected.evidence; })) throw new Error('Stored closure does not match manifest');
      } else {
        if (row.status !== 'active' || row.triage_state !== 'outstanding' || hashRecord(row.record) !== expected.expectedRecordHash) throw new Error('Closure row state or fingerprint changed');
        if (['triage_local_commit', 'triage_live_verified_at', 'triage_live_evidence'].some(key => row.record[key] != null)) throw new Error('Closure cannot discard local or live fix evidence');
        if (row.record.additional_data !== null) object(row.record.additional_data);
        const prior = (row.record.additional_data as Record<string, unknown> | null)?.fixerrorsClosures;
        if (prior !== undefined && !Array.isArray(prior)) throw new Error('Closure audit is not an array');
      }
    }
    if (!options.refresh) {
      writer('docs_private/fixerrors-close-stale-receipt.pre.json', JSON.stringify({ manifestHash, target: manifest.targetProjectRef, rows: manifest.rows, validatedAt: now().toISOString() }, null, 2));
      const closedAt = now().toISOString();
      for (const row of locked.rows) {
        const expected = manifest.rows.find(r => r.id === row.id)!;
        const data = (row.record.additional_data ?? {}) as Record<string, unknown>;
        const audit = { contract: CONTRACT, manifestHash, ...expected, closedAt, priorTriage: { state: row.record.triage_state, summary: row.record.triage_summary, nextStep: row.record.triage_next_step, triagedAt: row.record.triaged_at } };
        const result = await client.query(`UPDATE public.error_logs SET status = 'archived', archived_at = $2::timestamptz, triage_state = 'no_fix_required', triaged_at = $2::timestamptz, triage_summary = $3, triage_next_step = NULL, additional_data = $4::jsonb WHERE id = $1::uuid AND status = 'active' AND triage_state = 'outstanding' RETURNING id`, [row.id, closedAt, expected.summary, JSON.stringify({ ...data, fixerrorsClosures: [...(data.fixerrorsClosures as unknown[] ?? []), audit] })]);
        if (result.rows.length !== 1) throw new Error('Closure update count mismatch');
      }
    }
    const active = await client.query<{ id: string; triage_state: string | null }>("SELECT id::text, triage_state FROM public.error_logs WHERE status = 'active' ORDER BY id");
    await client.query('COMMIT');
    committed = true;
    const result = { closed: ids.length, active: active.rows.length };
    writer('docs_private/fixerrors-close-stale-receipt.post.json', JSON.stringify({ manifestHash, ...result, active: active.rows }, null, 2));
    const summary = ['Errors found', '- none (historical closure only)', 'Errors fixed live', '- none', 'Errors closed without a fix', ...manifest.rows.map(r => `- ${r.id}: ${r.reason}: ${r.summary}`), 'Errors still outstanding', ...(active.rows.length ? active.rows.map(r => `- ${r.id}: ${r.triage_state ?? 'untriaged'}; next step: review current diagnostics.`) : ['- none']), `Outstanding work remains: ${active.rows.length ? 'YES' : 'NO'}`, '', `Final recommendation: ${active.rows.length ? 'Review the remaining active errors.' : 'No further fixerrors action is required.'}`, ...(active.rows.length ? ['Say "fix" to proceed with this recommendation now.'] : []), ''].join('\n');
    writer('docs_private/error-run-summary.txt', summary);
    return result;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    else throw new Error('Closure committed; regenerate receipts using --refresh with the same manifest and confirmations', { cause: error });
    throw error;
  }
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const allowed = ['--manifest=', '--confirm-target=', '--confirm-manifest='];
  if (args.some(a => a !== '--apply' && a !== '--refresh' && !allowed.some(p => a.startsWith(p))) || new Set(args.map(a => a.split('=')[0])).size !== args.length || args.includes('--apply') && args.includes('--refresh')) throw new Error('Invalid closure arguments');
  const value = (key: string) => args.find(a => a.startsWith(`${key}=`))?.slice(key.length + 1);
  const manifestPath = resolve(value('--manifest') ?? '');
  const rel = relative(resolve('docs_private'), manifestPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Manifest must be inside docs_private');
  const bytes = readFileSync(manifestPath);
  // Refresh can recover a committed closure after its manifest expires, but still validates the original bounded interval.
  const refresh = args.includes('--refresh');
  const validationNow = refresh ? new Date(JSON.parse(bytes.toString()).createdAt) : new Date();
  const manifest = parseClosureManifest(bytes.toString(), validationNow), hash = hashBytes(bytes);
  if (!args.includes('--apply') && !refresh) { console.log(JSON.stringify({ dryRun: true, manifestHash: hash, target: manifest.targetProjectRef, rows: manifest.rows.length })); return; }
  assertClosureConfirmation(manifest, hash, value('--confirm-target'), value('--confirm-manifest'));
  dotenv.config({ path: '.env.local', quiet: true });
  const connection = process.env.POSTGRES_URL_NON_POOLING ?? '';
  assertNonPoolingTarget(connection, { confirmTarget: manifest.targetProjectRef, allowLoopback: false });
  const u = new URL(connection);
  const client = new pg.Client({ host: u.hostname, port: Number(u.port || '5432'), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try { console.log(JSON.stringify(await closeStaleExactIds(client, manifest, hash, { refresh }))); } finally { await client.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => {
  console.error(error instanceof Error && error.message.startsWith('Closure committed;') ? error.message : 'Closure failed; inspect validated private evidence. No credentials or diagnostics are printed.');
  process.exitCode = 1;
});
