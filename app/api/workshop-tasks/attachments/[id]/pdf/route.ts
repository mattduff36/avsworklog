import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { WorkshopAttachmentPDF } from '@/lib/pdf/workshop-attachment-pdf';
import { logServerError } from '@/lib/utils/server-error-logger';

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

interface QuestionRow {
  id: string;
  question_text: string;
  question_type: string;
  is_required: boolean;
  sort_order: number;
}

interface ResponseRow {
  question_id: string;
  response_value: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  workshop_comments: string | null;
  vehicle_id: string | null;
  plant_id: string | null;
  workshop_task_categories: { name: string } | null;
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

    // Fetch questions for the template
    const { data: rawQuestions, error: questionsError } = await supabase
      .from('workshop_attachment_questions')
      .select('id, question_text, question_type, is_required, sort_order')
      .eq('template_id', attachment.template_id)
      .order('sort_order', { ascending: true });

    if (questionsError) throw questionsError;

    const questions = (rawQuestions || []) as unknown as QuestionRow[];

    // Fetch responses for this attachment
    const { data: rawResponses, error: responsesError } = await supabase
      .from('workshop_attachment_responses')
      .select('question_id, response_value')
      .eq('attachment_id', attachmentId);

    if (responsesError) throw responsesError;

    const responses = (rawResponses || []) as unknown as ResponseRow[];

    // Fetch the parent task to get category and description
    const { data: rawTask, error: taskError } = await supabase
      .from('actions')
      .select(`
        id,
        title,
        status,
        workshop_comments,
        vehicle_id,
        plant_id,
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
    let assetType: 'vehicle' | 'plant' | null = null;

    if (task?.vehicle_id) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('reg_number, nickname')
        .eq('id', task.vehicle_id)
        .single();
      if (vehicle) {
        assetName = (vehicle as { reg_number: string | null; nickname: string | null }).reg_number
          || (vehicle as { reg_number: string | null; nickname: string | null }).nickname
          || null;
        assetType = 'vehicle';
      }
    } else if (task?.plant_id) {
      const { data: plant } = await supabase
        .from('plant')
        .select('plant_id, nickname')
        .eq('id', task.plant_id)
        .single();
      if (plant) {
        const p = plant as { plant_id: string; nickname: string | null };
        assetName = `${p.plant_id}${p.nickname ? ` (${p.nickname})` : ''}`;
        assetType = 'plant';
      }
    }

    const templateName = attachment.workshop_attachment_templates?.name || 'Attachment';

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
      questions,
      responses,
      assetName,
      assetType,
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
