import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

type AssetType = 'van' | 'hgv' | 'plant';

type Candidate = {
  action_id: string;
  asset_type: AssetType;
  asset_id: string;
  inspection_id: string;
  inspection_item_id: string | null;
  title: string | null;
  description: string | null;
  logged_comment: string | null;
  workshop_comments: string | null;
  latest_deleted_at: string;
  deleted_item_count: number;
};

type AuditInspectionItem = {
  id: string;
  inspection_id: string;
  item_number: number;
  item_description: string | null;
  status: 'ok' | 'attention' | 'defect' | 'na';
  comments: string | null;
  day_of_week: number;
  original_created_at: string | null;
};

type RestoredItem = {
  id: string;
  item_number: number;
  item_description: string | null;
  comments: string | null;
};

type InspectionInfo = {
  inspection_date: string;
};

const ACTIVE_STATUSES = ['pending', 'logged', 'on_hold', 'in_progress'];
const dryRun = process.argv.includes('--dry-run');

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string. Set POSTGRES_URL_NON_POOLING in .env.local.');
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString!);
  return new pg.Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
}

function parseItemNumber(description: string | null): number | null {
  const match = description?.match(/Item\s+(\d+)\s*-/i);
  if (!match) return null;
  const itemNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(itemNumber) ? itemNumber : null;
}

function extractCommentFromDescription(description: string | null): string {
  const match = description?.match(/(?:^|\n)Comment:\s*(.+?)(?:\n|$)/i);
  return match?.[1]?.trim() || '';
}

function withDescriptionComment(description: string | null, comment: string): string | null {
  if (!description || !comment.trim()) return description;

  const nextCommentLine = `Comment: ${comment.trim()}`;
  if (/(^|\n)Comment:\s*.*(?=\n|$)/i.test(description)) {
    return description.replace(/(^|\n)Comment:\s*.*(?=\n|$)/i, `$1${nextCommentLine}`);
  }

  return `${description.trimEnd()}\n${nextCommentLine}`;
}

function getInspectionTable(assetType: AssetType): { table: string; assetColumn: string } {
  if (assetType === 'hgv') {
    return { table: 'hgv_inspections', assetColumn: 'hgv_id' };
  }
  if (assetType === 'plant') {
    return { table: 'plant_inspections', assetColumn: 'plant_id' };
  }
  return { table: 'van_inspections', assetColumn: 'van_id' };
}

async function findCandidates(client: pg.Client): Promise<Candidate[]> {
  const { rows } = await client.query<Candidate>(
    `
    WITH active_actions AS (
      SELECT
        a.id AS action_id,
        CASE
          WHEN a.hgv_id IS NOT NULL THEN 'hgv'
          WHEN a.plant_id IS NOT NULL THEN 'plant'
          WHEN a.van_id IS NOT NULL THEN 'van'
          ELSE NULL
        END AS asset_type,
        COALESCE(a.hgv_id, a.plant_id, a.van_id) AS asset_id,
        a.inspection_id,
        a.inspection_item_id,
        a.title,
        a.description,
        a.logged_comment,
        a.workshop_comments
      FROM public.actions a
      WHERE a.action_type = 'inspection_defect'
        AND a.status = ANY($1)
        AND a.inspection_id IS NOT NULL
        AND COALESCE(a.hgv_id, a.plant_id, a.van_id) IS NOT NULL
    ),
    item_counts AS (
      SELECT inspection_id, COUNT(*)::int AS current_item_count
      FROM public.inspection_items
      GROUP BY inspection_id
    ),
    deleted_batches AS (
      SELECT
        (changes->'inspection_id'->>'old')::uuid AS inspection_id,
        created_at AS latest_deleted_at,
        COUNT(*)::int AS deleted_item_count,
        ROW_NUMBER() OVER (
          PARTITION BY (changes->'inspection_id'->>'old')::uuid
          ORDER BY created_at DESC
        ) AS rn
      FROM public.audit_log
      WHERE table_name = 'inspection_items'
        AND action = 'deleted'
        AND changes->'inspection_id'->>'old' IS NOT NULL
      GROUP BY (changes->'inspection_id'->>'old')::uuid, created_at
    )
    SELECT
      aa.action_id,
      aa.asset_type,
      aa.asset_id,
      aa.inspection_id,
      aa.inspection_item_id,
      aa.title,
      aa.description,
      aa.logged_comment,
      aa.workshop_comments,
      db.latest_deleted_at,
      db.deleted_item_count
    FROM active_actions aa
    LEFT JOIN item_counts ic ON ic.inspection_id = aa.inspection_id
    JOIN deleted_batches db ON db.inspection_id = aa.inspection_id AND db.rn = 1
    WHERE aa.asset_type IS NOT NULL
      AND COALESCE(ic.current_item_count, 0) = 0
    ORDER BY aa.action_id;
    `,
    [ACTIVE_STATUSES]
  );

  return rows;
}

