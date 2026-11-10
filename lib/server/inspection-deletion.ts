import 'server-only';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { InspectionAssetType } from '@/lib/inspections/meter-correction';

type QueryClient = Pick<pg.Client, 'query'>;
type Snapshot = Record<string, unknown>;
type Target = 'vehicle_maintenance' | 'hgvs' | 'actions' | 'reminders' | 'reminder_actions';
interface Effect {
  id: string;
  target_table: Target;
  target_id: string;
  before_row: Snapshot | null;
  after_row: Snapshot;
  voided_at: string | null;
  input_fields: string[];
  baseline_override: Snapshot | null;
}
export interface InspectionDeletionResult {
  success: true;
  alreadyDeleted: boolean;
  warnings: string[];
  storageCleanupPending: number;
}
interface InspectionPhotoStorage {
  from(bucket: string): { remove(paths: string[]): Promise<{ error: unknown }> };
}
export class InspectionDeletionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function withInspectionDeletionDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) throw new InspectionDeletionError('Daily Check deletion is temporarily unavailable.', 503);
  const url = new URL(connectionString);
  const caPath = process.env.PGSSLROOTCERT;
  const ca = process.env.POSTGRES_SSL_CA_PEM ?? process.env.SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM ??
    (caPath ? await readFile(caPath, 'utf8') : undefined);
  if (ca !== undefined) {
    try {
      const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu);
      if (Buffer.byteLength(ca, 'utf8') > 65_536 || !certificates?.length ||
        ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu, '').trim()) {
        throw new Error('Invalid CA bundle');
      }
      certificates.forEach(certificate => { new X509Certificate(certificate); });
    } catch {
      throw new InspectionDeletionError('Invalid Daily Check database CA configuration.', 503);
    }
  }
  const client = new pg.Client({
    host: url.hostname, port: Number(url.port || '5432'), database: url.pathname.slice(1),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true, servername: url.hostname, ...(ca !== undefined ? { ca } : {}) },
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    return await work(client);
  } finally { await client.end(); }
}

const TARGETS: readonly string[] = ['vehicle_maintenance', 'hgvs', 'actions', 'reminders', 'reminder_actions'];
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const normalized = (row: Snapshot) => Object.fromEntries(
  Object.entries(row).filter(([key]) => !['updated_at', 'daily_check_source_id', 'daily_check_source_type'].includes(key)));

