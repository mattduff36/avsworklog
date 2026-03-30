/**
 * Timesheet Absence Guardrails — DB Integration Test
 *
 * Verifies the DB trigger `enforce_timesheet_entry_absence_rules` coerces
 * timesheet entries to did_not_work on approved full-day leave dates.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasCredentials = Boolean(supabaseUrl && supabaseServiceKey);
const isAllowedTarget = Boolean(
  supabaseUrl &&
    (supabaseUrl.includes('localhost') ||
      supabaseUrl.includes('127.0.0.1') ||
      supabaseUrl.includes('staging'))
);
const canRunSuite = hasCredentials && isAllowedTarget;
const describeSuite = canRunSuite ? describe : describe.skip;

if (!canRunSuite) {
  console.warn(
    '⏭️  Skipping timesheet absence guardrails integration test (requires localhost/127.0.0.1/staging + service role).'
  );
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getEntryDateFromWeekEnding(weekEnding: string, dayOfWeek: number): string {
  const safeDay = Math.min(7, Math.max(1, dayOfWeek));
  const weekEndingDate = new Date(`${weekEnding}T00:00:00`);
  const entryDate = new Date(weekEndingDate);
  entryDate.setDate(weekEndingDate.getDate() - (7 - safeDay));
  return formatIsoDate(entryDate);
}

function getUniqueSunday(): string {
  const seed = Date.now() % 28;
  const date = new Date();
  date.setDate(date.getDate() + 21 + seed);
  const day = date.getDay(); // 0=Sun
  const daysUntilSunday = (7 - day) % 7;
  date.setDate(date.getDate() + daysUntilSunday);
  return formatIsoDate(date);
}

describeSuite('Timesheet absence guardrails — database integration', () => {
  let supabase: SupabaseClient;
  const cleanup = {
    entryIds: [] as string[],
    timesheetIds: [] as string[],
    absenceIds: [] as string[],
  };

  beforeAll(() => {
    supabase = createClient(supabaseUrl!, supabaseServiceKey!, {
      auth: { persistSession: false },
    });
  });

  afterEach(async () => {
    if (cleanup.entryIds.length > 0) {
      const ids = [...cleanup.entryIds];
      cleanup.entryIds = [];
      await supabase.from('timesheet_entries').delete().in('id', ids);
    }

    if (cleanup.timesheetIds.length > 0) {
      const ids = [...cleanup.timesheetIds];
      cleanup.timesheetIds = [];
      await supabase.from('timesheets').delete().in('id', ids);
    }

    if (cleanup.absenceIds.length > 0) {
      const ids = [...cleanup.absenceIds];
      cleanup.absenceIds = [];
      await supabase.from('absences').delete().in('id', ids);
    }
  });

  it('coerces working-hour entry to did_not_work for approved annual leave date', async () => {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single();

    expect(profileError).toBeNull();
    expect(profile?.id).toBeTruthy();

    const { data: annualReason, error: reasonError } = await supabase
      .from('absence_reasons')
      .select('id, name')
      .ilike('name', 'annual leave')
      .limit(1)
      .single();

    expect(reasonError).toBeNull();
    expect(annualReason?.id).toBeTruthy();

    const weekEnding = getUniqueSunday();
    const dayOfWeek = 1; // Monday
    const entryDate = getEntryDateFromWeekEnding(weekEnding, dayOfWeek);

    const { data: insertedAbsence, error: absenceError } = await supabase
      .from('absences')
      .insert({
        profile_id: profile!.id,
        date: entryDate,
        end_date: null,
        reason_id: annualReason!.id,
        duration_days: 1,
        is_half_day: false,
        status: 'approved',
        notes: 'integration-test leave fixture',
        created_by: profile!.id,
        approved_by: profile!.id,
        approved_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    expect(absenceError).toBeNull();
    expect(insertedAbsence?.id).toBeTruthy();
    cleanup.absenceIds.push(insertedAbsence!.id);

    const { data: insertedTimesheet, error: timesheetError } = await supabase
      .from('timesheets')
      .insert({
        user_id: profile!.id,
        week_ending: weekEnding,
        status: 'draft',
        timesheet_type: 'civils',
      })
      .select('id')
      .single();

    expect(timesheetError).toBeNull();
    expect(insertedTimesheet?.id).toBeTruthy();
    cleanup.timesheetIds.push(insertedTimesheet!.id);

    const { data: insertedEntry, error: entryInsertError } = await supabase
      .from('timesheet_entries')
      .insert({
        timesheet_id: insertedTimesheet!.id,
        day_of_week: dayOfWeek,
        time_started: '08:00',
        time_finished: '17:00',
        job_number: '1234-AB',
        working_in_yard: true,
        did_not_work: false,
        daily_total: 8.5,
        remarks: 'should be overwritten',
      })
      .select('id, did_not_work, time_started, time_finished, job_number, working_in_yard, daily_total, remarks')
      .single();

    expect(entryInsertError).toBeNull();
    expect(insertedEntry?.id).toBeTruthy();
    cleanup.entryIds.push(insertedEntry!.id);

    expect(insertedEntry?.did_not_work).toBe(true);
    expect(insertedEntry?.time_started).toBeNull();
    expect(insertedEntry?.time_finished).toBeNull();
    expect(insertedEntry?.job_number).toBeNull();
    expect(insertedEntry?.working_in_yard).toBe(false);
    expect(Number(insertedEntry?.daily_total || 0)).toBe(9);
    expect((insertedEntry?.remarks || '').toLowerCase()).toBe((annualReason!.name || '').toLowerCase());
  });

  it('keeps working-hour entry when annual leave timesheet-work override is enabled', async () => {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single();

    expect(profileError).toBeNull();
    expect(profile?.id).toBeTruthy();

    const { data: annualReason, error: reasonError } = await supabase
      .from('absence_reasons')
      .select('id, name')
      .ilike('name', 'annual leave')
      .limit(1)
      .single();

    expect(reasonError).toBeNull();
    expect(annualReason?.id).toBeTruthy();

    const weekEnding = getUniqueSunday();
    const dayOfWeek = 1; // Monday
    const entryDate = getEntryDateFromWeekEnding(weekEnding, dayOfWeek);

    const { data: insertedAbsence, error: absenceError } = await supabase
      .from('absences')
      .insert({
        profile_id: profile!.id,
        date: entryDate,
        end_date: null,
        reason_id: annualReason!.id,
        duration_days: 1,
        is_half_day: false,
        status: 'approved',
        notes: 'integration-test leave override fixture',
        allow_timesheet_work_on_leave: true,
        created_by: profile!.id,
        approved_by: profile!.id,
        approved_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    expect(absenceError).toBeNull();
    expect(insertedAbsence?.id).toBeTruthy();
    cleanup.absenceIds.push(insertedAbsence!.id);

    const { data: insertedTimesheet, error: timesheetError } = await supabase
      .from('timesheets')
      .insert({
        user_id: profile!.id,
        week_ending: weekEnding,
        status: 'draft',
        timesheet_type: 'civils',
      })
      .select('id')
      .single();

    expect(timesheetError).toBeNull();
    expect(insertedTimesheet?.id).toBeTruthy();
    cleanup.timesheetIds.push(insertedTimesheet!.id);

    const { data: insertedEntry, error: entryInsertError } = await supabase
      .from('timesheet_entries')
      .insert({
        timesheet_id: insertedTimesheet!.id,
        day_of_week: dayOfWeek,
        time_started: '08:00',
        time_finished: '12:00',
        job_number: '1234-AB',
        working_in_yard: false,
        did_not_work: false,
        daily_total: 4,
        remarks: 'worked during leave',
      })
      .select('id, did_not_work, time_started, time_finished, job_number, working_in_yard, daily_total, remarks')
      .single();

    expect(entryInsertError).toBeNull();
    expect(insertedEntry?.id).toBeTruthy();
    cleanup.entryIds.push(insertedEntry!.id);

    expect(insertedEntry?.did_not_work).toBe(false);
    expect(insertedEntry?.time_started).toBe('08:00:00');
    expect(insertedEntry?.time_finished).toBe('12:00:00');
    expect(insertedEntry?.job_number).toBe('1234-AB');
    expect(insertedEntry?.working_in_yard).toBe(false);
    expect(Number(insertedEntry?.daily_total || 0)).toBe(4);
    expect(insertedEntry?.remarks).toBe('worked during leave');
  });

  it('does not full-day-coerce entries when absence is half-day only', async () => {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single();

    expect(profileError).toBeNull();
    expect(profile?.id).toBeTruthy();

    const { data: annualReason, error: reasonError } = await supabase
      .from('absence_reasons')
      .select('id')
      .ilike('name', 'annual leave')
      .limit(1)
      .single();

    expect(reasonError).toBeNull();
    expect(annualReason?.id).toBeTruthy();

    const weekEnding = getUniqueSunday();
    const dayOfWeek = 1; // Monday
    const entryDate = getEntryDateFromWeekEnding(weekEnding, dayOfWeek);

    const { data: insertedAbsence, error: absenceError } = await supabase
      .from('absences')
      .insert({
        profile_id: profile!.id,
        date: entryDate,
        end_date: null,
        reason_id: annualReason!.id,
        duration_days: 0.5,
        is_half_day: true,
        half_day_session: 'AM',
        status: 'approved',
        notes: 'integration-test half-day leave fixture',
        created_by: profile!.id,
        approved_by: profile!.id,
        approved_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    expect(absenceError).toBeNull();
    expect(insertedAbsence?.id).toBeTruthy();
    cleanup.absenceIds.push(insertedAbsence!.id);

    const { data: insertedTimesheet, error: timesheetError } = await supabase
      .from('timesheets')
      .insert({
        user_id: profile!.id,
        week_ending: weekEnding,
        status: 'draft',
        timesheet_type: 'civils',
      })
      .select('id')
      .single();

    expect(timesheetError).toBeNull();
    expect(insertedTimesheet?.id).toBeTruthy();
    cleanup.timesheetIds.push(insertedTimesheet!.id);

    const { data: insertedEntry, error: entryInsertError } = await supabase
      .from('timesheet_entries')
      .insert({
        timesheet_id: insertedTimesheet!.id,
        day_of_week: dayOfWeek,
        time_started: '12:00',
        time_finished: '16:00',
        job_number: '1234-AB',
        working_in_yard: false,
        did_not_work: false,
        daily_total: 4,
        remarks: 'half day',
      })
      .select('id, did_not_work, time_started, time_finished, job_number, daily_total')
      .single();

    expect(entryInsertError).toBeNull();
    expect(insertedEntry?.id).toBeTruthy();
    cleanup.entryIds.push(insertedEntry!.id);

    expect(insertedEntry?.did_not_work).toBe(false);
    expect(insertedEntry?.time_started).toBe('12:00:00');
    expect(insertedEntry?.time_finished).toBe('16:00:00');
    expect(insertedEntry?.job_number).toBe('1234-AB');
    expect(Number(insertedEntry?.daily_total || 0)).toBe(4);
  });
});
