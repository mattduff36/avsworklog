import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { WorkshopAttachmentPDF, type V2PdfSectionData } from '@/lib/pdf/workshop-attachment-pdf';
import { loadSquiresLogoDataUrl } from '@/lib/pdf/squires-logo';
import { logServerError } from '@/lib/utils/server-error-logger';
import { inferAssetMeterUnit, normalizeAssetMeterUnit } from '@/lib/workshop-tasks/asset-meter';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Explicit types for Supabase query results (avoids generated-type `never` issue)
interface AttachmentRow {
  id: string;
  task_id: string;
  template_id: string;
  status: 'pending' | 'completed';
  completed_at: string | null;
  created_at: string;
  workshop_attachment_templates: {
    id: string;
    name: string;
    description: string | null;
  } | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  workshop_comments: string | null;
  asset_meter_reading: number | null;
  asset_meter_unit: string | null;
  van_id: string | null;
  plant_id: string | null;
  hgv_id: string | null;
  workshop_task_categories: { name: string } | null;
}

interface SchemaSnapshotRow {
  snapshot_json: {
    sections?: Array<{
      section_key?: string;
      title?: string;
      description?: string | null;
      sort_order?: number;
      fields?: Array<{
        field_key?: string;
        label?: string;
        field_type?: string;
        is_required?: boolean;
        sort_order?: number;
      }>;
    }>;
  } | null;
}

interface FieldResponseRow {
  section_key: string;
  field_key: string;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

interface MaintenanceMeterRow {
  current_hours?: number | null;
  current_mileage?: number | null;
}

function normalizeFieldType(
  fieldType: string | undefined
): 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature' {
  if (fieldType === 'marking_code') return 'marking_code';
  if (fieldType === 'long_text') return 'long_text';
  if (fieldType === 'number') return 'number';
  if (fieldType === 'date') return 'date';
  if (fieldType === 'yes_no') return 'yes_no';
  if (fieldType === 'signature') return 'signature';
  return 'text';
}

function mapSnapshotToV2PdfSections(
  snapshot: SchemaSnapshotRow | null,
  fieldResponses: FieldResponseRow[],
): V2PdfSectionData[] {
  const snapshotSections = snapshot?.snapshot_json?.sections || [];
  if (!Array.isArray(snapshotSections) || snapshotSections.length === 0) return [];

  const responseMap = new Map(
    fieldResponses.map((response) => [`${response.section_key}::${response.field_key}`, response] as const),
  );

  return snapshotSections
    .slice()
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
    .map((section, sectionIndex) => {
      const sectionKey = section.section_key || `section_${sectionIndex + 1}`;
      const fields = (section.fields || [])
        .slice()
        .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
        .map((field, fieldIndex) => {
          const fieldKey = field.field_key || `field_${fieldIndex + 1}`;
          const response = responseMap.get(`${sectionKey}::${fieldKey}`);
          return {
            field_key: fieldKey,
            label: field.label || `Field ${fieldIndex + 1}`,
            field_type: normalizeFieldType(field.field_type),
            is_required: Boolean(field.is_required),
            response_value: response?.response_value || null,
            response_json: response?.response_json || null,
          };
        });
      return {
        section_key: sectionKey,
        title: section.title || `Section ${sectionIndex + 1}`,
        description: section.description || null,
        fields,
      };
    })
    .filter((section) => section.fields.length > 0);
}

