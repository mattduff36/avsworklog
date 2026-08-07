import { config } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

type MismatchType =
  | 'match'
  | 'item_behind_history'
  | 'history_behind_item'
  | 'future_history'
  | 'no_history';

interface ClassificationRow {
  item_id: string;
  item_number: string;
  name: string;
  status: string;
  last_checked_at: string | null;
  max_checked_at: string | null;
  history_count: number;
  london_today: string;
  has_future_history: boolean;
  mismatch_type: MismatchType;
  proposed_action: 'none' | 'set_last_checked_to_max_history' | 'review_only';
}

interface AllowlistEntry {
  item_id: string;
  item_number: string;
  expected_last_checked_at: string | null;
  expected_max_checked_at: string;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const confirmApply = argv.includes('--confirm-apply');
  const allowlistFlagIndex = argv.indexOf('--allowlist');
  const allowlistPath = allowlistFlagIndex >= 0 ? argv[allowlistFlagIndex + 1] : null;
  return { apply, confirmApply, allowlistPath };
}

function createClient() {
  if (!connectionString) {
    throw new Error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  }

  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
}

async function classifyRows(client: pg.Client): Promise<ClassificationRow[]> {
  const { rows } = await client.query<ClassificationRow>(`
    WITH history_stats AS (
      SELECT
        item_id,
        COUNT(*)::INTEGER AS history_count,
        MAX(checked_at) AS max_checked_at,
        BOOL_OR(checked_at > (timezone('Europe/London', now()))::date) AS has_future_history
      FROM public.inventory_check_history
      GROUP BY item_id
    )
    SELECT
      i.id AS item_id,
      i.item_number,
      i.name,
      i.status,
      i.last_checked_at::text AS last_checked_at,
      hs.max_checked_at::text AS max_checked_at,
      COALESCE(hs.history_count, 0) AS history_count,
      (timezone('Europe/London', now()))::date::text AS london_today,
      COALESCE(hs.has_future_history, FALSE) AS has_future_history,
      CASE
        WHEN COALESCE(hs.history_count, 0) = 0 THEN 'no_history'
        WHEN COALESCE(hs.has_future_history, FALSE) THEN 'future_history'
        WHEN i.last_checked_at IS NULL OR i.last_checked_at < hs.max_checked_at THEN 'item_behind_history'
        WHEN i.last_checked_at > hs.max_checked_at THEN 'history_behind_item'
        ELSE 'match'
      END AS mismatch_type,
      CASE
        WHEN COALESCE(hs.history_count, 0) = 0 THEN 'none'
        WHEN COALESCE(hs.has_future_history, FALSE) THEN 'review_only'
        WHEN i.last_checked_at IS NULL OR i.last_checked_at < hs.max_checked_at THEN 'set_last_checked_to_max_history'
        WHEN i.last_checked_at > hs.max_checked_at THEN 'review_only'
        ELSE 'none'
      END AS proposed_action
    FROM public.inventory_items i
    LEFT JOIN history_stats hs ON hs.item_id = i.id
    ORDER BY i.item_number
  `);

  return rows;
}

function buildAllowlist(rows: ClassificationRow[]): AllowlistEntry[] {
  return rows
    .filter((row) => (
      row.mismatch_type === 'item_behind_history'
      && row.proposed_action === 'set_last_checked_to_max_history'
      && !row.has_future_history
      && Boolean(row.max_checked_at)
    ))
    .map((row) => ({
      item_id: row.item_id,
      item_number: row.item_number,
      expected_last_checked_at: row.last_checked_at,
      expected_max_checked_at: row.max_checked_at as string,
    }))
    .sort((left, right) => left.item_id.localeCompare(right.item_id));
}

