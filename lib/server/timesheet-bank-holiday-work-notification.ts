import { createAdminClient } from '@/lib/supabase/admin';
import { filterInAppRecipientIds } from '@/lib/server/notification-preference-delivery';
import { isSystemAccountProfile } from '@/lib/utils/system-accounts';
import {
  BANK_HOLIDAY_WORK_CREATED_VIA,
  collectWorkingDatesFromEntries,
} from '@/lib/utils/timesheet-bank-holiday-work';
import type { Database } from '@/types/database';

const ACCOUNTS_TEAM_ID = 'accounts';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface BankHolidayWorkRecipientCandidate {
  id: string;
  is_placeholder?: boolean | null;
  is_system_account?: boolean | null;
  deleted_at?: string | null;
}

export function resolveBankHolidayWorkRecipientIds(input: {
  employeeId: string;
  manager1ProfileId?: string | null;
  manager2ProfileId?: string | null;
  accountsProfiles: BankHolidayWorkRecipientCandidate[];
}): string[] {
  const recipients = new Set<string>();
  for (const managerId of [input.manager1ProfileId, input.manager2ProfileId]) {
    if (managerId && managerId !== input.employeeId) {
      recipients.add(managerId);
    }
  }

  for (const profile of input.accountsProfiles) {
    if (
      !profile.id ||
      profile.id === input.employeeId ||
      profile.is_placeholder ||
      isSystemAccountProfile(profile) ||
      profile.deleted_at
    ) {
      continue;
    }
    recipients.add(profile.id);
  }

  return Array.from(recipients);
}

function formatWeekEnding(weekEnding: string): string {
  return new Date(`${weekEnding}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatWorkDates(dates: string[]): string {
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

export async function notifyBankHolidayWorkOnSubmit(input: {
  timesheetId: string;
  actorId: string;
  admin?: AdminClient;
}): Promise<{ notified: boolean; reason?: string }> {
  const admin = input.admin || createAdminClient();

  const { data: existingNotification, error: existingError } = await admin
    .from('messages')
    .select('id')
    .eq('created_via', BANK_HOLIDAY_WORK_CREATED_VIA)
    .is('deleted_at', null)
    .ilike('body', `%Timesheet ID: ${input.timesheetId}%`)
    .limit(1);

  if (existingError) throw existingError;
  if ((existingNotification || []).length > 0) {
    return { notified: false, reason: 'duplicate' };
  }

  const [
    { data: timesheet, error: timesheetError },
    { data: confirmationRows, error: confirmationError },
    { data: entryRows, error: entryError },
  ] = await Promise.all([
    admin
      .from('timesheets')
      .select('id, user_id, week_ending')
      .eq('id', input.timesheetId)
      .maybeSingle(),
    admin
      .from('timesheet_bank_holiday_work_confirmations')
      .select('work_date')
      .eq('timesheet_id', input.timesheetId),
    admin
      .from('timesheet_entries')
      .select(
        'day_of_week, time_started, time_finished, operator_working_hours, machine_working_hours, machine_start_time, machine_finish_time'
      )
      .eq('timesheet_id', input.timesheetId),
  ]);

  if (timesheetError) throw timesheetError;
  if (confirmationError) throw confirmationError;
  if (entryError) throw entryError;
  if (!timesheet) return { notified: false, reason: 'missing-timesheet' };

  const confirmedDates = (confirmationRows || []).map((row) => String(row.work_date).slice(0, 10));
  if (confirmedDates.length === 0) {
    return { notified: false, reason: 'no-confirmations' };
  }

  const workingDates = new Set(collectWorkingDatesFromEntries(timesheet.week_ending, entryRows || []));
  const workingConfirmedDates = confirmedDates.filter((date) => workingDates.has(date));
  if (workingConfirmedDates.length === 0) {
    return { notified: false, reason: 'no-hours' };
  }

  const [{ data: employee, error: employeeError }, { data: accountsProfiles, error: accountsError }] =
    await Promise.all([
      admin
        .from('profiles')
        .select(`
          id,
          full_name,
          team:org_teams!profiles_team_id_fkey(manager_1_profile_id, manager_2_profile_id)
        `)
        .eq('id', timesheet.user_id)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('id, is_placeholder, is_system_account, deleted_at, team_id')
        .eq('team_id', ACCOUNTS_TEAM_ID)
        .is('deleted_at', null)
        .eq('is_placeholder', false)
        .eq('is_system_account', false),
    ]);

  if (employeeError) throw employeeError;
  if (accountsError) throw accountsError;
  if (!employee) return { notified: false, reason: 'missing-employee' };

  const team = Array.isArray(employee.team) ? employee.team[0] : employee.team;
  const accountsTeamProfiles = (accountsProfiles || []) as BankHolidayWorkRecipientCandidate[];

  const recipients = await filterInAppRecipientIds(
    admin,
    'timesheets',
    resolveBankHolidayWorkRecipientIds({
      employeeId: timesheet.user_id,
      manager1ProfileId: team?.manager_1_profile_id || null,
      manager2ProfileId: team?.manager_2_profile_id || null,
      accountsProfiles: accountsTeamProfiles,
    })
  );

  if (recipients.length === 0) {
    return { notified: false, reason: 'no-recipients' };
  }

  const employeeName = employee.full_name || 'Unknown employee';
  const subject = `Bank holiday hours entered: ${employeeName}`;
  const body = [
    `${employeeName} entered hours on booked bank holiday(s): ${formatWorkDates(workingConfirmedDates)}.`,
    '',
    `Week ending: ${formatWeekEnding(timesheet.week_ending)}`,
    `Timesheet: /timesheets/${timesheet.id}`,
    `Timesheet ID: ${timesheet.id}`,
  ].join('\n');

  const { data: message, error: messageError } = await admin
    .from('messages')
    .insert({
      type: 'NOTIFICATION',
      subject,
      body,
      priority: 'HIGH',
      sender_id: input.actorId,
      created_via: BANK_HOLIDAY_WORK_CREATED_VIA,
      module_key: 'timesheets',
    } satisfies Database['public']['Tables']['messages']['Insert'])
    .select('id')
    .single();

  if (messageError) throw messageError;

  const { error: recipientsError } = await admin.from('message_recipients').insert(
    recipients.map((profileId) => ({
      message_id: message.id,
      user_id: profileId,
      status: 'PENDING' as const,
    }))
  );

  if (recipientsError) throw recipientsError;
  return { notified: true };
}
