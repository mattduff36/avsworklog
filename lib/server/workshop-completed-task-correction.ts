import pg from 'pg';
import { AssetServiceError, loadServiceConfig } from '@/lib/server/asset-service';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import {
  appendStatusHistory,
  buildStatusHistoryEvent,
} from '@/lib/utils/workshopTaskStatusHistory';
import {
  boundedTaskCorrectionValues,
  timestampsMatch,
  type CorrectCompletedTaskBody,
} from '@/lib/workshop-tasks/completed-correction';
import { inferAssetMeterUnit } from '@/lib/workshop-tasks/asset-meter';
import {
  isUnifiedServiceMembership,
  loadSubcategoryParentCategoryId,
} from '@/lib/server/workshop-tasks/service-identity';

const { Client } = pg;

export class WorkshopCorrectionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WorkshopCorrectionError';
    this.status = status;
  }
}

function createPgClient(): pg.Client {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new WorkshopCorrectionError('Missing database connection string', 500);
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });
}

export async function withWorkshopCorrectionTransaction<T>(
  work: (client: pg.Client) => Promise<T>
): Promise<T> {
  const client = createPgClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function loadActorName(client: pg.Client, actorId: string): Promise<string | null> {
  const { rows } = await client.query<{ full_name: string | null }>(
    `SELECT full_name FROM public.profiles WHERE id = $1 LIMIT 1`,
    [actorId]
  );
  return rows[0]?.full_name ?? null;
}

async function loadAssetLabel(
  client: pg.Client,
  assetType: 'van' | 'hgv' | 'plant',
  assetId: string
): Promise<string> {
  if (assetType === 'plant') {
    const { rows } = await client.query<{ plant_id: string | null; nickname: string | null }>(
      `SELECT plant_id, nickname FROM public.plant WHERE id = $1 LIMIT 1`,
      [assetId]
    );
    if (!rows[0]) throw new WorkshopCorrectionError('Target plant not found', 400);
    return formatFleetAssetLabel({
      identifier: rows[0].plant_id || 'Unknown Plant',
      nickname: rows[0].nickname,
    });
  }

  const table = assetType === 'hgv' ? 'hgvs' : 'vans';
  const { rows } = await client.query<{ reg_number: string | null; nickname: string | null }>(
    `SELECT reg_number, nickname FROM public.${table} WHERE id = $1 LIMIT 1`,
    [assetId]
  );
  if (!rows[0]) throw new WorkshopCorrectionError('Target asset not found', 400);
  return formatFleetAssetLabel({
    identifier: rows[0].reg_number || 'Unknown Asset',
    nickname: rows[0].nickname,
  });
}

async function resolveCategoryForAsset(
  client: pg.Client,
  assetType: 'van' | 'hgv' | 'plant',
  categoryId: string | null,
  subcategoryId: string | null
): Promise<{
  storedCategoryId: string | null;
  subcategoryId: string | null;
  effectiveCategoryId: string;
}> {
  const appliesTo = assetType;
  if (subcategoryId) {
    const { rows } = await client.query<{ id: string; category_id: string }>(
      `
      SELECT s.id, s.category_id
      FROM public.workshop_task_subcategories s
      JOIN public.workshop_task_categories c ON c.id = s.category_id
      WHERE s.id = $1
        AND c.applies_to = $2
      LIMIT 1
      `,
      [subcategoryId, appliesTo]
    );
    if (!rows[0]) {
      throw new WorkshopCorrectionError('Subcategory is not valid for this asset type', 400);
    }
    return {
      storedCategoryId: null,
      subcategoryId: rows[0].id,
      effectiveCategoryId: rows[0].category_id,
    };
  }

  if (!categoryId) {
    throw new WorkshopCorrectionError('A workshop category is required', 400);
  }

  const { rows } = await client.query<{ id: string }>(
    `
    SELECT id
    FROM public.workshop_task_categories
    WHERE id = $1
      AND applies_to = $2
    LIMIT 1
    `,
    [categoryId, appliesTo]
  );
  if (!rows[0]) {
    throw new WorkshopCorrectionError('Category is not valid for this asset type', 400);
  }
  return {
    storedCategoryId: rows[0].id,
    subcategoryId: null,
    effectiveCategoryId: rows[0].id,
  };
}

export async function correctCompletedWorkshopTask(input: {
  taskId: string;
  actorId: string;
  body: CorrectCompletedTaskBody;
}): Promise<{ updatedAt: string }> {
  return withWorkshopCorrectionTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      status: string;
      action_type: string;
      title: string | null;
      description: string | null;
      workshop_comments: string | null;
      van_id: string | null;
      hgv_id: string | null;
      plant_id: string | null;
      workshop_category_id: string | null;
      workshop_subcategory_id: string | null;
      asset_meter_reading: number | null;
      asset_meter_unit: string | null;
      status_history: unknown;
      updated_at: string | null;
    }>(
      `
      SELECT
        id, status, action_type, title, description, workshop_comments,
        van_id, hgv_id, plant_id, workshop_category_id, workshop_subcategory_id,
        asset_meter_reading, asset_meter_unit, status_history, updated_at
      FROM public.actions
      WHERE id = $1
      FOR UPDATE
      `,
      [input.taskId]
    );
    const task = rows[0];
    if (!task) throw new WorkshopCorrectionError('Task not found', 404);
    if (task.action_type !== 'workshop_vehicle_task') {
      throw new WorkshopCorrectionError('Only workshop vehicle tasks can be corrected', 400);
    }
    if (task.status !== 'completed') {
      throw new WorkshopCorrectionError('Only completed workshop tasks can be corrected', 400);
    }
    if (!timestampsMatch(input.body.expectedUpdatedAt, task.updated_at)) {
      throw new WorkshopCorrectionError(
        'This task changed since you opened it. Refresh and try again.',
        409
      );
    }

    const currentAssetType: 'van' | 'hgv' | 'plant' = task.hgv_id
      ? 'hgv'
      : task.plant_id
        ? 'plant'
        : 'van';
    const currentAssetId = task.hgv_id || task.plant_id || task.van_id;
    if (!currentAssetId) {
      throw new WorkshopCorrectionError('Task has no linked asset', 400);
    }

    const serviceConfig = await loadServiceConfig(client, currentAssetType);
    const subcategoryParentId = task.workshop_subcategory_id
      ? await loadSubcategoryParentCategoryId(client, task.workshop_subcategory_id)
      : null;
    if (task.workshop_subcategory_id && !subcategoryParentId) {
      throw new WorkshopCorrectionError('Subcategory not found', 400);
    }
    const isService = isUnifiedServiceMembership(
      serviceConfig.workshopCategoryId,
      task.workshop_category_id,
      subcategoryParentId
    );

    if (isService) {
      if (
        input.body.meter_reading !== undefined ||
        input.body.vehicle_id ||
        input.body.asset_type ||
        input.body.workshop_category_id !== undefined ||
        input.body.workshop_subcategory_id !== undefined
      ) {
        throw new WorkshopCorrectionError(
          'Completed Service identity and meter must be corrected with Correct Service',
          400
        );
      }
    }

    const nextAssetType = input.body.asset_type ?? currentAssetType;
    const nextAssetId = input.body.vehicle_id ?? currentAssetId;
    if (input.body.asset_type || input.body.vehicle_id) {
      if (isService) {
        throw new WorkshopCorrectionError('Completed Service asset cannot be changed', 400);
      }
    }

    let nextCategoryId = task.workshop_category_id;
    let nextSubcategoryId = task.workshop_subcategory_id;
    const categoryChanging =
      input.body.workshop_category_id !== undefined ||
      input.body.workshop_subcategory_id !== undefined;
    const assetChanging = Boolean(input.body.asset_type || input.body.vehicle_id);
    if (categoryChanging || assetChanging) {
      if (isService) {
        throw new WorkshopCorrectionError(
          categoryChanging
            ? 'Completed Service category cannot be changed'
            : 'Completed Service asset cannot be changed',
          400
        );
      }
      const resolved = await resolveCategoryForAsset(
        client,
        nextAssetType,
        input.body.workshop_category_id === undefined
          ? task.workshop_category_id
          : input.body.workshop_category_id,
        input.body.workshop_subcategory_id === undefined
          ? task.workshop_subcategory_id
          : input.body.workshop_subcategory_id
      );
      nextCategoryId = resolved.storedCategoryId;
      nextSubcategoryId = resolved.subcategoryId;

      const targetServiceConfig = await loadServiceConfig(client, nextAssetType);
      if (
        isUnifiedServiceMembership(
          targetServiceConfig.workshopCategoryId,
          resolved.storedCategoryId,
          resolved.effectiveCategoryId
        )
      ) {
        throw new WorkshopCorrectionError(
          'A completed non-Service task cannot be changed into a Service task',
          400
        );
      }
    }

    const nextComments = input.body.workshop_comments ?? task.workshop_comments ?? '';
    const nextMeter =
      input.body.meter_reading !== undefined
        ? input.body.meter_reading
        : task.asset_meter_reading;
    const nextMeterUnit = inferAssetMeterUnit(nextAssetType);
    const nextTitle = `Workshop Task - ${await loadAssetLabel(client, nextAssetType, nextAssetId)}`;
    const nextDescription = nextComments.substring(0, 200);

    const before = {
      workshop_comments: task.workshop_comments,
      description: task.description,
      asset_meter_reading: task.asset_meter_reading,
      asset_meter_unit: task.asset_meter_unit,
      van_id: task.van_id,
      hgv_id: task.hgv_id,
      plant_id: task.plant_id,
      workshop_category_id: task.workshop_category_id,
      workshop_subcategory_id: task.workshop_subcategory_id,
      title: task.title,
    };
    const after = {
      workshop_comments: nextComments,
      description: nextDescription,
      asset_meter_reading: nextMeter,
      asset_meter_unit: nextMeterUnit,
      van_id: nextAssetType === 'van' ? nextAssetId : null,
      hgv_id: nextAssetType === 'hgv' ? nextAssetId : null,
      plant_id: nextAssetType === 'plant' ? nextAssetId : null,
      workshop_category_id: nextCategoryId,
      workshop_subcategory_id: nextSubcategoryId,
      title: nextTitle,
    };
    const bounded = boundedTaskCorrectionValues(before, after);
    if (Object.keys(bounded.after).length === 0) {
      throw new WorkshopCorrectionError('No changes to save', 409);
    }

    const actorName = await loadActorName(client, input.actorId);
    const historyEvent = buildStatusHistoryEvent({
      status: 'corrected',
      body: input.body.reason,
      authorId: input.actorId,
      authorName: actorName,
      meta: {
        event_kind: 'completed_task_correction',
        before: bounded.before,
        after: bounded.after,
      },
    });
    const nextHistory = appendStatusHistory(task.status_history, historyEvent);

    const { rows: updatedRows } = await client.query<{ updated_at: string }>(
      `
      UPDATE public.actions
      SET workshop_comments = $2,
          description = $3,
          title = $4,
          asset_meter_reading = $5,
          asset_meter_unit = $6,
          van_id = $7,
          hgv_id = $8,
          plant_id = $9,
          workshop_category_id = $10,
          workshop_subcategory_id = $11,
          status_history = $12::jsonb,
          updated_at = NOW()
      WHERE id = $1
      RETURNING updated_at
      `,
      [
        task.id,
        nextComments,
        nextDescription,
        nextTitle,
        nextMeter,
        nextMeterUnit,
        after.van_id,
        after.hgv_id,
        after.plant_id,
        nextCategoryId,
        nextSubcategoryId,
        JSON.stringify(nextHistory),
      ]
    );

    if (
      !isService &&
      input.body.meter_reading !== undefined &&
      task.asset_meter_reading !== input.body.meter_reading
    ) {
      await client.query(
        `
        INSERT INTO public.maintenance_history (
          ${nextAssetType === 'hgv' ? 'hgv_id' : nextAssetType === 'plant' ? 'plant_id' : 'van_id'},
          field_name, old_value, new_value, value_type, comment, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          nextAssetId,
          nextAssetType === 'plant' ? 'task_hours' : 'task_mileage',
          task.asset_meter_reading == null ? null : String(task.asset_meter_reading),
          String(input.body.meter_reading),
          nextAssetType === 'plant' ? 'text' : 'mileage',
          `Audited completed-task correction: ${task.title || task.id}`,
          input.actorId,
        ]
      );
    }

    return { updatedAt: updatedRows[0]?.updated_at || new Date().toISOString() };
  });
}

export { AssetServiceError };
