import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAssignRole } from '@/lib/utils/rbac';
import { requireAdminUsersModuleAccess } from '@/lib/server/admin-users-module-access';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ContractorTransitionConflictError,
  transitionProfileToContractor,
} from '@/lib/server/contractor-role-transition';
import { isContractorOnboardingRole } from '@/lib/utils/absence-onboarding';
import { isSystemAccountProfile } from '@/lib/utils/system-accounts';
import { logServerError } from '@/lib/utils/server-error-logger';

interface ContractorTransitionRequest {
  expected_role_id?: unknown;
  contractor_role_id?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireAdminUsersModuleAccess();
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const profileId = (await params).id;
    const body = await request.json() as ContractorTransitionRequest;
    const expectedRoleId =
      typeof body.expected_role_id === 'string' ? body.expected_role_id.trim() : '';
    const contractorRoleId =
      typeof body.contractor_role_id === 'string' ? body.contractor_role_id.trim() : '';

    if (!expectedRoleId || !contractorRoleId) {
      return NextResponse.json(
        { error: 'Expected role and Contractor role are required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminClient();
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role_id, deleted_at, is_system_account')
      .eq('id', profileId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: 'Failed to load user profile' }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (profile.deleted_at) {
      return NextResponse.json({ error: 'Deleted users cannot be converted to Contractor' }, { status: 409 });
    }
    if (isSystemAccountProfile(profile)) {
      return NextResponse.json({ error: 'System accounts cannot be converted to Contractor' }, { status: 409 });
    }
    if (!profile.role_id || profile.role_id !== expectedRoleId) {
      return NextResponse.json(
        {
          error: 'The user role changed. Refresh the page and try again.',
          code: 'STALE_ROLE',
        },
        { status: 409 }
      );
    }

    const [canManageExistingRole, canAssignContractorRole] = await Promise.all([
      canEffectiveRoleAssignRole(profile.role_id),
      canEffectiveRoleAssignRole(contractorRoleId),
    ]);
    if (!canManageExistingRole || !canAssignContractorRole) {
      return NextResponse.json(
        { error: 'Forbidden: you cannot perform this role transition' },
        { status: 403 }
      );
    }

    const { data: contractorRole, error: contractorRoleError } = await supabaseAdmin
      .from('roles')
      .select('id, name, display_name')
      .eq('id', contractorRoleId)
      .maybeSingle();

    if (contractorRoleError || !contractorRole || !isContractorOnboardingRole(contractorRole)) {
      return NextResponse.json({ error: 'Selected role is not Contractor' }, { status: 400 });
    }

    const result = await transitionProfileToContractor(supabaseAdmin, {
      profileId,
      expectedRoleId,
      contractorRoleId,
    });

    return NextResponse.json({
      success: true,
      message: 'User converted to Contractor',
      transition: result,
    });
  } catch (error) {
    if (error instanceof ContractorTransitionConflictError) {
      const status = error.code === 'PROFILE_NOT_FOUND' ? 404 : 409;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status }
      );
    }

    console.error('Error transitioning user to Contractor:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/users/[id]/contractor-transition',
      additionalData: {
        endpoint: '/api/admin/users/[id]/contractor-transition',
      },
    });
    return NextResponse.json({ error: 'Failed to convert user to Contractor' }, { status: 500 });
  }
}
