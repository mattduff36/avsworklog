import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { runHierarchyValidation } from '@/lib/server/hierarchy-validation';

function getSupabaseAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const canAccessUserAdmin = await canEffectiveRoleAccessModule('admin-users');
  if (!canAccessUserAdmin) {
    return NextResponse.json({ error: 'Forbidden: admin-users access required' }, { status: 403 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const url = new URL(request.url);
    const teamId = url.searchParams.get('team_id') || undefined;
    const result = await runHierarchyValidation(supabaseAdmin, { teamId });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Failed to run hierarchy validation' }, { status: 500 });
  }
}
