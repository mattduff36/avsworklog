import { describe, expect, it } from 'vitest';
import { ensureStandardWorkShiftTemplate } from '@/lib/server/work-shifts';
import {
  cloneWorkShiftPattern,
  serializePatternToTemplateSlots,
  STANDARD_WORK_SHIFT_PATTERN,
} from '@/lib/utils/work-shifts';

interface MockTemplateRow {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface MockSlotRow {
  template_id: string;
  day_of_week: number;
  am_working: boolean;
  pm_working: boolean;
}

function buildSupabaseMock(options: {
  existingDefault: MockTemplateRow | null;
  insertedDefault?: MockTemplateRow;
  slotRows: MockSlotRow[];
}) {
  const upsertCalls: Array<Array<Record<string, unknown>>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];

  const supabase = {
    from(table: string) {
      if (table === 'work_shift_templates') {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      limit() {
                        return {
                          async maybeSingle() {
                            return {
                              data: options.existingDefault,
                              error: null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(payload: Record<string, unknown>) {
            insertCalls.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return {
                      data: options.insertedDefault || {
                        id: 'template-default',
                        name: 'Standard Week',
                        description: 'Monday to Friday, AM and PM.',
                        is_default: true,
                        created_at: '2026-03-23T00:00:00.000Z',
                        updated_at: '2026-03-23T00:00:00.000Z',
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'work_shift_template_slots') {
        return {
          select() {
            return {
              eq(_field: string, templateId: string) {
                return {
                  async order() {
                    return {
                      data: options.slotRows.filter((row) => row.template_id === templateId),
                      error: null,
                    };
                  },
                };
              },
            };
          },
          async upsert(rows: Array<Record<string, unknown>>) {
            upsertCalls.push(rows);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, upsertCalls, insertCalls };
}

describe('ensureStandardWorkShiftTemplate', () => {
  it('preserves an edited default template pattern instead of overwriting it', async () => {
    const existingDefault = {
      id: 'template-default',
      name: 'Standard Week',
      description: 'Editable default',
      is_default: true,
      created_at: '2026-03-23T00:00:00.000Z',
      updated_at: '2026-03-23T00:00:00.000Z',
    };
    const editedPattern = cloneWorkShiftPattern({
      monday_am: true,
      monday_pm: true,
      tuesday_am: true,
      tuesday_pm: false,
      wednesday_am: false,
      wednesday_pm: false,
      thursday_am: true,
      thursday_pm: true,
      friday_am: false,
      friday_pm: false,
      saturday_am: true,
      saturday_pm: true,
      sunday_am: false,
      sunday_pm: false,
    });
    const slotRows = serializePatternToTemplateSlots(editedPattern).map((slot) => ({
      template_id: existingDefault.id,
      ...slot,
    }));
    const { supabase, upsertCalls } = buildSupabaseMock({
      existingDefault,
      slotRows,
    });

    const result = await ensureStandardWorkShiftTemplate(supabase as never);

    expect(result.pattern).toEqual(editedPattern);
    expect(upsertCalls).toHaveLength(0);
  });

  it('backfills standard slots only when the default template has none', async () => {
    const existingDefault = {
      id: 'template-default',
      name: 'Standard Week',
      description: 'Editable default',
      is_default: true,
      created_at: '2026-03-23T00:00:00.000Z',
      updated_at: '2026-03-23T00:00:00.000Z',
    };
    const { supabase, upsertCalls, insertCalls } = buildSupabaseMock({
      existingDefault,
      slotRows: [],
    });

    const result = await ensureStandardWorkShiftTemplate(supabase as never);

    expect(result.pattern).toEqual(STANDARD_WORK_SHIFT_PATTERN);
    expect(insertCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toHaveLength(7);
  });
});
