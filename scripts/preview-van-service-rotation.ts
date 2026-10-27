import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import pg from 'pg';
import { requireSafeMigrationConnectionString } from './finalise-migrations';

export const VAN_SERVICE_ROTATION_MIGRATION = 'supabase/migrations/20261027_van_service_rotation.sql';

export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

export interface VanServiceRotationPreview {
  read_only: true;
  inference_applied: false;
  note: string;
  templates: Record<string, unknown>[];
  rotation: Record<string, unknown>[];
  mileage_aggregates: Record<string, unknown>;
  proposed_next: Record<string, unknown>[];
  ambiguous_service_notes: Record<string, unknown>[];
  attachments: {
    pending_count: number;
    null_name_snapshot_count: number;
    inconsistent_version_count: number;
    rows: Record<string, unknown>[];
  };
  open_service_tasks: {
    available: boolean;
    count: number;
    rows: Record<string, unknown>[];
  };
  migration: {
    path: string;
    present: boolean;
    sha256: string | null;
    phase: string | null;
    ledger: Record<string, unknown>;
  };
}

const TEMPLATE_SQL = `
SELECT t.id, t.name, t.is_active, t.applies_to,
       COUNT(DISTINCT v.id) FILTER (WHERE v.status::text = 'published')::int AS published_versions,
       COUNT(DISTINCT f.id) FILTER (WHERE v.status::text = 'published')::int AS field_count
FROM public.workshop_attachment_templates t
LEFT JOIN public.workshop_attachment_template_versions v ON v.template_id = t.id
LEFT JOIN public.workshop_attachment_template_sections s ON s.version_id = v.id
LEFT JOIN public.workshop_attachment_template_fields f ON f.section_id = s.id
WHERE LOWER(t.name) IN ('van service', 'full service (van)', 'basic service a (van)')
GROUP BY t.id, t.name, t.is_active, t.applies_to
ORDER BY t.name
`;

const ROTATION_SQL = `
SELECT mc.config_key, mc.period_value, mc.period_unit, s.id AS step_id, s.position, t.name AS template_name
FROM public.maintenance_categories mc
LEFT JOIN public.service_rotation_steps s ON s.maintenance_category_id = mc.id
LEFT JOIN public.workshop_attachment_templates t ON t.id = s.attachment_template_id
WHERE mc.config_key IN ('service_van', 'service_hgv', 'service_plant')
ORDER BY mc.config_key, s.position
`;

const MILEAGE_SQL = `
SELECT
  COUNT(*) FILTER (WHERE van_id IS NOT NULL AND hgv_id IS NULL AND plant_id IS NULL)::int AS van_rows,
  COUNT(*) FILTER (WHERE van_id IS NOT NULL AND hgv_id IS NULL AND plant_id IS NULL AND current_mileage IS NOT NULL)::int AS current_mileage_present,
  COUNT(*) FILTER (WHERE van_id IS NOT NULL AND hgv_id IS NULL AND plant_id IS NULL AND last_service_mileage IS NOT NULL)::int AS last_service_mileage_present,
  COUNT(*) FILTER (WHERE van_id IS NOT NULL AND hgv_id IS NULL AND plant_id IS NULL AND next_service_mileage IS NOT NULL)::int AS next_service_mileage_present,
  COUNT(*) FILTER (WHERE van_id IS NOT NULL AND hgv_id IS NULL AND plant_id IS NULL AND current_mileage IS NULL)::int AS current_mileage_null,
  COUNT(*) FILTER (WHERE hgv_id IS NOT NULL)::int AS hgv_rows,
  COUNT(*) FILTER (WHERE plant_id IS NOT NULL)::int AS plant_rows
FROM public.vehicle_maintenance
`;

const PROPOSED_NEXT_SQL = `
WITH generic_template AS (
  SELECT id
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = 'van service'
),
generic_step AS (
  SELECT s.id
  FROM public.service_rotation_steps s
  JOIN public.maintenance_categories mc ON mc.id = s.maintenance_category_id
  JOIN public.workshop_attachment_templates t ON t.id = s.attachment_template_id
  WHERE mc.config_key = 'service_van'
    AND LOWER(t.name) = 'van service'
)
SELECT
  vm.id AS maintenance_id,
  vm.van_id,
  vm.current_mileage,
  vm.last_service_mileage,
  vm.next_service_mileage,
  vm.current_hours,
  vm.last_service_hours,
  vm.next_service_hours,
  last_t.name AS last_template_name,
  next_t.name AS next_template_name,
  CASE
    WHEN vm.next_service_template_id IS NULL AND vm.next_service_rotation_step_id IS NULL THEN 'retain_null'
    WHEN vm.next_service_template_id IN (SELECT id FROM generic_template)
      OR vm.next_service_rotation_step_id IN (SELECT id FROM generic_step)
      THEN 'clear_ambiguous_next'
    ELSE 'retain_explicit'
  END AS proposed_next
FROM public.vehicle_maintenance vm
LEFT JOIN public.workshop_attachment_templates last_t ON last_t.id = vm.last_service_template_id
LEFT JOIN public.workshop_attachment_templates next_t ON next_t.id = vm.next_service_template_id
WHERE vm.van_id IS NOT NULL
  AND vm.hgv_id IS NULL
  AND vm.plant_id IS NULL
ORDER BY vm.id
`;

