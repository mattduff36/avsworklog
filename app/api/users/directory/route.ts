import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isEffectiveRoleManagerOrHigher } from '@/lib/utils/rbac';
import { getUsersWithPermission } from '@/lib/utils/permissions';
import { ALL_MODULES, type ModuleName } from '@/types/roles';

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true';
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

  const canViewDirectory = await isEffectiveRoleManagerOrHigher();
  if (!canViewDirectory) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const includeRole = isTruthy(request.nextUrl.searchParams.get('includeRole'));
  const includeAllowance = isTruthy(request.nextUrl.searchParams.get('includeAllowance'));
  const moduleName = request.nextUrl.searchParams.get('module');
  const ids = request.nextUrl.searchParams
    .get('ids')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) || [];

  if (moduleName && !ALL_MODULES.includes(moduleName as ModuleName)) {
    return NextResponse.json({ error: 'Valid module query parameter is required' }, { status: 400 });
  }

  const fields = ['id', 'full_name', 'employee_id', 'team:org_teams!profiles_team_id_fkey(id, name)'];

  if (includeAllowance) {
    fields.push('annual_holiday_allowance_days');
  }

  if (includeRole) {
    fields.push('role:roles(id, name, display_name, is_manager_admin)');
  }

  const admin = createAdminClient();
  let query = admin.from('profiles').select(fields.join(', '));

  if (ids.length > 0) {
    query = query.in('id', ids);
  }

  const { data, error } = await query.order('full_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message || 'Failed to load users' }, { status: 500 });
  }

  const allowedUserIds = moduleName
    ? new Set(await getUsersWithPermission(moduleName as ModuleName))
    : null;

  const userRows = ((data || []) as unknown) as Array<Record<string, unknown>>;
  const users = userRows.map((userRow) => ({
    ...userRow,
    has_module_access: allowedUserIds ? allowedUserIds.has(String(userRow.id || '')) : undefined,
  }));

  return NextResponse.json({
    success: true,
    users,
  });
}
