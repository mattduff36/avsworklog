import pg from 'pg';
import {
  calculateNextDueMeter,
  getDefaultMeterUnit,
  getServiceConfigKey,
  getSuccessorStep,
  resolveStepForTemplateAfter,
  resolveStepForTemplateFirst,
  type ServiceAssetType,
  type ServiceConfig,
  type ServiceMeterUnit,
  type ServiceRotationStep,
} from '@/lib/utils/assetServiceRotation';

const { Client } = pg;

export class AssetServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AssetServiceError';
    this.status = status;
  }
}

function createPgClient(): pg.Client {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new AssetServiceError('Missing database connection string', 500);
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

async function withTransaction<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
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

interface ServiceConfigRow {
  id: string;
  config_key: ServiceConfig['configKey'];
  period_value: number;
  period_unit: ServiceMeterUnit;
  workshop_category_id: string | null;
}

interface RotationStepRow {
  id: string;
  position: number;
  attachment_template_id: string;
  compact_label: string | null;
  template_name: string | null;
}

export async function loadServiceConfig(
  client: pg.Client,
  assetType: ServiceAssetType,
): Promise<ServiceConfig> {
  const configKey = getServiceConfigKey(assetType);
  const { rows } = await client.query<ServiceConfigRow>(
    `
    SELECT id, config_key, period_value, period_unit::text AS period_unit, workshop_category_id
    FROM public.maintenance_categories
    WHERE config_key = $1
      AND is_active = true
    LIMIT 1
    `,
    [configKey],
  );
  const config = rows[0];
  if (!config) {
    throw new AssetServiceError(`Service configuration missing for ${assetType}`, 500);
  }

  const { rows: stepRows } = await client.query<RotationStepRow>(
    `
    SELECT
      s.id,
      s.position,
      s.attachment_template_id,
      link.compact_label,
      t.name AS template_name
    FROM public.service_rotation_steps s
    JOIN public.workshop_attachment_templates t ON t.id = s.attachment_template_id
    LEFT JOIN public.workshop_category_attachment_templates link
      ON link.template_id = s.attachment_template_id
     AND link.category_id = $2
    WHERE s.maintenance_category_id = $1
    ORDER BY s.position
    `,
    [config.id, config.workshop_category_id],
  );

  const steps: ServiceRotationStep[] = stepRows.map((row) => ({
    id: row.id,
    position: row.position,
    attachmentTemplateId: row.attachment_template_id,
    compactLabel: row.compact_label,
    templateName: row.template_name,
  }));

  return {
    maintenanceCategoryId: config.id,
    configKey: config.config_key,
    intervalValue: Number(config.period_value),
    intervalUnit: config.period_unit,
    workshopCategoryId: config.workshop_category_id,
    steps,
  };
}

export async function listLinkedTemplatesForCategory(
  categoryId: string,
): Promise<Array<{
  templateId: string;
  templateName: string;
  sortOrder: number;
  compactLabel: string | null;
  isActive: boolean;
}>> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      template_id: string;
      template_name: string;
      sort_order: number;
      compact_label: string | null;
      is_active: boolean;
    }>(
      `
      SELECT
        w.template_id,
        t.name AS template_name,
        w.sort_order,
        w.compact_label,
        t.is_active
      FROM public.workshop_category_attachment_templates w
      JOIN public.workshop_attachment_templates t ON t.id = w.template_id
      WHERE w.category_id = $1
      ORDER BY w.sort_order, t.name
      `,
      [categoryId],
    );
    return rows.map((row) => ({
      templateId: row.template_id,
      templateName: row.template_name,
      sortOrder: row.sort_order,
      compactLabel: row.compact_label,
      isActive: row.is_active,
    }));
  });
}

export async function getServiceSettings(assetType: ServiceAssetType) {
  return withTransaction(async (client) => {
    const config = await loadServiceConfig(client, assetType);
    const linked = config.workshopCategoryId
      ? await client.query<{
          template_id: string;
          template_name: string;
          sort_order: number;
          compact_label: string | null;
          is_active: boolean;
        }>(
          `
          SELECT
            w.template_id,
            t.name AS template_name,
            w.sort_order,
            w.compact_label,
            t.is_active
          FROM public.workshop_category_attachment_templates w
          JOIN public.workshop_attachment_templates t ON t.id = w.template_id
          WHERE w.category_id = $1
          ORDER BY w.sort_order, t.name
          `,
          [config.workshopCategoryId],
        )
      : { rows: [] };

    return {
      assetType,
      maintenanceCategoryId: config.maintenanceCategoryId,
      configKey: config.configKey,
      intervalValue: config.intervalValue,
      intervalUnit: config.intervalUnit,
      workshopCategoryId: config.workshopCategoryId,
      linkedTemplates: linked.rows.map((row) => ({
        templateId: row.template_id,
        templateName: row.template_name,
        sortOrder: row.sort_order,
        compactLabel: row.compact_label,
        isActive: row.is_active,
      })),
      rotation: config.steps.map((step) => ({
        id: step.id,
        position: step.position,
        templateId: step.attachmentTemplateId,
        templateName: step.templateName,
        compactLabel: step.compactLabel,
      })),
    };
  });
}

