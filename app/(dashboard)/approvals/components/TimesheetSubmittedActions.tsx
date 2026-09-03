'use client';

import { Button } from '@/components/ui/button';
import { CheckCircle2, Edit2, Package, XCircle } from 'lucide-react';
import {
  canRejectTimesheetStatus,
  hasManagerApprovedGate,
  hasPayrollReceivedGate,
  isTimesheetComplete,
} from '@/lib/utils/timesheet-gates';

interface TimesheetSubmittedActionsProps {
  timesheetId: string;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  size?: 'default' | 'sm';
  className?: string;
  rejectClassName: string;
  approveClassName: string;
  showPayrollReceived?: boolean;
  status?: string;
  showPayrollEdit?: boolean;
  onProcess?: (id: string) => void;
  onEdit?: (id: string) => void;
  processClassName?: string;
  editClassName?: string;
}

export function TimesheetSubmittedActions({
  timesheetId,
  busy,
  onApprove,
  onReject,
  size = 'sm',
  className = 'flex items-center justify-end gap-1',
  rejectClassName,
  approveClassName,
  showPayrollReceived = true,
  status = 'submitted',
  showPayrollEdit = false,
  onProcess,
  onEdit,
  processClassName = 'border-avs-yellow/50 text-avs-yellow hover:bg-avs-yellow/20 hover:text-avs-yellow hover:border-avs-yellow active:bg-avs-yellow/30 active:text-avs-yellow active:scale-95 transition-all h-8 px-2',
  editClassName = 'border-blue-300 text-blue-500 hover:bg-blue-500 hover:text-white hover:border-blue-500 active:bg-blue-600 active:scale-95 transition-all h-8 px-2',
}: TimesheetSubmittedActionsProps) {
  const canReject = canRejectTimesheetStatus(status);
  const showPayroll = showPayrollReceived && !hasPayrollReceivedGate(status);
  const showManager = Boolean(onProcess) && !hasManagerApprovedGate(status) && status !== 'draft' && status !== 'rejected' && status !== 'adjusted';
  const showEdit = showPayrollEdit && status !== 'draft' && Boolean(onEdit);

  if (!canReject && !showPayroll && !showManager && !showEdit) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

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
          className={rejectClassName}
        >
          <XCircle className="mr-1 h-3.5 w-3.5" />
          Reject
        </Button>
      ) : null}
      {showPayroll ? (
        <Button
          variant="outline"
          size={size}
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onApprove(timesheetId);
          }}
          className={approveClassName}
        >
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
          Payroll Received
        </Button>
      ) : null}
      {showManager && onProcess ? (
        <Button
          variant="outline"
          size={size}
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onProcess(timesheetId);
          }}
          className={processClassName}
        >
          <Package className="mr-1 h-3.5 w-3.5" />
          Manager Approved
        </Button>
      ) : null}
      {showEdit && onEdit && (hasPayrollReceivedGate(status) || hasManagerApprovedGate(status) || isTimesheetComplete(status) || status === 'submitted' || status === 'rejected' || status === 'adjusted') ? (
        <Button
          variant="outline"
          size={size}
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit(timesheetId);
          }}
          className={editClassName}
        >
          <Edit2 className="mr-1 h-3.5 w-3.5" />
          Edit
        </Button>
      ) : null}
    </div>
  );
}