async function applyAllowlist(
  client: pg.Client,
  allowlist: AllowlistEntry[],
  historyCountBefore: string,
  unchangedSnapshot: Map<string, ClassificationRow>,
) {
  if (allowlist.length === 0) {
    console.log('No allowlisted rows to repair.');
    return;
  }

  const sortedAllowlist = [...allowlist].sort((left, right) => left.item_id.localeCompare(right.item_id));
  const allowlistedById = new Map(sortedAllowlist.map((entry) => [entry.item_id, entry]));

  await client.query('BEGIN');
  try {
    for (const entry of sortedAllowlist) {
      const { rows } = await client.query<{
        id: string;
        last_checked_at: string | null;
        max_checked_at: string | null;
        has_future_history: boolean;
      }>(`
        SELECT
          i.id,
          i.last_checked_at::text AS last_checked_at,
          (
            SELECT MAX(h.checked_at)::text
            FROM public.inventory_check_history h
            WHERE h.item_id = i.id
          ) AS max_checked_at,
          EXISTS (
            SELECT 1
            FROM public.inventory_check_history h
            WHERE h.item_id = i.id
              AND h.checked_at > (timezone('Europe/London', now()))::date
          ) AS has_future_history
        FROM public.inventory_items i
        WHERE i.id = $1
        FOR UPDATE
      `, [entry.item_id]);

      const current = rows[0];
      if (!current) {
        throw new Error(`Allowlisted item missing: ${entry.item_number}`);
      }
      if (current.has_future_history) {
        throw new Error(`Drift: ${entry.item_number} now has future history`);
      }
      if (current.last_checked_at !== entry.expected_last_checked_at) {
        throw new Error(
          `Drift: ${entry.item_number} last_checked_at changed from ${entry.expected_last_checked_at} to ${current.last_checked_at}`,
        );
      }
      if (current.max_checked_at !== entry.expected_max_checked_at) {
        throw new Error(
          `Drift: ${entry.item_number} max history changed from ${entry.expected_max_checked_at} to ${current.max_checked_at}`,
        );
      }

      await client.query(
        `
          UPDATE public.inventory_items
          SET last_checked_at = $2::date
          WHERE id = $1
        `,
        [entry.item_id, entry.expected_max_checked_at],
      );
    }

    const historyCountAfter = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM public.inventory_check_history',
    );
    if (historyCountBefore !== historyCountAfter.rows[0]?.count) {
      throw new Error('History row count changed during reconciliation');
    }

    const verification = await classifyRows(client);
    for (const entry of sortedAllowlist) {
      const repaired = verification.find((row) => row.item_id === entry.item_id);
      if (!repaired) {
        throw new Error(`Allowlisted item missing after repair: ${entry.item_number}`);
      }
      if (repaired.last_checked_at !== entry.expected_max_checked_at) {
        throw new Error(
          `Repair mismatch for ${entry.item_number}: expected ${entry.expected_max_checked_at}, got ${repaired.last_checked_at}`,
        );
      }
      if (repaired.max_checked_at !== entry.expected_max_checked_at) {
        throw new Error(
          `History drifted for ${entry.item_number} during repair`,
        );
      }
    }

    for (const [itemId, before] of unchangedSnapshot.entries()) {
      if (allowlistedById.has(itemId)) continue;
      const after = verification.find((row) => row.item_id === itemId);
      if (!after) {
        throw new Error(`Unapproved item disappeared during repair: ${before.item_number}`);
      }
      if (
        after.last_checked_at !== before.last_checked_at
        || after.max_checked_at !== before.max_checked_at
        || after.mismatch_type !== before.mismatch_type
      ) {
        throw new Error(`Unapproved item changed during repair: ${before.item_number}`);
      }
    }

    await client.query('COMMIT');
    console.log(`Applied repairs for ${sortedAllowlist.length} item(s).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const { apply, confirmApply, allowlistPath } = parseArgs(process.argv.slice(2));
  const client = createClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(process.cwd(), 'docs_private/inventory-check-reconciliation');
  mkdirSync(outDir, { recursive: true });

  try {
    await client.connect();
    const rows = await classifyRows(client);
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.mismatch_type] = (acc[row.mismatch_type] || 0) + 1;
      return acc;
    }, {});
    const generatedAllowlist = buildAllowlist(rows);
    const reportPath = resolve(outDir, `inventory-check-date-report-${stamp}.json`);
    const allowlistOutPath = resolve(outDir, `inventory-check-date-allowlist-${stamp}.json`);

    writeFileSync(reportPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      counts,
      rows,
    }, null, 2));
    writeFileSync(allowlistOutPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      entries: generatedAllowlist,
    }, null, 2));

    console.log('Inventory check date reconciliation dry-run complete.');
    console.log(`Report: ${reportPath}`);
    console.log(`Proposed allowlist: ${allowlistOutPath}`);
    console.log('Counts:', counts);
    console.log(`Unambiguous repair candidates: ${generatedAllowlist.length}`);
    for (const entry of generatedAllowlist) {
      console.log(
        `  - ${entry.item_number}: ${entry.expected_last_checked_at || 'null'} -> ${entry.expected_max_checked_at}`,
      );
    }

    const reviewOnly = rows.filter((row) => row.proposed_action === 'review_only' || row.mismatch_type === 'future_history');
    if (reviewOnly.length > 0) {
      console.log(`Deferred review-only rows: ${reviewOnly.length}`);
      for (const row of reviewOnly.slice(0, 20)) {
        console.log(
          `  - ${row.item_number}: ${row.mismatch_type} last=${row.last_checked_at || 'null'} max=${row.max_checked_at || 'null'}`,
        );
      }
    }

    if (!apply) {
      console.log('Dry-run only. Re-run with --apply --confirm-apply --allowlist <path> to repair.');
      return;
    }

    if (!confirmApply) {
      throw new Error('Refusing to apply without --confirm-apply');
    }
    if (!allowlistPath) {
      throw new Error('--allowlist <path> is required for apply mode');
    }

    const allowlistFile = JSON.parse(readFileSync(resolve(process.cwd(), allowlistPath), 'utf8')) as {
      entries?: AllowlistEntry[];
    };
    const allowlist = [...(allowlistFile.entries || [])].sort((left, right) => (
      left.item_id.localeCompare(right.item_id)
    ));
    if (!Array.isArray(allowlist) || allowlist.length === 0) {
      throw new Error('Allowlist is empty');
    }

    const historyCountBefore = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM public.inventory_check_history',
    );
    const snapshotBefore = await classifyRows(client);
    const unchangedSnapshot = new Map(
      snapshotBefore
        .filter((row) => !allowlist.some((entry) => entry.item_id === row.item_id))
        .map((row) => [row.item_id, row]),
    );

    await applyAllowlist(client, allowlist, historyCountBefore.rows[0]?.count || '0', unchangedSnapshot);
    console.log('Verification passed before commit.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
