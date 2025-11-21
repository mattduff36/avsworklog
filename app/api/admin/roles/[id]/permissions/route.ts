import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import type { UpdatePermissionsRequest } from '@/types/roles';

/**
 * PUT /api/admin/roles/[id]/permissions
 * Update role permissions (bulk update)
 */
export async function PUT(
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

    const body: UpdatePermissionsRequest = await request.json();

    // Validate request
    if (!body.permissions || !Array.isArray(body.permissions)) {
      return NextResponse.json({ 
        error: 'Invalid request: permissions array required' 
      }, { status: 400 });
    }

    // Check if role exists and is not super admin
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

    // Cannot modify super admin or manager/admin permissions
    if (existingRole.is_super_admin || existingRole.is_manager_admin) {
      return NextResponse.json({ 
        error: 'Cannot modify permissions for super admin or manager/admin roles' 
      }, { status: 403 });
    }

    // Update permissions in bulk using upsert
    const permissionsToUpdate = body.permissions.map(perm => ({
      role_id: id,
      module_name: perm.module_name,
      enabled: perm.enabled,
    }));

    // Delete existing permissions for this role
    const { error: deleteError } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', id);

    if (deleteError) {
      throw deleteError;
    }

    // Insert new permissions
    const { error: insertError } = await supabase
      .from('role_permissions')
      .insert(permissionsToUpdate);

    if (insertError) {
      throw insertError;
    }

    // Fetch updated permissions
    const { data: updatedPermissions, error: fetchPermsError } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role_id', id);

    if (fetchPermsError) {
      throw fetchPermsError;
    }

    return NextResponse.json({ 
      success: true,
      permissions: updatedPermissions,
      message: 'Permissions updated successfully'
    });

  } catch (error) {
    console.error(`Error in PUT /api/admin/roles/${params.id}/permissions:`, error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

