/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useSyncExternalStore, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const SELF = '11111111-1111-4111-8111-111111111111';
const TEAMMATE = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';

const pushMock = vi.fn();
const auth = {
  user: { id: SELF } as { id: string } | null,
  profile: { team: { name: 'Operations' } },
  effectiveRole: { team_name: 'Operations' },
  isManager: true,
  isAdmin: false,
  isSuperAdmin: false,
  isSupervisor: false,
  loading: false,
};
const permission = { hasPermission: true, loading: false };
const directory = {
  users: [] as Array<{ id: string; full_name: string; employee_id: string | null; has_module_access: boolean }>,
};

const queryStore = vi.hoisted(() => {
  let employee = 'all';
  let hgv = 'all';
  let status = 'all';
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    get employee() { return employee; },
    get hgv() { return hgv; },
    get status() { return status; },
    set(key: 'employee' | 'hgv' | 'status', value: string) {
      if (key === 'employee') employee = value;
      if (key === 'hgv') hgv = value;
      if (key === 'status') status = value;
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      employee = 'all';
      hgv = 'all';
      status = 'all';
      emit();
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hgv-inspections',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock('nuqs', () => ({
  useQueryState: (key: 'employee' | 'hgv' | 'status') => {
    const value = useSyncExternalStore(
      (listener) => queryStore.subscribe(listener),
      () => queryStore[key],
      () => queryStore[key],
    );
    return [value, (next: string | null) => queryStore.set(key, next || 'all')] as const;
  },
}));

vi.mock('@/components/providers/NuqsClientAdapter', () => ({
  NuqsClientAdapter: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => auth,
}));

vi.mock('@/lib/hooks/usePermissionCheck', () => ({
  usePermissionCheck: () => permission,
}));

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({ tabletModeEnabled: false }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/client/user-directory', () => ({
  fetchUserDirectory: async () => directory.users,
}));

type FilterOp =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; value: unknown[] };
type OrderOp = { kind: 'order'; column: string; ascending: boolean };
type RangeOp = { kind: 'range'; from: number; to: number };
type QueryOp = FilterOp | OrderOp | RangeOp;

interface QueryLog {
  table: string;
  select: string;
  countExact: boolean;
  ops: QueryOp[];
}

interface InspectionRow {
  id: string;
  user_id: string;
  hgv_id: string | null;
  status: 'draft' | 'submitted';
  inspection_date: string;
  inspection_end_date: string | null;
  submitted_at: string | null;
}

interface VehicleRow {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: 'active';
}

interface PendingQuery {
  ops: QueryOp[];
  release: () => void;
}

const logs: QueryLog[] = [];
const pending: PendingQuery[] = [];
const fixture = {
  inspections: [] as InspectionRow[],
  vehicles: [] as VehicleRow[],
  profiles: [] as Array<{ id: string; full_name: string | null }>,
  holdInspections: false,
  includeCount: true,
  listError: false,
  missingRelations: false,
  responseCap: Number.POSITIVE_INFINITY,
};

function uuid(prefix: string, n: number): string {
  const digits = '0123456789abcdef';
  let head = '';
  for (let index = 0; index < 8; index += 1) {
    head += digits[(prefix.charCodeAt(index) || index + 1) % 16];
  }
  return `${head}-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`;
}

