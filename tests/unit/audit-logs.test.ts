import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin');
vi.mock('@/lib/server/debug-console-access', () => ({
  requireDebugConsoleAccess: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import {
  AUDIT_LOG_PAGE_SIZE,
  buildAuditLogSearchOrFilter,
  clampAuditLogLimit,
  decodeAuditLogCursor,
  encodeAuditLogCursor,
  listAuditLogs,
  normalizeAuditLogSearch,
  shouldScanAuditLogChanges,
} from '@/lib/server/audit-logs';

interface AuditRow {
  id: string;
  table_name: string;
  record_id: string;
  user_id: string | null;
  action: string;
  changes: Record<string, { old?: unknown; new?: unknown }> | null;
  created_at: string;
}

function makeRow(index: number, overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    table_name: 'timesheets',
    record_id: `rec-${index}`,
    user_id: 'user-1',
    action: 'updated',
    changes: { status: { old: 'draft', new: 'submitted' } },
    created_at: new Date(Date.UTC(2026, 8, 7, 12, 0, 0) - index * 1000).toISOString(),
    ...overrides,
  };
}

function createThenableChain<T>(getResult: () => { data: T; error: unknown }) {
  const calls = {
    eq: [] as unknown[][],
    is: [] as unknown[][],
    in: [] as unknown[][],
    or: [] as unknown[][],
    gte: [] as unknown[][],
    ilike: [] as unknown[][],
    not: [] as unknown[][],
    neq: [] as unknown[][],
    order: [] as unknown[][],
    limit: [] as unknown[][],
  };

  const chain: Record<string, unknown> = {};
  const ret = (..._args: unknown[]) => chain;
  chain.select = vi.fn(ret);
  chain.order = vi.fn((...args: unknown[]) => {
    calls.order.push(args);
    return chain;
  });
  chain.limit = vi.fn((...args: unknown[]) => {
    calls.limit.push(args);
    return chain;
  });
  chain.eq = vi.fn((...args: unknown[]) => {
    calls.eq.push(args);
    return chain;
  });
  chain.is = vi.fn((...args: unknown[]) => {
    calls.is.push(args);
    return chain;
  });
  chain.in = vi.fn((...args: unknown[]) => {
    calls.in.push(args);
    return chain;
  });
  chain.or = vi.fn((...args: unknown[]) => {
    calls.or.push(args);
    return chain;
  });
  chain.gte = vi.fn((...args: unknown[]) => {
    calls.gte.push(args);
    return chain;
  });
  chain.ilike = vi.fn((...args: unknown[]) => {
    calls.ilike.push(args);
    return chain;
  });
  chain.not = vi.fn((...args: unknown[]) => {
    calls.not.push(args);
    return chain;
  });
  chain.neq = vi.fn((...args: unknown[]) => {
    calls.neq.push(args);
    return chain;
  });
  chain.then = (resolve: (value: { data: T; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(getResult()).then(resolve, reject);

  return { chain, calls };
}

function mockAdmin(options?: {
  auditRows?: AuditRow[];
  nameMatches?: Array<{ id: string }>;
  teamMatches?: Array<{ id: string }>;
  teamUsers?: Array<{ id: string }>;
  profiles?: Array<{ id: string; full_name: string | null; team_id: string | null }>;
}) {
  let auditRows = options?.auditRows ?? [makeRow(1)];
  const nameIlike = vi.fn().mockResolvedValue({ data: options?.nameMatches ?? [], error: null });
  const teamNameIlike = vi.fn().mockResolvedValue({ data: options?.teamMatches ?? [], error: null });
  const profileIdIn = vi.fn().mockResolvedValue({ data: options?.teamUsers ?? [], error: null });
  const profileIdEq = vi.fn().mockResolvedValue({ data: options?.teamUsers ?? [], error: null });
  const profileIdIs = vi.fn().mockResolvedValue({ data: options?.teamUsers ?? [], error: null });
  const profileByIdIn = vi.fn().mockResolvedValue({
    data: options?.profiles ?? [{ id: 'user-1', full_name: 'John Browne', team_id: 'team-1' }],
    error: null,
  });

  const audit = createThenableChain(() => ({ data: auditRows, error: null }));

  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'audit_log') {
        return audit.chain;
      }
      if (table === 'org_teams') {
        return {
          select: vi.fn(() => ({ ilike: teamNameIlike })),
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'id') {
              const idQuery = {
                ilike: nameIlike,
                in: profileIdIn,
                is: profileIdIs,
                eq: vi.fn((column: string) =>
                  column === 'is_system_account' ? idQuery : profileIdEq(column)
                ),
              };
              return idQuery;
            }
            return {
              in: profileByIdIn,
              eq: vi.fn((column: string) => {
                if (column === 'is_system_account') {
                  return {
                    eq: vi.fn(() => ({
                      order: vi.fn().mockResolvedValue({ data: [], error: null }),
                    })),
                    order: vi.fn().mockResolvedValue({ data: [], error: null }),
                  };
                }
                return {
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                };
              }),
            };
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as never);

  return {
    audit,
    nameIlike,
    teamNameIlike,
    setAuditRows(rows: AuditRow[]) {
      auditRows = rows;
    },
  };
}

describe('audit log helpers', () => {
  it('AL-CAP-001 clamps missing, invalid, and oversized limits to 200', () => {
    expect(clampAuditLogLimit(undefined)).toBe(AUDIT_LOG_PAGE_SIZE);
    expect(clampAuditLogLimit(null)).toBe(AUDIT_LOG_PAGE_SIZE);
    expect(clampAuditLogLimit('')).toBe(AUDIT_LOG_PAGE_SIZE);
    expect(clampAuditLogLimit('nope')).toBe(AUDIT_LOG_PAGE_SIZE);
    expect(clampAuditLogLimit(5000)).toBe(AUDIT_LOG_PAGE_SIZE);
    expect(clampAuditLogLimit('5000')).toBe(AUDIT_LOG_PAGE_SIZE);
    expect(clampAuditLogLimit(50)).toBe(50);
  });

  it('AL-FILTER-002 ignores 1-2 character search and does not scan JSON', () => {
    expect(normalizeAuditLogSearch('ab')).toBeNull();
    expect(normalizeAuditLogSearch(' a ')).toBeNull();
    expect(shouldScanAuditLogChanges(normalizeAuditLogSearch('ab'))).toBe(false);
    expect(shouldScanAuditLogChanges('ab')).toBe(false);
  });

  it('AL-FILTER-003 searches name, table, action, record id, and changes at 3+ characters', () => {
    expect(normalizeAuditLogSearch('jon')).toBe('jon');
    expect(shouldScanAuditLogChanges('jon')).toBe(true);

    const filter = buildAuditLogSearchOrFilter('jon', ['user-1']);
    expect(filter).toContain('table_name.ilike.%jon%');
    expect(filter).toContain('action.ilike.%jon%');
    expect(filter).toContain('record_id::text.ilike.%jon%');
    expect(filter).toContain('changes::text.ilike.%jon%');
    expect(filter).toContain('user_id.in.(user-1)');
  });

  it('encodes and decodes a keyset cursor', () => {
    const encoded = encodeAuditLogCursor('2026-09-07T12:00:00.000Z', 'row-1');
    expect(decodeAuditLogCursor(encoded)).toEqual({
      createdAt: '2026-09-07T12:00:00.000Z',
      id: 'row-1',
    });
    expect(decodeAuditLogCursor('not-a-cursor')).toBeNull();
  });
});

describe('listAuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AL-PAGE-001 defaults to 200 rows and sets has_more plus next_cursor when a 201st row exists', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => makeRow(index + 1));
    const { audit } = mockAdmin({ auditRows: rows });

    const result = await listAuditLogs({});

    expect(audit.calls.limit).toEqual([[201]]);
    expect(result.logs).toHaveLength(200);
    expect(result.pagination.limit).toBe(200);
    expect(result.pagination.has_more).toBe(true);
    expect(result.pagination.next_cursor).toBe(
      encodeAuditLogCursor(rows[199].created_at, rows[199].id)
    );
    expect(result.logs[0].user_name).toBe('John Browne');
  });

  it('AL-PAGE-002 uses the cursor for the next older page without duplicate ids', async () => {
    const firstPage = Array.from({ length: 201 }, (_, index) => makeRow(index + 1));
    const secondPage = Array.from({ length: 50 }, (_, index) => makeRow(index + 300));
    const { audit, setAuditRows } = mockAdmin({ auditRows: firstPage });

    const first = await listAuditLogs({});
    setAuditRows(secondPage);
    const second = await listAuditLogs({ cursor: first.pagination.next_cursor });

    expect(second.logs).toHaveLength(50);
    expect(second.logs.length).toBeLessThanOrEqual(200);
    expect(audit.calls.or.some(([filter]) => String(filter).includes('created_at.lt.'))).toBe(true);

    const ids = [...first.logs, ...second.logs].map((log) => log.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('AL-CAP-001 clamps limit=5000 to 200 in the query builder', async () => {
    const { audit } = mockAdmin({ auditRows: [makeRow(1)] });

    const result = await listAuditLogs({ limit: 5000 });

    expect(result.pagination.limit).toBe(200);
    expect(audit.calls.limit).toEqual([[201]]);
  });

  it('AL-FILTER-001 applies user, table, action, and time window in the query builder', async () => {
    const { audit } = mockAdmin({ auditRows: [makeRow(1)] });

    await listAuditLogs({
      userId: 'user-1',
      table: 'timesheets',
      action: 'updated',
      timeWindow: '7d',
    });

    expect(audit.calls.eq).toContainEqual(['user_id', 'user-1']);
    expect(audit.calls.eq).toContainEqual(['table_name', 'timesheets']);
    expect(audit.calls.ilike).toContainEqual(['action', 'updated']);
    expect(audit.calls.gte[0]?.[0]).toBe('created_at');
    expect(typeof audit.calls.gte[0]?.[1]).toBe('string');
    expect(audit.calls.limit).toEqual([[201]]);
    expect(audit.calls.limit.flat()).not.toContain(1000);
  });

  it('AL-FILTER-002 does not run a JSON scan for a 1-2 character query', async () => {
    const { audit, nameIlike, teamNameIlike } = mockAdmin({ auditRows: [makeRow(1)] });

    const result = await listAuditLogs({ q: 'ab' });

    expect(result.searchApplied).toBe(false);
    expect(nameIlike).not.toHaveBeenCalled();
    expect(teamNameIlike).not.toHaveBeenCalled();
    expect(audit.calls.or.filter(([filter]) => String(filter).includes('changes::text'))).toHaveLength(0);
  });

  it('AL-FILTER-003 applies a 3+ character search against name, table, action, record id, and changes', async () => {
    const { audit, nameIlike, teamNameIlike } = mockAdmin({
      auditRows: [makeRow(1)],
      nameMatches: [{ id: 'user-1' }],
    });

    const result = await listAuditLogs({ q: 'jon' });

    expect(result.searchApplied).toBe(true);
    expect(nameIlike).toHaveBeenCalledWith('full_name', '%jon%');
    expect(teamNameIlike).toHaveBeenCalledWith('name', '%jon%');
    expect(audit.calls.or[0]?.[0]).toEqual(expect.stringContaining('table_name.ilike.%jon%'));
    expect(audit.calls.or[0]?.[0]).toEqual(expect.stringContaining('action.ilike.%jon%'));
    expect(audit.calls.or[0]?.[0]).toEqual(expect.stringContaining('record_id::text.ilike.%jon%'));
    expect(audit.calls.or[0]?.[0]).toEqual(expect.stringContaining('changes::text.ilike.%jon%'));
    expect(audit.calls.or[0]?.[0]).toEqual(expect.stringContaining('user_id.in.(user-1)'));
  });
});
