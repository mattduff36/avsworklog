import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { RAMSExportDocument } from '@/lib/pdf/RAMSExportDocument';

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
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    if (profile.role !== 'admin' && profile.role !== 'manager') {
      return NextResponse.json(
        { error: 'Only admins and managers can export RAMS documents' },
        { status: 403 }
      );
    }

    // Fetch document
    const { data: document, error: docError } = await supabase
      .from('rams_documents')
      .select(`
        *,
        uploader:profiles!rams_documents_uploaded_by_fkey(full_name)
      `)
      .eq('id', id)
      .single();

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Fetch employee assignments with signatures
    const { data: assignments, error: assignError } = await supabase
      .from('rams_assignments')
      .select(`
        *,
        employee:profiles!rams_assignments_employee_id_fkey(id, full_name, role)
      `)
      .eq('rams_document_id', id)
      .order('signed_at', { ascending: false });

    if (assignError) {
      console.error('Error fetching assignments:', assignError);
      return NextResponse.json(
        { error: 'Failed to fetch assignments' },
        { status: 500 }
      );
    }

    // Fetch visitor signatures
    const { data: visitorSignatures, error: visitorError } = await supabase
      .from('rams_visitor_signatures')
      .select(`
        *,
        recorder:profiles!rams_visitor_signatures_recorded_by_fkey(full_name)
      `)
      .eq('rams_document_id', id)
      .order('signed_at', { ascending: false });

    if (visitorError) {
      console.error('Error fetching visitor signatures:', visitorError);
      return NextResponse.json(
        { error: 'Failed to fetch visitor signatures' },
        { status: 500 }
      );
    }

    // Generate PDF
    const pdfDocument = RAMSExportDocument({
      document: {
        ...document,
        uploader_name: document.uploader?.full_name || 'Unknown',
      },
      assignments: assignments || [],
      visitorSignatures: visitorSignatures || [],
    });

    const pdfBuffer = await renderToBuffer(pdfDocument);

    // Return PDF
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${document.title.replace(/[^a-z0-9]/gi, '_')}_signatures.pdf"`,
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