async function isPhotoReferenced(client: QueryClient, photoPath: string) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '20s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('daily-check-workshop-photos', 0))");
    const shared = await client.query(`SELECT 1 WHERE
      ${['inspection_photos', 'workshop_task_check_photos', 'workshop_attachment_responses',
    'workshop_attachment_field_responses', 'workshop_task_comments', 'workshop_task_attachments', 'actions']
    .map(table => `EXISTS (SELECT 1 FROM public.${table} t
        WHERE strpos(private.daily_check_photo_text(to_jsonb(t)::text), $1) > 0)`).join(' OR ')}`, [photoPath]);
    // The committed outbox rejects new references, so no lock is held during the Storage request.
    await client.query('COMMIT');
    return Boolean(shared.rowCount);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function restoreTarget(client: QueryClient, target: Target, id: string, warnings: Set<string>) {
  if (!TARGETS.includes(target)) throw new Error('Unexpected Daily Check effect target');
  const { rows } = await client.query<{ snapshot: Snapshot }>(
    `SELECT to_jsonb(t) AS snapshot FROM public.${target} t WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows[0]) {
    warnings.add('A recorded linked effect no longer exists. No missing row was recreated.');
    return;
  }
  const { rows: events } = await client.query<Effect>(
    `SELECT id::text, target_table, target_id, before_row, after_row, voided_at, input_fields, baseline_override
     FROM private.daily_check_effects WHERE target_table = $1 AND target_id = $2 ORDER BY daily_check_effects.id`, [target, id]);
  const last = events.at(-1);
  const meter = target === 'vehicle_maintenance' || target === 'hgvs';
  if (!last) return;
  const current = normalized(rows[0].snapshot);
  const comparable = meter
    ? Object.fromEntries(Object.keys(last.after_row).map(key => [key, current[key]]))
    : current;
  const { rows: match } = await client.query<{ matches: boolean }>(
    'SELECT $1::jsonb = $2::jsonb AS matches', [JSON.stringify(comparable), JSON.stringify(last.after_row)]);
  if (!match[0].matches) {
    warnings.add('Some effects changed outside the recorded history and were preserved. Reconcile the asset record.');
    return;
  }
  let next = events[0].baseline_override ?? events[0].before_row;
  for (const event of events) {
    if (event.voided_at) continue;
    if (!event.before_row) {
      next = { ...event.after_row };
      continue;
    }
    const delta = Object.fromEntries(Object.entries(event.after_row).filter(([key, value]) =>
      !isDeepStrictEqual(value, event.before_row?.[key]) || event.input_fields.includes(key)));
    if (meter && !next && !Object.keys(delta).some(key => key === 'current_mileage' || key === 'current_hours')) continue;
    if (Object.keys(delta).length) next = { ...(next ?? events[0].after_row), ...delta };
  }
  if (meter && !next) {
    warnings.add('No verified previous meter reading exists. The current reading was retained; reconcile it manually.');
    return;
  }
  if (target === 'actions' && next) {
    const { rows: valid } = await client.query<{ inspection_id: string | null; inspection_item_id: string | null }>(`
      SELECT (SELECT id FROM (
        SELECT id FROM public.van_inspections UNION ALL SELECT id FROM public.plant_inspections
        UNION ALL SELECT id FROM public.hgv_inspections
      ) parents WHERE id = $1) AS inspection_id,
      (SELECT id FROM public.inspection_items WHERE id = $2) AS inspection_item_id`,
    [next.inspection_id, next.inspection_item_id]);
    next = { ...next, ...valid[0] };
  }
  if (!next) {
    // Workshop work and attachments are never discarded just because their originating check was wrong.
    if (target === 'actions') {
      const { rows: work } = await client.query<{ has_work: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM public.workshop_task_comments WHERE task_id = $1)
         OR EXISTS (SELECT 1 FROM public.workshop_task_attachments WHERE task_id = $1) AS has_work`, [id]);
      if (work[0].has_work) {
        warnings.add('Linked workshop work was preserved and detached from the deleted check.');
        next = { ...events[0].after_row };
      }
    }
    if (!next) {
      await client.query(`DELETE FROM public.${target} WHERE id = $1`, [id]);
      return;
    }
  }
  if (target === 'actions' && current.status === 'completed' &&
      (next.status !== 'completed' || next.actioned !== true)) {
    const service = await client.query(`SELECT 1 FROM public.asset_service_events
      WHERE task_id = $1 AND event_type = 'completion' LIMIT 1`, [id]);
    if (service.rowCount) {
      warnings.add('Completed Service work was preserved. An audited workshop correction is required to undo it.');
      return;
    }
  }
  const keys = Object.keys(next).filter(key => key !== 'id' && !isDeepStrictEqual(next[key], current[key]));
  if (keys.length) {
    const columns = keys.map(quote).join(', ');
    await client.query(`UPDATE public.${target} SET (${columns}) =
      (SELECT ${columns} FROM jsonb_populate_record(NULL::public.${target}, $2::jsonb)) WHERE id = $1`,
    [id, JSON.stringify(next)]);
  }
}

interface MeterAudit {
  id: string;
  record_id: string;
  table_name: string;
  xid: string;
  stamp: string;
  changes: Record<string, { old?: unknown; new?: unknown }>;
  deleted_source: boolean;
  reversal: boolean;
  transaction_valid: boolean;
  journaled: boolean;
  order: number;
}