const AMBIGUOUS_NOTES_SQL = `
WITH generic_template AS (
  SELECT id
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = 'van service'
),
generic_step AS (
  SELECT s.id
  FROM public.service_rotation_steps s
  JOIN public.maintenance_categories mc ON mc.id = s.maintenance_category_id
  JOIN public.workshop_attachment_templates t ON t.id = s.attachment_template_id
  WHERE mc.config_key = 'service_van'
    AND LOWER(t.name) = 'van service'
),
proposed AS (
  SELECT
    vm.id AS maintenance_id,
    vm.van_id,
    CASE
      WHEN vm.next_service_template_id IS NULL AND vm.next_service_rotation_step_id IS NULL THEN 'retain_null'
      WHEN vm.next_service_template_id IN (SELECT id FROM generic_template)
        OR vm.next_service_rotation_step_id IN (SELECT id FROM generic_step)
        THEN 'clear_ambiguous_next'
      ELSE 'retain_explicit'
    END AS proposed_next
  FROM public.vehicle_maintenance vm
  WHERE vm.van_id IS NOT NULL
    AND vm.hgv_id IS NULL
    AND vm.plant_id IS NULL
),
latest_event AS (
  SELECT DISTINCT ON (e.van_id)
    e.van_id,
    e.id AS event_id,
    e.notes AS event_notes,
    e.completed_template_name,
    e.next_template_name
  FROM public.asset_service_events e
  WHERE e.van_id IS NOT NULL
  ORDER BY e.van_id, e.created_at DESC NULLS LAST, e.id DESC
)
SELECT
  p.maintenance_id,
  p.van_id,
  p.proposed_next,
  (NULLIF(TRIM(vm.notes), '') IS NOT NULL) AS has_maintenance_notes,
  le.event_id,
  (NULLIF(TRIM(le.event_notes), '') IS NOT NULL) AS has_event_notes,
  le.completed_template_name,
  le.next_template_name
FROM proposed p
JOIN public.vehicle_maintenance vm ON vm.id = p.maintenance_id
LEFT JOIN latest_event le ON le.van_id = p.van_id
WHERE p.proposed_next = 'clear_ambiguous_next'
ORDER BY p.maintenance_id
`;

const ATTACHMENT_SQL = `
SELECT
  a.id AS attachment_id,
  a.status::text AS status,
  t.name AS template_name,
  a.template_name_snapshot,
  (ss.id IS NOT NULL) AS has_schema_snapshot,
  CASE
    WHEN ss.template_version_id IS NOT NULL AND v.template_id IS DISTINCT FROM a.template_id THEN TRUE
    ELSE FALSE
  END AS inconsistent_version
FROM public.workshop_task_attachments a
JOIN public.workshop_attachment_templates t ON t.id = a.template_id
LEFT JOIN public.workshop_attachment_schema_snapshots ss ON ss.attachment_id = a.id
LEFT JOIN public.workshop_attachment_template_versions v ON v.id = ss.template_version_id
WHERE LOWER(t.name) IN ('van service', 'full service (van)', 'basic service a (van)')
  AND (
    a.status::text = 'pending'
    OR a.template_name_snapshot IS NULL
    OR (ss.template_version_id IS NOT NULL AND v.template_id IS DISTINCT FROM a.template_id)
  )
ORDER BY a.id
`;

const OPEN_TASK_SQL = `
SELECT
  a.id AS task_id,
  a.status::text AS status,
  c.name AS category_name,
  c.applies_to::text AS category_scope,
  s.name AS subcategory_name,
  a.van_id,
  a.hgv_id,
  a.plant_id
FROM public.actions a
JOIN public.workshop_task_categories c ON c.id = a.workshop_category_id
LEFT JOIN public.workshop_task_subcategories s ON s.id = a.workshop_subcategory_id
WHERE a.van_id IS NOT NULL AND a.hgv_id IS NULL AND a.plant_id IS NULL
  AND a.status::text IS DISTINCT FROM 'completed'
  AND (
    c.name ILIKE '%service%'
    OR s.name ILIKE '%service%'
  )
ORDER BY a.id
`;

export const PREVIEW_SQL = [
  TEMPLATE_SQL,
  ROTATION_SQL,
  MILEAGE_SQL,
  PROPOSED_NEXT_SQL,
  AMBIGUOUS_NOTES_SQL,
  ATTACHMENT_SQL,
  OPEN_TASK_SQL,
];

export function assertPreviewInvocationReadOnly(argv: string[]): void {
  const blocked = ['--apply', '--confirm-target', '--execute', '--mutate'];
  if (argv.some((arg) => blocked.includes(arg))) {
    throw new Error('preview-van-service-rotation is read-only and cannot apply changes');
  }
}

