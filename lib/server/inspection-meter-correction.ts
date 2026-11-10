import 'server-only';
import pg from 'pg';
import {
  type InspectionAssetType, type InspectionMeterCorrection, type InspectionMeterSnapshot,
  type InspectionMeterHistoryEntry, inspectionMeterUnit,
} from '@/lib/inspections/meter-correction';

const TABLES = { van: 'van_inspections', plant: 'plant_inspections', hgv: 'hgv_inspections' } as const;
const AUDIT_ACTION = 'daily_check_meter_correction';
type QueryClient = Pick<pg.Client, 'query'>;

export class InspectionMeterCorrectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function withInspectionMeterDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) throw new InspectionMeterCorrectionError('Reading corrections are temporarily unavailable.', 503);
  const url = new URL(connectionString);
  const client = new pg.Client({
    host: url.hostname, port: Number(url.port || '5432'), database: url.pathname.slice(1),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    return await work(client);
  } finally { await client.end(); }
}

interface InspectionReadingRow {
  current_mileage: number | null;
  version: string;
  status: string;
  asset_id: string | null;
}

async function getRecordedMeterSource(client: QueryClient, table: 'vehicle_maintenance' | 'hgvs', id: string) {
  const { rows } = await client.query<{ source_id: string | null; source_type: InspectionAssetType | null }>(
    `SELECT e.source_id, e.source_type FROM public.${table} t
     JOIN LATERAL (SELECT source_id, source_type, after_row FROM private.daily_check_effects
       WHERE target_table = $1 AND target_id = t.id AND voided_at IS NULL ORDER BY id DESC LIMIT 1) e
       ON e.after_row <@ to_jsonb(t) WHERE t.id = $2`, [table, id]);
  return rows[0];
}

