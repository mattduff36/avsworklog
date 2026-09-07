'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BankHolidayWorkConfirmModal } from '@/components/timesheets/BankHolidayWorkConfirmModal';
import {
  confirmBankHolidayWorkClient,
  fetchBankHolidaySelfOverrideEnabled,
  fetchConfirmedBankHolidayWorkDates,
} from '@/lib/client/timesheet-bank-holiday-work';
import { createClient } from '@/lib/supabase/client';
import {
  collectWorkingDatesFromEntries,
  getUnconfirmedBankHolidayDates,
  type BankHolidayWorkHoursInput,
} from '@/lib/utils/timesheet-bank-holiday-work';
import type { TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';

export interface BankHolidayConfirmResult {
  ok: boolean;
  timesheetId: string | null;
}

interface UseBankHolidayWorkConfirmOptions {
  weekEnding: string;
  userId: string | null;
  timesheetId: string | null;
  timesheetType: 'civils' | 'plant';
  templateVersion: 1 | 2;
  offDayStates: TimesheetOffDayState[];
  onAdoptTimesheetId?: (timesheetId: string) => void;
}

export function useBankHolidayWorkConfirm(options: UseBankHolidayWorkConfirmOptions) {
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [trialReady, setTrialReady] = useState(false);
  const [confirmedDates, setConfirmedDates] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [pendingDates, setPendingDates] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const pendingResolveRef = useRef<((result: BankHolidayConfirmResult) => void) | null>(null);
  const trialEnabledRef = useRef(false);
  const confirmedDatesRef = useRef<string[]>([]);
  const timesheetIdRef = useRef<string | null>(options.timesheetId);
  const userIdRef = useRef(options.userId);
  const weekEndingRef = useRef(options.weekEnding);
  const bankHolidayDatesRef = useRef<string[]>([]);
  const onAdoptTimesheetIdRef = useRef(options.onAdoptTimesheetId);

  timesheetIdRef.current = options.timesheetId;
  userIdRef.current = options.userId;
  weekEndingRef.current = options.weekEnding;
  onAdoptTimesheetIdRef.current = options.onAdoptTimesheetId;
  bankHolidayDatesRef.current = options.offDayStates
    .filter((state) => state.isBankHoliday)
    .map((state) => state.date);

  useEffect(() => {
    let cancelled = false;
    void fetchBankHolidaySelfOverrideEnabled()
      .then((enabled) => {
        if (!cancelled) {
          trialEnabledRef.current = enabled;
          setTrialEnabled(enabled);
        }
      })
      .catch(() => {
        if (!cancelled) {
          trialEnabledRef.current = false;
          setTrialEnabled(false);
        }
      })
      .finally(() => {
        if (!cancelled) setTrialReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!options.timesheetId) {
      confirmedDatesRef.current = [];
      setConfirmedDates([]);
      return;
    }

    let cancelled = false;
    void fetchConfirmedBankHolidayWorkDates(supabase, options.timesheetId)
      .then((dates) => {
        if (!cancelled) {
          confirmedDatesRef.current = dates;
          setConfirmedDates(dates);
        }
      })
      .catch((error) => {
        console.warn('Failed to load bank holiday confirmations:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [options.timesheetId, supabase]);

  const finishPending = useCallback((result: BankHolidayConfirmResult) => {
    const resolve = pendingResolveRef.current;
    pendingResolveRef.current = null;
    setOpen(false);
    setPendingDates([]);
    resolve?.(result);
  }, []);

  const ensureConfirmed = useCallback(
    async (entries: BankHolidayWorkHoursInput[]): Promise<BankHolidayConfirmResult> => {
      const currentTimesheetId = timesheetIdRef.current;
      if (!trialEnabledRef.current) {
        return { ok: true, timesheetId: currentTimesheetId };
      }

      const unconfirmed = getUnconfirmedBankHolidayDates({
        bankHolidayDates: bankHolidayDatesRef.current,
        workingDates: collectWorkingDatesFromEntries(weekEndingRef.current, entries),
        confirmedDates: confirmedDatesRef.current,
      });
      if (unconfirmed.length === 0) {
        return { ok: true, timesheetId: currentTimesheetId };
      }
      if (!userIdRef.current) {
        return { ok: false, timesheetId: currentTimesheetId };
      }

      setPendingDates(unconfirmed);
      setOpen(true);
      return new Promise((resolve) => {
        pendingResolveRef.current = resolve;
      });
    },
    []
  );

  const handleConfirm = useCallback(
    async (phrase: string) => {
      const userId = userIdRef.current;
      if (!userId) return;

      setConfirming(true);
      try {
        const result = await confirmBankHolidayWorkClient({
          timesheetId: timesheetIdRef.current,
          userId,
          weekEnding: weekEndingRef.current,
          timesheetType: options.timesheetType,
          templateVersion: options.templateVersion,
          dates: pendingDates,
          phrase,
        });
        timesheetIdRef.current = result.timesheetId;
        confirmedDatesRef.current = result.confirmedDates;
        setConfirmedDates(result.confirmedDates);
        onAdoptTimesheetIdRef.current?.(result.timesheetId);
        finishPending({ ok: true, timesheetId: result.timesheetId });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to confirm bank holiday hours');
      } finally {
        setConfirming(false);
      }
    },
    [finishPending, options.templateVersion, options.timesheetType, pendingDates]
  );

  const handleCancel = useCallback(() => {
    if (confirming) return;
    finishPending({ ok: false, timesheetId: timesheetIdRef.current });
  }, [confirming, finishPending]);

  const modal = (
    <BankHolidayWorkConfirmModal
      open={open}
      dates={pendingDates}
      confirming={confirming}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    />
  );

  return {
    trialEnabled,
    trialReady,
    confirmedDates,
    ensureConfirmed,
    modal,
  };
}
