import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleUseModuleLevel, getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { DailyAllocationContext } from '@/types/daily-allocation';

export type AuthedClient = Awaited<ReturnType<typeof createClient>>;
export type AdminClient = ReturnType<typeof createAdminClient>;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EMPTY_SCOPE_ID = '00000000-0000-0000-0000-000000000000';
export const MAX_BOARD_RANGE_DAYS = 7;

type RpcErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export class DailyAllocationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'DailyAllocationError';
  }
}

export function isWorkDate(value: string | null | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed ? trimmed : null;
}

export function addIsoDateDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day + days));
  return parsed.toISOString().slice(0, 10);
}

export function enumerateInclusiveIsoDates(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = start;
  while (current <= end) {
    dates.push(current);
    current = addIsoDateDays(current, 1);
  }
  return dates;
}

export function parseDailyAllocationBoardRange(
  start: string | null | undefined,
  end: string | null | undefined
): { start: string; end: string; dates: string[] } {
  if (!isWorkDate(start) || !isWorkDate(end)) {
    throw new DailyAllocationError('A valid start and end date are required.', 400, 'VALIDATION');
  }
  if (start > end) {
    throw new DailyAllocationError('Start date must be on or before end date.', 400, 'VALIDATION');
  }
  const dates = enumerateInclusiveIsoDates(start, end);
  if (dates.length > MAX_BOARD_RANGE_DAYS) {
    throw new DailyAllocationError(
      `Date range must be ${MAX_BOARD_RANGE_DAYS} days or fewer.`,
      400,
      'VALIDATION'
    );
  }
  return { start, end, dates };
}

export function parseWithSchema<T>(schema: z.ZodType<T>, data: unknown, fallbackMessage: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new DailyAllocationError(parsed.error.issues[0]?.message || fallbackMessage, 400, 'VALIDATION');
  }
  return parsed.data;
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DailyAllocationError('Invalid JSON body.', 400, 'VALIDATION');
  }
}

export async function readOptionalJsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DailyAllocationError('Invalid JSON body.', 400, 'VALIDATION');
  }
}

export async function requireDailyAllocationUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new DailyAllocationError('Unauthorized', 401, 'UNAUTHORIZED');
  }
  return { supabase, user };
}

export async function requireDailyAllocationMutation() {
  const auth = await requireDailyAllocationUser();
  const effectiveRole = await getEffectiveRole();
  if (effectiveRole.is_viewing_as) {
    throw new DailyAllocationError(
      'Daily allocation cannot be changed while viewing as another role.',
      403,
      'VIEW_AS'
    );
  }
  return { ...auth, effectiveRole };
}

export async function requireDailyAllocationManagerMutation() {
  const auth = await requireDailyAllocationMutation();
  const canManage = await canEffectiveRoleUseModuleLevel('daily-allocation', 4);
  if (!canManage) {
    throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  }
  return auth;
}

