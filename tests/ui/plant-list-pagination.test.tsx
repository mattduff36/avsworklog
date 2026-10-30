/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useSyncExternalStore, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const SELF = '11111111-1111-4111-8111-111111111111';
const TEAMMATE = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';
const LIST_SELECT = [
  'id',
  'plant_id',
  'user_id',
  'inspection_date',
  'inspection_end_date',
  'current_mileage',
  'status',
  'submitted_at',
  'is_hired_plant',
  'hired_plant_id_serial',
  'hired_plant_description',
  'hired_plant_hiring_company',
  'job_code',
  'job_site_address',
].join(', ');

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
  let plant = 'all';
  let status = 'all';
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    get employee() { return employee; },
    get plant() { return plant; },
    get status() { return status; },
    set(key: 'employee' | 'plant' | 'status', value: string) {
      if (key === 'employee') employee = value;
      if (key === 'plant') plant = value;
      if (key === 'status') status = value;
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      employee = 'all';
      plant = 'all';
      status = 'all';
      emit();
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/plant-inspections',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock('nuqs', () => ({
  useQueryState: (key: 'employee' | 'plant' | 'status') => {
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

vi.mock('@/lib/hooks/useRealtime', () => ({
  usePlantInspectionRealtime: () => undefined,
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
  plant_id: string | null;
  user_id: string;
  inspection_date: string;
  inspection_end_date: string | null;
  current_mileage: number | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  is_hired_plant: boolean;
  hired_plant_id_serial: string | null;
  hired_plant_description: string | null;
  hired_plant_hiring_company: string | null;
  job_code: string | null;
  job_site_address: string | null;
}

interface PlantRow {
  id: string;
  plant_id: string;
  nickname: string | null;
  serial_number: string | null;
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
  plants: [] as PlantRow[],
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
  return logs.filter((entry) => entry.table === 'plant_inspections');
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
  expect(entry.select.replace(/\s+/g, ' ').trim()).toBe(LIST_SELECT);
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
    const promise = this.table === 'plant_inspections' && fixture.holdInspections
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

    if (this.table === 'plant_inspections' && fixture.listError) {
      return { data: null, error: { message: 'db down' }, count: null };
    }

    if (fixture.missingRelations && (this.table === 'plant' || this.table === 'profiles') && ops.some((op) => op.kind === 'in')) {
      return { data: null, error: { message: 'relation missing' }, count: null };
    }

    if (this.table === 'plant') {
      const ids = ops.find((op) => op.kind === 'in' && op.column === 'id');
      let rows = fixture.plants.filter((plant) => plant.status === 'active');
      if (ids && ids.kind === 'in') {
        rows = rows.filter((plant) => ids.value.includes(plant.id));
      }
      return {
        data: rows.map((plant) => ({ ...plant, van_categories: null })),
        error: null,
        count: null,
      };
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

import PlantInspectionsPage from '@/app/(dashboard)/plant-inspections/page';

function addInspection(partial: {
  id: string;
  user_id: string;
  status: 'draft' | 'submitted';
  inspection_date: string;
  label: string;
  plant_id?: string | null;
  hired?: boolean;
  hired_serial?: string | null;
}) {
  const hired = partial.hired === true;
  let plantId = partial.plant_id ?? null;
  if (!hired) {
    plantId = plantId || uuid('plantrow', fixture.plants.length + 1);
    if (!fixture.plants.some((plant) => plant.id === plantId)) {
      fixture.plants.push({
        id: plantId,
        plant_id: partial.label,
        nickname: null,
        serial_number: null,
        status: 'active',
      });
    }
  }
  fixture.inspections.push({
    id: partial.id,
    plant_id: hired ? null : plantId,
    user_id: partial.user_id,
    inspection_date: partial.inspection_date,
    inspection_end_date: null,
    current_mileage: null,
    status: partial.status,
    submitted_at: partial.status === 'submitted' ? partial.inspection_date : null,
    is_hired_plant: hired,
    hired_plant_id_serial: hired ? (partial.hired_serial ?? partial.label) : null,
    hired_plant_description: null,
    hired_plant_hiring_company: null,
    job_code: null,
    job_site_address: null,
  });
}

function cardTitles(): string[] {
  return [...document.querySelectorAll('.text-lg.text-white')].map((node) =>
    (node.textContent || '').replace(/\s+/g, ' ').trim()
  );
}

function renderPage() {
  return render(<PlantInspectionsPage />);
}

async function shownTitle(title: string) {
  await waitFor(() => expect(cardTitles()).toContain(title));
}

describe('Plant inspection list pagination', () => {
  beforeEach(() => {
    logs.length = 0;
    pending.length = 0;
    fixture.inspections = [];
    fixture.plants = [];
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
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
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
        status: 'submitted',
        inspection_date: isoFromOffset(21 - index),
        label: index === 0 ? 'FIRST-PLANT' : index === 20 ? 'LATE-PLANT' : `MID-${index}`,
      });
    }

    renderPage();
    await shownTitle('FIRST-PLANT');
    await waitFor(() => expect(inspectionQueries().length).toBeGreaterThanOrEqual(2));
    expect(cardTitles()).not.toContain('LATE-PLANT');
    expect(screen.getByRole('button', { name: 'Show More (1 remaining)' })).toBeInTheDocument();

    for (const table of ['inspection_items', 'actions'] as const) {
      const enrichedBefore = logs.filter((entry) => entry.table === table);
      expect(enrichedBefore.length).toBeGreaterThan(0);
      for (const entry of enrichedBefore) {
        expect(opValue(entry, 'in', 'inspection_id')).not.toContain(lateId);
        expect(opValue(entry, 'in', 'inspection_id')).toHaveLength(20);
      }
    }
    for (const entry of inspectionQueries()) {
      assertWindowQuery(entry);
      expect(entry.ops.some((op) => op.kind === 'range' && op.from === 0 && op.to === 20)).toBe(true);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Show More (1 remaining)' }));
    await shownTitle('LATE-PLANT');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument());
    const latest = inspectionQueries().at(-1);
    expect(latest?.ops).toContainEqual({ kind: 'range', from: 0, to: 40 });
    const enrichedLate = logs.filter((entry) => entry.table === 'inspection_items').at(-1);
    expect(opValue(enrichedLate as QueryLog, 'in', 'inspection_id')).toContain(lateId);
  });

  it('continues capped responses and includes a later row when the growing window refreshes', async () => {
    fixture.responseCap = 7;
    for (let index = 1; index <= 21; index += 1) {
      addInspection({
        id: uuid('capped00', index),
        user_id: SELF,
        status: 'submitted',
        inspection_date: isoFromOffset(index),
        label: `CAP-${index}`,
      });
    }
    renderPage();
    await waitFor(() => expect(cardTitles()).toHaveLength(20));
    expect(cardTitles()).not.toContain('CAP-1');
    expect(inspectionQueries().some((query) => query.ops.some((op) => op.kind === 'range' && op.from === 14))).toBe(true);
    addInspection({
      id: uuid('capped00', 22),
      user_id: SELF,
      status: 'submitted',
      inspection_date: isoFromOffset(22),
      label: 'NEW-INSERT',
    });
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
      status: 'submitted',
      inspection_date: '2026-03-01',
      label: 'EQ-LOW',
    });
    addInspection({
      id: uuid('inspect2', 2),
      user_id: SELF,
      status: 'submitted',
      inspection_date: '2026-03-01',
      label: 'EQ-HIGH',
    });
    addInspection({
      id: uuid('inspect2', 3),
      user_id: SELF,
      status: 'submitted',
      inspection_date: '2026-03-02',
      label: 'NEWER-PLANT',
    });

    renderPage();
    await shownTitle('NEWER-PLANT');
    await shownTitle('EQ-HIGH');
    const titles = cardTitles();
    expect(titles.indexOf('NEWER-PLANT')).toBeLessThan(titles.indexOf('EQ-HIGH'));
    expect(titles.indexOf('EQ-HIGH')).toBeLessThan(titles.indexOf('EQ-LOW'));
    expect(inspectionQueries().at(-1)?.ops.filter((op) => op.kind === 'order')).toEqual([
      { kind: 'order', column: 'inspection_date', ascending: false },
      { kind: 'order', column: 'id', ascending: false },
    ]);
  });

  it('applies hired, plant, and status filters before the range and resets after Show More', async () => {
    const plantA = uuid('plantaaa', 1);
    const plantB = uuid('plantbbb', 1);
    for (let index = 0; index < 21; index += 1) {
      addInspection({
        id: uuid('inspect3', index + 1),
        user_id: SELF,
        plant_id: plantA,
        status: 'submitted',
        inspection_date: isoFromOffset(500 + index),
        label: 'PLANT-A',
      });
    }
    for (let index = 0; index < 5; index += 1) {
      addInspection({
        id: uuid('inspect3', index + 100),
        user_id: SELF,
        status: 'submitted',
        inspection_date: isoFromOffset(100 + index),
        label: 'HIRED',
        hired: true,
        hired_serial: 'HIRED',
      });
    }
    for (let index = 0; index < 3; index += 1) {
      addInspection({
        id: uuid('inspect3', index + 200),
        user_id: OUTSIDER,
        plant_id: plantB,
        status: 'draft',
        inspection_date: isoFromOffset(10 + index),
        label: 'PLANT-B',
      });
    }

    renderPage();
    await waitFor(() => expect(cardTitles().filter((title) => title === 'PLANT-A')).toHaveLength(20));
    await waitFor(() => expect(inspectionQueries().length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByRole('button', { name: 'Show More (9 remaining)' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument());
    expect(cardTitles().filter((title) => title === 'PLANT-A')).toHaveLength(21);
    expect(cardTitles().filter((title) => title === 'Hired - HIRED')).toHaveLength(5);
    expect(cardTitles().filter((title) => title === 'PLANT-B')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await waitFor(() => expect(cardTitles().filter((title) => title === 'PLANT-B')).toHaveLength(3));
    expect(cardTitles()).not.toContain('PLANT-A');
    expect(cardTitles()).not.toContain('Hired - HIRED');
    expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument();
    const drafted = inspectionQueries().filter((entry) => hasStatus(entry.ops, 'draft'));
    expect(drafted.length).toBeGreaterThan(0);
    for (const entry of drafted) assertWindowQuery(entry);
    expect(drafted.at(-1)?.ops).toContainEqual({ kind: 'range', from: 0, to: 20 });

    act(() => {
      queryStore.set('status', 'all');
      queryStore.set('plant', 'hired');
    });
    await waitFor(() => expect(cardTitles().filter((title) => title === 'Hired - HIRED')).toHaveLength(5));
    expect(cardTitles()).not.toContain('PLANT-A');
    expect(cardTitles()).not.toContain('PLANT-B');
    const hired = inspectionQueries().filter((entry) => opValue(entry, 'eq', 'is_hired_plant') === true);
    expect(hired.length).toBeGreaterThan(0);
    for (const entry of hired) assertWindowQuery(entry);
    expect(hired.at(-1)?.ops).toContainEqual({ kind: 'range', from: 0, to: 20 });

    act(() => queryStore.set('plant', plantB));
    await waitFor(() => expect(cardTitles().filter((title) => title === 'PLANT-B')).toHaveLength(3));
    expect(cardTitles()).not.toContain('Hired - HIRED');
    const plantFiltered = inspectionQueries().filter((entry) => opValue(entry, 'eq', 'plant_id') === plantB);
    expect(plantFiltered.length).toBeGreaterThan(0);
    for (const entry of plantFiltered) assertWindowQuery(entry);
    expect(plantFiltered.at(-1)?.ops).toContainEqual({ kind: 'range', from: 0, to: 20 });
  });

  it('shows an empty page without a remainder', async () => {
    addInspection({
      id: uuid('inspect4', 1),
      user_id: SELF,
      status: 'draft',
      inspection_date: '2026-04-01',
      label: 'ONLY-DRAFT',
    });

    renderPage();
    await shownTitle('ONLY-DRAFT');
    fireEvent.click(screen.getByRole('button', { name: 'Submitted' }));
    expect(await screen.findByText('No plant daily checks yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument();
    expect(cardTitles()).not.toContain('ONLY-DRAFT');
    const submitted = inspectionQueries().filter((entry) => hasStatus(entry.ops, 'submitted'));
    expect(submitted.length).toBeGreaterThan(0);
    for (const entry of submitted) assertWindowQuery(entry);
  });

  it('keeps own results in the query and uses a plain label when the count is missing', async () => {
    auth.isManager = false;
    for (let index = 0; index < 12; index += 1) {
      addInspection({
        id: uuid('inspect5', index + 1),
        user_id: SELF,
        status: 'draft',
        inspection_date: isoFromOffset(12 - index),
        label: index === 11 ? 'OWN-LATE' : `OWN-${index}`,
      });
    }
    addInspection({
      id: uuid('inspect5', 90),
      user_id: OUTSIDER,
      status: 'draft',
      inspection_date: '2026-08-01',
      label: 'HIDDEN-OUTSIDER',
    });

    fixture.includeCount = false;
    renderPage();
    await shownTitle('OWN-0');
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
    await shownTitle('OWN-LATE');
    expect(cardTitles()).not.toContain('HIDDEN-OUTSIDER');
    expect(screen.queryByRole('button', { name: /Show More/ })).not.toBeInTheDocument();
  });

  it('limits team results to the directory and collapses an out-of-scope employee to self', async () => {
    auth.isManager = false;
    auth.profile = { team: { name: 'Workshop' } };
    auth.effectiveRole = { team_name: 'Workshop' };
    directory.users = [{ id: TEAMMATE, full_name: 'Team User', employee_id: null, has_module_access: true }];
    addInspection({
      id: uuid('inspect6', 1),
      user_id: SELF,
      status: 'submitted',
      inspection_date: '2026-05-02',
      label: 'SELF-PLANT',
    });
    addInspection({
      id: uuid('inspect6', 2),
      user_id: TEAMMATE,
      status: 'submitted',
      inspection_date: '2026-05-03',
      label: 'TEAM-PLANT',
    });
    addInspection({
      id: uuid('inspect6', 3),
      user_id: OUTSIDER,
      status: 'submitted',
      inspection_date: '2026-05-04',
      label: 'OUT-PLANT',
    });

    renderPage();
    await shownTitle('TEAM-PLANT');
    await shownTitle('SELF-PLANT');
    expect(cardTitles()).not.toContain('OUT-PLANT');
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
    queryStore.set('employee', OUTSIDER);
    renderPage();
    await shownTitle('SELF-PLANT');
    expect(cardTitles()).not.toContain('TEAM-PLANT');
    expect(cardTitles()).not.toContain('OUT-PLANT');
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
      status: 'draft',
      inspection_date: '2026-06-02',
      label: 'STALE-DRAFT',
    });
    addInspection({
      id: uuid('inspect7', 2),
      user_id: SELF,
      status: 'submitted',
      inspection_date: '2026-06-01',
      label: 'KEEP-SUBMITTED',
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
    await shownTitle('KEEP-SUBMITTED');
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
      status: 'submitted',
      inspection_date: '2026-07-02',
      label: 'SHOULD-NOT-USE',
    });
    addInspection({
      id: draftId,
      user_id: SELF,
      status: 'draft',
      inspection_date: '2026-07-01',
      label: 'DRAFT-HIDDEN',
    });

    renderPage();
    expect(await screen.findAllByText('Unknown Plant')).toHaveLength(2);
    expect(cardTitles()).not.toContain('SHOULD-NOT-USE');
    expect(screen.queryByText('Self User')).not.toBeInTheDocument();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Unknown Plant')[0]);
    expect(pushMock).toHaveBeenCalledWith(`/plant-inspections/${submittedId}`);
    fireEvent.click(screen.getAllByText('Unknown Plant')[1]);
    expect(pushMock).toHaveBeenCalledWith(`/plant-inspections/new?id=${draftId}`);
  });
});