export async function getAssetServiceState(
  assetType: ServiceAssetType,
  assetId: string,
) {
  return withTransaction(async (client) => {
    const fkColumn =
      assetType === 'hgv' ? 'hgv_id' : assetType === 'plant' ? 'plant_id' : 'van_id';
    const { rows } = await client.query<{
      next_service_template_id: string | null;
      next_service_rotation_step_id: string | null;
    }>(
      `
      SELECT next_service_template_id, next_service_rotation_step_id
      FROM public.vehicle_maintenance
      WHERE ${fkColumn} = $1
      LIMIT 1
      `,
      [assetId],
    );
    return {
      nextServiceTemplateId: rows[0]?.next_service_template_id ?? null,
      nextServiceRotationStepId: rows[0]?.next_service_rotation_step_id ?? null,
    };
  });
}

export async function saveServiceSettings(input: {
  assetType: ServiceAssetType;
  intervalValue: number;
  intervalUnit: ServiceMeterUnit;
  linkedTemplateIds: string[];
  compactLabels: Record<string, string | null>;
  rotationTemplateIds: string[];
}) {
  if (!Number.isFinite(input.intervalValue) || input.intervalValue <= 0) {
    throw new AssetServiceError('Interval must be a positive number');
  }
  const expectedUnit = getDefaultMeterUnit(input.assetType);
  if (input.intervalUnit !== expectedUnit) {
    throw new AssetServiceError(
      `${input.assetType} service intervals must use ${expectedUnit}`,
    );
  }
  if (input.rotationTemplateIds.length === 0) {
    throw new AssetServiceError('Service rotation must include at least one step');
  }
  for (const templateId of input.rotationTemplateIds) {
    if (!input.linkedTemplateIds.includes(templateId)) {
      throw new AssetServiceError('Rotation steps must use linked service templates');
    }
  }

  return withTransaction(async (client) => {
    const config = await loadServiceConfig(client, input.assetType);
    if (!config.workshopCategoryId) {
      throw new AssetServiceError('Workshop service category is not linked', 500);
    }

    const uniqueLinkedTemplateIds = [...new Set(input.linkedTemplateIds)];
    const { rows: activeTemplates } = await client.query<{ id: string }>(
      `
      SELECT id
      FROM public.workshop_attachment_templates
      WHERE id = ANY($1::uuid[])
        AND is_active = true
      `,
      [uniqueLinkedTemplateIds],
    );
    if (activeTemplates.length !== uniqueLinkedTemplateIds.length) {
      throw new AssetServiceError('Inactive or missing templates cannot be linked to Service');
    }

    await client.query(
      `
      UPDATE public.maintenance_categories
      SET period_value = $2,
          period_unit = $3,
          updated_at = NOW()
      WHERE id = $1
      `,
      [config.maintenanceCategoryId, Math.trunc(input.intervalValue), input.intervalUnit],
    );

    await client.query(
      `DELETE FROM public.workshop_category_attachment_templates WHERE category_id = $1`,
      [config.workshopCategoryId],
    );

    for (let index = 0; index < input.linkedTemplateIds.length; index += 1) {
      const templateId = input.linkedTemplateIds[index];
      await client.query(
        `
        INSERT INTO public.workshop_category_attachment_templates (
          category_id, template_id, sort_order, compact_label
        ) VALUES ($1, $2, $3, $4)
        `,
        [
          config.workshopCategoryId,
          templateId,
          index + 1,
          input.compactLabels[templateId] ?? null,
        ],
      );
    }

    await client.query(
      `DELETE FROM public.service_rotation_steps WHERE maintenance_category_id = $1`,
      [config.maintenanceCategoryId],
    );

    for (let index = 0; index < input.rotationTemplateIds.length; index += 1) {
      await client.query(
        `
        INSERT INTO public.service_rotation_steps (
          maintenance_category_id, position, attachment_template_id
        ) VALUES ($1, $2, $3)
        `,
        [config.maintenanceCategoryId, index + 1, input.rotationTemplateIds[index]],
      );
    }

    const refreshed = await loadServiceConfig(client, input.assetType);

    // Rotation step IDs change on save; re-resolve cursors from next template.
    const { rows: assetsNeedingCursor } = await client.query<{
      id: string;
      next_service_template_id: string | null;
    }>(
      `
      SELECT id, next_service_template_id
      FROM public.vehicle_maintenance
      WHERE next_service_template_id IS NOT NULL
        AND (
          ($1 = 'van' AND van_id IS NOT NULL)
          OR ($1 = 'hgv' AND hgv_id IS NOT NULL)
          OR ($1 = 'plant' AND plant_id IS NOT NULL)
        )
      `,
      [input.assetType],
    );
    for (const row of assetsNeedingCursor) {
      if (!row.next_service_template_id) continue;
      const step = resolveStepForTemplateFirst(refreshed.steps, row.next_service_template_id);
      await client.query(
        `
        UPDATE public.vehicle_maintenance
        SET next_service_rotation_step_id = $2,
            updated_at = NOW()
        WHERE id = $1
        `,
        [row.id, step?.id ?? null],
      );
    }

    return {
      assetType: input.assetType,
      maintenanceCategoryId: refreshed.maintenanceCategoryId,
      configKey: refreshed.configKey,
      intervalValue: refreshed.intervalValue,
      intervalUnit: refreshed.intervalUnit,
      workshopCategoryId: refreshed.workshopCategoryId,
      linkedTemplates: input.linkedTemplateIds.map((templateId, index) => ({
        templateId,
        templateName:
          refreshed.steps.find((step) => step.attachmentTemplateId === templateId)?.templateName ??
          templateId,
        sortOrder: index + 1,
        compactLabel: input.compactLabels[templateId] ?? null,
        isActive: true,
      })),
      rotation: refreshed.steps.map((step) => ({
        id: step.id,
        position: step.position,
        templateId: step.attachmentTemplateId,
        templateName: step.templateName,
        compactLabel: step.compactLabel,
      })),
    };
  });
}

