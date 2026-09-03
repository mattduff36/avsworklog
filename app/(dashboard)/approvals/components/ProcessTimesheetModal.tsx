'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ProcessTimesheetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  processing: boolean;
}

export function ProcessTimesheetModal({
  open,
  onOpenChange,
  onConfirm,
  processing,
}: ProcessTimesheetModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-white dark:bg-slate-900 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">Mark Timesheet as Manager Approved</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground space-y-2">
            <span className="block">
              Are you sure you want to mark this timesheet as Manager Approved?
            </span>
            <span className="block text-sm">
              Payroll Received can still happen afterwards. Reject stays available until both gates are complete.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={processing} className="border-border text-foreground">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={processing}
            className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900"
          >
            {processing ? 'Updating...' : 'Mark as Manager Approved'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
