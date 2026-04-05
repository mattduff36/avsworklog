import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import {
  addAbsenceSecondaryExceptionRow,
  getAbsenceSecondaryExceptionMatrix,
} from '@/lib/server/absence-secondary-permissions';

function isActorAdmin(effectiveRole: {
  is_actual_super_admin: boolean;
  is_super_admin: boolean;
  role_class?: 'admin' | 'manager' | 'employee' | null;
  role_name: string | null;
}): boolean {
  return hasEffectiveRoleFullAccess(effectiveRole);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canAccessAbsence = await canEffectiveRoleAccessModule('absence');
  const effectiveRole = await getEffectiveRole();
  if (!canAccessAbsence || !isActorAdmin(effectiveRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const matrix = await getAbsenceSecondaryExceptionMatrix();
    return NextResponse.json({ success: true, ...matrix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load absence exceptions matrix' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canAccessAbsence = await canEffectiveRoleAccessModule('absence');
  const effectiveRole = await getEffectiveRole();
  if (!canAccessAbsence || !isActorAdmin(effectiveRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let profileId = '';
  try {
    const body = (await request.json()) as { profile_id?: string };
    profileId = (body.profile_id || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!profileId) {
    return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
  }

  try {
    await addAbsenceSecondaryExceptionRow(profileId, user.id);
    const matrix = await getAbsenceSecondaryExceptionMatrix();
    return NextResponse.json({ success: true, ...matrix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add absence exception user' },
      { status: 500 }
    );
  }
}