function isoFromOffset(offset: number): string {
  const date = new Date(Date.UTC(2026, 0, 1));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function inspectionQueries(): QueryLog[] {
  return logs.filter((entry) => entry.table === 'hgv_inspections');
}

function opValue(entry: QueryLog, kind: 'eq' | 'in', column: string): unknown {
  const match = entry.ops.find((op) => op.kind === kind && op.column === column);
  return match && 'value' in match ? match.value : undefined;
}

function hasStatus(ops: QueryOp[], status: string): boolean {
  return ops.some((op) => op.kind === 'eq' && op.column === 'status' && op.value === status);
}

function assertWindowQuery(entry: QueryLog) {
  const rangeAt = entry.ops.findIndex((op) => op.kind === 'range');
  expect(rangeAt).toBeGreaterThan(-1);
  entry.ops.forEach((op, index) => {
    if (op.kind === 'eq' || op.kind === 'in') expect(index).toBeLessThan(rangeAt);
  });
  expect(entry.ops.filter((op) => op.kind === 'order')).toEqual([
    { kind: 'order', column: 'inspection_date', ascending: false },
    { kind: 'order', column: 'id', ascending: false },
  ]);
  expect(entry.select).toBe('id, user_id, hgv_id, status, inspection_date, inspection_end_date, submitted_at');
  expect(entry.countExact).toBe(true);
}

class Query {
  private readonly ops: QueryOp[] = [];
  private selectColumns = '';
  private countExact = false;

  constructor(private readonly table: string) {}

  select(columns: string, options?: { count?: string }) {
    this.selectColumns = columns;
    this.countExact = options?.count === 'exact';
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.ops.push({ kind: 'order', column, ascending: options?.ascending !== false });
    return this;
  }

  eq(column: string, value: unknown) {
    this.ops.push({ kind: 'eq', column, value });
    return this;
  }

  in(column: string, value: readonly unknown[]) {
    this.ops.push({ kind: 'in', column, value: [...value] });
    return this;
  }

  range(from: number, to: number) {
    this.ops.push({ kind: 'range', from, to });
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown; count: number | null }, TResult2 = never>(
    onFulfilled?: ((value: { data: unknown; error: unknown; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const execute = () => this.run();
    const promise = this.table === 'hgv_inspections' && fixture.holdInspections
      ? new Promise<{ data: unknown; error: unknown; count: number | null }>((resolve, reject) => {
          const ops = this.ops.map((op) => ({ ...op }));
          pending.push({
            ops,
            release: () => {
              try {
                resolve(execute());
              } catch (error) {
                reject(error);
              }
            },
          });
        })
      : Promise.resolve().then(execute);
    return promise.then(onFulfilled, onRejected);
  }

  private run(): { data: unknown; error: unknown; count: number | null } {
    const ops = this.ops.map((op) => ({ ...op }));
    logs.push({ table: this.table, select: this.selectColumns, countExact: this.countExact, ops });

    if (this.table === 'hgv_inspections' && fixture.listError) {
      return { data: null, error: { message: 'db down' }, count: null };
    }

    if (fixture.missingRelations && (this.table === 'hgvs' || this.table === 'profiles') && ops.some((op) => op.kind === 'in')) {
      return { data: null, error: { message: 'relation missing' }, count: null };
    }

    if (this.table === 'hgvs') {
      const ids = ops.find((op) => op.kind === 'in' && op.column === 'id');
      const rows = ids && ids.kind === 'in'
        ? fixture.vehicles.filter((vehicle) => ids.value.includes(vehicle.id))
        : fixture.vehicles.filter((vehicle) => vehicle.status === 'active');
      return { data: rows, error: null, count: null };
    }

    if (this.table === 'profiles') {
      const ids = ops.find((op) => op.kind === 'in' && op.column === 'id');
      const rows = ids && ids.kind === 'in'
        ? fixture.profiles.filter((profile) => ids.value.includes(profile.id))
        : [];
      return { data: rows, error: null, count: null };
    }

    if (this.table === 'inspection_items' || this.table === 'actions') {
      return { data: [], error: null, count: null };
    }

    let rows = [...fixture.inspections];
    for (const op of ops) {
      if (op.kind === 'eq') {
        rows = rows.filter((row) => row[op.column as keyof InspectionRow] === op.value);
      } else if (op.kind === 'in') {
        rows = rows.filter((row) => op.value.includes(row[op.column as keyof InspectionRow]));
      }
    }
    const orders = ops.filter((op): op is OrderOp => op.kind === 'order');
    rows.sort((left, right) => {
      for (const order of orders) {
        const leftValue = String(left[order.column as keyof InspectionRow] ?? '');
        const rightValue = String(right[order.column as keyof InspectionRow] ?? '');
        if (leftValue === rightValue) continue;
        const compared = leftValue < rightValue ? -1 : 1;
        return order.ascending ? compared : -compared;
      }
      return 0;
    });
    const total = rows.length;
    const range = ops.find((op): op is RangeOp => op.kind === 'range');
    if (range) rows = rows.slice(range.from, Math.min(range.to + 1, range.from + fixture.responseCap));
    return {
      data: rows,
      error: null,
      count: this.countExact && fixture.includeCount ? total : null,
    };
  }
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => new Query(table),
  }),
}));

import HgvInspectionsPage from '@/app/(dashboard)/hgv-inspections/page';

