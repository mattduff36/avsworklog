'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isBankHolidayConfirmPhrase } from '@/lib/utils/timesheet-bank-holiday-work';

interface BankHolidayWorkConfirmModalProps {
  open: boolean;
  dates: string[];
  confirming?: boolean;
  onCancel: () => void;
  onConfirm: (phrase: string) => void;
}

function formatDateList(dates: string[]): string {
  return dates
    .map((date) =>
      new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    )
    .join(', ');
}

export function BankHolidayWorkConfirmModal({
  open,
  dates,
  confirming = false,
  onCancel,
  onConfirm,
}: BankHolidayWorkConfirmModalProps) {
  const [phrase, setPhrase] = useState('');

  useEffect(() => {
    if (open) setPhrase('');
  }, [open]);

  const canConfirm = isBankHolidayConfirmPhrase(phrase) && !confirming;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !confirming) onCancel();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto bg-slate-900 border-yellow-500/50 text-white">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">Confirm bank holiday hours</DialogTitle>
          <DialogDescription className="text-muted-foreground text-base pt-2 space-y-3">
            <span className="block">
              {dates.length === 1 ? (
                <>
                  <span className="font-semibold text-yellow-400">{formatDateList(dates)}</span> is a
                  booked bank holiday.
                </>
              ) : (
                <>
                  These dates are booked bank holidays:{' '}
                  <span className="font-semibold text-yellow-400">{formatDateList(dates)}</span>.
                </>
              )}
            </span>
            <span className="block">
              Type BANK HOLIDAY to confirm you worked and to save these hours. If you do not confirm,
              the timesheet cannot be saved.
            </span>
            <span className="block">
              When you submit this timesheet, an in-app notification will be sent to your team
              manager(s) and Payroll (Accounts team).
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="bank-holiday-confirm-phrase" className="text-white">
            Type BANK HOLIDAY
          </Label>
          <Input
            id="bank-holiday-confirm-phrase"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            autoComplete="off"
            className="bg-slate-950 text-white"
          />
        </div>
        <DialogFooter className="mt-4 flex gap-3 sm:gap-3">
          <Button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            variant="outline"
            className="flex-1 border-slate-600 text-white hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(phrase)}
            className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold"
          >
            {confirming ? 'Confirming...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
