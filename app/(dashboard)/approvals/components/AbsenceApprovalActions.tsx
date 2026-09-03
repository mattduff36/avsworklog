'use client';

import { Button } from '@/components/ui/button';
import { CheckCircle2, Package, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { AbsenceApprovalActionVisibility } from '@/lib/utils/approvals-action-visibility';

const ACTION_BUTTON_SIZE = 'h-11 px-2 md:h-8';

interface AbsenceApprovalActionsProps {
  visibility: AbsenceApprovalActionVisibility;
  onApprove: () => void;
  onReject: () => void;
  onProcess: () => void;
  className?: string;
}

export function AbsenceApprovalActions({
  visibility,
  onApprove,
  onReject,
  onProcess,
  className = 'flex min-w-[10rem] items-center justify-end gap-1',
}: AbsenceApprovalActionsProps) {
  if (!visibility.showApprove && !visibility.showReject && !visibility.showProcess) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <div className={className}>
      {visibility.showReject ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onReject}
          className={cn(ACTION_BUTTON_SIZE, 'border-red-400/70 text-red-400 hover:bg-red-500/10 hover:text-red-300')}
        >
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </Button>
      ) : null}
      {visibility.showApprove ? (
        <Button
          size="sm"
          onClick={onApprove}
          className={cn(ACTION_BUTTON_SIZE, 'bg-emerald-600 text-white hover:bg-emerald-700')}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve
        </Button>
      ) : null}
      {visibility.showProcess ? (
        <Button
          size="sm"
          onClick={onProcess}
          className={cn(ACTION_BUTTON_SIZE, 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover')}
        >
          <Package className="h-3.5 w-3.5" />
          Process
        </Button>
      ) : null}
    </div>
  );
}
