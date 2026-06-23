import { config } from 'dotenv';
import pg from 'pg';
import { resolve } from 'path';

const { Client } = pg;

interface RepairRow {
  hgv_id: string;
  reg_number: string;
  maintenance_id: string;
  task_id: string;
  task_title: string;
  task_actioned_at: string;
  due_from_task: string;
  current_due: string | null;
  has_adjusted_completed_event: boolean;
  screenshot_expected_due: string | null;
  support_status: 'supported' | 'unsupported-screenshot-date';
}

const SCREENSHOT_EXPECTED_DUE_DATES = new Map<string, string>([
  ['AS71 AVS', '2026-07-06'],
  ['DS71 AVS', '2026-07-07'],
  ['KS21 AVS', '2026-07-09'],
  ['TS71 AVS', '2026-07-16'],
  ['KS71 AVS', '2026-07-30'],
  ['ES71 AVS', '2026-06-23'],
  ['VS71 AVS', '2026-06-25'],
  ['SS15 AVS', '2026-06-30'],
  ['PS71 AVS', '2026-06-30'],
]);

const UNSUPPORTED_SCREENSHOT_REGS = new Set(['TS71 AVS', 'KS71 AVS']);
const HISTORY_COMMENT = 'Corrected from adjusted 6-weekly completed date';

config({ path: resolve(process.cwd(), '.env.local') });

function parseArgs() {
  const isApply = process.argv.includes('--apply');
  const isDryRun = process.argv.includes('--dry-run') || !isApply;
  return { isApply, isDryRun };
}

function createClient() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  }

  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

function screenshotExpectedDue(regNumber: string): string | null {
  return SCREENSHOT_EXPECTED_DUE_DATES.get(regNumber) ?? null;
}

function getSupportStatus(regNumber: string, dueFromTask: string): RepairRow['support_status'] {
  const expectedDue = screenshotExpectedDue(regNumber);
  if (!expectedDue) return 'supported';
  if (expectedDue === dueFromTask && !UNSUPPORTED_SCREENSHOT_REGS.has(regNumber)) return 'supported';
  return 'unsupported-screenshot-date';
}

function printRows(title: string, rows: RepairRow[]) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  None');
    return;
  }

  for (const row of rows) {
    console.log(
      [
        `  ${row.reg_number}`,
        `current=${row.current_due ?? 'null'}`,
        `calculated=${row.due_from_task}`,
        `screenshot=${row.screenshot_expected_due ?? 'n/a'}`,
        `task=${row.task_id}`,
        `completed=${row.task_actioned_at}`,
        `adjusted=${row.has_adjusted_completed_event ? 'yes' : 'no'}`,
        `support=${row.support_status}`,
      ].join(' | ')
    );
  }
}