async function loadAuditItems(client: pg.Client, candidate: Candidate): Promise<AuditInspectionItem[]> {
  const { rows } = await client.query<AuditInspectionItem>(
    `
    WITH latest_batch AS (
      SELECT MAX(created_at) AS deleted_at
      FROM public.audit_log
      WHERE table_name = 'inspection_items'
        AND action = 'deleted'
        AND changes->'inspection_id'->>'old' = $1
    )
    SELECT
      al.record_id::text AS id,
      al.changes->'inspection_id'->>'old' AS inspection_id,
      (al.changes->'item_number'->>'old')::int AS item_number,
      al.changes->'item_description'->>'old' AS item_description,
      al.changes->'status'->>'old' AS status,
      al.changes->'comments'->>'old' AS comments,
      (al.changes->'day_of_week'->>'old')::int AS day_of_week,
      created_audit.created_at::text AS original_created_at
    FROM public.audit_log al
    LEFT JOIN public.audit_log created_audit
      ON created_audit.table_name = 'inspection_items'
      AND created_audit.action = 'created'
      AND created_audit.record_id = al.record_id
    WHERE al.table_name = 'inspection_items'
      AND al.action = 'deleted'
      AND al.created_at = (SELECT deleted_at FROM latest_batch)
      AND al.changes->'inspection_id'->>'old' = $1
    ORDER BY (al.changes->'item_number'->>'old')::int, (al.changes->'day_of_week'->>'old')::int NULLS LAST;
    `,
    [candidate.inspection_id]
  );

  return rows;
}

