'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

export interface TimesheetPayrollEditTotals {
  basicHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  subsistenceDays: number;
}

interface TimesheetPayrollEditModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  employeeName: string;
  weekEnding: string;
  payImpact: boolean;
  isComplete: boolean;
  beforeTotals: TimesheetPayrollEditTotals | null;
  afterTotals: TimesheetPayrollEditTotals | null;
}

function formatHours(value: number): string {
  return `${value.toFixed(2)}h`;
}

export function TimesheetPayrollEditModal({
  open,
  onClose,
  onConfirm,
  employeeName,
  weekEnding,
  payImpact,
  isComplete,
  beforeTotals,
  afterTotals,
}: TimesheetPayrollEditModalProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleClose = () => {
    if (loading) return;
    setReason('');
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Save payroll edit</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{employeeName}</span>
              <br />
              Week ending {weekEnding}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {payImpact ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                This change affects pay. Payroll Received stays in place and Manager Approved will be cleared.
                {beforeTotals && afterTotals ? (
                  <ul className="mt-2 space-y-1 font-mono text-xs">
                    <li>Basic: {formatHours(beforeTotals.basicHours)} → {formatHours(afterTotals.basicHours)}</li>
                    <li>OT: {formatHours(beforeTotals.overtimeHours)} → {formatHours(afterTotals.overtimeHours)}</li>
                    <li>DT: {formatHours(beforeTotals.doubleTimeHours)} → {formatHours(afterTotals.doubleTimeHours)}</li>
                    <li>Subsistence: {beforeTotals.subsistenceDays} → {afterTotals.subsistenceDays}</li>
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Job numbers or costing only. Pay figures, gates, and the payroll snapshot stay as they are.
              </p>
            )}

            {isComplete && payImpact ? (
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                This week may already be in a payroll run. Saving will not silently keep Manager Approved.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="payroll-edit-reason">
                Reason <span className="text-red-600">*</span>
              </Label>
              <Textarea
                id="payroll-edit-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={loading}
                rows={4}
                required
                placeholder="Explain the correction..."
              />
            </div>
          </div>

          <DialogFooter className="gap-3">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || reason.trim().length === 0}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save payroll edit'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
