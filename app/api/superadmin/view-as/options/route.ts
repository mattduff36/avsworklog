import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select(`
      super_admin,
      role:roles(
        is_super_admin
      )
    `)
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Unable to verify user' }, { status: 403 });
  }

  const typedProfile = profile as {
    super_admin?: boolean | null;
    role?: { is_super_admin?: boolean | null } | null;
  };

  const isActualSuperAdmin =
    typedProfile.super_admin === true ||
    typedProfile.role?.is_super_admin === true ||
    user.email === 'admin@mpdee.co.uk';

  if (!isActualSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [{ data: roles, error: rolesError }, { data: teams, error: teamsError }] = await Promise.all([
    admin
      .from('roles')
      .select('id, name, display_name, is_super_admin, is_manager_admin')
      .order('is_super_admin', { ascending: false })
      .order('is_manager_admin', { ascending: false })
      .order('display_name', { ascending: true }),
    admin
      .from('org_teams')
      .select('id, name, code, active')
      .eq('active', true)
      .order('name', { ascending: true }),
  ]);

  if (rolesError || teamsError) {
    return NextResponse.json(
      { error: rolesError?.message || teamsError?.message || 'Failed to load view-as options' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    roles: roles || [],
    teams: teams || [],
  });
}