async function restoreItems(client: pg.Client, items: AuditInspectionItem[]): Promise<number> {
  let inserted = 0;

  for (const item of items) {
    const result = await client.query(
      `
      INSERT INTO public.inspection_items (
        id,
        inspection_id,
        item_number,
        item_description,
        status,
        comments,
        created_at,
        day_of_week
      )
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()), $8)
      ON CONFLICT (id) DO NOTHING;
      `,
      [
        item.id,
        item.inspection_id,
        item.item_number,
        item.item_description,
        item.status,
        item.comments,
        item.original_created_at,
        item.day_of_week,
      ]
    );
    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

async function getRestoredItemForTask(
  client: pg.Client,
  candidate: Candidate
): Promise<RestoredItem | null> {
  const itemNumber = parseItemNumber(candidate.description);
  if (!itemNumber) return null;

  const { rows } = await client.query<RestoredItem>(
    `
    SELECT id, item_number, item_description, comments
    FROM public.inspection_items
    WHERE inspection_id = $1::uuid
      AND item_number = $2
    ORDER BY day_of_week NULLS LAST, created_at NULLS LAST
    LIMIT 1;
    `,
    [candidate.inspection_id, itemNumber]
  );

  return rows[0] ?? null;
}

async function getInspectionInfo(
  client: pg.Client,
  assetType: AssetType,
  inspectionId: string
): Promise<InspectionInfo> {
  const { table } = getInspectionTable(assetType);
  const { rows } = await client.query<InspectionInfo>(
    `SELECT inspection_date::text AS inspection_date FROM public.${table} WHERE id = $1::uuid`,
    [inspectionId]
  );

  if (!rows[0]) {
    throw new Error(`Inspection ${inspectionId} not found in ${table}`);
  }

  return rows[0];
}

async function updateActionOriginalItem(
  client: pg.Client,
  candidate: Candidate,
  restoredItem: RestoredItem
): Promise<number> {
  const originalComment = restoredItem.comments?.trim() || extractCommentFromDescription(candidate.description);
  const nextDescription = withDescriptionComment(candidate.description, originalComment);
  const result = await client.query(
    `
    UPDATE public.actions
    SET
      inspection_item_id = $2::uuid,
      description = $3,
      updated_at = NOW()
    WHERE id = $1::uuid
      AND inspection_id = $4::uuid;
    `,
    [candidate.action_id, restoredItem.id, nextDescription, candidate.inspection_id]
  );

  return result.rowCount ?? 0;
}

async function updateSubsequentInspectionComments(
  client: pg.Client,
  candidate: Candidate,
  restoredItem: RestoredItem,
  inspectionDate: string
): Promise<number> {
  const originalComment = restoredItem.comments?.trim();
  if (!originalComment) return 0;

  const { table, assetColumn } = getInspectionTable(candidate.asset_type);
  const result = await client.query(
    `
    UPDATE public.inspection_items ii
    SET comments = $5
    FROM public.${table} inspection
    WHERE inspection.id = ii.inspection_id
      AND inspection.${assetColumn} = $1::uuid
      AND inspection.inspection_date >= $2::date
      AND ii.inspection_id <> $3::uuid
      AND ii.item_number = $4
      AND ii.status = 'attention'
      AND ii.comments IS DISTINCT FROM $5;
    `,
    [
      candidate.asset_id,
      inspectionDate,
      candidate.inspection_id,
      restoredItem.item_number,
      originalComment,
    ]
  );

  return result.rowCount ?? 0;
}

async function main() {
  const client = createClient();
  await client.connect();

  try {
    const candidates = await findCandidates(client);
    console.log(`Found ${candidates.length} active task(s) linked to inspections with no checklist rows.`);

    if (candidates.length === 0) {
      return;
    }

    for (const candidate of candidates) {
      console.log(`- ${candidate.asset_type.toUpperCase()} task ${candidate.action_id} -> inspection ${candidate.inspection_id}`);
      console.log(`  Recoverable deleted batch: ${candidate.deleted_item_count} item(s) at ${candidate.latest_deleted_at}`);
    }

    if (dryRun) {
      console.log('Dry run only. No changes applied.');
      return;
    }

    await client.query('BEGIN');

    for (const candidate of candidates) {
      const auditItems = await loadAuditItems(client, candidate);
      if (auditItems.length === 0) {
        throw new Error(`No audit items found for inspection ${candidate.inspection_id}`);
      }

      const inserted = await restoreItems(client, auditItems);
      console.log(`Restored ${inserted}/${auditItems.length} checklist item(s) for inspection ${candidate.inspection_id}`);

      const restoredItem = await getRestoredItemForTask(client, candidate);
      if (!restoredItem) {
        throw new Error(`Could not resolve restored task item for action ${candidate.action_id}`);
      }

      const actionUpdates = await updateActionOriginalItem(client, candidate, restoredItem);
      const inspectionInfo = await getInspectionInfo(client, candidate.asset_type, candidate.inspection_id);
      const subsequentCommentUpdates = await updateSubsequentInspectionComments(
        client,
        candidate,
        restoredItem,
        inspectionInfo.inspection_date
      );

      console.log(`Updated ${actionUpdates} active task pointer(s) for ${candidate.action_id}`);
      console.log(`Updated ${subsequentCommentUpdates} subsequent inspection comment(s) to original comment`);
    }

    await client.query('COMMIT');
    console.log('Repair completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Repair failed:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Unexpected repair failure:', error);
  process.exit(1);
});
