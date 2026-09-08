import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export interface BankHolidayConfirmationEvidence {
  workDate: string;
  absenceId: string;
}

export async function fetchBankHolidaySelfOverrideEnabled(): Promise<boolean> {
  const response = await fetch('/api/timesheets/bank-holiday-self-override', { cache: 'no-store' });
  const payload = (await response.json().catch(() => null)) as {
    bankHolidaySelfOverrideEnabled?: boolean;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to load bank holiday trial setting');
  }
  if (typeof payload?.bankHolidaySelfOverrideEnabled !== 'boolean') {
    throw new Error('Bank holiday trial setting response was invalid');
  }
  return payload.bankHolidaySelfOverrideEnabled;
}

export async function fetchConfirmedBankHolidayWorkEvidence(
  supabase: Pick<SupabaseClient<Database>, 'from'>,
  timesheetId: string
): Promise<BankHolidayConfirmationEvidence[]> {
  const { data, error } = await supabase
    .from('timesheet_bank_holiday_work_confirmations')
    .select('work_date, absence_id')
    .eq('timesheet_id', timesheetId)
    .order('work_date', { ascending: true });

  if (error) {
    throw new Error(error.message || 'Failed to load bank holiday confirmations');
  }

  return (data || []).map((row) => ({
    workDate: String(row.work_date).slice(0, 10),
    absenceId: row.absence_id,
  }));
}

export async function confirmBankHolidayWorkClient(input: {
  timesheetId?: string | null;
  userId: string;
  weekEnding: string;
  timesheetType?: 'civils' | 'plant';
  templateVersion?: 1 | 2;
  dates: string[];
  phrase: string;
}): Promise<{ timesheetId: string; confirmedDates: string[] }> {
  const response = await fetch('/api/timesheets/bank-holiday-work-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as {
    timesheetId?: string;
    confirmedDates?: string[];
    error?: string;
  } | null;
  if (!response.ok || !payload?.timesheetId) {
    throw new Error(payload?.error || 'Failed to confirm bank holiday hours');
  }
  return {
    timesheetId: payload.timesheetId,
    confirmedDates: payload.confirmedDates || [],
  };
}
