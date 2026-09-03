'use client';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ApprovalsRejectDialogProps {
  open: boolean;
  title: string;
  description: string;
  reason: string;
  submitting?: boolean;
  onReasonChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ApprovalsRejectDialog({
  open,
  title,
  description,
  reason,
  submitting = false,
  onReasonChange,
  onOpenChange,
  onConfirm,
}: ApprovalsRejectDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-white dark:bg-slate-900 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="approvals-rejection-reason">Rejection reason</Label>
          <Input
            id="approvals-rejection-reason"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Provide a reason for rejection"
            className="bg-background border-border text-foreground"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting} className="border-border text-foreground">
            Cancel
          </AlertDialogCancel>
          <Button
            variant="outline"
            disabled={submitting || !reason.trim()}
            onClick={onConfirm}
            className="border-red-400/70 text-red-400 hover:bg-red-500/10"
          >
            Confirm rejection
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
