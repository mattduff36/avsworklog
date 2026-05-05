'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface DidNotWorkReasonDialogProps {
  open: boolean;
  dayName: string;
  initialReason?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

export function DidNotWorkReasonDialog({
  open,
  dayName,
  initialReason = '',
  onOpenChange,
  onConfirm,
}: DidNotWorkReasonDialogProps) {
  const [reason, setReason] = useState(initialReason);
  const trimmedReason = reason.trim();

  function handleConfirm() {
    if (!trimmedReason) return;
    onConfirm(trimmedReason);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why did you not work?</DialogTitle>
          <DialogDescription>
            {dayName} is a scheduled working day. Please explain why you are selecting Did Not Work so your
            manager or an admin can add the correct absence booking.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Example: I was off sick and need this recording as sickness."
          rows={4}
          autoFocus
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!trimmedReason}>
            Save Reason
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
