'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  useBankHolidayWorkConfirm,
  type BankHolidayWorkConfirmLoaders,
} from '@/lib/hooks/useBankHolidayWorkConfirm';
import { isBankHolidayConfirmPhrase } from '@/lib/utils/timesheet-bank-holiday-work';
import {
  resolveTimesheetOffDayStates,
  type ApprovedAbsenceForTimesheet,
} from '@/lib/utils/timesheet-off-days';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TIMESHEET_ID = '22222222-2222-4222-8222-222222222222';
const ABSENCE_ID = '33333333-3333-4333-8333-333333333333';
const WEEK_ENDING = '2026-09-06';
const BANK_HOLIDAY_DATE = '2026-08-31';

type Scenario =
  | 'eligible'
  | 'ordinary'
  | 'legacy-off'
  | 'trial-loading'
  | 'trial-fail'
  | 'leave-loading'
  | 'confirmation-loading'
  | 'leave-fail'
  | 'confirmation-fail';

function isScenario(value: string): value is Scenario {
  return [
    'eligible',
    'ordinary',
    'legacy-off',
    'trial-loading',
    'trial-fail',
    'leave-loading',
    'confirmation-loading',
    'leave-fail',
    'confirmation-fail',
  ].includes(value);
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function absenceForScenario(scenario: Scenario): ApprovedAbsenceForTimesheet[] {
  if (
    scenario === 'trial-loading' ||
    scenario === 'leave-loading' ||
    scenario === 'leave-fail'
  ) {
    return [];
  }
  return [
    {
      id: ABSENCE_ID,
      date: BANK_HOLIDAY_DATE,
      end_date: BANK_HOLIDAY_DATE,
      status: 'approved',
      is_half_day: false,
      is_bank_holiday: scenario !== 'ordinary',
      allow_timesheet_work_on_leave: scenario === 'legacy-off',
      absence_reasons: { name: 'Annual Leave', color: '#facc15', is_paid: true },
    },
  ];
}

export function BankHolidayE2EHarness({ scenario: rawScenario }: { scenario: string }) {
  const scenario: Scenario = isScenario(rawScenario) ? rawScenario : 'eligible';
  const [result, setResult] = useState('idle');
  const trialEnabled = scenario !== 'legacy-off';
  const leaveState =
    scenario === 'leave-loading'
      ? 'loading'
      : scenario === 'leave-fail'
        ? 'failed'
        : 'ready';
  const offDayStates = useMemo(
    () =>
      resolveTimesheetOffDayStates(
        WEEK_ENDING,
        absenceForScenario(scenario),
        null,
        { bankHolidaySelfOverrideEnabled: trialEnabled }
      ),
    [scenario, trialEnabled]
  );
  const loaders = useMemo<BankHolidayWorkConfirmLoaders>(
    () => ({
      loadTrialEnabled: () =>
        scenario === 'trial-loading'
          ? never<boolean>()
          : scenario === 'trial-fail'
            ? Promise.reject(new Error('Injected trial read failure'))
            : Promise.resolve(trialEnabled),
      loadConfirmationEvidence: (_timesheetId) => {
        if (scenario === 'confirmation-loading') return never<[]>();
        if (scenario === 'confirmation-fail') {
          return Promise.reject(new Error('Injected confirmation read failure'));
        }
        return Promise.resolve([]);
      },
      confirm: async (input) => {
        if (!isBankHolidayConfirmPhrase(input.phrase)) {
          throw new Error('Type BANK HOLIDAY to confirm');
        }
        return {
          timesheetId: input.timesheetId || TIMESHEET_ID,
          confirmedDates: input.dates,
        };
      },
    }),
    [scenario, trialEnabled]
  );
  const bankHolidayConfirm = useBankHolidayWorkConfirm({
    weekEnding: WEEK_ENDING,
    userId: USER_ID,
    timesheetId: TIMESHEET_ID,
    timesheetType: 'civils',
    templateVersion: 1,
    offDayStates,
    offDaysState: leaveState,
    loaders,
  });
  const monday = offDayStates[0];
  const entries = [
    {
      day_of_week: 1,
      time_started: '08:00',
      time_finished: '16:00',
    },
  ];

  const attempt = async (kind: 'draft' | 'submit') => {
    setResult('checking');
    const confirmation = await bankHolidayConfirm.ensureConfirmed(entries);
    setResult(confirmation.ok ? `${kind}-complete` : `${kind}-blocked`);
  };

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <Card className="mx-auto max-w-xl border-slate-700 bg-slate-900">
        <CardHeader>
          <CardTitle>Bank holiday local E2E harness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p data-testid="scenario">{scenario}</p>
          <p data-testid="trial-state">{bankHolidayConfirm.trialState}</p>
          <p data-testid="leave-state">{leaveState}</p>
          <p data-testid="confirmation-state">{bankHolidayConfirm.confirmationState}</p>
          <p data-testid="result">{result}</p>

          <label className="block space-y-2">
            <span>Monday hours</span>
            <Input
              aria-label="Monday hours"
              value="08:00–16:00"
              readOnly
              disabled={Boolean(monday?.isLeaveLocked)}
            />
          </label>

          {bankHolidayConfirm.readinessError && (
            <div role="alert" className="rounded-md border border-red-500/40 bg-red-950/30 p-3">
              {bankHolidayConfirm.readinessError}
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!bankHolidayConfirm.actionReady}
              onClick={() => void attempt('draft')}
            >
              Save Draft
            </Button>
            <Button
              type="button"
              disabled={!bankHolidayConfirm.actionReady}
              onClick={() => void attempt('submit')}
            >
              Submit
            </Button>
          </div>
        </CardContent>
      </Card>
      {bankHolidayConfirm.modal}
    </main>
  );
}
