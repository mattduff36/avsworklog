import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { renderToBuffer } from '@react-pdf/renderer';
import { ToolboxTalkExportDocument } from '@/lib/pdf/ToolboxTalkExportDocument';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check user role (must be manager or admin)
    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    if (!profile.role?.is_manager_admin) {
      return NextResponse.json(
        { error: 'Only admins and managers can export toolbox talk reports' },
        { status: 403 }
      );
    }

    // Fetch message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        subject,
        body,
        type,
        created_at,
        pdf_file_path,
        sender:profiles!messages_sender_id_fkey(full_name)
      `)
      .eq('id', id)
      .single();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Only allow exporting toolbox talks (not reminders)
    if (message.type !== 'TOOLBOX_TALK') {
      return NextResponse.json(
        { error: 'Only toolbox talk messages can be exported' },
        { status: 400 }
      );
    }

    // Fetch all recipients with their signature status
    const { data: recipients, error: recipientsError } = await supabase
      .from('message_recipients')
      .select(`
        id,
        status,
        signed_at,
        signature_data,
        user:profiles!message_recipients_recipient_id_fkey(
          id,
          full_name,
          role,
          employee_id
        )
      `)
      .eq('message_id', id)
      .order('signed_at', { ascending: false, nullsFirst: false });

    if (recipientsError) {
      console.error('Error fetching recipients:', recipientsError);
      return NextResponse.json(
        { error: 'Failed to fetch recipients' },
        { status: 500 }
      );
    }

    // Construct absolute logo URL
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('host') || 'localhost:3000';
    const logoUrl = `${protocol}://${host}/images/logo.png`;

    // Generate PDF
    const pdfDocument = ToolboxTalkExportDocument({
      message: {
        id: message.id,
        subject: message.subject,
        body: message.body,
        created_at: message.created_at,
        sender_name: message.sender?.full_name || 'Unknown',
        pdf_file_path: message.pdf_file_path,
      },
      recipients: recipients || [],
      logoUrl,
    });

    const pdfBuffer = await renderToBuffer(pdfDocument);

    // Return PDF
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Toolbox_Talk_${message.subject.replace(/[^a-z0-9]/gi, '_')}_Report.pdf"`,
      },
    });
  } catch (error) {
    console.error('Unexpected error in export:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

