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
import type { DidNotWorkTrainingSession } from '@/lib/utils/timesheet-did-not-work-bookings';

export type DidNotWorkReasonDecision =
  | { kind: 'sickness' }
  | { kind: 'training'; trainingSession: DidNotWorkTrainingSession }
  | { kind: 'other'; reason: string };

type DialogStep = 'choice' | 'training' | 'other';

interface DidNotWorkReasonDialogProps {
  open: boolean;
  dayName: string;
  initialReason?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (decision: DidNotWorkReasonDecision) => void;
}

export function DidNotWorkReasonDialog({
  open,
  dayName,
  initialReason = '',
  onOpenChange,
  onConfirm,
}: DidNotWorkReasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DidNotWorkReasonDialogContent
          key={`${dayName}:${initialReason}`}
          dayName={dayName}
          initialReason={initialReason}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
}

interface DidNotWorkReasonDialogContentProps {
  dayName: string;
  initialReason: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (decision: DidNotWorkReasonDecision) => void;
}

function DidNotWorkReasonDialogContent({
  dayName,
  initialReason,
  onOpenChange,
  onConfirm,
}: DidNotWorkReasonDialogContentProps) {
  const [step, setStep] = useState<DialogStep>('choice');
  const [reason, setReason] = useState(initialReason);
  const trimmedReason = reason.trim();

  function handleConfirm() {
    if (!trimmedReason) return;
    onConfirm({ kind: 'other', reason: trimmedReason });
  }

  function handleTrainingConfirm(trainingSession: DidNotWorkTrainingSession) {
    onConfirm({ kind: 'training', trainingSession });
  }

  function renderChoiceStep() {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Why did you not work?</DialogTitle>
          <DialogDescription>
            {dayName} is a scheduled working day. Select the reason so the right booking can be created.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Button type="button" variant="outline" onClick={() => onConfirm({ kind: 'sickness' })}>
            Sick
          </Button>
          <Button type="button" variant="outline" onClick={() => setStep('training')}>
            Training
          </Button>
          <Button type="button" variant="outline" onClick={() => setStep('other')}>
            Other
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

  function renderTrainingStep() {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Training Duration</DialogTitle>
          <DialogDescription>
            Select whether {dayName} was booked as full-day or half-day training.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Button type="button" variant="outline" onClick={() => handleTrainingConfirm('FULL')}>
            Full Day
          </Button>
          <Button type="button" variant="outline" onClick={() => handleTrainingConfirm('AM')}>
            Half Day AM
          </Button>
          <Button type="button" variant="outline" onClick={() => handleTrainingConfirm('PM')}>
            Half Day PM
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setStep('choice')}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

  function renderOtherStep() {
    return (
      <>
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
          placeholder="Example: I had a personal appointment and need this reviewing."
          rows={4}
          autoFocus
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setStep('choice')}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!trimmedReason}
            className="min-w-28 bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 disabled:bg-emerald-700 disabled:text-white disabled:opacity-70"
          >
            Save Reason
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <DialogContent>
      {step === 'choice' ? renderChoiceStep() : null}
      {step === 'training' ? renderTrainingStep() : null}
      {step === 'other' ? renderOtherStep() : null}
    </DialogContent>
  );
}
