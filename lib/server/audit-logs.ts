import { createAdminClient } from '@/lib/supabase/admin';
import { requireDebugConsoleAccess } from '@/lib/server/debug-console-access';
import type { AuditLogEntry } from '@/app/(dashboard)/debug/types';

export const AUDIT_LOG_PAGE_SIZE = 200;
export const AUDIT_LOG_SEARCH_MIN_LENGTH = 3;

export type AuditTimeWindow = 'all' | '24h' | '7d' | '30d' | '90d';
export type AuditChangeFilter = 'all' | 'with_changes' | 'without_changes';

export interface AuditLogListFilters {
  q?: string;
  userId?: string;
  teamId?: string;
  table?: string;
  action?: string;
  timeWindow?: AuditTimeWindow;
  changeFilter?: AuditChangeFilter;
  cursor?: string | null;
  limit?: number;
}

export interface AuditLogCursor {
  createdAt: string;
  id: string;
}

export interface AuditLogFacets {
  users: Array<{ id: string; label: string }>;
  hasSystemEntry: boolean;
  tables: string[];
  actions: Array<{ value: string; label: string }>;
}

export interface AuditLogListResult {
  logs: AuditLogEntry[];
  pagination: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  };
  facets: AuditLogFacets | null;
  searchApplied: boolean;
}

export class AuditLogQueryError extends Error {
  constructor(
    message: string,
    readonly code: 'SEARCH_TOO_BROAD' | 'INVALID_CURSOR' | 'QUERY_FAILED' = 'QUERY_FAILED'
  ) {
    super(message);
    this.name = 'AuditLogQueryError';
  }
}

const TIME_WINDOW_MS: Record<Exclude<AuditTimeWindow, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const KNOWN_AUDIT_TABLES = [
  'timesheets',
  'timesheet_entries',
  'absences',
  'profiles',
  'vehicles',
  'vans',
  'hgvs',
  'vehicle_inspections',
  'hgv_inspections',
  'plant_inspections',
  'inspection_items',
  'vehicle_maintenance',
  'rams_documents',
  'workshop_tasks',
];

const KNOWN_AUDIT_ACTIONS = ['created', 'updated', 'deleted', 'submitted', 'approved', 'rejected'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireAuditLogAdminAccess() {
  return requireDebugConsoleAccess();
}

export function clampAuditLogLimit(limit: unknown): number {
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    return Math.min(Math.max(Math.trunc(limit), 1), AUDIT_LOG_PAGE_SIZE);
  }
  if (typeof limit === 'string' && limit.trim()) {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, 1), AUDIT_LOG_PAGE_SIZE);
    }
  }
  return AUDIT_LOG_PAGE_SIZE;
}

export function normalizeAuditLogSearch(q: string | null | undefined): string | null {
  const trimmed = (q ?? '').trim();
  if (trimmed.length < AUDIT_LOG_SEARCH_MIN_LENGTH) {
    return null;
  }
  return trimmed;
}

export function shouldScanAuditLogChanges(q: string | null): boolean {
  return Boolean(q && q.length >= AUDIT_LOG_SEARCH_MIN_LENGTH);
}

export function getAuditLogTimeWindowStart(
  timeWindow: AuditTimeWindow | undefined,
  nowMs = Date.now()
): string | null {
  if (!timeWindow || timeWindow === 'all') {
    return null;
  }
  return new Date(nowMs - TIME_WINDOW_MS[timeWindow]).toISOString();
}

export function encodeAuditLogCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

