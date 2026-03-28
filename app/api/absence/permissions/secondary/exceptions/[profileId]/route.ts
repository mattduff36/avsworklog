import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import {
  deleteAbsenceSecondaryExceptionRow,
  getAbsenceSecondaryExceptionMatrix,
  upsertAbsenceSecondaryException,
} from '@/lib/server/absence-secondary-permissions';
import {
  ABSENCE_SECONDARY_PERMISSION_KEYS,
  type AbsenceSecondaryPermissionKey,
} from '@/types/absence-permissions';

function isActorAdmin(effectiveRole: {
  is_actual_super_admin: boolean;
  is_super_admin: boolean;
  role_name: string | null;
}): boolean {
  return effectiveRole.is_actual_super_admin || effectiveRole.is_super_admin || effectiveRole.role_name === 'admin';
}

function parseUpdates(
  payload: unknown
): Partial<Record<AbsenceSecondaryPermissionKey, boolean | null>> {
  const validKeys = new Set<string>(ABSENCE_SECONDARY_PERMISSION_KEYS as readonly string[]);
  const updates: Partial<Record<AbsenceSecondaryPermissionKey, boolean | null>> = {};
  const source = payload as Record<string, unknown>;

  if (source && typeof source === 'object' && source.updates && typeof source.updates === 'object') {
    const updateMap = source.updates as Record<string, unknown>;
    Object.entries(updateMap).forEach(([key, value]) => {
      if (!validKeys.has(key)) return;
      if (typeof value === 'boolean' || value === null) {
        updates[key as AbsenceSecondaryPermissionKey] = value;
      }
    });
    return updates;
  }

  if (source && typeof source === 'object') {
    Object.entries(source).forEach(([key, value]) => {
      if (!validKeys.has(key)) return;
      if (typeof value === 'boolean' || value === null) {
        updates[key as AbsenceSecondaryPermissionKey] = value;
      }
    });
  }

  return updates;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
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

  const { profileId } = await params;
  if (!profileId) {
    return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
  }

  let updates: Partial<Record<AbsenceSecondaryPermissionKey, boolean | null>> = {};
  try {
    const body = await request.json();
    updates = parseUpdates(body);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid permission updates provided' }, { status: 400 });
  }

  try {
    await upsertAbsenceSecondaryException({
      profile_id: profileId,
      updates,
      actor_id: user.id,
    });
    const matrix = await getAbsenceSecondaryExceptionMatrix();
    return NextResponse.json({ success: true, ...matrix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update absence exception row' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
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

  const { profileId } = await params;
  if (!profileId) {
    return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
  }

  try {
    await deleteAbsenceSecondaryExceptionRow(profileId);
    const matrix = await getAbsenceSecondaryExceptionMatrix();
    return NextResponse.json({ success: true, ...matrix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete absence exception row' },
      { status: 500 }
    );
  }
}

