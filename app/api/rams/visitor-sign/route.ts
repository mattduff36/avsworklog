import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const { document_id, visitor_name, visitor_company, visitor_role, signature_data } = await request.json();

    if (!document_id || !visitor_name || !signature_data) {
      return NextResponse.json(
        { error: 'document_id, visitor_name, and signature_data are required' },
        { status: 400 }
      );
    }

    // Verify document exists
    const { data: document, error: docError } = await supabase
      .from('rams_documents')
      .select('id, title')
      .eq('id', document_id)
      .single();

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Check if visitor signature already exists (prevent duplicates)
    const { data: existingSignature } = await supabase
      .from('rams_visitor_signatures')
      .select('id')
      .eq('rams_document_id', document_id)
      .eq('visitor_name', visitor_name)
      .eq('visitor_company', visitor_company || '')
      .maybeSingle();

    if (existingSignature) {
      return NextResponse.json(
        { error: 'This visitor has already signed this document' },
        { status: 400 }
      );
    }

    // Create visitor signature record
    const { data: visitorSignature, error: signError } = await supabase
      .from('rams_visitor_signatures')
      .insert({
        rams_document_id: document_id,
        visitor_name,
        visitor_company: visitor_company || null,
        visitor_role: visitor_role || null,
        signature_data,
        recorded_by: user.id,
      })
      .select()
      .single();

    if (signError) {
      console.error('Error recording visitor signature:', signError);
      return NextResponse.json(
        { error: `Failed to record signature: ${signError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        signature: visitorSignature,
        message: 'Visitor signature recorded successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Unexpected error in visitor-sign:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

