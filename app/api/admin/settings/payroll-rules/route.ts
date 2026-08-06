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
import { requireAdminSettingsAccess } from '@/lib/server/admin-settings-access';
import type {
  PayrollProfileAssignmentInput,
  PayrollTeamAssignmentInput,
} from '@/types/payroll-admin';

export async function GET() {
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

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
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

  try {
    const body = (await request.json()) as { configuration?: PayrollRuleConfiguration };
    if (!body.configuration) {
      return NextResponse.json({ error: 'configuration is required' }, { status: 400 });
    }
    await savePayrollRuleDraft(body.configuration, access.userId);
    return NextResponse.json({ success: true, ...(await loadPayrollAdminMatrix()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save payroll draft' },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

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
        actorId: access.userId,
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
      await archivePayrollRuleVersion(body.versionId, access.userId);
      return NextResponse.json({ success: true, ...(await loadPayrollAdminMatrix()) });
    }
    return NextResponse.json({ error: 'Unknown payroll action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payroll action failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
