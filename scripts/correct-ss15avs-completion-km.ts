/**
 * Dry-run-first SS15AVS completion KM correction.
 *
 * Usage:
 *   npx tsx scripts/correct-ss15avs-completion-km.ts --dry-run
 *   npx tsx scripts/correct-ss15avs-completion-km.ts --apply --confirm-apply ss15avs-650153 --actor-id <uuid>
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { calculateNextDueMeter } from '@/lib/utils/assetServiceRotation';
import {
  canonicalizeAttachmentResponses,
  hashAttachmentResponses,
} from '@/lib/workshop-tasks/completed-correction';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const TARGET_COMPLETION_METER = 650153;
const TARGET_REG = 'SS15AVS';
const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';
const CONFIRM_APPLY_TOKEN = 'ss15avs-650153';
const ODOMETER_FIELD_KEY = 'odometer_reading';

const connectionString = process.env.POSTGRES_URL_NON_POOLING;

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function createClient(): pg.Client {
  if (!connectionString) {
    throw new Error('Missing POSTGRES_URL_NON_POOLING');
  }
  const url = new URL(connectionString);
  if (!connectionString.includes(TARGET_PROJECT_REF) && !url.hostname.includes('localhost')) {
    throw new Error(`Refusing to continue: connection does not include expected project ref`);
  }
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });
}

interface LocatedTarget {
  hgvId: string;
  regNumber: string;
  taskId: string;
  taskUpdatedAt: string | null;
  taskMeter: number | null;
  completionEventId: string;
  latestEventId: string;
  latestEventType: string;
  currentCompletionMeter: number | null;
  currentDueMeter: number | null;
  nextTemplateId: string | null;
  intervalValue: number;
  intervalUnit: string;
  meterUnit: string;
  maintenanceDue: number | null;
  categoryDue: number | null;
  attachmentId: string | null;
  odometerMatches: number;
  odometerValue: string | null;
  odometerSectionKey: string | null;
  preimageHash: string | null;
  expectedDueMeter: number;
  attachmentTableReady: boolean;
}

async function locateTarget(client: pg.Client): Promise<LocatedTarget> {
  const { rows: hgvs } = await client.query<{ id: string; reg_number: string }>(
    `
    SELECT id, reg_number
    FROM public.hgvs
    WHERE upper(regexp_replace(coalesce(reg_number, ''), '[^A-Z0-9]', '', 'g')) = $1
    `,
    [TARGET_REG]
  );
  if (hgvs.length !== 1) {
    throw new Error(`Expected exactly one HGV matching ${TARGET_REG}, found ${hgvs.length}`);
  }

  const { rows: tasks } = await client.query<{
    id: string;
    updated_at: string | null;
    asset_meter_reading: number | null;
  }>(
    `
    SELECT a.id, a.updated_at, a.asset_meter_reading
    FROM public.actions a
    LEFT JOIN public.workshop_task_subcategories s
      ON s.id = a.workshop_subcategory_id
    JOIN public.maintenance_categories mc
      ON mc.workshop_category_id IN (a.workshop_category_id, s.category_id)
    WHERE a.hgv_id = $1
      AND a.action_type = 'workshop_vehicle_task'
      AND a.status = 'completed'
      AND mc.config_key = 'service_hgv'
      AND mc.is_active = true
    ORDER BY a.actioned_at DESC NULLS LAST, a.updated_at DESC
    LIMIT 2
    `,
    [hgvs[0].id]
  );
  if (tasks.length === 0) {
    throw new Error('No completed Service workshop task found for SS15AVS');
  }
  const task = tasks[0];

  const { rows: completionEvents } = await client.query<{
    id: string;
    next_template_id: string | null;
    interval_value: number;
    interval_unit: string;
    meter_unit: string;
    completion_meter: number | null;
    resulting_due_meter: number | null;
  }>(
    `
    SELECT id, next_template_id, interval_value, interval_unit::text AS interval_unit,
           meter_unit::text AS meter_unit, completion_meter, resulting_due_meter
    FROM public.asset_service_events
    WHERE task_id = $1
      AND event_type = 'completion'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [task.id]
  );
  if (completionEvents.length === 0) {
    throw new Error('WT-CORR-R1: SS15AVS completed Service task has no unified completion event. Stopping.');
  }

  const { rows: latestEvents } = await client.query<{
    id: string;
    event_type: string;
    next_template_id: string | null;
    interval_value: number;
    interval_unit: string;
    meter_unit: string;
    completion_meter: number | null;
    resulting_due_meter: number | null;
  }>(
    `
    SELECT id, event_type, next_template_id, interval_value, interval_unit::text AS interval_unit,
           meter_unit::text AS meter_unit, completion_meter, resulting_due_meter
    FROM public.asset_service_events
    WHERE task_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [task.id]
  );
  const latest = latestEvents[0] ?? completionEvents[0];
  if (latest.meter_unit !== 'km') {
    throw new Error(`Expected KM meter unit, found ${latest.meter_unit}`);
  }
  if (latest.interval_unit !== 'km') {
    throw new Error(`Expected KM interval unit, found ${latest.interval_unit}`);
  }
  if (!latest.next_template_id) {
    throw new Error('Latest service event is missing next template id');
  }

  const { rows: maintenance } = await client.query<{
    next_service_mileage: number | null;
    due_mileage: number | null;
  }>(
    `
    SELECT vm.next_service_mileage, cv.due_mileage
    FROM public.vehicle_maintenance vm
    LEFT JOIN public.asset_maintenance_category_values cv
      ON cv.hgv_id = vm.hgv_id
    LEFT JOIN public.maintenance_categories mc
      ON mc.id = cv.maintenance_category_id
     AND mc.config_key = 'service_hgv'
    WHERE vm.hgv_id = $1
    LIMIT 1
    `,
    [hgvs[0].id]
  );

  const { rows: tableRows } = await client.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'workshop_attachment_corrections'
    ) AS exists
    `
  );
  const attachmentTableReady = Boolean(tableRows[0]?.exists);

  const { rows: odometerRows } = await client.query<{
    attachment_id: string;
    section_key: string;
    response_value: string | null;
  }>(
    `
    SELECT fr.attachment_id, fr.section_key, fr.response_value
    FROM public.workshop_task_attachments wta
    JOIN public.workshop_attachment_field_responses fr
      ON fr.attachment_id = wta.id
    WHERE wta.task_id = $1
      AND fr.field_key = $2
    ORDER BY wta.created_at, fr.section_key
    `,
    [task.id, ODOMETER_FIELD_KEY]
  );

  let preimageHash: string | null = null;
  if (odometerRows.length === 1) {
    const { rows: allResponses } = await client.query<{
      section_key: string;
      field_key: string;
      response_value: string | null;
      response_json: Record<string, unknown> | null;
    }>(
      `
      SELECT section_key, field_key, response_value, response_json
      FROM public.workshop_attachment_field_responses
      WHERE attachment_id = $1
      `,
      [odometerRows[0].attachment_id]
    );
    preimageHash = hashAttachmentResponses(canonicalizeAttachmentResponses(allResponses));
  }

  return {
    hgvId: hgvs[0].id,
    regNumber: hgvs[0].reg_number,
    taskId: task.id,
    taskUpdatedAt: task.updated_at,
    taskMeter: task.asset_meter_reading,
    completionEventId: completionEvents[0].id,
    latestEventId: latest.id,
    latestEventType: latest.event_type,
    currentCompletionMeter: latest.completion_meter,
    currentDueMeter: latest.resulting_due_meter,
    nextTemplateId: latest.next_template_id,
    intervalValue: latest.interval_value,
    intervalUnit: latest.interval_unit,
    meterUnit: latest.meter_unit,
    maintenanceDue: maintenance[0]?.next_service_mileage ?? null,
    categoryDue: maintenance[0]?.due_mileage ?? null,
    attachmentId: odometerRows.length === 1 ? odometerRows[0].attachment_id : null,
    odometerMatches: odometerRows.length,
    odometerValue: odometerRows.length === 1 ? odometerRows[0].response_value : null,
    odometerSectionKey: odometerRows.length === 1 ? odometerRows[0].section_key : null,
    preimageHash,
    expectedDueMeter: calculateNextDueMeter(TARGET_COMPLETION_METER, latest.interval_value),
    attachmentTableReady,
  };
}

function report(target: LocatedTarget): void {
  console.log(JSON.stringify({
    mode: 'report',
    hgvId: target.hgvId,
    regNumber: target.regNumber,
    taskId: target.taskId,
    completionEventId: target.completionEventId,
    latestEventId: target.latestEventId,
    latestEventType: target.latestEventType,
    before: {
      taskMeter: target.taskMeter,
      completionMeter: target.currentCompletionMeter,
      dueMeter: target.currentDueMeter,
      maintenanceDue: target.maintenanceDue,
      categoryDue: target.categoryDue,
      odometerMatches: target.odometerMatches,
      odometerValue: target.odometerValue,
    },
    planned: {
      completionMeter: TARGET_COMPLETION_METER,
      dueMeter: target.expectedDueMeter,
      nextTemplateId: target.nextTemplateId,
      intervalValue: target.intervalValue,
      intervalUnit: target.intervalUnit,
      meterUnit: target.meterUnit,
      attachmentCorrection: target.odometerMatches === 1 && target.attachmentTableReady,
    },
    attachmentTableReady: target.attachmentTableReady,
  }, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirmApply = readFlag(args, '--confirm-apply');
  const actorId = readFlag(args, '--actor-id');
  if (apply && confirmApply !== CONFIRM_APPLY_TOKEN) {
    throw new Error(`Apply requires --confirm-apply ${CONFIRM_APPLY_TOKEN}`);
  }
  if (apply && !actorId) {
    throw new Error('Apply requires --actor-id <profile uuid>');
  }

  const client = createClient();
  await client.connect();
  try {
    const target = await locateTarget(client);
    report(target);

    if (target.odometerMatches !== 1) {
      console.log(JSON.stringify({
        warning: 'WT-CORR-R2',
        message: target.odometerMatches === 0
          ? 'No exact odometer_reading field. Service correction can proceed; attachment will not be changed.'
          : 'Multiple exact odometer_reading fields. Service correction can proceed; attachment will not be changed.',
      }));
    }
    if (target.odometerMatches === 1 && !target.attachmentTableReady) {
      console.log(JSON.stringify({
        warning: 'attachment-table-missing',
        message: 'workshop_attachment_corrections is not present. Service correction can proceed; attachment will not be changed.',
      }));
    }

    if (!apply) {
      console.log(JSON.stringify({ dryRun: true, applyCommand: 'npx tsx scripts/correct-ss15avs-completion-km.ts --apply --confirm-apply ss15avs-650153 --actor-id <uuid>' }));
      return;
    }

    const { correctServiceWorkshopTask } = await import('@/lib/server/asset-service');
    const serviceResult = await correctServiceWorkshopTask({
      taskId: target.taskId,
      actorId: actorId!,
      completionMeter: TARGET_COMPLETION_METER,
      confirmedNextTemplateId: target.nextTemplateId!,
      correctionComment: "Correct Luke's incorrect SS15AVS completion mileage to 650153 km",
    });

    let attachmentCorrectionId: string | null = null;
    if (target.attachmentId && target.preimageHash && target.odometerSectionKey && target.attachmentTableReady) {
      const { correctCompletedAttachmentResponses } = await import('@/lib/server/workshop-attachment-correction');
      const attachmentResult = await correctCompletedAttachmentResponses({
        attachmentId: target.attachmentId,
        actorId: actorId!,
        source: 'production_script',
        body: {
          reason: "Correct Luke's incorrect SS15AVS odometer reading to 650153 km",
          expectedPreimageHash: target.preimageHash,
          responses: [
            {
              section_key: target.odometerSectionKey,
              field_key: ODOMETER_FIELD_KEY,
              response_value: String(TARGET_COMPLETION_METER),
            },
          ],
        },
      });
      attachmentCorrectionId = attachmentResult.correctionId;
    }

    const after = await locateTarget(client);
    console.log(JSON.stringify({
      applied: true,
      serviceResult,
      attachmentCorrectionId,
      after: {
        completionMeter: after.currentCompletionMeter,
        dueMeter: after.currentDueMeter,
        taskMeter: after.taskMeter,
        odometerValue: after.odometerValue,
        latestEventType: after.latestEventType,
      },
    }, null, 2));
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SS15AVS correction failed');
  process.exit(1);
});
