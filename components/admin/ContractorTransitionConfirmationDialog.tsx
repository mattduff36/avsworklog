'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ContractorTransitionConfirmationDialogProps {
  open: boolean;
  userName: string;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ContractorTransitionConfirmationDialog({
  open,
  userName,
  saving,
  error,
  onCancel,
  onConfirm,
}: ContractorTransitionConfirmationDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onCancel();
      }}
    >
      <DialogContent
        data-testid="contractor-transition-confirmation"
        className="border-border text-white sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Convert this user to Contractor?</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            This is a consequential account change for {userName || 'this user'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-slate-200">
          <p>Confirming will:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>set annual leave allowance and current-year carryover to 0;</li>
            <li>remove future auto-generated bank holidays and bulk-booked annual leave;</li>
            <li>clear personal module permission overrides.</li>
          </ul>
          <p className="text-muted-foreground">
            Historical, manual, or timesheet-linked leave will not be deleted. If any such
            leave makes the conversion ambiguous, no transition changes will be made.
          </p>
          {error && (
            <div
              role="alert"
              className="rounded border border-red-500/50 bg-red-500/10 p-3 text-red-300"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="confirm-contractor-transition"
            disabled={saving}
            onClick={onConfirm}
            className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? 'Converting...' : 'Convert to Contractor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
