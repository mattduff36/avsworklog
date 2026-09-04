import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSystemAccountIds } from '@/lib/server/system-accounts';
import { getUsersWithModuleAccess } from '@/lib/server/team-permissions';
import {
  assignmentIdSetsEqual,
  findAssignmentIdOverlap,
  normalizeAssignmentIds,
} from '@/lib/server/rams-assignments';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    const canManageRams = await canEffectiveRoleUseModuleLevel('rams', 4);
    if (!canManageRams) {
      return NextResponse.json(
        { error: 'Manager-level RAMS access required to assign documents' },
        { status: 403 }
      );
    }

    const body = await request.json() as {
      employee_ids?: unknown;
      unassign_ids?: unknown;
    };

    const employeeIds = normalizeAssignmentIds(body.employee_ids);
    if (!employeeIds) {
      return NextResponse.json(
        { error: 'employee_ids array is required' },
        { status: 400 }
      );
    }

    const unassignIds = body.unassign_ids === undefined || body.unassign_ids === null
      ? []
      : normalizeAssignmentIds(body.unassign_ids);
    if (!unassignIds) {
      return NextResponse.json(
        { error: 'unassign_ids must be an array of user IDs' },
        { status: 400 }
      );
    }

    if (findAssignmentIdOverlap(employeeIds, unassignIds).length > 0) {
      return NextResponse.json(
        { error: 'employee_ids and unassign_ids must not overlap' },
        { status: 400 }
      );
    }

    const { data: document, error: docError } = await supabase
      .from('rams_documents')
      .select('id, title')
      .eq('id', id)
      .single();

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { data: currentAssignments, error: currentError } = await supabase
      .from('rams_assignments')
      .select('employee_id')
      .eq('rams_document_id', id);

    if (currentError) {
      return NextResponse.json({ error: 'Failed to load current assignments' }, { status: 500 });
    }

    const typedCurrentAssignments = (currentAssignments || []) as Array<{ employee_id: string }>;
    const currentAssignedIds = new Set(typedCurrentAssignments.map((assignment) => assignment.employee_id));
    const newlyAssignedIds = employeeIds.filter((employeeId) => !currentAssignedIds.has(employeeId));
    const addedCount = newlyAssignedIds.length;

    const admin = createAdminClient();

    if (employeeIds.length > 0) {
      const systemAccountIds = await getSystemAccountIds(admin);
      if (employeeIds.some((employeeId) => systemAccountIds.has(employeeId))) {
        return NextResponse.json(
          { error: 'System accounts cannot be assigned to RAMS documents' },
          { status: 400 }
        );
      }

      const { data: employees, error: empError } = await supabase
        .from('profiles')
        .select('id')
        .in('id', employeeIds);

      if (empError || !employees) {
        return NextResponse.json({ error: 'Failed to verify employees' }, { status: 400 });
      }

      if (employees.length !== employeeIds.length) {
        return NextResponse.json(
          { error: 'One or more employee IDs are invalid' },
          { status: 400 }
        );
      }

      if (newlyAssignedIds.length > 0) {
        const allowedUserIds = await getUsersWithModuleAccess('rams', newlyAssignedIds, admin);
        if (newlyAssignedIds.some((employeeId) => !allowedUserIds.has(employeeId))) {
          return NextResponse.json(
            { error: 'One or more employees do not have Projects access' },
            { status: 400 }
          );
        }
      }
    }

    let unassignableIds: string[] = [];
    if (unassignIds.length > 0) {
      const { data: signedAssignments, error: signedError } = await supabase
        .from('rams_assignments')
        .select('employee_id')
        .eq('rams_document_id', id)
        .eq('status', 'signed')
        .in('employee_id', unassignIds);

      if (signedError) {
        return NextResponse.json({ error: 'Failed to verify signed assignments' }, { status: 500 });
      }

      const signedEmployeeIds = new Set(
        ((signedAssignments || []) as Array<{ employee_id: string }>).map((assignment) => assignment.employee_id)
      );
      unassignableIds = unassignIds.filter((employeeId) => !signedEmployeeIds.has(employeeId));
    }

    const existingStatusMap = new Map<string, string>();
    if (employeeIds.length > 0) {
      const { data: existingAssignments, error: existingError } = await supabase
        .from('rams_assignments')
        .select('employee_id, status')
        .eq('rams_document_id', id)
        .in('employee_id', employeeIds);

      if (existingError) {
        return NextResponse.json({ error: 'Failed to load existing assignments' }, { status: 500 });
      }

      ((existingAssignments || []) as Array<{ employee_id: string; status: string }>).forEach((assignment) => {
        existingStatusMap.set(assignment.employee_id, assignment.status);
      });
    }

    let removedCount = 0;
    if (unassignableIds.length > 0) {
      const { data: deletedRows, error: unassignError } = await supabase
        .from('rams_assignments')
        .delete()
        .eq('rams_document_id', id)
        .in('employee_id', unassignableIds)
        .neq('status', 'signed')
        .select('employee_id');

      if (unassignError) {
        console.error('Unassignment error:', unassignError);
        return NextResponse.json(
          { error: `Failed to unassign employees: ${unassignError.message}` },
          { status: 500 }
        );
      }

      const deletedIds = ((deletedRows || []) as Array<{ employee_id: string }>).map(
        (row) => row.employee_id
      );
      if (!assignmentIdSetsEqual(deletedIds, unassignableIds)) {
        return NextResponse.json(
          { error: 'Failed to unassign employees: assignment state changed' },
          { status: 409 }
        );
      }
      removedCount = deletedIds.length;
    }

    if (employeeIds.length > 0) {
      const assignmentsToCreate = employeeIds.map((employeeId) => ({
        rams_document_id: id,
        employee_id: employeeId,
        assigned_by: user.id,
        status: (existingStatusMap.get(employeeId) || 'pending') as 'pending' | 'read' | 'signed',
      }));

      const { error: assignError } = await supabase
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

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/rams/[id]/assign',
      additionalData: {
        endpoint: '/api/rams/[id]/assign',
      },
    });
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await getProfileWithRole(user.id);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    const canManageRams = await canEffectiveRoleUseModuleLevel('rams', 4);
    if (!canManageRams) {
      return NextResponse.json(
        { error: 'Manager-level RAMS access required to view assignments' },
        { status: 403 }
      );
    }

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

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/rams/[id]/assign',
      additionalData: {
        endpoint: '/api/rams/[id]/assign',
      },
    });
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