export async function seedAssetServiceState(input: {
  assetType: ServiceAssetType;
  assetId: string;
  nextServiceTemplateId: string;
  nextDueMeter?: number | null;
}) {
  if (!input.nextServiceTemplateId) {
    throw new AssetServiceError('Next service type is required');
  }

  return withTransaction(async (client) => {
    const config = await loadServiceConfig(client, input.assetType);
    const step = resolveStepForTemplateFirst(config.steps, input.nextServiceTemplateId);
    if (!step) {
      throw new AssetServiceError('Selected next service type is not in the active rotation');
    }

    const fkColumn =
      input.assetType === 'hgv' ? 'hgv_id' : input.assetType === 'plant' ? 'plant_id' : 'van_id';
    const dueColumn =
      input.assetType === 'plant' ? 'next_service_hours' : 'next_service_mileage';
    const dueValue =
      input.nextDueMeter == null || Number.isNaN(input.nextDueMeter)
        ? null
        : Math.trunc(input.nextDueMeter);

    await client.query(
      `
      INSERT INTO public.vehicle_maintenance (
        ${fkColumn},
        ${dueColumn},
        next_service_template_id,
        next_service_rotation_step_id
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (${fkColumn}) DO UPDATE SET
        ${dueColumn} = COALESCE(EXCLUDED.${dueColumn}, public.vehicle_maintenance.${dueColumn}),
        next_service_template_id = EXCLUDED.next_service_template_id,
        next_service_rotation_step_id = EXCLUDED.next_service_rotation_step_id,
        updated_at = NOW()
      `,
      [input.assetId, dueValue, step.attachmentTemplateId, step.id],
    );

    return {
      nextServiceTemplateId: step.attachmentTemplateId,
      nextServiceRotationStepId: step.id,
      nextDueMeter: dueValue,
    };
  });
}

export async function updateAssetNextServiceType(input: {
  assetType: ServiceAssetType;
  assetId: string;
  nextServiceTemplateId: string;
  actorId: string;
  comment?: string | null;
}) {
  return withTransaction(async (client) => {
    const config = await loadServiceConfig(client, input.assetType);
    const step = resolveStepForTemplateFirst(config.steps, input.nextServiceTemplateId);
    if (!step) {
      throw new AssetServiceError('Selected next service type is not in the active rotation');
    }

    const fkColumn =
      input.assetType === 'hgv' ? 'hgv_id' : input.assetType === 'plant' ? 'plant_id' : 'van_id';

    const { rows: existing } = await client.query<{
      id: string;
      next_service_template_id: string | null;
    }>(
      `SELECT id, next_service_template_id FROM public.vehicle_maintenance WHERE ${fkColumn} = $1 LIMIT 1`,
      [input.assetId],
    );

    if (!existing[0]) {
      await client.query(
        `
        INSERT INTO public.vehicle_maintenance (
          ${fkColumn}, next_service_template_id, next_service_rotation_step_id, last_updated_by
        ) VALUES ($1, $2, $3, $4)
        `,
        [input.assetId, step.attachmentTemplateId, step.id, input.actorId],
      );
    } else {
      await client.query(
        `
        UPDATE public.vehicle_maintenance
        SET next_service_template_id = $2,
            next_service_rotation_step_id = $3,
            last_updated_by = $4,
            updated_at = NOW()
        WHERE id = $1
        `,
        [existing[0].id, step.attachmentTemplateId, step.id, input.actorId],
      );
    }

    await client.query(
      `
      INSERT INTO public.maintenance_history (
        ${fkColumn}, field_name, old_value, new_value, value_type, comment, updated_by
      ) VALUES ($1, 'next_service_type', $2, $3, 'text', $4, $5)
      `,
      [
        input.assetId,
        existing[0]?.next_service_template_id ?? null,
        step.attachmentTemplateId,
        input.comment?.trim() || 'Manual next service type update',
        input.actorId,
      ],
    );

    return {
      nextServiceTemplateId: step.attachmentTemplateId,
      nextServiceRotationStepId: step.id,
    };
  });
}