export function decodeAuditLogCursor(raw: string | null | undefined): AuditLogCursor | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function escapePostgrestOrValue(value: string): string {
  return value.replace(/[,()]/g, ' ').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function buildAuditLogSearchOrFilter(
  q: string,
  matchingUserIds: string[]
): string {
  const escaped = escapePostgrestOrValue(q);
  const clauses = [
    `table_name.ilike.%${escaped}%`,
    `action.ilike.%${escaped}%`,
    `record_id::text.ilike.%${escaped}%`,
  ];
  if (shouldScanAuditLogChanges(q)) {
    clauses.push(`changes::text.ilike.%${escaped}%`);
  }
  if (isUuid(q)) {
    clauses.push(`record_id.eq.${q}`);
  }
  if (matchingUserIds.length > 0) {
    clauses.push(`user_id.in.(${matchingUserIds.join(',')})`);
  }
  return clauses.join(',');
}

export function describeAuditLogFilters(filters: AuditLogListFilters): string[] {
  const applied: string[] = [];
  if (normalizeAuditLogSearch(filters.q)) applied.push('q');
  if (filters.userId && filters.userId !== 'all') applied.push('userId');
  if (filters.teamId && filters.teamId !== 'all') applied.push('teamId');
  if (filters.table && filters.table !== 'all') applied.push('table');
  if (filters.action && filters.action !== 'all') applied.push('action');
  if (filters.timeWindow && filters.timeWindow !== 'all') applied.push('timeWindow');
  if (filters.changeFilter && filters.changeFilter !== 'all') applied.push('changeFilter');
  return applied;
}

function mapAuditRow(
  row: {
    id: string;
    table_name: string;
    record_id: string;
    user_id: string | null;
    action: string;
    changes: unknown;
    created_at: string | null;
  },
  profileById: Map<string, { full_name: string | null; team_id: string | null }>
): AuditLogEntry {
  const profile = row.user_id ? profileById.get(row.user_id) : undefined;
  return {
    id: row.id,
    table_name: row.table_name,
    record_id: row.record_id,
    user_id: row.user_id,
    user_name: profile?.full_name || 'System',
    team_id: profile?.team_id || null,
    action: row.action,
    changes: (row.changes as AuditLogEntry['changes']) || null,
    created_at: row.created_at,
  };
}

async function loadProfilesById(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, { full_name: string | null; team_id: string | null }>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, team_id')
    .in('id', uniqueIds);

  if (error) {
    throw new AuditLogQueryError(error.message);
  }

  return new Map(
    (data || []).map((profile) => [
      profile.id,
      { full_name: profile.full_name, team_id: profile.team_id },
    ])
  );
}

async function findMatchingUserIds(
  admin: ReturnType<typeof createAdminClient>,
  q: string
): Promise<string[]> {
  const pattern = `%${escapeIlikePattern(q)}%`;
  const [nameResult, teamResult] = await Promise.all([
    admin.from('profiles').select('id').ilike('full_name', pattern),
    admin.from('org_teams').select('id').ilike('name', pattern),
  ]);

  if (nameResult.error) {
    throw new AuditLogQueryError(nameResult.error.message);
  }
  if (teamResult.error) {
    throw new AuditLogQueryError(teamResult.error.message);
  }

  const userIds = new Set((nameResult.data || []).map((row) => row.id));
  const teamIds = (teamResult.data || []).map((row) => row.id);

  if (teamIds.length > 0) {
    const { data, error } = await admin.from('profiles').select('id').in('team_id', teamIds);
    if (error) {
      throw new AuditLogQueryError(error.message);
    }
    for (const row of data || []) {
      userIds.add(row.id);
    }
  }

  return [...userIds];
}

async function findUserIdsForTeam(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string
): Promise<string[]> {
  let query = admin.from('profiles').select('id');
  query = teamId === 'unassigned' ? query.is('team_id', null) : query.eq('team_id', teamId);
  const { data, error } = await query;
  if (error) {
    throw new AuditLogQueryError(error.message);
  }
  return (data || []).map((row) => row.id);
}

export async function listAuditLogFacets(): Promise<AuditLogFacets> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, team_id')
    .eq('is_placeholder', false)
    .order('full_name', { ascending: true });

  if (error) {
    throw new AuditLogQueryError(error.message);
  }

  const users = (data || [])
    .filter((profile) => profile.id && profile.full_name)
    .map((profile) => ({ id: profile.id, label: profile.full_name }));

  return {
    users,
    hasSystemEntry: true,
    tables: [...KNOWN_AUDIT_TABLES],
    actions: KNOWN_AUDIT_ACTIONS.map((action) => ({
      value: action,
      label: action.toUpperCase(),
    })),
  };
}

export async function listAuditLogs(
  filters: AuditLogListFilters,
  options: { includeFacets?: boolean } = {}
): Promise<AuditLogListResult> {
  const admin = createAdminClient();
  const limit = clampAuditLogLimit(filters.limit);
  const search = normalizeAuditLogSearch(filters.q);
  const cursor = filters.cursor ? decodeAuditLogCursor(filters.cursor) : null;
  if (filters.cursor && !cursor) {
    throw new AuditLogQueryError('Invalid audit log cursor', 'INVALID_CURSOR');
  }

  let matchingUserIds: string[] = [];
  if (search) {
    matchingUserIds = await findMatchingUserIds(admin, search);
  }

  let teamUserIds: string[] | null = null;
  if (filters.teamId && filters.teamId !== 'all') {
    teamUserIds = await findUserIdsForTeam(admin, filters.teamId);
  }

  let query = admin
    .from('audit_log')
    .select('id, table_name, record_id, user_id, action, changes, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (filters.userId && filters.userId !== 'all') {
    query = filters.userId === 'system' ? query.is('user_id', null) : query.eq('user_id', filters.userId);
  }

  if (teamUserIds) {
    if (filters.teamId === 'unassigned') {
      query = query.or(`user_id.is.null,user_id.in.(${teamUserIds.join(',') || '00000000-0000-0000-0000-000000000000'})`);
    } else if (teamUserIds.length === 0) {
      return {
        logs: [],
        pagination: { limit, has_more: false, next_cursor: null },
        facets: options.includeFacets ? await listAuditLogFacets() : null,
        searchApplied: Boolean(search),
      };
    } else {
      query = query.in('user_id', teamUserIds);
    }
  }

  if (filters.table && filters.table !== 'all') {
    query = query.eq('table_name', filters.table);
  }

  if (filters.action && filters.action !== 'all') {
    query = query.ilike('action', filters.action);
  }

  const windowStart = getAuditLogTimeWindowStart(filters.timeWindow);
  if (windowStart) {
    query = query.gte('created_at', windowStart);
  }

  if (filters.changeFilter === 'with_changes') {
    query = query.not('changes', 'is', null).neq('changes', '{}');
  } else if (filters.changeFilter === 'without_changes') {
    query = query.or('changes.is.null,changes.eq.{}');
  }

  if (search) {
    query = query.or(buildAuditLogSearchOrFilter(search, matchingUserIds));
  }

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const { data, error } = await query;
  if (error) {
    const message = error.message || 'Failed to load audit logs';
    if (/statement timeout|canceling statement|timeout/i.test(message)) {
      throw new AuditLogQueryError(
        'Refine the filter. The search matched too many audit entries to load safely.',
        'SEARCH_TOO_BROAD'
      );
    }
    throw new AuditLogQueryError(message);
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const profileById = await loadProfilesById(
    admin,
    pageRows.map((row) => row.user_id).filter((id): id is string => Boolean(id))
  );
  const logs = pageRows.map((row) => mapAuditRow(row, profileById));
  const last = logs[logs.length - 1];

  return {
    logs,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last?.created_at ? encodeAuditLogCursor(last.created_at, last.id) : null,
    },
    facets: options.includeFacets ? await listAuditLogFacets() : null,
    searchApplied: Boolean(search),
  };
}