export async function getDailyAllocationV2Runtime(): Promise<{
  board_enabled: boolean;
  writes_enabled: boolean;
}> {
  const { supabase } = await requireDailyAllocationUser();
  const accessLevel = await getEffectiveModuleAccessLevel('daily-allocation');
  if (accessLevel < 2) {
    throw new DailyAllocationError('Daily allocation access required', 403);
  }
  const rpcClient = supabase as unknown as {
    rpc: (
      name: string
    ) => Promise<{ data: unknown; error: RpcErrorLike | null }>;
  };
  const { data, error } = await rpcClient.rpc('get_daily_allocation_v2_runtime');
  if (error) {
    const message = combinedErrorText(error);
    if (error.code === '42P01' || error.code === 'PGRST202' || error.code === 'PGRST205' || message.includes('schema cache')) {
      return { board_enabled: false, writes_enabled: false };
    }
    throw mapDailyAllocationRpcError(error) || new DailyAllocationError(
      'Unable to complete daily allocation request.',
      500
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    return { board_enabled: false, writes_enabled: false };
  }
  const record = row as { board_enabled?: unknown; writes_enabled?: unknown };
  return {
    board_enabled: record.board_enabled === true,
    writes_enabled: record.writes_enabled === true,
  };
}

export async function getDailyAllocationContext(): Promise<DailyAllocationContext> {
  const { user } = await requireDailyAllocationUser();
  const accessLevel = await getEffectiveModuleAccessLevel('daily-allocation');
  if (accessLevel < 2) {
    throw new DailyAllocationError('Daily allocation access required', 403);
  }
  const effectiveRole = await getEffectiveRole();
  return {
    user_id: user.id,
    access_level: accessLevel,
    is_manager: accessLevel >= 4,
    is_admin: accessLevel >= 5,
    team_id: effectiveRole.team_id,
    team_name: effectiveRole.team_name,
  };
}

export async function requireDailyAllocationManagerContext(): Promise<DailyAllocationContext> {
  const context = await getDailyAllocationContext();
  if (!context.is_manager) {
    throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  }
  return context;
}

export async function loadScopedProfileIds(supabase: AuthedClient, isAdmin: boolean): Promise<string[]> {
  if (isAdmin) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .select('id, full_name, employee_id')
      .eq('is_placeholder', false);
    if (error) throw error;
    return (data || [])
      .filter((row) => !isHiddenSystemTestAccountProfile(row))
      .map((row) => row.id);
  }

  const { data, error } = await supabase.rpc('list_daily_allocation_scope_profile_ids');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function scopeIdsOrPlaceholder(ids: string[]): string[] {
  return ids.length ? ids : [EMPTY_SCOPE_ID];
}

function combinedErrorText(error: RpcErrorLike | null | undefined): string {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
}

export function mapDailyAllocationRpcError(
  error: RpcErrorLike | null | undefined
): DailyAllocationError | null {
  if (!error) return null;
  const message = combinedErrorText(error);
  const code = error.code || '';

  if (code === '42P01' || code === 'PGRST205' || message.includes('schema cache')) {
    return new DailyAllocationError('Daily allocation v2 is not available.', 503, 'V2_DISABLED');
  }
  if (message.includes('V2_DISABLED')) {
    return new DailyAllocationError('Daily allocation v2 writes are disabled.', 503, 'V2_DISABLED');
  }
  if (message.includes('Unauthorized')) {
    return new DailyAllocationError('Unauthorized', 401, 'UNAUTHORIZED');
  }
  if (message.includes('viewing as another role') || message.includes('cannot be changed while viewing')) {
    return new DailyAllocationError(
      'Daily allocation cannot be changed while viewing as another role.',
      403,
      'VIEW_AS'
    );
  }
  if (message.includes('STALE_PLAN_VERSION')) {
    return new DailyAllocationError(
      'This plan was updated by someone else. Reload and try again.',
      409,
      'STALE_PLAN_VERSION'
    );
  }
  if (message.includes('STALE_ENTITY_VERSION')) {
    return new DailyAllocationError(
      'This visit was updated by someone else. Reload and try again.',
      409,
      'STALE_ENTITY_VERSION'
    );
  }
  if (message.includes('STALE_DRAFT_VERSION')) {
    return new DailyAllocationError(
      'This allocation was updated by someone else. Reload and try again.',
      409,
      'STALE_DRAFT_VERSION'
    );
  }
  if (message.includes('HARD_CONFLICT')) {
    return new DailyAllocationError(
      'This assignment conflicts with absence or shift rules.',
      409,
      'HARD_CONFLICT'
    );
  }
  if (message.includes('PLANT_JOB_CONFLICT')) {
    return new DailyAllocationError(
      'That plant is already allocated to a different job on this date.',
      409,
      'PLANT_JOB_CONFLICT'
    );
  }
  if (message.includes('IDEMPOTENCY_CONFLICT')) {
    return new DailyAllocationError(
      'That publish request conflicts with an existing publication.',
      409,
      'IDEMPOTENCY_CONFLICT'
    );
  }
  if (message.includes('CONFIRM_UNALLOCATED_REQUIRED')) {
    return new DailyAllocationError(
      'Confirm that available employees can remain unallocated before publishing.',
      409,
      'CONFIRM_UNALLOCATED_REQUIRED'
    );
  }
  if (message.includes('V1_WRITES_DISABLED')) {
    return new DailyAllocationError(
      'This team/date has been converted. Use the timed board instead.',
      409,
      'V1_WRITES_DISABLED'
    );
  }
  if (code === '23P01' || /exclusion constraint/i.test(message)) {
    return new DailyAllocationError('That assignment overlaps an existing timed interval.', 409, 'OVERLAP');
  }
  if (code === '23505') {
    return new DailyAllocationError('That plant is already allocated on this date.', 409, 'PLANT_CONFLICT');
  }
  if (message.includes('JOB_AMBIGUOUS')) {
    return new DailyAllocationError('That job code matches more than one unrelated source.', 400, 'JOB_AMBIGUOUS');
  }
  if (message.includes('JOB_MISSING_SITE')) {
    return new DailyAllocationError(
      'This job cannot be allocated until its source record has a proper site address.',
      400,
      'JOB_MISSING_SITE'
    );
  }
  if (message.includes('JOB_NOT_FOUND') || message.includes('JOB_REQUIRED')) {
    return new DailyAllocationError('Choose a catalogue job with a valid site address.', 400, 'JOB_NOT_FOUND');
  }
  if (message.includes('PUBLISH_INCOMPLETE')) {
    return new DailyAllocationError(
      'Every available employee needs a job before this date can be published.',
      400,
      'PUBLISH_INCOMPLETE'
    );
  }
  if (message.includes('Invalid visit interval')) {
    return new DailyAllocationError(
      'Visit times must land on 30-minute London boundaries, stay on one day, and last at least 30 minutes.',
      400,
      'INVALID_INTERVAL'
    );
  }
  if (message.includes('Idempotency key is required')) {
    return new DailyAllocationError('Idempotency key is required.', 400, 'VALIDATION');
  }
  if (message.includes('Override evidence is required') || message.includes('Override subject is required')) {
    return new DailyAllocationError(message.includes('subject') ? 'Override subject is required.' : 'Override evidence is required.', 400, 'VALIDATION');
  }
  if (message.includes('Off-shift override requires a visit')) {
    return new DailyAllocationError('Off-shift override requires a visit.', 400, 'VALIDATION');
  }
  if (
    message.includes('Plan day not found')
    || message.includes('Visit not found')
    || message.includes('Labour assignment not found')
    || message.includes('Plant assignment not found')
  ) {
    return new DailyAllocationError(message, 404, 'NOT_FOUND');
  }
  if (message.includes('Not allowed') || message.includes('Manager-level daily allocation')) {
    return new DailyAllocationError(message, 403, 'FORBIDDEN');
  }
  return null;
}

export function mapPostgresError(error: RpcErrorLike | null | undefined): DailyAllocationError | null {
  return mapDailyAllocationRpcError(error);
}

export async function callDailyAllocationRpc<T>(
  supabase: AuthedClient,
  fn: string,
  args: Record<string, unknown>
): Promise<T> {
  const rpcClient = supabase as unknown as {
    rpc: (
      name: string,
      params: Record<string, unknown>
    ) => Promise<{ data: T | null; error: RpcErrorLike | null }>;
  };
  const { data, error } = await rpcClient.rpc(fn, args);
  if (error) {
    throw mapDailyAllocationRpcError(error) || new DailyAllocationError(
      'Unable to complete daily allocation request.',
      500
    );
  }
  if (data == null) {
    throw new DailyAllocationError('Unable to complete daily allocation request.', 500);
  }
  return data;
}

export type UntypedFilterQuery<T> = {
  select: (columns: string) => UntypedFilterQuery<T>;
  eq: (column: string, value: string | number | boolean) => UntypedFilterQuery<T>;
  in: (column: string, values: string[]) => UntypedFilterQuery<T>;
  gte: (column: string, value: string) => UntypedFilterQuery<T>;
  lte: (column: string, value: string) => UntypedFilterQuery<T>;
  or: (filters: string) => UntypedFilterQuery<T>;
  order: (
    column: string,
    options?: { ascending?: boolean }
  ) => UntypedFilterQuery<T> & PromiseLike<{ data: T[] | null; error: RpcErrorLike | null }>;
  maybeSingle: () => PromiseLike<{ data: T | null; error: RpcErrorLike | null }>;
  then: Promise<{ data: T[] | null; error: RpcErrorLike | null }>['then'];
};

export function fromUntyped<T>(client: AuthedClient | AdminClient, table: string): UntypedFilterQuery<T> {
  return (client as unknown as { from: (name: string) => UntypedFilterQuery<T> }).from(table);
}

export function jsonDailyAllocationError(error: unknown): { error: string; code?: string; status: number } {
  if (error instanceof DailyAllocationError) {
    return { error: error.message, code: error.code, status: error.status };
  }
  const mapped = mapDailyAllocationRpcError(error as RpcErrorLike);
  if (mapped) {
    return { error: mapped.message, code: mapped.code, status: mapped.status };
  }
  return { error: 'Unable to complete daily allocation request.', status: 500 };
}

export async function runDailyAllocationRoute(
  request: NextRequest,
  componentName: string,
  endpoint: string,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof DailyAllocationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    await logServerError({
      error: error as Error,
      request,
      componentName,
      additionalData: { endpoint },
    });
    const mapped = jsonDailyAllocationError(error);
    return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
}
