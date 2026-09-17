import { describe, expect, it } from 'vitest';
import {
  findEmployeeIdOwner,
  isEmployeeIdUniqueViolation,
  parseEmployeeId,
} from '@/lib/server/admin-user-employee-id';

describe('admin-user-employee-id', () => {
  it('trims employee IDs and rejects non-string values', () => {
    expect(parseEmployeeId(' E123 ')).toEqual({ ok: true, value: 'E123' });
    expect(parseEmployeeId('')).toEqual({ ok: true, value: null });
    expect(parseEmployeeId(null)).toEqual({ ok: true, value: null });
    expect(parseEmployeeId(123)).toEqual({ ok: false });
  });

  it('identifies only the employee-ID unique constraint', () => {
    expect(isEmployeeIdUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_employee_id_key"',
    })).toBe(true);
    expect(isEmployeeIdUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_email_key"',
    })).toBe(false);
  });

  it('looks up owners without filtering deleted_at', async () => {
    const seen: string[] = [];
    const client = {
      from(table: 'profiles') {
        seen.push(table);
        return {
          select(columns: string) {
            seen.push(columns);
            return {
              eq(column: string, value: string) {
                seen.push(`${column}:${value}`);
                return {
                  async maybeSingle() {
                    return { data: { id: 'deleted-owner' }, error: null };
                  },
                  neq(neqColumn: string, neqValue: string) {
                    seen.push(`${neqColumn}!=${neqValue}`);
                    return {
                      async maybeSingle() {
                        return { data: { id: 'deleted-owner' }, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    const result = await findEmployeeIdOwner(client, 'E123', 'user-1');
    expect(result).toEqual({ ok: true, ownerId: 'deleted-owner' });
    expect(seen.join(' ')).not.toContain('deleted_at');
  });
});