export function redactDatabaseError(error: unknown, connectionString?: string): Error {
  const message = error instanceof Error ? error.message : 'Unknown database error';
  const redacted = connectionString ? message.split(connectionString).join('[redacted]') : message;
  if (/postgres(ql)?:\/\//i.test(redacted) || /password=/i.test(redacted)) {
    return new Error('Read-only van service preview failed without exposing the connection string');
  }
  return new Error(redacted);
}

function readMigrationFile(): { present: boolean; sha256: string | null; phase: string | null } {
  const fullPath = path.join(process.cwd(), VAN_SERVICE_ROTATION_MIGRATION);
  if (!existsSync(fullPath)) {
    return { present: false, sha256: null, phase: null };
  }
  const sql = readFileSync(fullPath);
  const phase = sql.toString('utf8').match(/--\s*finalise-phase:\s*(\w+)/)?.[1] ?? null;
  return {
    present: true,
    sha256: createHash('sha256').update(sql).digest('hex'),
    phase,
  };
}

async function relationExists(client: Queryable, relation: string): Promise<boolean> {
  const result = await client.query<{ present: string | null }>(
    'SELECT to_regclass($1) AS present',
    [relation]
  );
  return Boolean(result.rows[0]?.present);
}

export async function collectVanServiceRotationPreview(client: Queryable): Promise<VanServiceRotationPreview> {
  const file = readMigrationFile();
  const templates = await client.query(TEMPLATE_SQL);
  const rotation = await client.query(ROTATION_SQL);
  const mileage = await client.query(MILEAGE_SQL);
  const proposed = await client.query(PROPOSED_NEXT_SQL);
  const notes = await client.query(AMBIGUOUS_NOTES_SQL);
  const attachments = await client.query(ATTACHMENT_SQL);

  let openTasks: { available: boolean; count: number; rows: Record<string, unknown>[] } = {
    available: false,
    count: 0,
    rows: [],
  };
  const actionsReady = await relationExists(client, 'public.actions');
  const subcategoriesReady = await relationExists(client, 'public.workshop_task_subcategories');
  if (actionsReady && subcategoriesReady) {
    const tasks = await client.query(OPEN_TASK_SQL);
    openTasks = { available: true, count: tasks.rows.length, rows: tasks.rows };
  }

  let ledger: Record<string, unknown> = { state: 'not_present' };
  if (await relationExists(client, 'private.finalise_migration_ledger')) {
    const ledgerRows = await client.query<{
      filename: string;
      phase: string;
      checksum_sha256: string;
    }>(
      `SELECT filename, phase, checksum_sha256
       FROM private.finalise_migration_ledger
       WHERE filename = $1`,
      [VAN_SERVICE_ROTATION_MIGRATION]
    );
    const row = ledgerRows.rows[0];
    ledger = row
      ? {
          state: 'recorded',
          phase: row.phase,
          checksum_matches: row.checksum_sha256 === file.sha256,
        }
      : { state: 'absent' };
  }

  const attachmentRows = attachments.rows;
  return {
    read_only: true,
    inference_applied: false,
    note: 'Historic Van Service is not inferred as Full Service (Van). clear_ambiguous_next is proposed only while the template is still named Van Service. This preview does not apply that change.',
    templates: templates.rows,
    rotation: rotation.rows,
    mileage_aggregates: mileage.rows[0] ?? {},
    proposed_next: proposed.rows,
    ambiguous_service_notes: notes.rows,
    attachments: {
      pending_count: attachmentRows.filter((row) => row.status === 'pending').length,
      null_name_snapshot_count: attachmentRows.filter((row) => row.template_name_snapshot == null).length,
      inconsistent_version_count: attachmentRows.filter((row) => row.inconsistent_version === true).length,
      rows: attachmentRows,
    },
    open_service_tasks: openTasks,
    migration: {
      path: VAN_SERVICE_ROTATION_MIGRATION,
      present: file.present,
      sha256: file.sha256,
      phase: file.phase,
      ledger,
    },
  };
}

function readNonPoolingFromEnvFile(): string | undefined {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return undefined;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator).trim() !== 'POSTGRES_URL_NON_POOLING') continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function isDirectRun(): boolean {
  const entry = process.argv[1]?.replace(/\\/g, '/');
  return Boolean(entry && entry.endsWith('scripts/preview-van-service-rotation.ts'));
}

async function main(): Promise<void> {
  assertPreviewInvocationReadOnly(process.argv.slice(2));
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? readNonPoolingFromEnvFile();
  let safeConnection = '';
  try {
    safeConnection = requireSafeMigrationConnectionString(connectionString);
    const url = new URL(safeConnection);
    const client = new pg.Client({
      host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '20s'");
      const report = await collectVanServiceRotationPreview(client);
      await client.query('ROLLBACK');
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
      await client.end();
    }
  } catch (error) {
    throw redactDatabaseError(error, safeConnection);
  }
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Read-only van service preview failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