/**
 * GET /api/workshop-tasks/attachments/[id]/pdf
 * Generate and download a PDF for a workshop task attachment.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: attachmentId } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch attachment with template
    const { data: rawAttachment, error: attachmentError } = await supabase
      .from('workshop_task_attachments')
      .select(`
        *,
        workshop_attachment_templates (
          id,
          name,
          description
        )
      `)
      .eq('id', attachmentId)
      .single();

    if (attachmentError) {
      if (attachmentError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
      }
      throw attachmentError;
    }

    const attachment = rawAttachment as unknown as AttachmentRow;

    const { data: rawSnapshot, error: snapshotError } = await supabase
      .from('workshop_attachment_schema_snapshots')
      .select('snapshot_json')
      .eq('attachment_id', attachmentId)
      .limit(1);

    if (snapshotError) throw snapshotError;

    const snapshot = (rawSnapshot && rawSnapshot.length > 0)
      ? (rawSnapshot[0] as unknown as SchemaSnapshotRow)
      : null;

    const { data: rawFieldResponses, error: fieldResponsesError } = await supabase
      .from('workshop_attachment_field_responses')
      .select('section_key, field_key, response_value, response_json')
      .eq('attachment_id', attachmentId);

    if (fieldResponsesError) throw fieldResponsesError;

    const fieldResponses = (rawFieldResponses || []) as unknown as FieldResponseRow[];
    const v2Sections = mapSnapshotToV2PdfSections(snapshot, fieldResponses);
    if (v2Sections.length === 0) {
      return NextResponse.json(
        { error: 'Attachment has no V2 schema data to render' },
        { status: 400 },
      );
    }

    // Fetch the parent task to get category and description
    const { data: rawTask, error: taskError } = await supabase
      .from('actions')
      .select(`
        id,
        title,
        status,
        workshop_comments,
        asset_meter_reading,
        asset_meter_unit,
        van_id,
        plant_id,
        hgv_id,
        workshop_task_categories (
          name
        )
      `)
      .eq('id', attachment.task_id)
      .single();

    if (taskError) {
      console.error('Error fetching parent task:', taskError);
    }

    const task = rawTask as unknown as TaskRow | null;

    // Try to get asset name for context
    let assetName: string | null = null;
    let assetType: 'van' | 'plant' | 'hgv' | null = null;
    let assetMeterReading = task?.asset_meter_reading ?? null;
    let assetMeterUnit = normalizeAssetMeterUnit(task?.asset_meter_unit ?? null);

    if (task?.van_id) {
      const { data: vehicle } = await supabase
        .from('vans')
        .select('reg_number, nickname')
        .eq('id', task.van_id)
        .single();
      if (vehicle) {
        assetName = (vehicle as { reg_number: string | null; nickname: string | null }).reg_number
          || (vehicle as { reg_number: string | null; nickname: string | null }).nickname
          || null;
        assetType = 'van';
      }
    } else if (task?.plant_id) {
      const { data: plant } = await supabase
        .from('plant')
        .select('plant_id, nickname, serial_number')
        .eq('id', task.plant_id)
        .single();
      if (plant) {
        const p = plant as { plant_id: string; nickname: string | null; serial_number: string | null };
        assetName = `${p.plant_id}${p.nickname ? ` (${p.nickname})` : ''}${p.serial_number ? ` (SN: ${p.serial_number})` : ''}`;
        assetType = 'plant';
      }
    } else if (task?.hgv_id) {
      const { data: hgv } = await supabase
        .from('hgvs')
        .select('reg_number, nickname')
        .eq('id', task.hgv_id)
        .single();
      if (hgv) {
        const typedHgv = hgv as { reg_number: string | null; nickname: string | null };
        assetName = typedHgv.reg_number || typedHgv.nickname || null;
        assetType = 'hgv';
      }
    }

    if (assetMeterReading == null && task) {
      const idColumn = task.plant_id ? 'plant_id' : task.hgv_id ? 'hgv_id' : task.van_id ? 'van_id' : null;
      const assetId = task.plant_id ?? task.hgv_id ?? task.van_id ?? null;
      const meterColumn = task.plant_id ? 'current_hours' : 'current_mileage';

      if (idColumn && assetId) {
        const { data: maintenance } = await supabase
          .from('vehicle_maintenance')
          .select(meterColumn)
          .eq(idColumn, assetId)
          .maybeSingle();

        const meterData = maintenance as MaintenanceMeterRow | null;
        assetMeterReading = meterColumn === 'current_hours'
          ? (meterData?.current_hours ?? null)
          : (meterData?.current_mileage ?? null);
      }
    }

    if (!assetMeterUnit) {
      assetMeterUnit = inferAssetMeterUnit(assetType);
    }

    const templateName = attachment.workshop_attachment_templates?.name || 'Attachment';
    const logoSrc = await loadSquiresLogoDataUrl();

    // Generate PDF
    const pdfDocument = WorkshopAttachmentPDF({
      templateName,
      templateDescription: attachment.workshop_attachment_templates?.description || null,
      taskTitle: task?.workshop_comments || task?.title || '',
      taskCategory: task?.workshop_task_categories?.name || 'Workshop Task',
      taskStatus: task?.status || 'unknown',
      attachmentStatus: attachment.status,
      completedAt: attachment.completed_at,
      createdAt: attachment.created_at,
      v2Sections,
      assetName,
      assetType,
      assetMeterReading,
      assetMeterUnit,
      logoSrc,
    });

    // Convert stream to buffer (same pattern as timesheets/[id]/pdf)
    const stream = await renderToStream(pdfDocument);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const pdfBytes = new Uint8Array(Buffer.concat(chunks));

    // Build a clean filename
    const safeTemplateName = templateName.replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeTemplateName}_attachment.pdf`;

    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const { id: attachmentId } = await params;
    console.error('Error generating attachment PDF:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/[id]/pdf',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/${attachmentId}/pdf`,
      },
    });

    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
