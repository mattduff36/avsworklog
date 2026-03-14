import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetRolesResponse, CreateRoleRequest, RoleWithUserCount, RoleMatrixRow, ModuleName, RoleClass } from '@/types/roles';
import { ALL_MODULES } from '@/types/roles';
import { managerFlagFromRoleClass, normalizeRoleInternalName, roleClassFromLegacyRoleType } from '@/lib/utils/role-name';

/**
 * GET /api/admin/roles
 * List all roles with user counts
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const effectiveRole = await getEffectiveRole();
    const isAdminOrSuper = effectiveRole.is_super_admin || effectiveRole.role_name === 'admin';
    const isManager = effectiveRole.is_manager_admin && !isAdminOrSuper;
    if (!isAdminOrSuper && !isManager) {
      return NextResponse.json({ error: 'Forbidden - Admin or Manager access required' }, { status: 403 });
    }

    // Get all roles with user counts and permissions
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select(`
        *,
        profiles:profiles(count),
        role_permissions:role_permissions(module_name, enabled)
      `)
      .order('is_super_admin', { ascending: false })
      .order('is_manager_admin', { ascending: false })
      .order('name');

    if (rolesError) {
      throw rolesError;
    }

    interface RolePermissionRow {
      module_name: string;
      enabled: boolean;
    }

    interface RoleRow {
      id: string;
      name: string;
      display_name: string;
      description: string | null;
      role_class: RoleClass;
      is_super_admin: boolean;
      is_manager_admin: boolean;
      timesheet_type?: string;
      created_at: string;
      updated_at: string;
      profiles?: Array<{ count: number }>;
      role_permissions?: RolePermissionRow[];
    }

    const formattedRoles: RoleWithUserCount[] = (roles as RoleRow[]).map((role) => ({
      id: role.id,
      name: role.name,
      display_name: role.display_name,
      description: role.description,
      role_class: role.role_class,
      is_super_admin: role.is_super_admin,
      is_manager_admin: role.is_manager_admin,
      created_at: role.created_at,
      updated_at: role.updated_at,
      user_count: role.profiles?.[0]?.count || 0,
      permission_count: role.role_permissions?.filter((permission) => permission.enabled).length || 0,
    }));

    const matrixRoles: RoleMatrixRow[] = (roles as RoleRow[]).map((role) => {
      const perms: Record<ModuleName, boolean> = {} as Record<ModuleName, boolean>;
      ALL_MODULES.forEach((mod) => {
        const found = role.role_permissions?.find((p) => p.module_name === mod);
        perms[mod] = found?.enabled ?? false;
      });
      return {
        id: role.id,
        name: role.name,
        display_name: role.display_name,
        description: role.description,
        role_class: role.role_class,
        is_super_admin: role.is_super_admin,
        is_manager_admin: role.is_manager_admin,
        timesheet_type: role.timesheet_type,
        created_at: role.created_at,
        updated_at: role.updated_at,
        user_count: role.profiles?.[0]?.count || 0,
        permissions: perms,
      };
    });

    const response: GetRolesResponse = {
      success: true,
      roles: formattedRoles,
    };

    return NextResponse.json({ ...response, matrix: matrixRoles });

  } catch (error) {
    console.error('Error in GET /api/admin/roles:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/roles',
      additionalData: {
        endpoint: '/api/admin/roles',
      },
    });
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

    const effectiveRole = await getEffectiveRole();
    const isAdminOrSuper = effectiveRole.is_super_admin || effectiveRole.role_name === 'admin';
    const isManager = effectiveRole.is_manager_admin && !isAdminOrSuper;
    if (!isAdminOrSuper && !isManager) {
      return NextResponse.json({ error: 'Forbidden - Admin or Manager access required' }, { status: 403 });
    }

    const body = (await request.json()) as CreateRoleRequest;

    // Validate required fields
    if (!body.name || !body.display_name) {
      return NextResponse.json({ 
        error: 'Missing required fields: name, display_name' 
      }, { status: 400 });
    }

    const normalizedName = normalizeRoleInternalName(body.name);
    const requestedRoleClass = roleClassFromLegacyRoleType(
      body.role_class ?? body.role_type,
      false,
      normalizedName
    );

    if (isManager && requestedRoleClass !== 'employee') {
      return NextResponse.json({
        error: 'Managers can only create Employee roles'
      }, { status: 403 });
    }

    if (requestedRoleClass === 'admin' && normalizedName !== 'admin') {
      return NextResponse.json({
        error: 'Admin role must use internal name "admin"'
      }, { status: 400 });
    }

    // Check if role name already exists
    const { data: existingRole } = await supabase
      .from('roles')
      .select('id')
      .eq('name', normalizedName)
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
        name: normalizedName,
        display_name: body.display_name.trim(),
        description: body.description || null,
        role_class: requestedRoleClass,
        is_super_admin: false, // Cannot create super admin via API
        is_manager_admin: managerFlagFromRoleClass(requestedRoleClass),
        timesheet_type: body.timesheet_type || 'civils',
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
      enabled: ['timesheets', 'inspections', 'rams', 'absence'].includes(module),
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

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/roles',
      additionalData: {
        endpoint: '/api/admin/roles',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