async function readInspection(client: QueryClient, assetType: InspectionAssetType, id: string, lock = false) {
  const { rows } = await client.query<InspectionReadingRow>(
    `SELECT current_mileage, updated_at::text AS version, status, ${assetType}_id AS asset_id
     FROM public.${TABLES[assetType]} WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  const row = rows[0];
  if (!row) throw new InspectionMeterCorrectionError('Daily Check not found.', 404);
  if (row.status !== 'submitted') throw new InspectionMeterCorrectionError('Only submitted Daily Checks can be corrected.', 409);
  return row;
}

export async function getInspectionMeterSnapshot(client: QueryClient, assetType: InspectionAssetType, id: string): Promise<InspectionMeterSnapshot> {
  const row = await readInspection(client, assetType, id);
  const { rows: history } = await client.query<InspectionMeterHistoryEntry>(
    `SELECT a.id, a.created_at, p.full_name AS actor_name, a.changes
     FROM public.audit_log a LEFT JOIN public.profiles p ON p.id = a.user_id
     WHERE a.table_name = $1 AND a.record_id = $2 AND a.action = $3
     ORDER BY a.created_at DESC, a.id DESC`, [TABLES[assetType], id, AUDIT_ACTION]);
  return { reading: row.current_mileage, version: row.version, history };
}

// Export the transaction body for disposable PostgreSQL integration tests.
// The route is responsible for session/effective-role authorization first.
export async function correctInspectionMeter(client: QueryClient, actorId: string, input: InspectionMeterCorrection) {
  const { assetType, inspectionId, reading } = input;
  const table = TABLES[assetType];
  const meter = assetType === 'plant' ? 'current_hours' : 'current_mileage';
  const timestamp = assetType === 'plant' ? 'last_hours_update' : 'last_mileage_update';
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    const row = await readInspection(client, assetType, inspectionId, true);
    if (row.current_mileage !== input.expectedReading || row.version !== input.expectedVersion) {
      throw new InspectionMeterCorrectionError('This check changed since you opened it. Close and reopen Edit reading to load the latest value.', 409);
    }
    if (row.current_mileage === reading) throw new InspectionMeterCorrectionError('Enter a different reading to save a correction.');
    if (row.asset_id) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('daily-check:' || $1 || ':' || $2, 0))", [assetType, row.asset_id]);
    }

    // Existing inspection triggers overwrite maintenance on every mileage update.
    // Lock and snapshot that row before firing them, then restore a newer source
    // or recompute the latest submitted check if the erroneous value was current.
    const { rows: maintenance } = row.asset_id ? await client.query<{
      id: string; reading: number | null; meter_updated_at: string | null; source_not_newer: boolean;
    }>(`SELECT id, ${meter} AS reading, ${timestamp}::text AS meter_updated_at,
        (${timestamp} IS NULL OR ${timestamp} <= $2::timestamptz) AS source_not_newer
        FROM public.vehicle_maintenance WHERE ${assetType}_id = $1 FOR UPDATE`, [row.asset_id, row.version]) : { rows: [] };
    const before = maintenance[0];
    const journalActive = (await client.query<{ active: boolean }>(
      "SELECT to_regclass('private.daily_check_effects') IS NOT NULL AS active")).rows[0].active;
    const hgvBefore = assetType === 'hgv' && row.asset_id
      ? (await client.query<{ current_mileage: number | null }>(
        'SELECT current_mileage FROM public.hgvs WHERE id = $1 FOR UPDATE', [row.asset_id])).rows[0]
      : undefined;
    const meterSource = journalActive && before
      ? await getRecordedMeterSource(client, 'vehicle_maintenance', before.id) : undefined;
    const hgvSource = journalActive && hgvBefore && row.asset_id
      ? await getRecordedMeterSource(client, 'hgvs', row.asset_id) : undefined;
    await client.query(`UPDATE public.${table} SET current_mileage = $2, updated_at = NOW() WHERE id = $1`, [inspectionId, reading]);

    let assetReadingUpdated = false;
    if (row.asset_id) {
      const { rows: latest } = await client.query<{ id: string; current_mileage: number }>(
        `SELECT id, current_mileage FROM public.${table}
         WHERE ${assetType}_id = $1 AND status = 'submitted' AND current_mileage IS NOT NULL
         ORDER BY inspection_date DESC, submitted_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1`, [row.asset_id]);
      const latestReading = latest[0]?.current_mileage ?? reading;
      const replaceCurrent = !before || (journalActive
        ? meterSource?.source_id === inspectionId && meterSource.source_type === assetType
        : before.reading === row.current_mileage && before.source_not_newer);
      const nextReading = replaceCurrent ? latestReading : before.reading;
      const sourceId = replaceCurrent ? (latest[0]?.id ?? inspectionId) : meterSource?.source_id ?? null;
      assetReadingUpdated = replaceCurrent && nextReading !== before?.reading;
      await client.query(
        `UPDATE public.vehicle_maintenance SET ${meter} = $2,
         ${timestamp} = CASE WHEN $3 THEN NOW() ELSE $4::timestamptz END
         ${journalActive ? ', daily_check_source_id = $5, daily_check_source_type = $6' : ''}
         WHERE ${assetType}_id = $1`, [row.asset_id, nextReading, assetReadingUpdated, before?.meter_updated_at ?? null,
          ...(journalActive ? [sourceId, sourceId ? assetType : null] : [])]);
      // HGV save also maintains hgvs.current_mileage separately from maintenance.
      if (assetType === 'hgv' && journalActive && hgvBefore) {
        const replaceHgv = hgvSource?.source_id === inspectionId && hgvSource.source_type === assetType;
        const hgvSourceId = replaceHgv ? latest[0]?.id ?? inspectionId : hgvSource?.source_id ?? null;
        await client.query(`UPDATE public.hgvs SET current_mileage = $2,
          daily_check_source_id = $3, daily_check_source_type = $4 WHERE id = $1`,
        [row.asset_id, replaceHgv ? latestReading : hgvBefore.current_mileage,
          hgvSourceId, hgvSourceId ? assetType : null]);
      } else if (assetType === 'hgv' && replaceCurrent) {
        await client.query(`UPDATE public.hgvs SET current_mileage = $2
          WHERE id = $1 AND current_mileage IS NOT DISTINCT FROM $3::integer`, [row.asset_id, latestReading, row.current_mileage]);
      }
    }
    await client.query(
      `INSERT INTO public.audit_log (table_name, record_id, user_id, action, changes)
       VALUES ($1, $2, $3, $4, $5::jsonb)`, [table, inspectionId, actorId, AUDIT_ACTION, JSON.stringify({
        old_reading: row.current_mileage, new_reading: reading, unit: inspectionMeterUnit(assetType),
        comment: input.comment?.trim() || null, asset_reading_updated: assetReadingUpdated,
      })]);
    await client.query('COMMIT');
    return { reading, assetReadingUpdated };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