function addInspection(partial: Omit<InspectionRow, 'inspection_end_date' | 'submitted_at' | 'hgv_id'> & {
  reg: string;
  hgv_id?: string | null;
  inspection_end_date?: string | null;
  submitted_at?: string | null;
}) {
  const hgvId = partial.hgv_id || uuid('vehicle0', fixture.vehicles.length + 1);
  if (!fixture.vehicles.some((vehicle) => vehicle.id === hgvId)) {
    fixture.vehicles.push({
      id: hgvId,
      reg_number: partial.reg,
      nickname: null,
      status: 'active',
    });
  }
  fixture.inspections.push({
    id: partial.id,
    user_id: partial.user_id,
    hgv_id: hgvId,
    status: partial.status,
    inspection_date: partial.inspection_date,
    inspection_end_date: partial.inspection_end_date ?? null,
    submitted_at: partial.submitted_at ?? null,
  });
}

function cardTitles(): string[] {
  return [...document.querySelectorAll('.text-lg.text-white')].map((node) => (node.textContent || '').trim());
}

function renderPage() {
  return render(<HgvInspectionsPage />);
}

async function shownRegs(reg: string) {
  await waitFor(() => expect(cardTitles()).toContain(reg));
}

describe('HGV inspection list pagination', () => {
  beforeEach(() => {
    logs.length = 0;
    pending.length = 0;
    fixture.inspections = [];
    fixture.vehicles = [];
    fixture.profiles = [
      { id: SELF, full_name: 'Self User' },
      { id: TEAMMATE, full_name: 'Team User' },
    ];
    fixture.holdInspections = false;
    fixture.includeCount = true;
    fixture.listError = false;
    fixture.missingRelations = false;
    fixture.responseCap = Number.POSITIVE_INFINITY;
    directory.users = [];
    auth.user = { id: SELF };
    auth.profile = { team: { name: 'Operations' } };
    auth.effectiveRole = { team_name: 'Operations' };
    auth.isManager = true;
    auth.isAdmin = false;
    auth.isSuperAdmin = false;
    auth.isSupervisor = false;
    auth.loading = false;
    permission.hasPermission = true;
    permission.loading = false;
    queryStore.reset();
    pushMock.mockReset();
    vi.mocked(toast.error).mockClear();
    window.localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('reveals a record past the first page and enriches only the visible rows', async () => {
    const lateId = uuid('inspect1', 21);
    for (let index = 0; index < 21; index += 1) {
      const id = index === 20 ? lateId : uuid('inspect1', index + 1);
      addInspection({
        id,
        user_id: SELF,
        hgv_id: uuid('vehicle1', index + 1),
        status: 'submitted',
        inspection_date: isoFromOffset(21 - index),
        reg: index === 0 ? 'FIRST-REG' : index === 20 ? 'LATE-REG' : `MID-${index}`,
      });
    }

    renderPage();
    await shownRegs('FIRST-REG');
    await waitFor(() => expect(inspectionQueries().length).toBeGreaterThanOrEqual(2));
    expect(cardTitles()).not.toContain('LATE-REG');
    expect(screen.getByRole('button', { name: 'Show More (1 remaining)' })).toBeInTheDocument();

    const enrichedBefore = logs.filter((entry) => entry.table === 'inspection_items');
    expect(enrichedBefore.length).toBeGreaterThan(0);
    for (const entry of enrichedBefore) {
      expect(opValue(entry, 'in', 'inspection_id')).not.toContain(lateId);
      expect(opValue(entry, 'in', 'inspection_id')).toHaveLength(20);
    }
    for (const entry of inspectionQueries()) {
      assertWindowQuery(entry);
      expect(entry.ops.some((op) => op.kind === 'range' && op.from === 0 && op.to === 20)).toBe(true);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Show More (1 remaining)' }));
    await shownRegs('LATE-REG');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument());
    const latest = inspectionQueries().at(-1);
    expect(latest?.ops).toContainEqual({ kind: 'range', from: 0, to: 40 });
    const enrichedLate = logs.filter((entry) => entry.table === 'inspection_items').at(-1);
    expect(opValue(enrichedLate as QueryLog, 'in', 'inspection_id')).toContain(lateId);
  });

  it('continues capped responses and includes a concurrent insert when the growing window refreshes', async () => {
    fixture.responseCap = 7;
    for (let index = 1; index <= 21; index += 1) {
      addInspection({ id: uuid('capped00', index), user_id: SELF, status: 'submitted', inspection_date: isoFromOffset(index), reg: `CAP-${index}` });
    }
    renderPage();
    await waitFor(() => expect(cardTitles()).toHaveLength(20));
    expect(cardTitles()).not.toContain('CAP-1');
    expect(inspectionQueries().some(q => q.ops.some(op => op.kind === 'range' && op.from === 14))).toBe(true);
    addInspection({ id: uuid('capped00', 22), user_id: SELF, status: 'submitted', inspection_date: isoFromOffset(22), reg: 'NEW-INSERT' });
    fireEvent.click(screen.getByRole('button', { name: 'Show More (1 remaining)' }));
    await waitFor(() => expect(cardTitles()).toHaveLength(22));
    expect(new Set(cardTitles()).size).toBe(22);
    expect(cardTitles()[0]).toBe('NEW-INSERT');
    expect(cardTitles()).toContain('CAP-1');
    expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument();
  });

  it('orders equal dates by id descending', async () => {
    addInspection({
      id: uuid('inspect2', 1),
      user_id: SELF,
      hgv_id: uuid('vehicle2', 1),
      status: 'submitted',
      inspection_date: '2026-03-01',
      reg: 'EQ-LOW',
    });
    addInspection({
      id: uuid('inspect2', 2),
      user_id: SELF,
      hgv_id: uuid('vehicle2', 2),
      status: 'submitted',
      inspection_date: '2026-03-01',
      reg: 'EQ-HIGH',
    });
    addInspection({
      id: uuid('inspect2', 3),
      user_id: SELF,
      hgv_id: uuid('vehicle2', 3),
      status: 'submitted',
      inspection_date: '2026-03-02',
      reg: 'NEWER-REG',
    });

    renderPage();
    await shownRegs('NEWER-REG');
    await shownRegs('EQ-HIGH');
    const titles = cardTitles();
    expect(titles.indexOf('NEWER-REG')).toBeLessThan(titles.indexOf('EQ-HIGH'));
    expect(titles.indexOf('EQ-HIGH')).toBeLessThan(titles.indexOf('EQ-LOW'));
    expect(inspectionQueries().at(-1)?.ops.filter((op) => op.kind === 'order')).toEqual([
      { kind: 'order', column: 'inspection_date', ascending: false },
      { kind: 'order', column: 'id', ascending: false },
    ]);
  });

  it('applies filters before the range and resets the window after Show More', async () => {
    const hgvSubmitted = uuid('vehicle3', 1);
    const hgvDraft = uuid('vehicle3', 2);
    const hgvOnly = uuid('vehicle3', 3);
    for (let index = 0; index < 25; index += 1) {
      addInspection({
        id: uuid('inspect3', index + 1),
        user_id: SELF,
        hgv_id: hgvSubmitted,
        status: 'submitted',
        inspection_date: isoFromOffset(400 + index),
        reg: 'SUB-REG',
      });
    }
    for (let index = 0; index < 30; index += 1) {
      addInspection({
        id: uuid('inspect3', index + 100),
        user_id: OUTSIDER,
        hgv_id: index === 0 ? hgvOnly : hgvDraft,
        status: 'draft',
        inspection_date: isoFromOffset(200 + index),
        reg: index === 0 ? 'ONLY-HGV' : 'DRAFT-REG',
      });
    }

    renderPage();
    await waitFor(() => expect(cardTitles().filter((title) => title === 'SUB-REG')).toHaveLength(20));
    await waitFor(() => expect(inspectionQueries().length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByRole('button', { name: 'Show More (35 remaining)' }));
    await waitFor(() => {
      expect(cardTitles().filter((title) => title === 'SUB-REG')).toHaveLength(25);
      expect(screen.getByRole('button', { name: 'Show More (15 remaining)' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show More (15 remaining)' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument());
    expect(cardTitles()).toContain('ONLY-HGV');

    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await waitFor(() => {
      expect(cardTitles().filter((title) => title === 'DRAFT-REG')).toHaveLength(20);
      expect(screen.getByRole('button', { name: 'Show More (10 remaining)' })).toBeInTheDocument();
    });
    expect(cardTitles()).not.toContain('ONLY-HGV');
    expect(cardTitles()).not.toContain('SUB-REG');

    const drafted = inspectionQueries().filter((entry) => hasStatus(entry.ops, 'draft'));
    expect(drafted.length).toBeGreaterThan(0);
    for (const entry of drafted) {
      assertWindowQuery(entry);
    }
    expect(drafted.at(-1)?.ops).toContainEqual({ kind: 'range', from: 0, to: 20 });

    act(() => queryStore.set('hgv', hgvOnly));
    await waitFor(() => expect(cardTitles()).toEqual(['ONLY-HGV']));
    const hgvFiltered = inspectionQueries().filter((entry) => opValue(entry, 'eq', 'hgv_id') === hgvOnly);
    expect(hgvFiltered.length).toBeGreaterThan(0);
    for (const entry of hgvFiltered) assertWindowQuery(entry);
  });

  it('shows an empty page without a remainder', async () => {
    addInspection({
      id: uuid('inspect4', 1),
      user_id: SELF,
      hgv_id: uuid('vehicle4', 1),
      status: 'draft',
      inspection_date: '2026-04-01',
      reg: 'ONLY-DRAFT',
    });

    renderPage();
    await shownRegs('ONLY-DRAFT');
    fireEvent.click(screen.getByRole('button', { name: 'Submitted' }));
    expect(await screen.findByText('No HGV daily checks yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument();
    expect(cardTitles()).not.toContain('ONLY-DRAFT');
    const submitted = inspectionQueries().filter((entry) => hasStatus(entry.ops, 'submitted'));
    expect(submitted.length).toBeGreaterThan(0);
    for (const entry of submitted) assertWindowQuery(entry);
  });

  it('keeps own, team, and out-of-scope visibility in the query', async () => {
    auth.isManager = false;
    for (let index = 0; index < 12; index += 1) {
      addInspection({
        id: uuid('inspect5', index + 1),
        user_id: SELF,
        hgv_id: uuid('vehicle5', index + 1),
        status: 'draft',
        inspection_date: isoFromOffset(12 - index),
        reg: index === 11 ? 'OWN-LATE' : `OWN-${index}`,
      });
    }
    addInspection({
      id: uuid('inspect5', 90),
      user_id: OUTSIDER,
      hgv_id: uuid('vehicle5', 90),
      status: 'draft',
      inspection_date: '2026-08-01',
      reg: 'HIDDEN-OUTSIDER',
    });

    fixture.includeCount = false;
    renderPage();
    await shownRegs('OWN-0');
    await waitFor(() => expect(inspectionQueries().length).toBeGreaterThanOrEqual(2));
    expect(cardTitles()).not.toContain('OWN-LATE');
    expect(cardTitles()).not.toContain('HIDDEN-OUTSIDER');
    expect(screen.getByRole('button', { name: 'Show More' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remaining/ })).not.toBeInTheDocument();
    for (const entry of inspectionQueries()) {
      assertWindowQuery(entry);
      expect(opValue(entry, 'eq', 'user_id')).toBe(SELF);
      expect(entry.ops.some((op) => op.kind === 'range' && op.to === 10)).toBe(true);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Show More' }));
    await shownRegs('OWN-LATE');
    expect(cardTitles()).not.toContain('HIDDEN-OUTSIDER');
  });

  it('limits team results to the directory and collapses an out-of-scope employee to self', async () => {
    auth.isManager = false;
    auth.profile = { team: { name: 'Workshop' } };
    auth.effectiveRole = { team_name: 'Workshop' };
    directory.users = [{ id: TEAMMATE, full_name: 'Team User', employee_id: null, has_module_access: true }];
    addInspection({
      id: uuid('inspect6', 1),
      user_id: SELF,
      hgv_id: uuid('vehicle6', 1),
      status: 'submitted',
      inspection_date: '2026-05-02',
      reg: 'SELF-REG',
    });
    addInspection({
      id: uuid('inspect6', 2),
      user_id: TEAMMATE,
      hgv_id: uuid('vehicle6', 2),
      status: 'submitted',
      inspection_date: '2026-05-03',
      reg: 'TEAM-REG',
    });
    addInspection({
      id: uuid('inspect6', 3),
      user_id: OUTSIDER,
      hgv_id: uuid('vehicle6', 3),
      status: 'submitted',
      inspection_date: '2026-05-04',
      reg: 'OUT-REG',
    });

    renderPage();
    await shownRegs('TEAM-REG');
    await shownRegs('SELF-REG');
    expect(cardTitles()).not.toContain('OUT-REG');
    await waitFor(() => {
      const scoped = inspectionQueries().filter((entry) => {
        const ids = opValue(entry, 'in', 'user_id');
        return Array.isArray(ids) && ids.includes(SELF) && ids.includes(TEAMMATE) && !ids.includes(OUTSIDER);
      });
      expect(scoped.length).toBeGreaterThan(0);
      scoped.forEach(assertWindowQuery);
    });

    cleanup();
    logs.length = 0;
    fixture.inspections = fixture.inspections.slice();
    queryStore.set('employee', OUTSIDER);
    renderPage();
    await shownRegs('SELF-REG');
    expect(cardTitles()).not.toContain('TEAM-REG');
    expect(cardTitles()).not.toContain('OUT-REG');
    await waitFor(() => {
      const restricted = inspectionQueries().filter((entry) => opValue(entry, 'eq', 'user_id') === SELF);
      expect(restricted.length).toBeGreaterThan(0);
      restricted.forEach((entry) => {
        assertWindowQuery(entry);
        expect(opValue(entry, 'eq', 'user_id')).not.toBe(OUTSIDER);
      });
    });
  });

  it('ignores a stale unfiltered response after the status filter changes', async () => {
    fixture.holdInspections = true;
    addInspection({
      id: uuid('inspect7', 1),
      user_id: SELF,
      hgv_id: uuid('vehicle7', 1),
      status: 'draft',
      inspection_date: '2026-06-02',
      reg: 'STALE-DRAFT',
    });
    addInspection({
      id: uuid('inspect7', 2),
      user_id: SELF,
      hgv_id: uuid('vehicle7', 2),
      status: 'submitted',
      inspection_date: '2026-06-01',
      reg: 'KEEP-SUBMITTED',
    });

    renderPage();
    await waitFor(() => expect(pending.filter((entry) => !hasStatus(entry.ops, 'submitted')).length).toBeGreaterThanOrEqual(2));
    act(() => queryStore.set('status', 'submitted'));
    await waitFor(() => expect(pending.some((entry) => hasStatus(entry.ops, 'submitted'))).toBe(true));

    const stale = pending.filter((entry) => !hasStatus(entry.ops, 'submitted'));
    const fresh = pending.filter((entry) => hasStatus(entry.ops, 'submitted'));
    await act(async () => {
      stale.forEach((entry) => entry.release());
    });
    expect(cardTitles()).not.toContain('STALE-DRAFT');
    expect(cardTitles()).not.toContain('KEEP-SUBMITTED');

    await act(async () => {
      fresh.forEach((entry) => entry.release());
    });
    await shownRegs('KEEP-SUBMITTED');
    expect(cardTitles()).not.toContain('STALE-DRAFT');
    fresh.forEach((entry) => {
      const rangeAt = entry.ops.findIndex((op) => op.kind === 'range');
      const statusAt = entry.ops.findIndex((op) => op.kind === 'eq' && op.column === 'status');
      expect(statusAt).toBeGreaterThan(-1);
      expect(statusAt).toBeLessThan(rangeAt);
    });
  });

  it('keeps the row when enrichment relations are missing and preserves PDF and detail links', async () => {
    fixture.missingRelations = true;
    const submittedId = uuid('inspect8', 1);
    const draftId = uuid('inspect8', 2);
    addInspection({
      id: submittedId,
      user_id: OUTSIDER,
      hgv_id: uuid('vehicle8', 1),
      status: 'submitted',
      inspection_date: '2026-07-02',
      reg: 'SHOULD-NOT-USE-REG',
    });
    addInspection({
      id: draftId,
      user_id: SELF,
      hgv_id: uuid('vehicle8', 2),
      status: 'draft',
      inspection_date: '2026-07-01',
      reg: 'DRAFT-REG-HIDDEN',
    });

    renderPage();
    expect(await screen.findAllByText('Unknown HGV')).toHaveLength(2);
    expect(cardTitles()).not.toContain('SHOULD-NOT-USE-REG');
    expect(screen.queryByText('Self User')).not.toBeInTheDocument();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Unknown HGV')[0]);
    expect(pushMock).toHaveBeenCalledWith(`/hgv-inspections/${submittedId}`);
    fireEvent.click(screen.getAllByText('Unknown HGV')[1]);
    expect(pushMock).toHaveBeenCalledWith(`/hgv-inspections/new?id=${draftId}`);
  });

  it('toasts a list error and does not invent rows or a remainder', async () => {
    fixture.listError = true;
    addInspection({
      id: uuid('inspect9', 1),
      user_id: SELF,
      hgv_id: uuid('vehicle9', 1),
      status: 'submitted',
      inspection_date: '2026-09-01',
      reg: 'BROKEN-REG',
    });

    renderPage();
    expect(await screen.findByText('No HGV daily checks yet')).toBeInTheDocument();
    expect(cardTitles()).not.toContain('BROKEN-REG');
    expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Failed to load HGV inspections',
      expect.objectContaining({ id: 'hgv-inspections-fetch-list-error' }),
    );
  });
});
