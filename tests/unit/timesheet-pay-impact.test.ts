import { describe, expect, it } from 'vitest';
import {
  canonicalPayDayFromEntry,
  canonicalPayWeekFromEntries,
  classifyTimesheetPayImpact,
  padCanonicalPayWeek,
} from '@/lib/utils/timesheet-pay-impact';

const monday = {
  day_of_week: 1,
  time_started: '08:00',
  time_finished: '16:00',
  daily_total: 8,
  operator_travel_hours: 0,
  did_not_work: false,
  night_shift: false,
  bank_holiday: false,
  subsistence_payment_required: false,
  job_number: 'D7328',
  remarks: 'Site',
};

describe('timesheet pay impact hash', () => {
  it('TS-EDIT-001 treats job-number-only changes as costing', () => {
    const current = [canonicalPayDayFromEntry(monday)];
    const proposed = [canonicalPayDayFromEntry({ ...monday, job_number: 'D9999', remarks: 'Corrected' })];
    expect(classifyTimesheetPayImpact({
      currentDays: current,
      proposedDays: proposed,
      proposedEntries: [{ ...monday, job_number: 'D9999', remarks: 'Corrected' }],
    }).payImpact).toBe(false);
  });

  it('TS-EDIT-002 treats hour changes as pay impact', () => {
    const current = [canonicalPayDayFromEntry(monday)];
    const proposedEntry = { ...monday, time_finished: '18:00', daily_total: 10 };
    const proposed = [canonicalPayDayFromEntry(proposedEntry)];
    expect(classifyTimesheetPayImpact({
      currentDays: current,
      proposedDays: proposed,
      proposedEntries: [proposedEntry],
    }).payImpact).toBe(true);
  });

  it('fails closed on unknown entry columns', () => {
    const current = [canonicalPayDayFromEntry(monday)];
    const proposedEntries = [{ ...monday, mystery_column: true }];
    expect(classifyTimesheetPayImpact({
      currentDays: current,
      proposedDays: current,
      proposedEntries,
    }).payImpact).toBe(true);
  });

  it('ignores identity fields that the client always sends', () => {
    const current = [canonicalPayDayFromEntry(monday)];
    const proposedEntries = [{
      ...monday,
      id: 'entry-1',
      timesheet_id: 'sheet-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      timesheet_entry_job_codes: [{ job_number: 'D7328' }],
    }];
    expect(classifyTimesheetPayImpact({
      currentDays: current,
      proposedDays: current,
      proposedEntries,
    }).payImpact).toBe(false);
  });

  it('treats HH:MM and HH:MM:SS as the same pay time', () => {
    const current = [canonicalPayDayFromEntry({ ...monday, time_started: '08:00:00', time_finished: '16:00:00' })];
    const proposed = [canonicalPayDayFromEntry({ ...monday, time_started: '8:00', time_finished: '16:00' })];
    expect(classifyTimesheetPayImpact({
      currentDays: current,
      proposedDays: proposed,
      proposedEntries: [{ ...monday, time_started: '8:00', time_finished: '16:00' }],
    }).payImpact).toBe(false);
  });

  it('TS-ARCH-HASH-001 treats a seven-day UI payload vs sparse persisted rows as costing when hours match', () => {
    const current = padCanonicalPayWeek([canonicalPayDayFromEntry(monday)]);
    const proposedEntries = [
      { ...monday, job_number: 'D9999', remarks: 'Corrected' },
      { day_of_week: 2 },
      { day_of_week: 3 },
      { day_of_week: 4 },
      { day_of_week: 5 },
      { day_of_week: 6 },
      { day_of_week: 7 },
    ];
    expect(classifyTimesheetPayImpact({
      currentDays: current,
      proposedDays: canonicalPayWeekFromEntries(proposedEntries),
      proposedEntries,
    }).payImpact).toBe(false);
  });
});