async function fetchRepairRows(client: pg.Client): Promise<RepairRow[]> {
  const screenshotRegs = Array.from(SCREENSHOT_EXPECTED_DUE_DATES.keys());
  const { rows } = await client.query<RepairRow>(
    `
      with latest_six_weekly_hgv_tasks as (
        select distinct on (a.hgv_id)
          a.hgv_id,
          h.reg_number,
          vm.id as maintenance_id,
          a.id as task_id,
          a.title as task_title,
          a.actioned_at::text as task_actioned_at,
          (a.actioned_at::date + interval '6 weeks')::date::text as due_from_task,
          vm.six_weekly_inspection_due_date::text as current_due,
          exists (
            select 1
            from jsonb_array_elements(
              case
                when jsonb_typeof(a.status_history::jsonb) = 'array' then a.status_history::jsonb
                else '[]'::jsonb
              end
            ) event
            where event->>'status' = 'completed'
              and coalesce((event->'meta'->>'timestamp_adjusted')::boolean, false) = true
          ) as has_adjusted_completed_event
        from public.actions a
        join public.hgvs h on h.id = a.hgv_id
        join public.vehicle_maintenance vm on vm.hgv_id = a.hgv_id
        left join public.workshop_task_categories wtc on wtc.id = a.workshop_category_id
        left join public.workshop_task_subcategories wts on wts.id = a.workshop_subcategory_id
        where a.action_type in ('inspection_defect', 'workshop_vehicle_task')
          and a.hgv_id is not null
          and a.actioned is true
          and a.actioned_at is not null
          and (
            lower(coalesce(a.title, '') || ' ' || coalesce(a.description, '') || ' ' || coalesce(a.workshop_comments, '')) like '%6 weekly%'
            or lower(coalesce(a.title, '') || ' ' || coalesce(a.description, '') || ' ' || coalesce(a.workshop_comments, '')) like '%6-week%'
            or lower(coalesce(wtc.name, '')) like '%6 weekly%'
            or lower(coalesce(wts.name, '')) like '%6 weekly%'
            or lower(coalesce(wtc.name, '')) like '%6-week%'
            or lower(coalesce(wts.name, '')) like '%6-week%'
          )
        order by a.hgv_id, a.actioned_at desc, a.id desc
      )
      select *
      from latest_six_weekly_hgv_tasks
      where current_due is distinct from due_from_task
         or reg_number = any($1::text[])
      order by reg_number
    `,
    [screenshotRegs]
  );

  return rows.map((row) => ({
    ...row,
    screenshot_expected_due: screenshotExpectedDue(row.reg_number),
    support_status: getSupportStatus(row.reg_number, row.due_from_task),
  }));
}

async function fetchSixWeeklyCategoryId(client: pg.Client): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `
      select id
      from public.maintenance_categories
      where lower(name) = lower('6 Weekly Inspection Due')
      order by created_at nulls last
      limit 1
    `
  );
  return rows[0]?.id ?? null;
}

async function applyRepairs(client: pg.Client, rows: RepairRow[]) {
  const categoryId = await fetchSixWeeklyCategoryId(client);

  await client.query('begin');
  try {
    for (const row of rows) {
      await client.query(
        `
          update public.vehicle_maintenance
          set six_weekly_inspection_due_date = $1::date,
              last_updated_at = now(),
              last_updated_by = null
          where id = $2
        `,
        [row.due_from_task, row.maintenance_id]
      );

      await client.query(
        `
          insert into public.maintenance_history (
            hgv_id,
            maintenance_category_id,
            field_name,
            old_value,
            new_value,
            value_type,
            comment,
            updated_by,
            updated_by_name
          )
          values ($1, $2, 'six_weekly_inspection_due_date', $3, $4, 'date', $5, null, 'System Repair Script')
        `,
        [row.hgv_id, categoryId, row.current_due, row.due_from_task, HISTORY_COMMENT]
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const { isApply, isDryRun } = parseArgs();
  const client = createClient();

  await client.connect();
  try {
    const rows = await fetchRepairRows(client);
    const mismatchedRows = rows.filter((row) => row.current_due !== row.due_from_task);
    const evidenceRows = mismatchedRows.filter(
      (row) => row.has_adjusted_completed_event || row.screenshot_expected_due !== null
    );
    const unsupportedRows = evidenceRows.filter((row) => row.support_status !== 'supported');
    const repairableRows = evidenceRows.filter((row) => row.support_status === 'supported');
    const screenshotVerificationRows = rows.filter((row) => row.screenshot_expected_due !== null);

    console.log(`6-weekly due-date repair mode: ${isDryRun ? 'dry-run' : 'apply'}`);
    printRows('Screenshot verification', screenshotVerificationRows);
    printRows('Repairable rows', repairableRows);
    printRows('Unsupported rows skipped', unsupportedRows);

    if (isApply) {
      if (repairableRows.length === 0) {
        console.log('\nNo supported rows need repair.');
      } else {
        await applyRepairs(client, repairableRows);
        console.log(`\nApplied ${repairableRows.length} supported 6-weekly due-date repairs.`);
      }

      const afterRows = await fetchRepairRows(client);
      printRows(
        'Post-apply screenshot verification',
        afterRows.filter((row) => row.screenshot_expected_due !== null)
      );
    } else {
      console.log('\nDry run only. Re-run with --apply to update supported rows.');
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