async function restoreLegacyMeter(
  client: QueryClient, kind: InspectionAssetType, assetId: string, checkId: string,
  target: 'vehicle_maintenance' | 'hgvs', warnings: Set<string>,
) {
  const field = kind === 'plant' ? 'current_hours' : 'current_mileage';
  const stampField = kind === 'plant' ? 'last_hours_update' : 'last_mileage_update';
  const table = `${kind}_inspections`;
  const { rows: targets } = await client.query<{ id: string; snapshot: Snapshot }>(
    `SELECT id, to_jsonb(t) AS snapshot FROM public.${target} t WHERE ${target === 'hgvs' ? 'id' : `${kind}_id`} = $1 FOR UPDATE`,
    [assetId]);
  if (!targets[0]) return;
  const { id, snapshot } = targets[0];
  const unresolved = (reason: string) => {
    warnings.add(`RECONCILIATION REQUIRED: ${target}.${field}: ${reason} Current value retained; record an audited manual meter correction in asset maintenance history.`);
  };
  const { rows: journal } = await client.query<Effect>(
    `SELECT id::text, before_row, after_row, baseline_override FROM private.daily_check_effects
      WHERE target_table = $1 AND target_id = $2 ORDER BY id LIMIT 1`, [target, id]);
  const { rows: audits } = await client.query<MeterAudit>(`
    WITH sources AS (
      SELECT id, false AS deleted FROM public.${table} WHERE ${kind}_id = $1
      UNION ALL SELECT record_id, true FROM public.audit_log
        WHERE table_name = $2 AND action = 'daily_check_deleted'
          AND changes->'inspection'->>'${kind}_id' = $1::text
    ), relevant AS (
      SELECT a.*, a.xmin AS audit_xmin, coalesce(s.deleted, false) AS deleted_source
      FROM public.audit_log a LEFT JOIN sources s ON a.table_name = $2 AND s.id = a.record_id
      WHERE (a.table_name = $3 AND a.record_id = $4 AND a.changes ? $5)
        OR (s.id IS NOT NULL AND a.changes->'current_mileage' ? 'new')
    ), transaction_stamps AS (
      SELECT a.xmin::text AS xid, count(DISTINCT a.created_at) AS stamps
      FROM public.audit_log a WHERE a.xmin::text IN (SELECT audit_xmin::text FROM relevant) GROUP BY a.xmin::text
    )
    SELECT r.id, r.record_id, r.table_name, r.audit_xmin::text AS xid, r.created_at::text AS stamp,
      r.changes, r.deleted_source,
      (extract(epoch FROM r.created_at) * 1000000)::float8 AS "order",
      EXISTS (SELECT 1 FROM private.daily_check_effects e WHERE e.target_table = $3 AND e.target_id = $4
        AND e.transaction_id % 4294967296 = r.audit_xmin::text::bigint) AS journaled,
      r.audit_xmin::text::bigint > 2 AND age(r.audit_xmin) BETWEEN 0 AND 150000000 AND t.stamps = 1 AS transaction_valid,
      EXISTS (SELECT 1 FROM public.audit_log d WHERE d.action = 'daily_check_deleted'
        AND d.xmin = r.audit_xmin AND d.created_at = r.created_at) AS reversal
    FROM relevant r JOIN transaction_stamps t ON t.xid = r.audit_xmin::text
    ORDER BY r.created_at, r.id`, [assetId, table, target, id, field]);
  const sourceAudits = audits.filter(audit => audit.table_name === table);
  const meterAudits = audits.filter(audit => audit.table_name === target && !audit.journaled &&
    Object.hasOwn(audit.changes[field], 'new'));
  const owned = new Set<string>();
  const excluded = new Set<string>();
  for (const audit of meterAudits) {
    if (audit.reversal) { excluded.add(audit.id); continue; }
    const matches = sourceAudits.filter(source => source.xid === audit.xid && source.stamp === audit.stamp &&
      isDeepStrictEqual(source.changes.current_mileage.new, audit.changes[field].new));
    const uniqueTransition = meterAudits.filter(other => other.xid === audit.xid && other.stamp === audit.stamp).length === 1;
    const uniqueSource = matches.length === 1 && sourceAudits.filter(source =>
      source.record_id === matches[0].record_id && source.stamp === audit.stamp &&
      isDeepStrictEqual(source.changes.current_mileage.new, audit.changes[field].new)).length === 1;
    if (matches.some(source => source.record_id === checkId) &&
      (!audit.transaction_valid || !uniqueTransition || !uniqueSource || !matches[0].transaction_valid)) {
      unresolved('Audit transaction correlation is ambiguous, revised or too old to verify.');
      return;
    }
    if (audit.transaction_valid && uniqueTransition && uniqueSource && matches[0].transaction_valid) {
      if (matches[0].record_id === checkId) owned.add(audit.id);
      if (matches[0].record_id === checkId || matches[0].deleted_source) excluded.add(audit.id);
    }
  }
  if (!owned.size) {
    unresolved('No unique original inspection/asset audit transaction establishes meter ownership.');
    return;
  }
  // Only pre-journal history supplies its baseline. Later journal events replay their own deltas.
  const firstJournal = journal[0];
  const legacy = meterAudits;
  const first = legacy[0];
  if (!first) { unresolved('No historical meter timeline precedes the journal.'); return; }
  let known = Object.hasOwn(first.changes[field], 'old');
  let value = first.changes[field].old;
  let meterStamp: unknown = first.changes[stampField]?.old ?? null;
  if (!known) {
    const { rows: prior } = await client.query<{ value: string | null; stamp: string }>(`
      WITH candidates AS (
        SELECT new_value AS value, created_at FROM public.maintenance_history
          WHERE ${kind}_id = $1 AND field_name = $2 AND created_at < $3::timestamptz
            AND daily_check_id IS DISTINCT FROM $4::uuid AND coalesce(comment, '') NOT LIKE 'Daily Check % deleted.%'
        UNION ALL
        SELECT a.changes->'current_mileage'->>'new', a.created_at FROM public.audit_log a
          JOIN public.${table} i ON i.id = a.record_id
          WHERE a.table_name = $5 AND i.${kind}_id = $1 AND i.id <> $4
            AND a.changes->'current_mileage' ? 'new' AND a.created_at < $3::timestamptz
      ) SELECT value, created_at::text AS stamp FROM candidates
        WHERE created_at = (SELECT max(created_at) FROM candidates)`, [assetId, field, first.stamp, checkId, table]);
    const values = new Set(prior.map(row => row.value));
    if (values.size === 1 && (prior[0].value === null || /^\d+(?:\.\d+)?$/u.test(prior[0].value))) {
      value = prior[0].value === null ? null : Number(prior[0].value);
      meterStamp = prior[0].stamp;
      known = true;
    }
  }
  let actual = first.changes[field].old;
  const { rows: independent } = target === 'vehicle_maintenance' ? await client.query<{
    value: string | null; stamp: string; order: number;
  }>(`SELECT new_value AS value, created_at::text AS stamp,
      (extract(epoch FROM created_at) * 1000000)::float8 AS "order" FROM public.maintenance_history
    WHERE ${kind}_id = $1 AND field_name = $2 AND daily_check_id IS NULL
      AND coalesce(comment, '') NOT LIKE 'Daily Check % deleted.%'
      AND created_at >= $3::timestamptz
      AND ($4::bigint IS NULL OR created_at < (SELECT created_at FROM private.daily_check_effects WHERE id = $4))`,
  [assetId, field, first.stamp, firstJournal?.id ?? null]) : { rows: [] };
  const timeline = [
    ...legacy.map(audit => ({ order: audit.order, audit, history: undefined })),
    ...independent.map(history => ({ order: history.order, audit: undefined, history })),
  ].sort((a, b) => a.order - b.order);
  for (const entry of timeline) {
    const { audit, history } = entry;
    if (history) {
      if (history.value !== null && !/^\d+(?:\.\d+)?$/u.test(history.value)) {
        unresolved('A manual/workshop history reading is not a valid meter value.'); return;
      }
      const historyValue = history.value === null ? null : Number(history.value);
      if (legacy.some(other => other.order === entry.order && excluded.has(other.id) &&
          !isDeepStrictEqual(other.changes[field].new, historyValue))) {
        unresolved('Manual and inspection readings have an ambiguous shared transaction timestamp.'); return;
      }
      value = historyValue;
      meterStamp = history.stamp;
      known = true;
      continue;
    }
    if (!audit) continue;
    const change = audit.changes[field];
    if (Object.hasOwn(change, 'old') && actual !== undefined && !isDeepStrictEqual(actual, change.old)) {
      unresolved('The asset audit timeline has a missing or conflicting transition.');
      return;
    }
    actual = change.new;
    if (!excluded.has(audit.id)) {
      value = change.new;
      known = true;
      meterStamp = audit.changes[stampField]?.new ?? audit.stamp;
    }
  }
  const expected = firstJournal?.before_row ? firstJournal.before_row[field] : snapshot[field];
  if (!isDeepStrictEqual(actual, expected)) {
    unresolved('The current asset or journal baseline does not match the recorded meter timeline.');
    return;
  }
  if (!known) { unresolved('Neither a before-image nor a prior valid check/manual/workshop reading exists.'); return; }
  const restored = { [field]: value, ...(target === 'vehicle_maintenance' ? { [stampField]: meterStamp } : {}) };
  if (firstJournal) {
    await client.query('UPDATE private.daily_check_effects SET baseline_override = $2::jsonb WHERE id = $1',
      [firstJournal.id, JSON.stringify({ ...firstJournal.before_row, ...restored })]);
    await restoreTarget(client, target, id, warnings);
  } else {
    const keys = Object.keys(restored).filter(key => !isDeepStrictEqual(snapshot[key], restored[key]));
    if (keys.length) {
      const columns = keys.map(quote).join(', ');
      await client.query(`UPDATE public.${target} SET (${columns}) =
        (SELECT ${columns} FROM jsonb_populate_record(NULL::public.${target}, $2::jsonb)) WHERE id = $1`,
      [id, JSON.stringify(restored)]);
    }
  }
}

