import { NextRequest, NextResponse } from 'next/server';
import { calculatePayrollWeek } from '@/lib/payroll/calculate';
import type { PayrollDayInput, PayrollRuleConfiguration } from '@/lib/payroll/types';
import {
  activatePayrollRollout,
  archivePayrollRuleVersion,
  deletePayrollRuleDraft,
  loadPayrollAdminMatrix,
  savePayrollRuleDraft,
} from '@/lib/server/payroll-admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import type {
  PayrollProfileAssignmentInput,
  PayrollTeamAssignmentInput,
} from '@/types/payroll-admin';

async function authorizePayrollAdmin() {
  const [effectiveRole, canAccessSettings] = await Promise.all([
    getEffectiveRole(),
    canEffectiveRoleAccessModule('admin-settings'),
  ]);
  return {
    effectiveRole,
    allowed: Boolean(
      effectiveRole.user_id
      && canAccessSettings
      && hasEffectiveRoleFullAccess(effectiveRole)
    ),
  };
}

export async function GET() {
  const auth = await authorizePayrollAdmin();
  if (!auth.effectiveRole.user_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!auth.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    return NextResponse.json({ success: true, ...(await loadPayrollAdminMatrix()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load payroll rules' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorizePayrollAdmin();
  if (!auth.effectiveRole.user_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!auth.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { configuration?: PayrollRuleConfiguration };
    if (!body.configuration) {
      return NextResponse.json({ error: 'configuration is required' }, { status: 400 });
    }
    await savePayrollRuleDraft(body.configuration, auth.effectiveRole.user_id);
    return NextResponse.json({ success: true, ...(await loadPayrollAdminMatrix()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save payroll draft' },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizePayrollAdmin();
  if (!auth.effectiveRole.user_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!auth.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      action?: 'test' | 'activate' | 'archive_version' | 'delete_draft';
      configuration?: PayrollRuleConfiguration;
      weekEnding?: string;
      days?: PayrollDayInput[];
      effectiveWeekEnding?: string;
      teamAssignments?: PayrollTeamAssignmentInput[];
      profileAssignments?: PayrollProfileAssignmentInput[];
      versionId?: string;
    };
    if (body.action === 'test') {
      if (!body.configuration || !body.weekEnding || !body.days) {
        return NextResponse.json({ error: 'Test configuration, week and days are required' }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        breakdown: calculatePayrollWeek({
          rule: body.configuration,
          weekEnding: body.weekEnding,
          days: body.days,
        }),
      });
    }
    if (body.action === 'activate') {
      if (!body.effectiveWeekEnding) {
        return NextResponse.json({ error: 'effectiveWeekEnding is required' }, { status: 400 });
      }
      await activatePayrollRollout({
        effectiveWeekEnding: body.effectiveWeekEnding,
        actorId: auth.effectiveRole.user_id,
        teamAssignments: body.teamAssignments || [],
        profileAssignments: body.profileAssignments || [],
      });
      return NextResponse.json({ success: true, ...(await loadPayrollAdminMatrix()) });
    }
    if (body.action === 'delete_draft') {
      if (!body.versionId) {
        return NextResponse.json({ error: 'versionId is required' }, { status: 400 });
      }
      await deletePayrollRuleDraft(body.versionId);
      return NextResponse.json({ success: true, ...(await loadPayrollAdminMatrix()) });
    }
    if (body.action === 'archive_version') {
      if (!body.versionId) {
        return NextResponse.json({ error: 'versionId is required' }, { status: 400 });
      }
      await archivePayrollRuleVersion(body.versionId, auth.effectiveRole.user_id);
      return NextResponse.json({ success: true, ...(await loadPayrollAdminMatrix()) });
    }
    return NextResponse.json({ error: 'Unknown payroll action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payroll action failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
