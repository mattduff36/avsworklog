'use client';

import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle } from 'lucide-react';

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
}: TimesheetSubmittedActionsProps) {
  return (
    <div className={className}>
      <Button
        variant="outline"
        size={size}
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onReject(timesheetId);
        }}
        className={rejectClassName}
      >
        <XCircle className="h-3.5 w-3.5 mr-1" />
        Reject
      </Button>
      {showPayrollReceived ? (
        <Button
          variant="outline"
          size={size}
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onApprove(timesheetId);
          }}
          className={approveClassName}
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          Payroll Received
        </Button>
      ) : null}
    </div>
  );
}
