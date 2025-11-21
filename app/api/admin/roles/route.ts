import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import type { GetRolesResponse, CreateRoleRequest, RoleWithUserCount } from '@/types/roles';
import { ALL_MODULES } from '@/types/roles';

/**
 * GET /api/admin/roles
 * List all roles with user counts
 */
export async function GET() {
  try {
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

    // Get all roles with user counts and permission counts
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select(`
        *,
        profiles:profiles(count),
        role_permissions:role_permissions(count)
      `)
      .order('is_super_admin', { ascending: false })
      .order('is_manager_admin', { ascending: false })
      .order('name');

    if (rolesError) {
      throw rolesError;
    }

    // Format response
    const formattedRoles: RoleWithUserCount[] = roles.map((role: any) => ({
      id: role.id,
      name: role.name,
      display_name: role.display_name,
      description: role.description,
      is_super_admin: role.is_super_admin,
      is_manager_admin: role.is_manager_admin,
      created_at: role.created_at,
      updated_at: role.updated_at,
      user_count: role.profiles[0]?.count || 0,
      permission_count: role.role_permissions[0]?.count || 0,
    }));

    const response: GetRolesResponse = {
      success: true,
      roles: formattedRoles,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/admin/roles:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/roles
 * Create a new role with default permissions
 */
export async function POST(request: NextRequest) {
  try {
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

    const body: CreateRoleRequest = await request.json();

    // Validate required fields
    if (!body.name || !body.display_name) {
      return NextResponse.json({ 
        error: 'Missing required fields: name, display_name' 
      }, { status: 400 });
    }

    // Check if role name already exists
    const { data: existingRole } = await supabase
      .from('roles')
      .select('id')
      .eq('name', body.name)
      .single();

    if (existingRole) {
      return NextResponse.json({ 
        error: 'A role with this name already exists' 
      }, { status: 409 });
    }

    // Create the role
    const { data: newRole, error: roleError } = await supabase
      .from('roles')
      .insert({
        name: body.name,
        display_name: body.display_name,
        description: body.description || null,
        is_super_admin: false, // Cannot create super admin via API
        is_manager_admin: body.is_manager_admin || false,
      })
      .select()
      .single();

    if (roleError) {
      throw roleError;
    }

    // Create default permissions for all modules
    // New roles get access to employee-facing modules by default
    const defaultPermissions = ALL_MODULES.map(module => ({
      role_id: newRole.id,
      module_name: module,
      enabled: ['timesheets', 'inspections', 'rams', 'absence', 'toolbox-talks'].includes(module),
    }));

    const { error: permsError } = await supabase
      .from('role_permissions')
      .insert(defaultPermissions);

    if (permsError) {
      // Rollback: delete the role if permissions fail
      await supabase.from('roles').delete().eq('id', newRole.id);
      throw permsError;
    }

    return NextResponse.json({ 
      success: true, 
      role: newRole 
    }, { status: 201 });

  } catch (error) {
    console.error('Error in POST /api/admin/roles:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