export interface CompleteServiceTaskInput {
  taskId: string;
  actorId: string;
  actorName?: string | null;
  completionMeter: number;
  confirmedNextTemplateId: string;
  completedComment: string;
  completedAt: string;
  completedSignatureData?: string | null;
  intermediateComment?: string | null;
  intermediateAt?: string | null;
  createdAt?: string | null;
  statusHistoryJson: unknown;
}

export async function completeServiceWorkshopTask(input: CompleteServiceTaskInput) {
  if (!Number.isFinite(input.completionMeter) || input.completionMeter < 0) {
    throw new AssetServiceError('A valid completion meter reading is required');
  }
  if (!input.confirmedNextTemplateId) {
    throw new AssetServiceError('Next service type confirmation is required');
  }
  if (!input.completedComment.trim()) {
    throw new AssetServiceError('Completion comment is required');
  }

  return withTransaction(async (client) => {
    const { rows: taskRows } = await client.query<{
      id: string;
      status: string;
      van_id: string | null;
      hgv_id: string | null;
      plant_id: string | null;
      workshop_category_id: string | null;
      workshop_subcategory_id: string | null;
      action_type: string;
      title: string | null;
    }>(
      `
      SELECT id, status, van_id, hgv_id, plant_id, workshop_category_id,
             workshop_subcategory_id, action_type, title
      FROM public.actions
      WHERE id = $1
      FOR UPDATE
      `,
      [input.taskId],
    );
    const task = taskRows[0];
    if (!task) throw new AssetServiceError('Task not found', 404);
    if (task.action_type !== 'workshop_vehicle_task') {
      throw new AssetServiceError('Only workshop vehicle tasks can complete Service');
    }
    const { rows: existingEvents } = await client.query<{ id: string }>(
      `
      SELECT id
      FROM public.asset_service_events
      WHERE task_id = $1
        AND event_type = 'completion'
      LIMIT 1
      `,
      [input.taskId],
    );
    if (existingEvents[0]) {
      return { alreadyCompleted: true as const, eventId: existingEvents[0].id };
    }

    const assetType: ServiceAssetType = task.hgv_id
      ? 'hgv'
      : task.plant_id
        ? 'plant'
        : 'van';
    const assetId = task.hgv_id || task.plant_id || task.van_id;
    if (!assetId) throw new AssetServiceError('Task has no linked asset', 400);

    const config = await loadServiceConfig(client, assetType);
    if (
      !config.workshopCategoryId ||
      !task.workshop_category_id ||
      task.workshop_category_id !== config.workshopCategoryId
    ) {
      throw new AssetServiceError('Task category is not a Service category for this asset type');
    }

    const { rows: attachmentRows } = await client.query<{
      id: string;
      template_id: string;
      status: string;
      template_name: string;
    }>(
      `
      SELECT a.id, a.template_id, a.status::text AS status, COALESCE(a.template_name_snapshot, t.name) AS template_name
      FROM public.workshop_task_attachments a
      JOIN public.workshop_attachment_templates t ON t.id = a.template_id
      WHERE a.task_id = $1
      `,
      [input.taskId],
    );

    if (attachmentRows.length !== 1) {
      throw new AssetServiceError('Service tasks require exactly one linked attachment');
    }
    const attachment = attachmentRows[0];
    if (attachment.status !== 'completed') {
      throw new AssetServiceError('Linked service attachment must be completed before task completion');
    }

    const linkedOk = await client.query(
      `
      SELECT 1
      FROM public.workshop_category_attachment_templates
      WHERE category_id = $1 AND template_id = $2
      LIMIT 1
      `,
      [config.workshopCategoryId, attachment.template_id],
    );
    if ((linkedOk.rowCount ?? 0) === 0) {
      throw new AssetServiceError('Task attachment is not linked to the Service category');
    }

    const { rows: vmRows } = await client.query<{
      id: string;
      next_service_rotation_step_id: string | null;
      next_service_mileage: number | null;
      next_service_hours: number | null;
      last_service_mileage: number | null;
      last_service_hours: number | null;
    }>(
      `
      SELECT id, next_service_rotation_step_id, next_service_mileage, next_service_hours,
             last_service_mileage, last_service_hours
      FROM public.vehicle_maintenance
      WHERE ${assetType === 'hgv' ? 'hgv_id' : assetType === 'plant' ? 'plant_id' : 'van_id'} = $1
      LIMIT 1
      FOR UPDATE
      `,
      [assetId],
    );

    let maintenanceId = vmRows[0]?.id ?? null;
    if (!maintenanceId) {
      const inserted = await client.query<{ id: string }>(
        `
        INSERT INTO public.vehicle_maintenance (
          ${assetType === 'hgv' ? 'hgv_id' : assetType === 'plant' ? 'plant_id' : 'van_id'}
        ) VALUES ($1)
        RETURNING id
        `,
        [assetId],
      );
      maintenanceId = inserted.rows[0].id;
    }

    const completedStep =
      (vmRows[0]?.next_service_rotation_step_id
        ? config.steps.find(
            (step) =>
              step.id === vmRows[0].next_service_rotation_step_id &&
              step.attachmentTemplateId === attachment.template_id,
          )
        : null) ||
      resolveStepForTemplateFirst(config.steps, attachment.template_id);

    if (!completedStep) {
      throw new AssetServiceError('Completed attachment is not part of the service rotation');
    }

    const resolvedNext = resolveStepForTemplateAfter(
      config.steps,
      input.confirmedNextTemplateId,
      completedStep.id,
    );
    if (!resolvedNext) {
      throw new AssetServiceError('Confirmed next service type is not in the active rotation');
    }

    const meterUnit = getDefaultMeterUnit(assetType);
    const dueMeter = calculateNextDueMeter(input.completionMeter, config.intervalValue);
    const dueColumn = assetType === 'plant' ? 'next_service_hours' : 'next_service_mileage';
    const lastColumn = assetType === 'plant' ? 'last_service_hours' : 'last_service_mileage';
    const currentColumn = assetType === 'plant' ? 'current_hours' : 'current_mileage';

    const oldDue =
      assetType === 'plant'
        ? vmRows[0]?.next_service_hours ?? null
        : vmRows[0]?.next_service_mileage ?? null;

    await client.query(
      `
      UPDATE public.vehicle_maintenance
      SET ${dueColumn} = $2,
          ${lastColumn} = $3,
          ${currentColumn} = GREATEST(COALESCE(${currentColumn}, 0), $3),
          last_service_template_id = $4,
          next_service_template_id = $5,
          next_service_rotation_step_id = $6,
          last_updated_by = $7,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        maintenanceId,
        dueMeter,
        Math.trunc(input.completionMeter),
        attachment.template_id,
        resolvedNext.attachmentTemplateId,
        resolvedNext.id,
        input.actorId,
      ],
    );

    // Dual-write HGV custom value for rollback window
    if (assetType === 'hgv') {
      const updated = await client.query(
        `
        UPDATE public.asset_maintenance_category_values
        SET due_mileage = $3,
            last_mileage = $4,
            last_updated_by = $5,
            last_updated_at = NOW(),
            updated_at = NOW()
        WHERE maintenance_category_id = $1
          AND hgv_id = $2
        `,
        [
          config.maintenanceCategoryId,
          assetId,
          dueMeter,
          Math.trunc(input.completionMeter),
          input.actorId,
        ],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await client.query(
          `
          INSERT INTO public.asset_maintenance_category_values (
            maintenance_category_id, hgv_id, due_mileage, last_mileage, last_updated_by, last_updated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW())
          `,
          [
            config.maintenanceCategoryId,
            assetId,
            dueMeter,
            Math.trunc(input.completionMeter),
            input.actorId,
          ],
        );
      }
    }

    await client.query(
      `
      INSERT INTO public.asset_service_events (
        task_id, van_id, hgv_id, plant_id, maintenance_category_id,
        completed_template_id, completed_template_name,
        next_template_id, next_template_name,
        completed_rotation_step_id, next_rotation_step_id,
        completion_meter, meter_unit, interval_value, interval_unit,
        resulting_due_meter, actor_id, event_type, notes, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7,
        $8, $9,
        $10, $11,
        $12, $13, $14, $15,
        $16, $17, 'completion', $18, $19::timestamptz
      )
      ON CONFLICT (task_id) WHERE (event_type = 'completion') DO NOTHING
      `,
      [
        input.taskId,
        assetType === 'van' ? assetId : null,
        assetType === 'hgv' ? assetId : null,
        assetType === 'plant' ? assetId : null,
        config.maintenanceCategoryId,
        attachment.template_id,
        attachment.template_name,
        resolvedNext.attachmentTemplateId,
        resolvedNext.templateName ?? null,
        completedStep.id,
        resolvedNext.id,
        Math.trunc(input.completionMeter),
        meterUnit,
        config.intervalValue,
        config.intervalUnit,
        dueMeter,
        input.actorId,
        input.completedComment.trim(),
        input.completedAt,
      ],
    );

    await client.query(
      `
      INSERT INTO public.maintenance_history (
        ${assetType === 'hgv' ? 'hgv_id' : assetType === 'plant' ? 'plant_id' : 'van_id'},
        field_name, old_value, new_value, value_type, comment, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        assetId,
        dueColumn,
        oldDue == null ? null : String(oldDue),
        String(dueMeter),
        assetType === 'plant' ? 'text' : 'mileage',
        `Updated from workshop service completion: ${task.title || 'Task'}`,
        input.actorId,
      ],
    );

    // Snapshot category names and mark task complete
    const { rows: categoryNames } = await client.query<{
      category_name: string | null;
      subcategory_name: string | null;
    }>(
      `
      SELECT c.name AS category_name, s.name AS subcategory_name
      FROM public.actions a
      LEFT JOIN public.workshop_task_categories c ON c.id = a.workshop_category_id
      LEFT JOIN public.workshop_task_subcategories s ON s.id = a.workshop_subcategory_id
      WHERE a.id = $1
      `,
      [input.taskId],
    );

    await client.query(
      `
      UPDATE public.actions
      SET status = 'completed',
          actioned = true,
          actioned_at = $2::timestamptz,
          actioned_by = $3,
          actioned_comment = $4,
          actioned_signature_data = $5,
          actioned_signed_at = CASE WHEN $5::text IS NULL THEN NULL ELSE $2::timestamptz END,
          asset_meter_reading = $6,
          asset_meter_unit = $7,
          status_history = $8::jsonb,
          workshop_category_name_snapshot = COALESCE(workshop_category_name_snapshot, $9),
          workshop_subcategory_name_snapshot = COALESCE(workshop_subcategory_name_snapshot, $10),
          logged_at = COALESCE($11::timestamptz, logged_at),
          logged_by = CASE WHEN $11::timestamptz IS NULL THEN logged_by ELSE $3 END,
          logged_comment = COALESCE($12::text, logged_comment),
          created_at = COALESCE($13::timestamptz, created_at),
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        input.taskId,
        input.completedAt,
        input.actorId,
        input.completedComment.trim(),
        input.completedSignatureData ?? null,
        Math.trunc(input.completionMeter),
        meterUnit,
        JSON.stringify(input.statusHistoryJson ?? []),
        categoryNames[0]?.category_name ?? null,
        categoryNames[0]?.subcategory_name ?? null,
        input.intermediateAt ?? null,
        input.intermediateComment?.trim() || null,
        input.createdAt ?? null,
      ],
    );

    await client.query(
      `
      UPDATE public.workshop_task_attachments
      SET completed_at = COALESCE(completed_at, $2::timestamptz),
          template_name_snapshot = COALESCE(template_name_snapshot, $3)
      WHERE id = $1
      `,
      [attachment.id, input.completedAt, attachment.template_name],
    );

    return {
      alreadyCompleted: false as const,
      dueMeter,
      nextTemplateId: resolvedNext.attachmentTemplateId,
      nextStepId: resolvedNext.id,
      completedTemplateId: attachment.template_id,
    };
  });
}

export async function isServiceCategoryTask(
  categoryId: string | null | undefined,
  assetType: ServiceAssetType,
): Promise<boolean> {
  if (!categoryId) return false;
  return withTransaction(async (client) => {
    const config = await loadServiceConfig(client, assetType);
    return config.workshopCategoryId === categoryId;
  });
}

export interface CorrectServiceTaskInput {
  taskId: string;
  actorId: string;
  completionMeter: number;
  confirmedNextTemplateId: string;
  correctionComment: string;
}

/**
 * Manager/admin audited correction for a completed Service task.
 * Does not reopen the task; appends a correction event and updates maintenance state.
 */
export async function correctServiceWorkshopTask(input: CorrectServiceTaskInput) {
  if (!Number.isFinite(input.completionMeter) || input.completionMeter < 0) {
    throw new AssetServiceError('A valid corrected meter reading is required');
  }
  if (!input.confirmedNextTemplateId) {
    throw new AssetServiceError('Corrected next service type is required');
  }
  if (!input.correctionComment.trim() || input.correctionComment.trim().length < 10) {
    throw new AssetServiceError('Correction comment must be at least 10 characters');
  }

  return withTransaction(async (client) => {
    const { rows: taskRows } = await client.query<{
      id: string;
      status: string;
      van_id: string | null;
      hgv_id: string | null;
      plant_id: string | null;
      workshop_category_id: string | null;
      action_type: string;
      title: string | null;
    }>(
      `
      SELECT id, status, van_id, hgv_id, plant_id, workshop_category_id, action_type, title
      FROM public.actions
      WHERE id = $1
      FOR UPDATE
      `,
      [input.taskId],
    );
    const task = taskRows[0];
    if (!task) throw new AssetServiceError('Task not found', 404);
    if (task.action_type !== 'workshop_vehicle_task') {
      throw new AssetServiceError('Only workshop vehicle tasks can be corrected as Service');
    }
    if (task.status !== 'completed') {
      throw new AssetServiceError('Only completed Service tasks can be corrected');
    }

    const assetType: ServiceAssetType = task.hgv_id
      ? 'hgv'
      : task.plant_id
        ? 'plant'
        : 'van';
    const assetId = task.hgv_id || task.plant_id || task.van_id;
    if (!assetId) throw new AssetServiceError('Task has no linked asset', 400);

    const config = await loadServiceConfig(client, assetType);
    if (
      !config.workshopCategoryId ||
      !task.workshop_category_id ||
      task.workshop_category_id !== config.workshopCategoryId
    ) {
      throw new AssetServiceError('Task category is not a Service category for this asset type');
    }

    const { rows: completionEvents } = await client.query<{
      id: string;
      completed_template_id: string;
      completed_template_name: string;
      completed_rotation_step_id: string | null;
      resulting_due_meter: number | null;
    }>(
      `
      SELECT id, completed_template_id, completed_template_name, completed_rotation_step_id, resulting_due_meter
      FROM public.asset_service_events
      WHERE task_id = $1 AND event_type = 'completion'
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [input.taskId],
    );
    const completionEvent = completionEvents[0];
    if (!completionEvent) {
      throw new AssetServiceError('No completion event found for this Service task', 404);
    }

    const completedStep =
      (completionEvent.completed_rotation_step_id
        ? config.steps.find((step) => step.id === completionEvent.completed_rotation_step_id)
        : null) ||
      resolveStepForTemplateFirst(config.steps, completionEvent.completed_template_id);
    if (!completedStep) {
      throw new AssetServiceError('Completed service type is not in the active rotation');
    }

    const resolvedNext = resolveStepForTemplateAfter(
      config.steps,
      input.confirmedNextTemplateId,
      completedStep.id,
    );
    if (!resolvedNext) {
      throw new AssetServiceError('Corrected next service type is not in the active rotation');
    }

    const { rows: vmRows } = await client.query<{
      id: string;
      next_service_mileage: number | null;
      next_service_hours: number | null;
    }>(
      `
      SELECT id, next_service_mileage, next_service_hours
      FROM public.vehicle_maintenance
      WHERE ${assetType === 'hgv' ? 'hgv_id' : assetType === 'plant' ? 'plant_id' : 'van_id'} = $1
      LIMIT 1
      FOR UPDATE
      `,
      [assetId],
    );
    if (!vmRows[0]) {
      throw new AssetServiceError('Maintenance record not found for asset', 404);
    }

    const meterUnit = getDefaultMeterUnit(assetType);
    const dueMeter = calculateNextDueMeter(input.completionMeter, config.intervalValue);
    const dueColumn = assetType === 'plant' ? 'next_service_hours' : 'next_service_mileage';
    const lastColumn = assetType === 'plant' ? 'last_service_hours' : 'last_service_mileage';
    const currentColumn = assetType === 'plant' ? 'current_hours' : 'current_mileage';
    const oldDue =
      assetType === 'plant'
        ? vmRows[0].next_service_hours ?? null
        : vmRows[0].next_service_mileage ?? null;

    await client.query(
      `
      UPDATE public.vehicle_maintenance
      SET ${dueColumn} = $2,
          ${lastColumn} = $3,
          ${currentColumn} = GREATEST(COALESCE(${currentColumn}, 0), $3),
          last_service_template_id = $4,
          next_service_template_id = $5,
          next_service_rotation_step_id = $6,
          last_updated_by = $7,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        vmRows[0].id,
        dueMeter,
        Math.trunc(input.completionMeter),
        completionEvent.completed_template_id,
        resolvedNext.attachmentTemplateId,
        resolvedNext.id,
        input.actorId,
      ],
    );

    if (assetType === 'hgv') {
      await client.query(
        `
        UPDATE public.asset_maintenance_category_values
        SET due_mileage = $3,
            last_mileage = $4,
            last_updated_by = $5,
            last_updated_at = NOW(),
            updated_at = NOW()
        WHERE maintenance_category_id = $1
          AND hgv_id = $2
        `,
        [
          config.maintenanceCategoryId,
          assetId,
          dueMeter,
          Math.trunc(input.completionMeter),
          input.actorId,
        ],
      );
    }

    await client.query(
      `
      INSERT INTO public.asset_service_events (
        task_id, van_id, hgv_id, plant_id, maintenance_category_id,
        completed_template_id, completed_template_name,
        next_template_id, next_template_name,
        completed_rotation_step_id, next_rotation_step_id,
        completion_meter, meter_unit, interval_value, interval_unit,
        resulting_due_meter, actor_id, event_type, notes, corrects_event_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7,
        $8, $9,
        $10, $11,
        $12, $13, $14, $15,
        $16, $17, 'correction', $18, $19
      )
      `,
      [
        input.taskId,
        assetType === 'van' ? assetId : null,
        assetType === 'hgv' ? assetId : null,
        assetType === 'plant' ? assetId : null,
        config.maintenanceCategoryId,
        completionEvent.completed_template_id,
        completionEvent.completed_template_name,
        resolvedNext.attachmentTemplateId,
        resolvedNext.templateName ?? null,
        completedStep.id,
        resolvedNext.id,
        Math.trunc(input.completionMeter),
        meterUnit,
        config.intervalValue,
        config.intervalUnit,
        dueMeter,
        input.actorId,
        input.correctionComment.trim(),
        completionEvent.id,
      ],
    );

    await client.query(
      `
      INSERT INTO public.maintenance_history (
        ${assetType === 'hgv' ? 'hgv_id' : assetType === 'plant' ? 'plant_id' : 'van_id'},
        field_name, old_value, new_value, value_type, comment, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        assetId,
        dueColumn,
        oldDue == null ? null : String(oldDue),
        String(dueMeter),
        assetType === 'plant' ? 'text' : 'mileage',
        `Audited service correction for task: ${task.title || input.taskId}`,
        input.actorId,
      ],
    );

    await client.query(
      `
      UPDATE public.actions
      SET asset_meter_reading = $2,
          asset_meter_unit = $3,
          updated_at = NOW()
      WHERE id = $1
      `,
      [input.taskId, Math.trunc(input.completionMeter), meterUnit],
    );

    return {
      dueMeter,
      nextTemplateId: resolvedNext.attachmentTemplateId,
      nextStepId: resolvedNext.id,
      correctsEventId: completionEvent.id,
    };
  });
}

