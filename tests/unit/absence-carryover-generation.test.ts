import { describe, expect, it } from 'vitest';

import { generateFinancialYearCarryovers } from '@/lib/services/absence-bank-holiday-sync';

function buildMockSupabase() {
  const insertedCarryovers: Array<Record<string, unknown>> = [];
  const deletedYears: number[] = [];

  const supabase = {
    from(table: string) {
      if (table === 'absence_reasons') {
        return {
          select() {
            return {
              ilike() {
                return {
                  async single() {
                    return {
                      data: { id: 'reason-annual', name: 'Annual Leave' },
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
                return {
                  data: [
                    { id: 'emp-a', annual_holiday_allowance_days: 28 },
                    { id: 'emp-b', annual_holiday_allowance_days: 20 },
                  ],
                  error: null,
                };
              },
            };
          },
        };
      }

      if (table === 'absences') {
        return {
          select() {
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
                return {
                  data: [
                    { profile_id: 'emp-a', duration_days: 6 },
                    { profile_id: 'emp-a', duration_days: 4 },
                    { profile_id: 'emp-b', duration_days: 20 },
                  ],
                  error: null,
                };
              },
            };
            return chain;
          },
        };
      }

      if (table === 'absence_allowance_carryovers') {
        return {
          delete() {
            return {
              eq(_field: string, value: number | boolean | string) {
                if (typeof value === 'number') {
                  deletedYears.push(value);
                }
                return this;
              },
            };
          },
          async insert(rows: Array<Record<string, unknown>>) {
            insertedCarryovers.push(...rows);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, insertedCarryovers, deletedYears };
}

describe('generateFinancialYearCarryovers', () => {
  it('creates next-year carryover rows from unused allowance', async () => {
    const { supabase, insertedCarryovers, deletedYears } = buildMockSupabase();

    const created = await generateFinancialYearCarryovers(
      supabase as never,
      2025,
      2026,
      'admin-1'
    );

    expect(created).toBe(1);
    expect(deletedYears).toContain(2026);
    expect(insertedCarryovers).toHaveLength(1);
    expect(insertedCarryovers[0]).toMatchObject({
      profile_id: 'emp-a',
      financial_year_start_year: 2026,
      source_financial_year_start_year: 2025,
      carried_days: 18,
      auto_generated: true,
      generated_by: 'admin-1',
    });
  });
});
