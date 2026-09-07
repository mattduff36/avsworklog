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

export interface TimesheetPayrollRecalculateTotals {
  basicHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  travelHours: number;
  iprUnits: number;
}

interface TimesheetPayrollRecalculateModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  employeeName: string;
  weekEnding: string;
  currentRuleName: string;
  previewRuleName: string;
  isComplete: boolean;
  beforeTotals: TimesheetPayrollRecalculateTotals | null;
  afterTotals: TimesheetPayrollRecalculateTotals | null;
}

function formatHours(value: number): string {
  return `${value.toFixed(2)}h`;
}

export function TimesheetPayrollRecalculateModal({
  open,
  onClose,
  onConfirm,
  employeeName,
  weekEnding,
  currentRuleName,
  previewRuleName,
  isComplete,
  beforeTotals,
  afterTotals,
}: TimesheetPayrollRecalculateModalProps) {
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
            <DialogTitle>Recalculate from current payroll rule</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{employeeName}</span>
              <br />
              Week ending {weekEnding}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              Frozen snapshot: {currentRuleName}. Current assignment: {previewRuleName}.
              A new revision is written if the rule or inputs changed. Payroll Received stays in
              place and Manager Approved is cleared when pay buckets change.
              {beforeTotals && afterTotals ? (
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  <li>Basic: {formatHours(beforeTotals.basicHours)} → {formatHours(afterTotals.basicHours)}</li>
                  <li>OT: {formatHours(beforeTotals.overtimeHours)} → {formatHours(afterTotals.overtimeHours)}</li>
                  <li>DT: {formatHours(beforeTotals.doubleTimeHours)} → {formatHours(afterTotals.doubleTimeHours)}</li>
                  <li>Travel: {formatHours(beforeTotals.travelHours)} → {formatHours(afterTotals.travelHours)}</li>
                  <li>IPR: {beforeTotals.iprUnits.toFixed(1)} → {afterTotals.iprUnits.toFixed(1)}</li>
                </ul>
              ) : null}
            </div>

            {isComplete ? (
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                This week may already be in a payroll run. Recalculating will not silently keep Manager Approved.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="payroll-recalculate-reason">
                Reason <span className="text-red-600">*</span>
              </Label>
              <Textarea
                id="payroll-recalculate-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={loading}
                rows={4}
                required
                placeholder="Explain why this snapshot should be rebuilt from the current rule..."
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
                  Recalculating...
                </>
              ) : (
                'Recalculate snapshot'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
