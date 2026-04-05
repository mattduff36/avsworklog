import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasWorkshopInspectionFullVisibilityOverride } from '@/lib/utils/inspection-visibility';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { getUsersWithModuleAccess } from '@/lib/server/team-permissions';
import { ALL_MODULES, type ModuleName } from '@/types/roles';

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function isDeletedUserName(fullName: string | null | undefined): boolean {
  return Boolean(fullName && fullName.includes('(Deleted User)'));
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const moduleName = request.nextUrl.searchParams.get('module');
  if (moduleName && !ALL_MODULES.includes(moduleName as ModuleName)) {
    return NextResponse.json({ error: 'Valid module query parameter is required' }, { status: 400 });
  }

  const effectiveRole = await getEffectiveRole();
  const isInspectionDirectoryRequest =
    moduleName === 'inspections' ||
    moduleName === 'plant-inspections' ||
    moduleName === 'hgv-inspections';
  const hasWorkshopInspectionAccess =
    isInspectionDirectoryRequest &&
    hasWorkshopInspectionFullVisibilityOverride(effectiveRole.team_name);
  const canViewDirectory = Boolean(
    effectiveRole.user_id &&
      (
        hasEffectiveRoleFullAccess(effectiveRole) ||
        effectiveRole.is_manager_admin ||
        effectiveRole.role_name === 'supervisor' ||
        hasWorkshopInspectionAccess
      )
  );
  if (!canViewDirectory) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const isAdminOrSuper = hasEffectiveRoleFullAccess(effectiveRole);
  const shouldScopeToTeam = hasWorkshopInspectionAccess
    ? true
    : (effectiveRole.is_manager_admin || effectiveRole.role_name === 'supervisor') &&
      !isAdminOrSuper &&
      !isInspectionDirectoryRequest;

  const includeRole = isTruthy(request.nextUrl.searchParams.get('includeRole'));
  const includeAllowance = isTruthy(request.nextUrl.searchParams.get('includeAllowance'));
  const includeDeleted = isTruthy(request.nextUrl.searchParams.get('includeDeleted'));
  const ids = request.nextUrl.searchParams
    .get('ids')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) || [];
  const limit = Math.min(Math.max(Number.parseInt(request.nextUrl.searchParams.get('limit') || '200', 10) || 200, 1), 500);
  const offset = Math.max(Number.parseInt(request.nextUrl.searchParams.get('offset') || '0', 10) || 0, 0);

  const fields = ['id', 'full_name', 'employee_id', 'team:org_teams!profiles_team_id_fkey(id, name)'];

  if (includeAllowance) {
    fields.push('annual_holiday_allowance_days');
  }

  if (includeRole) {
    fields.push('role:roles(id, name, display_name, is_manager_admin)');
  }

  const admin = createAdminClient();
  let query = admin.from('profiles').select(fields.join(', '));

  if (shouldScopeToTeam) {
    if (effectiveRole.team_id) {
      query = query.eq('team_id', effectiveRole.team_id);
    } else {
      query = query.eq('id', user.id);
    }
  }

  if (ids.length > 0) {
    query = query.in('id', ids);
  }

  if (!includeDeleted) {
    query = query.not('full_name', 'ilike', '%(Deleted User)%');
  }

  const { data, error } = await query
    .order('full_name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message || 'Failed to load users' }, { status: 500 });
  }

  const allowedUserIds = moduleName
    ? await getUsersWithModuleAccess(moduleName as ModuleName, ids.length > 0 ? ids : undefined, admin)
    : null;

  const userRows = ((data || []) as unknown) as Array<Record<string, unknown>>;
  const filtered = includeDeleted
    ? userRows
    : userRows.filter((row) => !isDeletedUserName(String(row.full_name || '')));
  const users = filtered.map((userRow) => ({
    ...userRow,
    has_module_access: allowedUserIds ? allowedUserIds.has(String(userRow.id || '')) : undefined,
  }));

  return NextResponse.json({
    success: true,
    users,
    pagination: {
      offset,
      limit,
      has_more: (data || []).length === limit,
    },
  });
}
