'use client';

import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Clock, Package, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import {
  formatTimesheetStatusLabel,
  hasManagerApprovedGate,
  hasPayrollReceivedGate,
} from '@/lib/utils/timesheet-gates';

interface TimesheetStatusChipsProps {
  status: string;
  className?: string;
  density?: 'default' | 'compact';
}

function GateTick({
  on,
  label,
  compact,
  activeClassName,
}: {
  on: boolean;
  label: string;
  compact: boolean;
  activeClassName: string;
}) {
  const Icon = on ? CheckCircle2 : Circle;
  return (
    <span
      title={label}
      className={cn(
        'inline-flex items-center gap-0.5',
        compact ? 'text-[10px]' : 'text-[11px]',
        on ? activeClassName : 'text-muted-foreground/60'
      )}
    >
      <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      <span className={compact ? 'sr-only' : undefined}>
        {compact ? label : label === 'Payroll Received' ? 'Payroll' : 'Manager'}
      </span>
    </span>
  );
}

export function TimesheetStatusChips({
  status,
  className,
  density = 'default',
}: TimesheetStatusChipsProps) {
  const payrollOn = hasPayrollReceivedGate(status);
  const managerOn = hasManagerApprovedGate(status);
  const compact = density === 'compact';
  const showGates =
    status === 'submitted' ||
    status === 'approved' ||
    status === 'manager_approved';

  const primaryBadge =
    status === 'submitted' ? (
      <Badge variant="warning" className={compact ? 'px-2 py-0 text-[11px]' : undefined}>
        <Clock className="mr-1 h-3 w-3" />
        Pending
      </Badge>
    ) : status === 'rejected' ? (
      <Badge variant="destructive" className={compact ? 'px-2 py-0 text-[11px]' : undefined}>
        <XCircle className="mr-1 h-3 w-3" />
        Rejected
      </Badge>
    ) : status === 'processed' ? (
      <Badge
        variant="default"
        className={cn(
          'bg-blue-500/10 text-blue-300 border-blue-500/20',
          compact && 'px-2 py-0 text-[11px]'
        )}
      >
        <Package className="mr-1 h-3 w-3" />
        Complete
      </Badge>
    ) : status === 'approved' ? (
      <Badge
        variant="success"
        className={cn(
          'bg-green-500/10 text-green-500 border-green-500/20',
          compact && 'px-2 py-0 text-[11px]'
        )}
      >
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Payroll Received
      </Badge>
    ) : status === 'manager_approved' ? (
      <Badge
        variant="default"
        className={cn(
          'bg-avs-yellow/15 text-avs-yellow border-avs-yellow/40',
          compact && 'px-2 py-0 text-[11px]'
        )}
      >
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Manager Approved
      </Badge>
    ) : status === 'draft' || status === 'adjusted' ? (
      <Badge variant={status === 'draft' ? 'secondary' : 'default'} className={compact ? 'px-2 py-0 text-[11px]' : undefined}>
        {formatTimesheetStatusLabel(status)}
      </Badge>
    ) : null;

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      {primaryBadge}
      {showGates ? (
        <span className="inline-flex items-center gap-2" aria-label="Approval gates">
          <GateTick
            on={payrollOn}
            label="Payroll Received"
            compact={compact}
            activeClassName="text-emerald-400"
          />
          <GateTick
            on={managerOn}
            label="Manager Approved"
            compact={compact}
            activeClassName="text-avs-yellow"
          />
        </span>
      ) : null}
    </div>
  );
}
