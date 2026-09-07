import { validateRequiredSchemaResponses } from '@/lib/workshop-attachments/schema-validation';
import type { AttachmentSchemaSection } from '@/types/workshop-attachments-v2';
import {
  canonicalizeAttachmentResponses,
  diffAttachmentResponses,
  hashAttachmentResponses,
  type CorrectAttachmentResponsesBody,
} from '@/lib/workshop-tasks/completed-correction';
import {
  WorkshopCorrectionError,
  withWorkshopCorrectionTransaction,
} from '@/lib/server/workshop-completed-task-correction';

interface SnapshotJson {
  sections?: AttachmentSchemaSection[];
}

export async function correctCompletedAttachmentResponses(input: {
  attachmentId: string;
  actorId: string;
  body: CorrectAttachmentResponsesBody;
  source?: 'manager_ui' | 'production_script';
}): Promise<{ correctionId: string; preimageHash: string }> {
  return withWorkshopCorrectionTransaction(async (client) => {
    const { rows: attachmentRows } = await client.query<{
      id: string;
      task_id: string;
      status: string | null;
    }>(
      `
      SELECT id, task_id, status
      FROM public.workshop_task_attachments
      WHERE id = $1
      FOR UPDATE
      `,
      [input.attachmentId]
    );
    const attachment = attachmentRows[0];
    if (!attachment) throw new WorkshopCorrectionError('Attachment not found', 404);

    const { rows: taskRows } = await client.query<{
      id: string;
      status: string;
      action_type: string;
    }>(
      `
      SELECT id, status, action_type
      FROM public.actions
      WHERE id = $1
      FOR UPDATE
      `,
      [attachment.task_id]
    );
    const task = taskRows[0];
    if (!task) throw new WorkshopCorrectionError('Task not found', 404);
    if (task.action_type !== 'workshop_vehicle_task') {
      throw new WorkshopCorrectionError('Only workshop vehicle task attachments can be corrected', 400);
    }
    if (task.status !== 'completed' || attachment.status !== 'completed') {
      throw new WorkshopCorrectionError('Only completed attachments on completed tasks can be corrected', 400);
    }

    const { rows: snapshotRows } = await client.query<{ snapshot_json: SnapshotJson | null }>(
      `
      SELECT snapshot_json
      FROM public.workshop_attachment_schema_snapshots
      WHERE attachment_id = $1
      LIMIT 1
      `,
      [attachment.id]
    );
    const sections = Array.isArray(snapshotRows[0]?.snapshot_json?.sections)
      ? snapshotRows[0]!.snapshot_json!.sections!
      : [];
    if (sections.length === 0) {
      throw new WorkshopCorrectionError('Attachment is missing a V2 schema snapshot', 400);
    }

    const allowedKeys = new Set(
      sections.flatMap((section) =>
        section.fields.map((field) => `${section.section_key}::${field.field_key}`)
      )
    );
    for (const response of input.body.responses) {
      if (!allowedKeys.has(`${response.section_key}::${response.field_key}`)) {
        throw new WorkshopCorrectionError(
          `Unknown attachment field ${response.section_key}.${response.field_key}`,
          400
        );
      }
    }

    const { rows: currentRows } = await client.query<{
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
      [attachment.id]
    );
    const previous = canonicalizeAttachmentResponses(currentRows);
    const currentHash = hashAttachmentResponses(previous);
    if (currentHash !== input.body.expectedPreimageHash) {
      throw new WorkshopCorrectionError(
        'This attachment changed since you opened it. Refresh and try again.',
        409
      );
    }

    const incoming = canonicalizeAttachmentResponses(input.body.responses);
    const incomingMap = new Map(incoming.map((row) => [`${row.section_key}::${row.field_key}`, row]));
    const merged = canonicalizeAttachmentResponses(
      previous.map((row) => incomingMap.get(`${row.section_key}::${row.field_key}`) ?? row).concat(
        incoming.filter((row) => !previous.some((existing) =>
          existing.section_key === row.section_key && existing.field_key === row.field_key
        ))
      )
    );
    const diff = diffAttachmentResponses(previous, merged);
    if (diff.changedFields.length === 0) {
      throw new WorkshopCorrectionError('No attachment changes to save', 409);
    }

    const validationErrors = validateRequiredSchemaResponses(sections, merged);
    if (validationErrors.length > 0) {
      throw new WorkshopCorrectionError(
        `Cannot save correction: ${validationErrors[0]}`,
        400
      );
    }

    for (const row of incoming) {
      await client.query(
        `
        INSERT INTO public.workshop_attachment_field_responses (
          attachment_id, field_id, section_key, field_key, response_value, response_json
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (attachment_id, section_key, field_key)
        DO UPDATE SET
          field_id = EXCLUDED.field_id,
          response_value = EXCLUDED.response_value,
          response_json = EXCLUDED.response_json,
          updated_at = NOW()
        `,
        [
          attachment.id,
          input.body.responses.find(
            (entry) => entry.section_key === row.section_key && entry.field_key === row.field_key
          )?.field_id ?? null,
          row.section_key,
          row.field_key,
          row.response_value,
          row.response_json ? JSON.stringify(row.response_json) : null,
        ]
      );
    }

    const { rows: actorRows } = await client.query<{ full_name: string | null }>(
      `SELECT full_name FROM public.profiles WHERE id = $1 LIMIT 1`,
      [input.actorId]
    );

    const { rows: correctionRows } = await client.query<{ id: string }>(
      `
      INSERT INTO public.workshop_attachment_corrections (
        attachment_id, task_id, actor_id, actor_name, reason, changed_fields,
        previous_responses, new_responses, source
      ) VALUES (
        $1, $2, $3, $4, $5, $6::text[], $7::jsonb, $8::jsonb, $9
      )
      RETURNING id
      `,
      [
        attachment.id,
        task.id,
        input.actorId,
        actorRows[0]?.full_name ?? null,
        input.body.reason,
        diff.changedFields,
        JSON.stringify(diff.previousResponses),
        JSON.stringify(diff.newResponses),
        input.source ?? 'manager_ui',
      ]
    );

    return {
      correctionId: correctionRows[0].id,
      preimageHash: hashAttachmentResponses(merged),
    };
  });
}
