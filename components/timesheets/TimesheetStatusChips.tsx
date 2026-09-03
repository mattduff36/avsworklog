'use client';

import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, Package, XCircle } from 'lucide-react';
import {
  formatTimesheetStatusLabel,
  hasManagerApprovedGate,
  hasPayrollReceivedGate,
} from '@/lib/utils/timesheet-gates';

interface TimesheetStatusChipsProps {
  status: string;
  className?: string;
}

export function TimesheetStatusChips({ status, className }: TimesheetStatusChipsProps) {
  const payrollOn = hasPayrollReceivedGate(status);
  const managerOn = hasManagerApprovedGate(status);
  const showGates =
    status === 'submitted' ||
    status === 'approved' ||
    status === 'manager_approved' ||
    status === 'processed';

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className || ''}`}>
      {status === 'submitted' ? (
        <Badge variant="warning">
          <Clock className="mr-1 h-3 w-3" />
          Pending
        </Badge>
      ) : status === 'rejected' ? (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Rejected
        </Badge>
      ) : status === 'processed' ? (
        <Badge variant="default" className="bg-blue-500/10 text-blue-300 border-blue-500/20">
          <Package className="mr-1 h-3 w-3" />
          Complete
        </Badge>
      ) : status === 'draft' || status === 'adjusted' ? (
        <Badge variant={status === 'draft' ? 'secondary' : 'default'}>
          {formatTimesheetStatusLabel(status)}
        </Badge>
      ) : null}
      {showGates ? (
        <>
          <Badge
            variant={payrollOn ? 'success' : 'outline'}
            className={payrollOn ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'opacity-70'}
          >
            {payrollOn ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
            Payroll Received
          </Badge>
          <Badge
            variant={managerOn ? 'default' : 'outline'}
            className={managerOn ? 'bg-avs-yellow/15 text-avs-yellow border-avs-yellow/40' : 'opacity-70'}
          >
            {managerOn ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
            Manager Approved
          </Badge>
        </>
      ) : null}
    </div>
  );
}
