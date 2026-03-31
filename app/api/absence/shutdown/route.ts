import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import { getEffectiveRole } from '@/lib/utils/view-as';
import {
  bookBulkAbsence,
  listBulkAbsenceBatches,
  undoBulkAbsenceBatch,
} from '@/lib/services/absence-bank-holiday-sync';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

interface BulkAbsencePayload {
  reasonId?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  applyToAll?: boolean;
  roleIds?: string[];
  roleNames?: string[];
  employeeIds?: string[];
  confirm?: boolean;
}

async function requireAbsenceAccess() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, profile: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const profile = await getProfileWithRole(user.id);
  const canAccessAbsence = await canEffectiveRoleAccessModule('absence');
  if (!profile || !canAccessAbsence) {
    return {
      supabase,
      profile: null,
      response: NextResponse.json(
        { error: 'Forbidden: Absence access required' },
        { status: 403 }
      ),
    };
  }

  const effectiveRole = await getEffectiveRole();
  const roleOverride =
    effectiveRole.user_id === user.id && (effectiveRole.role_name || effectiveRole.is_manager_admin || effectiveRole.is_super_admin)
      ? {
          name: effectiveRole.role_name,
          display_name: effectiveRole.display_name,
          role_class: effectiveRole.role_class,
          is_manager_admin: effectiveRole.is_manager_admin,
          is_super_admin: effectiveRole.is_super_admin,
        }
      : undefined;
  const secondary = await getActorAbsenceSecondaryPermissions(user.id, {
    role: roleOverride,
    ...(effectiveRole.user_id === user.id
      ? {
          team_id: effectiveRole.team_id,
          team_name: effectiveRole.team_name,
        }
      : {}),
  });
  const isAdmin =
    effectiveRole.is_actual_super_admin || effectiveRole.is_super_admin || effectiveRole.role_name === 'admin';
  const canRunGlobalActions = isAdmin || secondary.effective.see_manage_overview_all;
  if (!canRunGlobalActions) {
    return {
      supabase,
      profile: null,
      response: NextResponse.json(
        { error: 'Forbidden: Records & Admin ALL scope required' },
        { status: 403 }
      ),
    };
  }

  return { supabase, profile, response: null };
}

export async function GET() {
  try {
    const auth = await requireAbsenceAccess();
    if (auth.response) {
      return auth.response;
    }

    const batches = await listBulkAbsenceBatches(auth.supabase);
    return NextResponse.json({ success: true, batches });
  } catch (error) {
    console.error('Error loading bulk absence batches:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load bulk absence batches' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAbsenceAccess();
    if (auth.response) {
      return auth.response;
    }

    const payload = (await request.json()) as BulkAbsencePayload;
    if (!payload.reasonId) {
      return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
    }
    if (!payload.startDate) {
      return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    }

    const result = await bookBulkAbsence({
      supabase: auth.supabase,
      actorProfileId: auth.profile.id,
      reasonId: payload.reasonId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      notes: payload.notes,
      applyToAll: payload.applyToAll !== false,
      roleIds: payload.roleIds || [],
      roleNames: payload.roleNames || [],
      employeeIds: payload.employeeIds || [],
      confirm: payload.confirm === true,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error booking bulk absence:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to book bulk absence' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAbsenceAccess();
    if (auth.response) {
      return auth.response;
    }

    const payload = (await request.json()) as { batchId?: string };
    if (!payload.batchId) {
      return NextResponse.json({ error: 'Batch id is required' }, { status: 400 });
    }

    const result = await undoBulkAbsenceBatch(auth.supabase, payload.batchId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error undoing bulk absence batch:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to undo bulk absence batch' },
      { status: 500 }
    );
  }
}
