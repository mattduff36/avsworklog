'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BankHolidayWorkConfirmModal } from '@/components/timesheets/BankHolidayWorkConfirmModal';
import {
  confirmBankHolidayWorkClient,
  fetchBankHolidaySelfOverrideEnabled,
  fetchConfirmedBankHolidayWorkEvidence,
  type BankHolidayConfirmationEvidence,
} from '@/lib/client/timesheet-bank-holiday-work';
import { createClient } from '@/lib/supabase/client';
import {
  collectWorkingDatesFromEntries,
  getUnconfirmedBankHolidayDates,
  resolveBankHolidayActionReadiness,
  type BankHolidayAuthoritativeReadState,
  type BankHolidayWorkHoursInput,
} from '@/lib/utils/timesheet-bank-holiday-work';
import type { TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';

export interface BankHolidayConfirmResult {
  ok: boolean;
  timesheetId: string | null;
}

export interface BankHolidayWorkConfirmLoaders {
  loadTrialEnabled?: () => Promise<boolean>;
  loadConfirmationEvidence?: (
    timesheetId: string
  ) => Promise<BankHolidayConfirmationEvidence[]>;
  confirm?: typeof confirmBankHolidayWorkClient;
}

interface UseBankHolidayWorkConfirmOptions {
  weekEnding: string;
  userId: string | null;
  timesheetId: string | null;
  timesheetType: 'civils' | 'plant';
  templateVersion: 1 | 2;
  offDayStates: TimesheetOffDayState[];
  offDaysState: BankHolidayAuthoritativeReadState;
  onAdoptTimesheetId?: (timesheetId: string) => void;
  loaders?: BankHolidayWorkConfirmLoaders;
}

export function useBankHolidayWorkConfirm(options: UseBankHolidayWorkConfirmOptions) {
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [trialState, setTrialState] = useState<BankHolidayAuthoritativeReadState>('loading');
  const [confirmedDates, setConfirmedDates] = useState<string[]>([]);
  const [confirmationState, setConfirmationState] = useState<BankHolidayAuthoritativeReadState>(
    options.timesheetId ? 'loading' : 'ready'
  );
  const [readRetryToken, setReadRetryToken] = useState(0);
  const [open, setOpen] = useState(false);
  const [pendingDates, setPendingDates] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const supabase = useMemo(
    () => (options.loaders?.loadConfirmationEvidence ? null : createClient()),
    [options.loaders?.loadConfirmationEvidence]
  );
  const pendingResolveRef = useRef<((result: BankHolidayConfirmResult) => void) | null>(null);
  const trialEnabledRef = useRef(false);
  const trialStateRef = useRef<BankHolidayAuthoritativeReadState>('loading');
  const offDaysStateRef = useRef<BankHolidayAuthoritativeReadState>('idle');
  const confirmationStateRef = useRef<BankHolidayAuthoritativeReadState>(
    options.timesheetId ? 'loading' : 'ready'
  );
  const confirmedDatesRef = useRef<string[]>([]);
  const timesheetIdRef = useRef<string | null>(options.timesheetId);
  const userIdRef = useRef(options.userId);
  const weekEndingRef = useRef(options.weekEnding);
  const bankHolidayDatesRef = useRef<string[]>([]);
  const onAdoptTimesheetIdRef = useRef(options.onAdoptTimesheetId);

  timesheetIdRef.current = options.timesheetId;
  userIdRef.current = options.userId;
  weekEndingRef.current = options.weekEnding;
  offDaysStateRef.current = options.offDaysState;
  onAdoptTimesheetIdRef.current = options.onAdoptTimesheetId;
  bankHolidayDatesRef.current = options.offDayStates
    .filter((state) => state.isBankHoliday)
    .map((state) => state.date);

  useEffect(() => {
    let cancelled = false;
    trialStateRef.current = 'loading';
    setTrialState('loading');
    void (options.loaders?.loadTrialEnabled || fetchBankHolidaySelfOverrideEnabled)()
      .then((enabled) => {
        if (!cancelled) {
          trialEnabledRef.current = enabled;
          setTrialEnabled(enabled);
          trialStateRef.current = 'ready';
          setTrialState('ready');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          trialEnabledRef.current = false;
          setTrialEnabled(false);
          trialStateRef.current = 'failed';
          setTrialState('failed');
          console.warn('Failed to load bank holiday trial setting:', error);
          toast.error('Unable to verify the bank holiday setting. Saving is blocked until you retry.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [options.loaders?.loadTrialEnabled, readRetryToken]);

  useEffect(() => {
    if (!options.timesheetId) {
      confirmedDatesRef.current = [];
      setConfirmedDates([]);
      confirmationStateRef.current = 'ready';
      setConfirmationState('ready');
      return;
    }
    if (options.offDaysState !== 'ready') {
      confirmedDatesRef.current = [];
      setConfirmedDates([]);
      confirmationStateRef.current = 'loading';
      setConfirmationState('loading');
      return;
    }

    let cancelled = false;
    confirmedDatesRef.current = [];
    setConfirmedDates([]);
    confirmationStateRef.current = 'loading';
    setConfirmationState('loading');
    const loadConfirmationEvidence =
      options.loaders?.loadConfirmationEvidence ||
      ((timesheetId: string) => {
        if (!supabase) throw new Error('Supabase client is unavailable');
        return fetchConfirmedBankHolidayWorkEvidence(supabase, timesheetId);
      });
    void loadConfirmationEvidence(options.timesheetId)
      .then((evidence) => {
        if (!cancelled) {
          const absenceIdsByDate = new Map(
            options.offDayStates
              .filter((state) => state.isBankHoliday)
              .map((state) => [
                state.date,
                new Set(
                  state.leaveLabels
                    .map((label) => label.absenceId)
                    .filter((id): id is string => Boolean(id))
                ),
              ])
          );
          const dates = evidence
            .filter((row) => absenceIdsByDate.get(row.workDate)?.has(row.absenceId))
            .map((row) => row.workDate);
          confirmedDatesRef.current = dates;
          setConfirmedDates(dates);
          confirmationStateRef.current = 'ready';
          setConfirmationState('ready');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          confirmationStateRef.current = 'failed';
          setConfirmationState('failed');
          console.warn('Failed to load bank holiday confirmations:', error);
          toast.error('Unable to verify saved bank holiday confirmations. Saving is blocked until you retry.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    options.loaders?.loadConfirmationEvidence,
    options.offDayStates,
    options.offDaysState,
    options.timesheetId,
    readRetryToken,
    supabase,
  ]);

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
      const readiness = resolveBankHolidayActionReadiness({
        trialState: trialStateRef.current,
        trialEnabled: trialEnabledRef.current,
        leaveState: offDaysStateRef.current,
        confirmationState: confirmationStateRef.current,
      });
      if (readiness.status !== 'ready') {
        toast.error(
          readiness.status === 'failed'
            ? 'Bank holiday and leave checks could not be verified. Retry before saving.'
            : 'Bank holiday and leave checks are still loading. Try again in a moment.'
        );
        return { ok: false, timesheetId: currentTimesheetId };
      }
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
        const confirm = options.loaders?.confirm || confirmBankHolidayWorkClient;
        const result = await confirm({
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
        confirmationStateRef.current = 'ready';
        setConfirmationState('ready');
        onAdoptTimesheetIdRef.current?.(result.timesheetId);
        finishPending({ ok: true, timesheetId: result.timesheetId });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to confirm bank holiday hours');
      } finally {
        setConfirming(false);
      }
    },
    [finishPending, options.loaders?.confirm, options.templateVersion, options.timesheetType, pendingDates]
  );

  const retryReadiness = useCallback(() => {
    setReadRetryToken((current) => current + 1);
  }, []);

  const actionReadiness = resolveBankHolidayActionReadiness({
    trialState,
    trialEnabled,
    leaveState: options.offDaysState,
    confirmationState,
  });

  const readinessError =
    actionReadiness.status === 'failed'
      ? actionReadiness.failureSource === 'leave'
        ? 'Leave information could not be loaded. Saving and submitting are blocked.'
        : actionReadiness.failureSource === 'confirmation'
          ? 'Saved bank holiday confirmations could not be verified. Saving and submitting are blocked.'
          : 'The bank holiday setting could not be loaded. Saving and submitting are blocked.'
      : null;

  const handleCancel = useCallback(() => {
    if (confirming) return;
    finishPending({ ok: false, timesheetId: timesheetIdRef.current });
  }, [confirming, finishPending]);

  const modal = (
    <BankHolidayWorkConfirmModal
      key={open ? pendingDates.join(',') : 'closed'}
      open={open}
      dates={pendingDates}
      confirming={confirming}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    />
  );

  return {
    trialEnabled,
    trialReady: trialState === 'ready',
    trialState,
    confirmationState,
    actionReady: actionReadiness.status === 'ready',
    readinessError,
    retryReadiness,
    confirmedDates,
    ensureConfirmed,
    modal,
  };
}
