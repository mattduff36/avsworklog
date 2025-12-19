import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import type { GetRoleResponse, UpdateRoleRequest } from '@/types/roles';
import { logServerError } from '@/lib/utils/server-error-logger';

/**
 * GET /api/admin/roles/[id]
 * Get role details with permissions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager/admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Manager/Admin access required' }, { status: 403 });
    }

    // Get role with permissions
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select(`
        *,
        permissions:role_permissions(*)
      `)
      .eq('id', id)
      .single();

    if (roleError) {
      if (roleError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
      throw roleError;
    }

    // Get user count
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role_id', id);

    const response: GetRoleResponse = {
      success: true,
      role: {
        ...role,
        user_count: count || 0,
      },
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error(`Error in GET /api/admin/roles/${params.id

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/admin/roles/:id',
      additionalData: {
        endpoint: '/admin/roles/:id',
      },
    );}:`, error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/roles/[id]
 * Update role details (not permissions)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager/admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Manager/Admin access required' }, { status: 403 });
    }

    const body: UpdateRoleRequest = await request.json();

    // Check if role exists and is not super admin
    const { data: existingRole, error: fetchError } = await supabase
      .from('roles')
      .select('is_super_admin')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
      throw fetchError;
    }

    if (existingRole.is_super_admin) {
      return NextResponse.json({ 
        error: 'Cannot modify super admin role' 
      }, { status: 403 });
    }

    // If changing name, check it doesn't conflict
    if (body.name) {
      const { data: conflictRole } = await supabase
        .from('roles')
        .select('id')
        .eq('name', body.name)
        .neq('id', id)
        .single();

      if (conflictRole) {
        return NextResponse.json({ 
          error: 'A role with this name already exists' 
        }, { status: 409 });
      }
    }

    // Update the role
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.display_name !== undefined) updateData.display_name = body.display_name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.is_manager_admin !== undefined) updateData.is_manager_admin = body.is_manager_admin;
    if (body.timesheet_type !== undefined) updateData.timesheet_type = body.timesheet_type; // Phase 6

    const { data: updatedRole, error: updateError } = await supabase
      .from('roles')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ 
      success: true, 
      role: updatedRole 
    });

  } catch (error) {
    console.error(`Error in PATCH /api/admin/roles/${params.id

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/admin/roles/:id',
      additionalData: {
        endpoint: '/admin/roles/:id',
      },
    );}:`, error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/roles/[id]
 * Delete a role (with safety checks)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager/admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Manager/Admin access required' }, { status: 403 });
    }

    // Check if role exists and is not super admin or manager/admin
    const { data: existingRole, error: fetchError } = await supabase
      .from('roles')
      .select('is_super_admin, is_manager_admin')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
      throw fetchError;
    }

    if (existingRole.is_super_admin || existingRole.is_manager_admin) {
      return NextResponse.json({ 
        error: 'Cannot delete super admin or manager/admin roles' 
      }, { status: 403 });
    }

    // Check if any users have this role
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role_id', id);

    if (count && count > 0) {
      return NextResponse.json({ 
        error: `Cannot delete role: ${count} user(s) are assigned to this role. Please reassign users first.` 
      }, { status: 409 });
    }

    // Delete role (permissions will cascade delete)
    const { error: deleteError } = await supabase
      .from('roles')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({ 
      success: true,
      message: 'Role deleted successfully'
    });

  } catch (error) {
    console.error(`Error in DELETE /api/admin/roles/${params.id

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/admin/roles/:id',
      additionalData: {
        endpoint: '/admin/roles/:id',
      },
    );}:`, error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

