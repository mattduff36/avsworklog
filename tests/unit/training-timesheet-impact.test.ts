import { describe, expect, it, vi } from 'vitest';
import {
  getTrainingImpactDayOfWeek,
  getTrainingImpactWeekEnding,
  resolveTrainingTimesheetImpacts,
  returnSubmittedTrainingTimesheetsForAmendment,
} from '@/lib/utils/training-timesheet-impact';

describe('training timesheet impact resolver', () => {
  it('maps training dates to timesheet week ending and day of week', () => {
    expect(getTrainingImpactWeekEnding('2026-04-15')).toBe('2026-04-19');
    expect(getTrainingImpactDayOfWeek('2026-04-15')).toBe(3);
    expect(getTrainingImpactDayOfWeek('2026-04-19')).toBe(7);
  });

  it('flags existing draft hours and job codes on the affected training day', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'timesheets') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(async () => ({
                  data: [
                    {
                      id: 'timesheet-1',
                      week_ending: '2026-04-19',
                      status: 'draft',
                      manager_comments: null,
                    },
                  ],
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === 'timesheet_entries') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [
                  {
                    timesheet_id: 'timesheet-1',
                    day_of_week: 3,
                    time_started: '08:00',
                    time_finished: '16:30',
                    job_number: '1234-AB',
                    working_in_yard: false,
                    did_not_work: false,
                    daily_total: 8,
                    remarks: null,
                    timesheet_entry_job_codes: [{ job_number: '1234-AB' }],
                  },
                ],
                error: null,
              })),
            })),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const impacts = await resolveTrainingTimesheetImpacts(supabase as never, {
      profileId: 'employee-1',
      startDate: '2026-04-15',
    });

    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({
      timesheetId: 'timesheet-1',
      status: 'draft',
      hasExistingHours: true,
      hasExistingJobCodes: true,
      hasAnyEnteredData: true,
    });
    expect(impacts[0].affectedDates).toEqual([
      {
        date: '2026-04-15',
        dayOfWeek: 3,
        hasEntry: true,
        hasWorkingHours: true,
        hasJobCodes: true,
        hasAnyEnteredData: true,
      },
    ]);
  });

  it('returns submitted timesheets for amendment with a training comment', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'timesheets') throw new Error(`Unexpected table ${table}`);
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updates.push(payload);
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ error: null })),
              })),
            };
          }),
        };
      }),
    };

    const returned = await returnSubmittedTrainingTimesheetsForAmendment(supabase as never, {
      actorUserId: 'manager-1',
      reason: 'Approved',
      impacts: [
        {
          timesheetId: 'timesheet-1',
          weekEnding: '2026-04-19',
          status: 'submitted',
          managerComments: 'Existing comment',
          hasExistingHours: true,
          hasExistingJobCodes: false,
          hasAnyEnteredData: true,
          affectedDates: [
            {
              date: '2026-04-15',
              dayOfWeek: 3,
              hasEntry: true,
              hasWorkingHours: true,
              hasJobCodes: false,
              hasAnyEnteredData: true,
            },
          ],
        },
      ],
    });

    expect(returned).toEqual(['timesheet-1']);
    expect(updates[0]).toMatchObject({
      status: 'rejected',
      reviewed_by: 'manager-1',
    });
    expect(String(updates[0].manager_comments)).toContain('Existing comment');
    expect(String(updates[0].manager_comments)).toContain('Training booking added for 2026-04-15');
  });
});
