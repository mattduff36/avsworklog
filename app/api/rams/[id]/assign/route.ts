import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';

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
    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    if (!profile.role?.is_manager_admin) {
      return NextResponse.json(
        { error: 'Only admins and managers can assign RAMS documents' },
        { status: 403 }
      );
    }

    // Parse request body
    const { employee_ids, unassign_ids } = await request.json();

    // employee_ids can be empty (to unassign everyone)
    if (!employee_ids || !Array.isArray(employee_ids)) {
      return NextResponse.json(
        { error: 'employee_ids array is required' },
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

    // Get current assignments BEFORE making changes to calculate accurate counts
    const { data: currentAssignments } = await supabase
      .from('rams_assignments')
      .select('employee_id')
      .eq('rams_document_id', id);
    
    const currentAssignedIds = new Set(
      currentAssignments?.map(a => a.employee_id) || []
    );

    // Calculate counts before making changes
    const newlyAssignedIds = employee_ids.filter(id => !currentAssignedIds.has(id));
    const addedCount = newlyAssignedIds.length;

    // Handle unassignments first (but exclude employees who have signed)
    let actualRemovedCount = 0;
    if (unassign_ids && Array.isArray(unassign_ids) && unassign_ids.length > 0) {
      // Check which employees have signed - they cannot be unassigned
      const { data: signedAssignments } = await supabase
        .from('rams_assignments')
        .select('employee_id')
        .eq('rams_document_id', id)
        .eq('status', 'signed')
        .in('employee_id', unassign_ids);

      const signedEmployeeIds = new Set(
        signedAssignments?.map(a => a.employee_id) || []
      );

      // Filter out signed employees from unassign list
      const unassignableIds = unassign_ids.filter(id => !signedEmployeeIds.has(id));
      actualRemovedCount = unassignableIds.length;

      if (unassignableIds.length > 0) {
        const { error: unassignError } = await supabase
          .from('rams_assignments')
          .delete()
          .eq('rams_document_id', id)
          .in('employee_id', unassignableIds);

        if (unassignError) {
          console.error('Unassignment error:', unassignError);
          return NextResponse.json(
            { error: `Failed to unassign employees: ${unassignError.message}` },
            { status: 500 }
          );
        }
      }
    }
    
    const removedCount = actualRemovedCount;

    // Only process assignments if there are employees to assign
    if (employee_ids.length > 0) {
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

      // Get existing assignments to preserve status for already assigned employees
      const { data: existingAssignments } = await supabase
        .from('rams_assignments')
        .select('employee_id, status')
        .eq('rams_document_id', id)
        .in('employee_id', employee_ids);

      const existingStatusMap = new Map(
        existingAssignments?.map(a => [a.employee_id, a.status]) || []
      );

      // Create assignments (using upsert to handle duplicates)
      // Preserve existing status if employee is already assigned, otherwise set to pending
      const assignmentsToCreate = employee_ids.map(employee_id => ({
        rams_document_id: id,
        employee_id: employee_id,
        assigned_by: user.id,
        status: (existingStatusMap.get(employee_id) || 'pending') as 'pending' | 'read' | 'signed',
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
    }

    return NextResponse.json(
      {
        success: true,
        message: addedCount > 0 && removedCount > 0
          ? `Document assigned to ${addedCount} employee(s) and unassigned from ${removedCount} employee(s)`
          : addedCount > 0
          ? `Document assigned to ${addedCount} employee(s)`
          : removedCount > 0
          ? `Document unassigned from ${removedCount} employee(s)`
          : 'Assignments updated',
      },
      { status: 200 }
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
    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    if (!profile.role?.is_manager_admin) {
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