export async function getServiceCorrectionContext(taskId: string) {
  return withTransaction(async (client) => {
    const { rows: taskRows } = await client.query<{
      van_id: string | null;
      hgv_id: string | null;
      plant_id: string | null;
      workshop_category_id: string | null;
      action_type: string;
    }>(
      `
      SELECT van_id, hgv_id, plant_id, workshop_category_id, action_type
      FROM public.actions
      WHERE id = $1
      LIMIT 1
      `,
      [taskId],
    );
    const task = taskRows[0];
    if (!task) throw new AssetServiceError('Task not found', 404);
    if (task.action_type !== 'workshop_vehicle_task') {
      throw new AssetServiceError('Only workshop vehicle tasks can be corrected as Service');
    }

    const assetType: ServiceAssetType = task.hgv_id
      ? 'hgv'
      : task.plant_id
        ? 'plant'
        : 'van';
    const config = await loadServiceConfig(client, assetType);
    if (
      !config.workshopCategoryId ||
      !task.workshop_category_id ||
      task.workshop_category_id !== config.workshopCategoryId
    ) {
      throw new AssetServiceError('Task category is not a Service category for this asset type');
    }

    const { rows: events } = await client.query<{
      completed_template_id: string;
      completed_rotation_step_id: string | null;
    }>(
      `
      SELECT completed_template_id, completed_rotation_step_id
      FROM public.asset_service_events
      WHERE task_id = $1
        AND event_type = 'completion'
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [taskId],
    );
    const completion = events[0];
    if (!completion) {
      return { suggestedNextTemplateId: null };
    }

    const completedStep =
      (completion.completed_rotation_step_id
        ? config.steps.find((step) => step.id === completion.completed_rotation_step_id)
        : null) ||
      resolveStepForTemplateFirst(config.steps, completion.completed_template_id);
    const successor = completedStep ? getSuccessorStep(config.steps, completedStep.id) : null;

    return {
      suggestedNextTemplateId: successor?.attachmentTemplateId ?? null,
    };
  });
}

export async function insertWorkshopTaskAttachmentExactOne(input: {
  taskId: string;
  templateId: string;
  templateName: string | null;
  actorId: string;
}) {
  return withTransaction(async (client) => {
    const { rows: taskRows } = await client.query<{
      category_id: string | null;
    }>(
      `
      SELECT COALESCE(a.workshop_category_id, s.category_id) AS category_id
      FROM public.actions a
      LEFT JOIN public.workshop_task_subcategories s
        ON s.id = a.workshop_subcategory_id
      WHERE a.id = $1
      FOR UPDATE OF a
      `,
      [input.taskId],
    );
    const task = taskRows[0];
    if (!task) throw new AssetServiceError('Task not found', 404);
    if (!task.category_id) {
      throw new AssetServiceError('Workshop category is required for linked attachments');
    }

    const { rows: linkedRows } = await client.query<{ template_id: string }>(
      `
      SELECT template_id
      FROM public.workshop_category_attachment_templates
      WHERE category_id = $1
      `,
      [task.category_id],
    );
    if (linkedRows.length === 0) {
      throw new AssetServiceError('This category does not allow attachments');
    }
    if (!linkedRows.some((row) => row.template_id === input.templateId)) {
      throw new AssetServiceError('Selected attachment is not linked to this workshop category');
    }

    const existing = await client.query(
      `SELECT 1 FROM public.workshop_task_attachments WHERE task_id = $1 LIMIT 1`,
      [input.taskId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new AssetServiceError('This category allows exactly one linked attachment', 409);
    }

    const { rows } = await client.query<{ id: string }>(
      `
      INSERT INTO public.workshop_task_attachments (
        task_id, template_id, status, created_by, template_name_snapshot
      ) VALUES ($1, $2, 'pending', $3, $4)
      RETURNING id
      `,
      [input.taskId, input.templateId, input.actorId, input.templateName],
    );
    return rows[0];
  });
}
