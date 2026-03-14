import { describe, expect, it } from 'vitest';
import { bookBulkAbsence } from '@/lib/services/absence-bank-holiday-sync';

interface MockProfile {
  id: string;
  full_name: string;
  employee_id: string | null;
  annual_holiday_allowance_days: number | null;
  roles: { id?: string; name?: string; display_name?: string } | null;
}

interface MockAbsenceRow {
  profile_id: string;
  date: string;
  end_date: string | null;
  status: string;
  absence_reasons?: { name?: string | null } | null;
}

interface BuildMockSupabaseOptions {
  profiles: MockProfile[];
  annualAbsences: Array<{ profile_id: string; duration_days: number | null; status: string }>;
  existingRows: MockAbsenceRow[];
}

function buildMockSupabase(options: BuildMockSupabaseOptions) {
  const insertedAbsenceRows: Array<Record<string, unknown>> = [];
  const insertedBatchRows: Array<Record<string, unknown>> = [];

  const supabase = {
    from(table: string) {
      if (table === 'absence_reasons') {
        return {
          select() {
            return {
              eq(_field: string, value: string) {
                return {
                  async single() {
                    return {
                      data: { id: value, name: 'Annual Leave', is_active: true },
                      error: null,
                    };
                  },
                };
              },
              ilike() {
                return {
                  async single() {
                    return {
                      data: { id: 'reason-annual', name: 'Annual Leave', is_active: true },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'profiles') {
        return {
          select() {
            return {
              async order() {
                return { data: options.profiles, error: null };
              },
            };
          },
        };
      }

      if (table === 'absences') {
        return {
          select(columns: string) {
            const chain = {
              eq() {
                return chain;
              },
              in() {
                return chain;
              },
              gte() {
                return chain;
              },
              async lte() {
                if (columns.includes('absence_reasons(name)')) {
                  return { data: options.existingRows, error: null };
                }
                return { data: options.annualAbsences, error: null };
              },
            };
            return chain;
          },
          async insert(rows: Array<Record<string, unknown>>) {
            insertedAbsenceRows.push(...rows);
            return { error: null };
          },
        };
      }

      if (table === 'absence_bulk_batches') {
        return {
          insert(payload: Record<string, unknown>) {
            insertedBatchRows.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: 'batch-1' }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, insertedAbsenceRows, insertedBatchRows };
}

describe('bookBulkAbsence partial conflict handling', () => {
  const profiles: MockProfile[] = [
    {
      id: 'emp-a',
      full_name: 'A Worker',
      employee_id: 'A1',
      annual_holiday_allowance_days: 28,
      roles: null,
    },
    {
      id: 'emp-b',
      full_name: 'B Worker',
      employee_id: 'B1',
      annual_holiday_allowance_days: 28,
      roles: null,
    },
    {
      id: 'emp-c',
      full_name: 'C Worker',
      employee_id: 'C1',
      annual_holiday_allowance_days: 28,
      roles: null,
    },
  ];

  const existingRows: MockAbsenceRow[] = [
    {
      profile_id: 'emp-a',
      date: '2026-12-16',
      end_date: null,
      status: 'approved',
      absence_reasons: { name: 'Sick Leave' },
    },
    {
      profile_id: 'emp-b',
      date: '2026-12-14',
      end_date: '2026-12-18',
      status: 'approved',
      absence_reasons: { name: 'Annual Leave' },
    },
  ];

  it('previews segmented rows, counting full and partial conflicts separately', async () => {
    const { supabase, insertedAbsenceRows, insertedBatchRows } = buildMockSupabase({
      profiles,
      annualAbsences: [],
      existingRows,
    });

    const result = await bookBulkAbsence({
      supabase: supabase as never,
      actorProfileId: 'manager-1',
      reasonId: 'reason-annual',
      startDate: '2026-12-14',
      endDate: '2026-12-18',
      applyToAll: true,
      confirm: false,
    });

    expect(result.requestedDays).toBe(5);
    expect(result.wouldCreate).toBe(3);
    expect(result.createdCount).toBe(0);
    expect(result.duplicateCount).toBe(1);
    expect(result.partialConflictEmployeeCount).toBe(1);
    expect(result.conflictingWorkingDaysSkipped).toBe(6);
    expect(result.createdSegmentsCount).toBe(3);
    expect(result.conflicts).toHaveLength(2);
    expect(insertedAbsenceRows).toHaveLength(0);
    expect(insertedBatchRows).toHaveLength(0);
  });

  it('creates only non-conflicting segments on confirm and tracks batch counts', async () => {
    const { supabase, insertedAbsenceRows, insertedBatchRows } = buildMockSupabase({
      profiles,
      annualAbsences: [],
      existingRows,
    });

    const result = await bookBulkAbsence({
      supabase: supabase as never,
      actorProfileId: 'manager-1',
      reasonId: 'reason-annual',
      startDate: '2026-12-14',
      endDate: '2026-12-18',
      applyToAll: true,
      confirm: true,
      notes: 'Bulk annual leave',
    });

    expect(result.createdCount).toBe(3);
    expect(result.duplicateCount).toBe(1);
    expect(result.partialConflictEmployeeCount).toBe(1);
    expect(result.createdSegmentsCount).toBe(3);
    expect(result.batchId).toBe('batch-1');

    expect(insertedBatchRows).toHaveLength(1);
    expect(insertedBatchRows[0]?.created_count).toBe(3);
    expect(insertedBatchRows[0]?.duplicate_count).toBe(1);

    expect(insertedAbsenceRows).toHaveLength(3);
    const dateRanges = insertedAbsenceRows.map((row) => `${row.date as string}:${(row.end_date as string | null) || row.date as string}`);
    expect(dateRanges).toContain('2026-12-14:2026-12-15');
    expect(dateRanges).toContain('2026-12-17:2026-12-18');
    expect(dateRanges).toContain('2026-12-14:2026-12-18');
  });
});
