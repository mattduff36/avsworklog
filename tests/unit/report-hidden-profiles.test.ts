import { describe, expect, it, vi } from 'vitest';
import {
  filterHiddenReportSubjects,
  getReportHiddenProfileIds,
  isHiddenReportSubject,
} from '@/lib/server/system-accounts';

describe('report hidden profile helpers', () => {
  it('RPT-HIDE-DELETED-SCOPE-001 includes deleted and system accounts', async () => {
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: (columns: string) => ({
              eq: async () => ({
                data: columns.includes('full_name') ? [] : [{ id: 'sys-1' }],
                error: null,
              }),
              ilike: async () => ({
                data: [
                  { id: 'del-1', full_name: 'Pat Example (Deleted User)' },
                  { id: 'skip-1', full_name: 'Not actually deleted' },
                ],
                error: null,
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { kiosk_user_id: 'kiosk-1' }, error: null }),
            }),
          }),
        };
      }),
    };

    const hidden = await getReportHiddenProfileIds(admin as never);
    expect(hidden.has('sys-1')).toBe(true);
    expect(hidden.has('kiosk-1')).toBe(true);
    expect(hidden.has('del-1')).toBe(true);
    expect(hidden.has('skip-1')).toBe(false);
  });

  it('RPT-HIDE-DELETED-PRINT-001 omits a deleted booking from the printable employee set', () => {
    const hidden = new Set(['sys-1']);
    const rows = [
      {
        profile_id: 'live-1',
        employee: { full_name: 'Kevin Corbitt', is_system_account: false },
      },
      {
        profile_id: 'del-1',
        employee: { full_name: 'Former Employee (Deleted User)', is_system_account: false },
      },
      {
        profile_id: 'sys-1',
        employee: { full_name: 'Kiosk', is_system_account: true },
      },
    ];

    const visible = filterHiddenReportSubjects(rows, hidden);
    expect(visible).toEqual([rows[0]]);
    expect(new Set(visible.map((row) => row.profile_id)).size).toBe(1);
  });

  it('RPT-HIDE-DELETED-BOOKINGS-001 omits deleted employees from bookings export rows', () => {
    const hidden = new Set<string>();
    const rows = [
      {
        profile_id: 'live-2',
        employee: { full_name: 'Charlotte Boyles' },
      },
      {
        profile_id: 'del-2',
        employee: { full_name: 'Leaver (Deleted User)' },
      },
    ];

    const excelSubjects = filterHiddenReportSubjects(rows, hidden).map((row) => row.employee?.full_name);
    expect(excelSubjects).toEqual(['Charlotte Boyles']);
    expect(isHiddenReportSubject('del-2', { full_name: 'Leaver (Deleted User)' }, hidden)).toBe(true);
  });
});
