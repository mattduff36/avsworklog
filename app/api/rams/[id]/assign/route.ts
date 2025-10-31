import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
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
        { error: 'Only admins and managers can assign RAMS documents' },
        { status: 403 }
      );
    }

    // Parse request body
    const { employee_ids } = await request.json();

    if (!employee_ids || !Array.isArray(employee_ids) || employee_ids.length === 0) {
      return NextResponse.json(
        { error: 'employee_ids array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Verify document exists
    const { data: document, error: docError } = await supabase
      .from('rams_documents')
      .select('id, title')
      .eq('id', id)
      .single();

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Verify all employee IDs exist
    const { data: employees, error: empError } = await supabase
      .from('profiles')
      .select('id')
      .in('id', employee_ids);

    if (empError || !employees) {
      return NextResponse.json({ error: 'Failed to verify employees' }, { status: 400 });
    }

    if (employees.length !== employee_ids.length) {
      return NextResponse.json(
        { error: 'One or more employee IDs are invalid' },
        { status: 400 }
      );
    }

    // Create assignments (using upsert to handle duplicates)
    const assignmentsToCreate = employee_ids.map(employee_id => ({
      rams_document_id: id,
      employee_id: employee_id,
      assigned_by: user.id,
      status: 'pending' as const,
    }));

    const { data: assignments, error: assignError } = await supabase
      .from('rams_assignments')
      .upsert(assignmentsToCreate, {
        onConflict: 'rams_document_id,employee_id',
        ignoreDuplicates: false,
      })
      .select();

    if (assignError) {
      console.error('Assignment error:', assignError);
      return NextResponse.json(
        { error: `Failed to create assignments: ${assignError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        assignments,
        message: `Document assigned to ${employee_ids.length} employee(s)`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Unexpected error in assign:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch current assignments for a document
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
        { error: 'Only admins and managers can view assignments' },
        { status: 403 }
      );
    }

    // Fetch assignments with employee details
    const { data: assignments, error } = await supabase
      .from('rams_assignments')
      .select(`
        *,
        employee:profiles!rams_assignments_employee_id_fkey(id, full_name, role)
      `)
      .eq('rams_document_id', id)
      .order('assigned_at', { ascending: false });

    if (error) {
      console.error('Error fetching assignments:', error);
      return NextResponse.json(
        { error: 'Failed to fetch assignments' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      assignments,
    });
  } catch (error) {
    console.error('Unexpected error in GET assignments:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

