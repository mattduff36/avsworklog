'use client';

import { Button } from '@/components/ui/button';
import { CheckCircle2, Edit2, UserCheck, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import {
  canShowTimesheetEditAction,
  canShowTimesheetManagerAction,
  canShowTimesheetPayrollAction,
} from '@/lib/utils/approvals-action-visibility';
import { canRejectTimesheetStatus } from '@/lib/utils/timesheet-gates';

const ACTION_BUTTON_SIZE = 'h-11 px-2 md:h-8';

interface TimesheetSubmittedActionsProps {
  timesheetId: string;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  size?: 'default' | 'sm';
  className?: string;
  rejectClassName?: string;
  approveClassName?: string;
  showPayrollReceived?: boolean;
  showManagerApproved?: boolean;
  showReject?: boolean;
  status?: string;
  showPayrollEdit?: boolean;
  onProcess?: (id: string) => void;
  onEdit?: (id: string) => void;
  processClassName?: string;
  editClassName?: string;
  compactLabels?: boolean;
  primaryGate?: 'payroll' | 'manager' | null;
}

export function TimesheetSubmittedActions({
  timesheetId,
  busy,
  onApprove,
  onReject,
  size = 'sm',
  className = 'flex min-w-[12.5rem] items-center justify-end gap-1',
  rejectClassName,
  approveClassName,
  showPayrollReceived = true,
  showManagerApproved = false,
  showReject = true,
  status = 'submitted',
  showPayrollEdit = false,
  onProcess,
  onEdit,
  processClassName,
  editClassName,
  compactLabels = false,
  primaryGate,
}: TimesheetSubmittedActionsProps) {
  const canReject = showReject && canRejectTimesheetStatus(status);
  const showPayroll = showPayrollReceived && canShowTimesheetPayrollAction(status);
  const showManager =
    showManagerApproved && Boolean(onProcess) && canShowTimesheetManagerAction(status);
  const showEdit = showPayrollEdit && canShowTimesheetEditAction(status) && Boolean(onEdit);
  const resolvedPrimaryGate =
    primaryGate ??
    (showPayroll && !showManager
      ? 'payroll'
      : !showPayroll && showManager
        ? 'manager'
        : showPayroll
          ? 'payroll'
          : null);
  const payrollIsPrimary = showPayroll && resolvedPrimaryGate !== 'manager';
  const managerIsPrimary = showManager && resolvedPrimaryGate !== 'payroll';

  if (!canReject && !showPayroll && !showManager && !showEdit) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  const payrollLabel = compactLabels ? 'Received' : 'Payroll Received';
  const managerLabel = compactLabels ? 'Approved' : 'Manager Approved';

  return (
    <div className={className}>
      {canReject ? (
        <Button
          variant="outline"
          size={size}
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onReject(timesheetId);
          }}
          className={cn(
            ACTION_BUTTON_SIZE,
            'border-red-400/70 text-red-400 hover:bg-red-500/10 hover:text-red-300',
            rejectClassName
          )}
        >
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </Button>
      ) : null}
      {showPayroll ? (
        <Button
          size={size}
          disabled={busy}
          variant={payrollIsPrimary ? 'default' : 'outline'}
          aria-label="Payroll Received"
          title="Payroll Received"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onApprove(timesheetId);
          }}
          className={cn(
            ACTION_BUTTON_SIZE,
            payrollIsPrimary
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10',
            approveClassName
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {payrollLabel}
        </Button>
      ) : null}
      {showManager && onProcess ? (
        <Button
          size={size}
          disabled={busy}
          variant={managerIsPrimary ? 'default' : 'outline'}
          aria-label="Manager Approved"
          title="Manager Approved"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onProcess(timesheetId);
          }}
          className={cn(
            ACTION_BUTTON_SIZE,
            managerIsPrimary
              ? 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover'
              : 'border-avs-yellow/50 text-avs-yellow hover:bg-avs-yellow/10',
            processClassName
          )}
        >
          <UserCheck className="h-3.5 w-3.5" />
          {managerLabel}
        </Button>
      ) : null}
      {showEdit && onEdit ? (
        <Button
          variant="ghost"
          size={size}
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit(timesheetId);
          }}
          className={cn(ACTION_BUTTON_SIZE, 'text-muted-foreground hover:text-foreground', editClassName)}
        >
          <Edit2 className="h-3.5 w-3.5" />
          Edit
        </Button>
      ) : null}
    </div>
  );
}
