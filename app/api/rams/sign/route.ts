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
    const { assignment_id, signature_data, comments } = await request.json();

    if (!assignment_id || !signature_data) {
      return NextResponse.json(
        { error: 'assignment_id and signature_data are required' },
        { status: 400 }
      );
    }

    // Verify assignment exists and belongs to user
    const { data: assignment, error: assignmentError } = await supabase
      .from('rams_assignments')
      .select('id, rams_document_id, employee_id, status')
      .eq('id', assignment_id)
      .eq('employee_id', user.id)
      .single();

    if (assignmentError || !assignment) {
      return NextResponse.json(
        { error: 'Assignment not found or you do not have permission' },
        { status: 404 }
      );
    }

    // Check if already signed
    if (assignment.status === 'signed') {
      return NextResponse.json(
        { error: 'This document has already been signed' },
        { status: 400 }
      );
    }

    // Update assignment with signature
    const { data: updatedAssignment, error: updateError } = await supabase
      .from('rams_assignments')
      .update({
        status: 'signed',
        signed_at: new Date().toISOString(),
        signature_data,
        comments: comments || null,
      })
      .eq('id', assignment_id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating assignment:', updateError);
      return NextResponse.json(
        { error: `Failed to sign document: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        assignment: updatedAssignment,
        message: 'Document signed successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Unexpected error in sign:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