// Session/effective-role authorization must precede entry; this transaction uses a privileged connection.
export async function deleteInspection(
  client: QueryClient, assetType: InspectionAssetType, inspectionId: string, actorId: string,
): Promise<InspectionDeletionResult> {
  const table = `${assetType}_inspections`;
  const warnings = new Set<string>();
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '20s'");
    const { rows } = await client.query<{ snapshot: Snapshot; asset_id: string | null }>(
      `SELECT to_jsonb(t) AS snapshot, ${assetType}_id AS asset_id FROM public.${table} t WHERE id = $1 FOR UPDATE`, [inspectionId]);
    if (!rows[0]) {
      const previous = await client.query<{ changes: { warnings: string[] } }>(`SELECT changes FROM public.audit_log
        WHERE table_name = $1 AND record_id = $2 AND action = 'daily_check_deleted'`, [table, inspectionId]);
      if (!previous.rowCount) throw new InspectionDeletionError('Daily Check not found.', 404);
      const pending = await client.query<{ count: string }>(`SELECT count(*)::text FROM private.daily_check_storage_cleanup
        WHERE source_type = $1 AND source_id = $2 AND completed_at IS NULL`, [assetType, inspectionId]);
      await client.query('COMMIT');
      return { success: true, alreadyDeleted: true, warnings: previous.rows[0].changes.warnings,
        storageCleanupPending: Number(pending.rows[0].count) };
    }
    const { snapshot, asset_id: assetId } = rows[0];
    let previousReading: string | null = null;
    if (assetId) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('daily-check:' || $1 || ':' || $2, 0))", [assetType, assetId]);
      const { rows: before } = await client.query<{ reading: string | null }>(
        `SELECT ${assetType === 'plant' ? 'current_hours' : 'current_mileage'}::text AS reading
        FROM public.vehicle_maintenance WHERE ${assetType}_id = $1 FOR UPDATE`, [assetId]);
      previousReading = before[0]?.reading ?? null;
      if (assetType === 'hgv') await client.query('SELECT id FROM public.hgvs WHERE id = $1 FOR UPDATE', [assetId]);
    }
    // Lock dependents before taking the journal snapshot; their writers acquire the same parent key lock.
    await client.query(`SELECT id FROM public.actions WHERE inspection_id = $1 OR inspection_item_id IN
      (SELECT id FROM public.inspection_items WHERE inspection_id = $1) ORDER BY id FOR UPDATE`, [inspectionId]);
    const { rows: children } = await client.query<{ snapshot: Snapshot }>(`SELECT jsonb_build_object(
      'items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.inspection_items t WHERE inspection_id = $1),
      'photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.inspection_photos t WHERE inspection_id = $1),
      'daily_hours', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.inspection_daily_hours t WHERE inspection_id = $1),
      'linked_tasks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]') FROM public.actions t WHERE inspection_id = $1
        OR inspection_item_id IN (SELECT id FROM public.inspection_items WHERE inspection_id = $1))
    ) AS snapshot`, [inspectionId]);
    const { rows: affected } = await client.query<{ target_table: Target; target_id: string }>(
      `SELECT DISTINCT target_table, target_id FROM private.daily_check_effects
       WHERE source_type = $1 AND source_id = $2 AND voided_at IS NULL ORDER BY target_table, target_id`, [assetType, inspectionId]);
    const { rows: checkpoint } = await client.query<{ id: string }>('SELECT COALESCE(max(id), 0)::text AS id FROM private.daily_check_effects');
    await client.query(`UPDATE private.daily_check_effects SET voided_at = clock_timestamp()
      WHERE source_type = $1 AND source_id = $2 AND voided_at IS NULL`, [assetType, inspectionId]);
    for (const effect of affected) await restoreTarget(client, effect.target_table, effect.target_id, warnings);

    if (assetId && snapshot.current_mileage !== null) {
      if (!affected.some(effect => effect.target_table === 'vehicle_maintenance')) {
        await restoreLegacyMeter(client, assetType, assetId, inspectionId, 'vehicle_maintenance', warnings);
      }
      if (assetType === 'hgv' && !affected.some(effect => effect.target_table === 'hgvs')) {
        await restoreLegacyMeter(client, assetType, assetId, inspectionId, 'hgvs', warnings);
      }
    }
    await client.query(`INSERT INTO public.workshop_task_check_photos
      (task_id, id, inspection_id, item_number, day_of_week, photo_url, caption, created_at)
      SELECT a.id, p.id, p.inspection_id, p.item_number, p.day_of_week, p.photo_url, p.caption, p.created_at
      FROM public.actions a JOIN public.inspection_items i ON i.id = a.inspection_item_id
      JOIN public.inspection_photos p ON p.inspection_id = $1 AND p.item_number = i.item_number
        AND (p.day_of_week IS NOT DISTINCT FROM i.day_of_week OR p.day_of_week IS NULL)
      WHERE a.inspection_id = $1 OR a.id IN (SELECT target_id FROM private.daily_check_effects
        WHERE source_type = $2 AND source_id = $1 AND target_table = 'actions')
      ON CONFLICT DO NOTHING`, [inspectionId, assetType]);
    const detached = await client.query(`UPDATE public.actions SET inspection_id = NULL, inspection_item_id = NULL
      WHERE inspection_id = $1 OR inspection_item_id IN (SELECT id FROM public.inspection_items WHERE inspection_id = $1)`,
    [inspectionId]);
    if (detached.rowCount) warnings.add('Shared, historical or later workshop tasks were preserved and detached.');
    if (!affected.some(effect => effect.target_table === 'reminders' || effect.target_table === 'reminder_actions') && snapshot.status === 'submitted') {
      warnings.add('No causal reminder history exists for this check. Historical reminder completions were not guessed or reopened.');
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('daily-check-photo:' || photo_url, 0))
      FROM (SELECT DISTINCT photo_url FROM public.inspection_photos WHERE inspection_id = $1 ORDER BY photo_url) photos`, [inspectionId]);
    await client.query(`INSERT INTO private.daily_check_storage_cleanup (source_type, source_id, photo_url)
      SELECT $1, $2, p.photo_url FROM public.inspection_photos p WHERE p.inspection_id = $2
      ON CONFLICT DO NOTHING`, [assetType, inspectionId]);
    const { rows: removedHistory } = await client.query<{ snapshot: Snapshot }>(
      `DELETE FROM public.maintenance_history WHERE daily_check_id = $1 AND daily_check_type = $2 RETURNING to_jsonb(maintenance_history) AS snapshot`,
      [inspectionId, assetType]);
    await client.query('DELETE FROM public.inspection_photos WHERE inspection_id = $1', [inspectionId]);
    await client.query('DELETE FROM public.inspection_daily_hours WHERE inspection_id = $1', [inspectionId]);
    await client.query('DELETE FROM public.inspection_items WHERE inspection_id = $1', [inspectionId]);
    await client.query(`DELETE FROM public.${table} WHERE id = $1`, [inspectionId]);
    if (assetId) {
      const field = assetType === 'plant' ? 'current_hours' : 'current_mileage';
      await client.query(`INSERT INTO public.maintenance_history
        (${assetType}_id, field_name, old_value, new_value, value_type, comment, updated_by)
        SELECT $1, $2, $3, ${field}::text, $4, $5, $6 FROM public.vehicle_maintenance WHERE ${assetType}_id = $1`,
      [assetId, field, previousReading,
        assetType === 'plant' ? 'text' : 'mileage',
        `Daily Check ${inspectionId} deleted. ${[...warnings].join(' ') || 'Verified previous reading restored; later changes preserved.'}`, actorId]);
    }
    await client.query(`INSERT INTO public.audit_log (table_name, record_id, user_id, action, changes)
      VALUES ($1, $2, $3, 'daily_check_deleted', $4::jsonb)`,
    [table, inspectionId, actorId, JSON.stringify({
      inspection: snapshot, children: children[0].snapshot, effects: affected,
      removed_history: removedHistory.map(row => row.snapshot), warnings: [...warnings],
    })]);
    // Reversal writes remain accountable, but must not become new independent meter/task inputs.
    await client.query(`UPDATE private.daily_check_effects SET voided_at = clock_timestamp()
      WHERE id > $1::bigint AND transaction_id = txid_current()`, [checkpoint[0].id]);
    const { rows: pending } = await client.query<{ count: string }>(`SELECT count(*)::text FROM private.daily_check_storage_cleanup
      WHERE source_type = $1 AND source_id = $2 AND completed_at IS NULL`, [assetType, inspectionId]);
    await client.query('COMMIT');
    return { success: true, alreadyDeleted: false, warnings: [...warnings], storageCleanupPending: Number(pending[0].count) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function cleanupInspectionStorage(
  client: QueryClient, assetType: InspectionAssetType, inspectionId: string,
  storage: InspectionPhotoStorage,
): Promise<number> {
  const { rows } = await client.query<{ id: string; photo_url: string }>(`SELECT id::text, photo_url FROM private.daily_check_storage_cleanup
    WHERE source_type = $1 AND source_id = $2 AND completed_at IS NULL`, [assetType, inspectionId]);
  for (const row of rows) {
    let failure: string | null = null;
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const url = URL.canParse(row.photo_url) ? new URL(row.photo_url) : null;
    const prefix = `/storage/v1/object/public/inspection-photos/${inspectionId}/`;
    if (!base || !url || url.origin !== new URL(base).origin || !url.pathname.startsWith(prefix)) {
      failure = 'Photo ownership could not be verified; manual storage reconciliation required.';
    } else {
      {
        let path: string | null = null;
        try { path = decodeURIComponent(url.pathname.slice('/storage/v1/object/public/inspection-photos/'.length)); }
        catch { failure = 'Malformed photo path; manual storage reconciliation required.'; }
        if (path && (path.includes('\\') || path.split('/').some(part => part === '..' || part === '.'))) {
          failure = 'Unsafe photo path; manual storage reconciliation required.';
        }
        if (path && !/^[a-zA-Z0-9_./-]+$/u.test(path)) {
          failure = 'Ambiguous photo path alias; manual storage reconciliation required.';
        }
        if (path && !failure && await isPhotoReferenced(client, path)) {
          failure = 'Photo is still referenced; storage object preserved.';
        }
        if (path && !failure) {
          try {
            const { error } = await storage.from('inspection-photos').remove([path]);
            if (error) failure = 'Storage removal failed; retry this deletion to retry photo cleanup.';
          } catch {
            failure = 'Storage removal threw an error; retry this deletion to retry photo cleanup.';
          }
        }
      }
    }
    await client.query(`UPDATE private.daily_check_storage_cleanup SET attempts = attempts + 1,
      last_error = $2, completed_at = CASE WHEN $2::text IS NULL THEN clock_timestamp() ELSE NULL END WHERE id = $1`, [row.id, failure]);
  }
  const { rows: pending } = await client.query<{ count: string }>(`SELECT count(*)::text FROM private.daily_check_storage_cleanup
    WHERE source_type = $1 AND source_id = $2 AND completed_at IS NULL`, [assetType, inspectionId]);
  return Number(pending[0].count);
}
