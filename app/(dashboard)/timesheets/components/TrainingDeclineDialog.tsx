'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TrainingDeclineDialogProps {
  open: boolean;
  dayLabel: string;
  trainingLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function TrainingDeclineDialog({
  open,
  dayLabel,
  trainingLabel,
  pending,
  onCancel,
  onConfirm,
}: TrainingDeclineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && !nextOpen && onCancel()}>
      <DialogContent className="max-w-md border-border bg-white dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-foreground">Remove Training Booking?</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {dayLabel} is currently marked as {trainingLabel}. If you confirm that the employee did not attend,
            the linked training booking will be deleted and their team manager plus Sarah Hubbard will be
            notified.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Removing...' : 'Confirm Did Not Attend'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
