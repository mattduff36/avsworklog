import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  detectUsageDeviceType,
  getUsageModuleFromPath,
  getUserUsageEventCategory,
  isUserUsageEventName,
  normalizeUsagePath,
  parseBrowserName,
  parseOsName,
  sanitizeAnalyticsMetadata,
  type UsageDeviceContext,
  type UserUsageEventCategory,
  type UserUsageEventName,
  type UserUsageEventSource,
} from '@/lib/analytics/events';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';
import { getEffectiveRole } from '@/lib/utils/view-as';

const MAX_BATCH_SIZE = 50;
const MAX_TEXT_LENGTH = 300;
const MAX_USER_AGENT_LENGTH = 2_048;
const ACTIVE_SESSION_WINDOW_MINUTES = 5;

interface CurrentProfileContext {
  profile: {
    id: string;
    email?: string | null;
  };
  validation?: {
    session?: {
      id: string;
    } | null;
  };
}

interface ClientUsageEventPayload {
  eventName?: unknown;
  eventCategory?: unknown;
  clientEventId?: unknown;
  clientSessionId?: unknown;
  occurredAt?: unknown;
  path?: unknown;
  referrerPath?: unknown;
  durationMs?: unknown;
  relatedRecordType?: unknown;
  relatedRecordId?: unknown;
  errorLogId?: unknown;
  metadata?: unknown;
}

export interface ClientUsageEventsPayload {
  clientSessionId?: unknown;
  device?: Partial<UsageDeviceContext> | null;
  events?: unknown;
}

export interface TrackServerUsageEventOptions {
  eventName: UserUsageEventName;
  userId?: string | null;
  appSessionId?: string | null;
  request?: Request | null;
  path?: string | null;
  referrerPath?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
  relatedRecordType?: string | null;
  relatedRecordId?: string | null;
  errorLogId?: string | null;
}

interface NormalizedUsageEvent {
  event_name: UserUsageEventName;
  event_category: UserUsageEventCategory;
  client_event_id: string | null;
  client_session_id: string | null;
  occurred_at: string;
  event_source: UserUsageEventSource;
  module: string | null;
  path: string | null;
  normalized_path: string | null;
  referrer_path: string | null;
  duration_ms: number | null;
  related_record_type: string | null;
  related_record_id: string | null;
  error_log_id: string | null;
  metadata: Record<string, unknown>;
}

export interface UsageAnalyticsSummary {
  totalEvents: number;
  uniqueUsers: number;
  sessionCount: number;
  pageViews: number;
  errorEvents: number;
  activeSessions: number;
  avgDurationMs: number | null;
}

export interface UsageAnalyticsDebugPayload {
  success: true;
  generatedAt: string;
  range: {
    start: string;
    end: string;
  };
  summary: UsageAnalyticsSummary;
  topModules: Array<{ module: string; events: number; users: number }>;
  topPages: Array<{ path: string; views: number; users: number }>;
  topEvents: Array<{ eventName: string; events: number; users: number }>;
  activeSessions: Array<{
    id: string;
    userId: string | null;
    userName: string;
    teamName: string | null;
    roleName: string | null;
    lastSeenAt: string;
    entryPath: string | null;
    exitPath: string | null;
    deviceType: string | null;
    browserName: string | null;
    eventCount: number;
    pageViewCount: number;
  }>;
  recentEvents: Array<{
    id: string;
    occurredAt: string;
    eventName: string;
    eventCategory: string;
    module: string | null;
    path: string | null;
    userId: string | null;
    userName: string;
    teamName: string | null;
    roleName: string | null;
    deviceType: string | null;
    sessionId: string | null;
    metadata: Record<string, unknown>;
  }>;
}

export interface DebugAnalyticsAccessResult {
  ok: boolean;
  status: number;
  error: string | null;
}

function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function normalizeDeviceContext(device: Partial<UsageDeviceContext> | null | undefined, request?: Request | null): UsageDeviceContext {
  const fallbackUserAgent = request?.headers.get('user-agent') || null;
  const userAgent = normalizeText(device?.userAgent, MAX_USER_AGENT_LENGTH) || fallbackUserAgent;
  const browser = parseBrowserName(userAgent);
  const viewportWidth = normalizeNumber(device?.viewportWidth);
  const viewportHeight = normalizeNumber(device?.viewportHeight);

  return {
    userAgent,
    browserName: normalizeText(device?.browserName, 80) || browser.name,
    browserVersion: normalizeText(device?.browserVersion, 80) || browser.version,
    osName: normalizeText(device?.osName, 80) || parseOsName(userAgent),
    deviceType: device?.deviceType || detectUsageDeviceType(userAgent),
    viewportWidth,
    viewportHeight,
    locale: normalizeText(device?.locale, 40),
    timezone: normalizeText(device?.timezone, 80),
  };
}

function normalizeClientUsageEvent(payload: ClientUsageEventPayload, fallbackClientSessionId: string | null): NormalizedUsageEvent | null {
  if (!isUserUsageEventName(payload.eventName)) {
    return null;
  }

  const path = normalizeText(payload.path, 1_000);
  const normalizedPath = normalizeUsagePath(path);
  const eventCategory =
    typeof payload.eventCategory === 'string'
      ? (payload.eventCategory as UserUsageEventCategory)
      : getUserUsageEventCategory(payload.eventName);

  return {
    event_name: payload.eventName,
    event_category: ['session', 'navigation', 'auth', 'error', 'performance'].includes(eventCategory)
      ? eventCategory
      : getUserUsageEventCategory(payload.eventName),
    client_event_id: normalizeText(payload.clientEventId, 120),
    client_session_id: normalizeText(payload.clientSessionId, 120) || fallbackClientSessionId,
    occurred_at: normalizeTimestamp(payload.occurredAt),
    event_source: 'client',
    module: getUsageModuleFromPath(normalizedPath),
    path: path ? path.slice(0, 1_000) : normalizedPath,
    normalized_path: normalizedPath,
    referrer_path: normalizeUsagePath(normalizeText(payload.referrerPath, 1_000)),
    duration_ms: normalizeNumber(payload.durationMs),
    related_record_type: normalizeText(payload.relatedRecordType, 80),
    related_record_id: normalizeText(payload.relatedRecordId, 120),
    error_log_id: normalizeText(payload.errorLogId, 80),
    metadata: sanitizeAnalyticsMetadata(payload.metadata || {}),
  };
}

async function getUsageSessionId({
  admin,
  current,
  clientSessionId,
  appSessionId,
  device,
  events,
}: {
  admin: ReturnType<typeof createAdminClient>;
  current: CurrentProfileContext;
  clientSessionId: string | null;
  appSessionId: string | null;
  device: UsageDeviceContext;
  events: NormalizedUsageEvent[];
}): Promise<string | null> {
  if (!clientSessionId) return null;

  const firstEvent = events[0] || null;
  const lastEvent = events[events.length - 1] || firstEvent;
  const pageViewCount = events.filter((event) => event.event_name === 'page_view').length;
  const heartbeatCount = events.filter((event) => event.event_name === 'session_heartbeat').length;

  const { data: existing, error: selectError } = await admin
    .from('user_usage_sessions')
    .select('id, event_count, page_view_count, heartbeat_count')
    .eq('client_session_id', clientSessionId)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }

  if (existing?.id) {
    const currentEventCount = typeof existing.event_count === 'number' ? existing.event_count : 0;
    const currentPageViewCount = typeof existing.page_view_count === 'number' ? existing.page_view_count : 0;
    const currentHeartbeatCount = typeof existing.heartbeat_count === 'number' ? existing.heartbeat_count : 0;

    const { error: updateError } = await admin
      .from('user_usage_sessions')
      .update({
        user_id: current.profile.id,
        app_session_id: appSessionId,
        last_seen_at: lastEvent?.occurred_at || new Date().toISOString(),
        exit_path: lastEvent?.normalized_path || lastEvent?.path || null,
        user_agent: device.userAgent,
        browser_name: device.browserName,
        browser_version: device.browserVersion,
        os_name: device.osName,
        device_type: device.deviceType,
        viewport_width: device.viewportWidth,
        viewport_height: device.viewportHeight,
        locale: device.locale,
        timezone: device.timezone,
        event_count: currentEventCount + events.length,
        page_view_count: currentPageViewCount + pageViewCount,
        heartbeat_count: currentHeartbeatCount + heartbeatCount,
      })
      .eq('id', existing.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return existing.id as string;
  }

  const { data: created, error: insertError } = await admin
    .from('user_usage_sessions')
    .insert({
      user_id: current.profile.id,
      app_session_id: appSessionId,
      client_session_id: clientSessionId,
      first_seen_at: firstEvent?.occurred_at || new Date().toISOString(),
      last_seen_at: lastEvent?.occurred_at || new Date().toISOString(),
      entry_path: firstEvent?.normalized_path || firstEvent?.path || null,
      exit_path: lastEvent?.normalized_path || lastEvent?.path || null,
      referrer_path: firstEvent?.referrer_path || null,
      user_agent: device.userAgent,
      browser_name: device.browserName,
      browser_version: device.browserVersion,
      os_name: device.osName,
      device_type: device.deviceType,
      viewport_width: device.viewportWidth,
      viewport_height: device.viewportHeight,
      locale: device.locale,
      timezone: device.timezone,
      event_count: events.length,
      page_view_count: pageViewCount,
      heartbeat_count: heartbeatCount,
    })
    .select('id')
    .single();

  if (insertError || !created?.id) {
    throw new Error(insertError?.message || 'Failed to create usage session');
  }

  return created.id as string;
}

export async function insertClientUsageEvents({
  request,
  current,
  payload,
}: {
  request: Request;
  current: CurrentProfileContext;
  payload: ClientUsageEventsPayload;
}): Promise<number> {
  const fallbackClientSessionId = normalizeText(payload.clientSessionId, 120);
  const rawEvents = Array.isArray(payload.events) ? payload.events : [];
  const events = rawEvents
    .slice(0, MAX_BATCH_SIZE)
    .map((entry) => normalizeClientUsageEvent((entry || {}) as ClientUsageEventPayload, fallbackClientSessionId))
    .filter((entry): entry is NormalizedUsageEvent => entry !== null);

  if (events.length === 0) return 0;

  const admin = createAdminClient();
  const appSessionId = current.validation?.session?.id || null;
  const device = normalizeDeviceContext(payload.device || null, request);
  const sessionId = await getUsageSessionId({
    admin,
    current,
    clientSessionId: events[0]?.client_session_id || fallbackClientSessionId,
    appSessionId,
    device,
    events,
  });

  const rows = events.map((event) => ({
    session_id: sessionId,
    user_id: current.profile.id,
    app_session_id: appSessionId,
    client_session_id: event.client_session_id,
    client_event_id: event.client_event_id,
    occurred_at: event.occurred_at,
    event_name: event.event_name,
    event_category: event.event_category,
    module: event.module,
    path: event.path,
    normalized_path: event.normalized_path,
    referrer_path: event.referrer_path,
    event_source: event.event_source,
    duration_ms: event.duration_ms,
    related_record_type: event.related_record_type,
    related_record_id: event.related_record_id,
    error_log_id: event.error_log_id,
    metadata: event.metadata,
  }));

  const { error } = await admin
    .from('user_usage_events')
    .upsert(rows, {
      onConflict: 'client_event_id',
      ignoreDuplicates: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  return rows.length;
}

export async function trackServerUsageEvent(options: TrackServerUsageEventOptions): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  try {
    const admin = createAdminClient();
    const userAgent = options.request?.headers.get('user-agent') || null;
    const referer = options.request?.headers.get('referer') || null;
    const requestUrl = options.request ? new URL(options.request.url) : null;
    const path = normalizeUsagePath(options.path || requestUrl?.pathname || null);

    const { error } = await admin.from('user_usage_events').insert({
      user_id: options.userId || null,
      app_session_id: options.appSessionId || null,
      occurred_at: new Date().toISOString(),
      event_name: options.eventName,
      event_category: getUserUsageEventCategory(options.eventName),
      module: getUsageModuleFromPath(path),
      path,
      normalized_path: path,
      referrer_path: normalizeUsagePath(options.referrerPath || referer),
      event_source: 'server',
      duration_ms: options.durationMs ?? null,
      related_record_type: options.relatedRecordType || null,
      related_record_id: options.relatedRecordId || null,
      error_log_id: options.errorLogId || null,
      metadata: sanitizeAnalyticsMetadata({
        ...options.metadata,
        userAgent,
        deviceType: detectUsageDeviceType(userAgent),
        osName: parseOsName(userAgent),
        browserName: parseBrowserName(userAgent).name,
      }),
    });

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    console.warn('[User Analytics] Failed to track server event:', error);
  }
}

export async function requireDebugAnalyticsAccess(): Promise<DebugAnalyticsAccessResult> {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return {
      ok: false,
      status: 401,
      error: 'Unauthorized',
    };
  }

  const effectiveRole = await getEffectiveRole();
  if (!canAccessDebugConsole({
    email: current.profile.email,
    isActualSuperAdmin: effectiveRole.is_actual_super_admin,
    isViewingAs: effectiveRole.is_viewing_as,
  })) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden',
    };
  }

  return {
    ok: true,
    status: 200,
    error: null,
  };
}

function getSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function addAggregate<K extends string>(
  map: Map<K, { label: K; events: number; users: Set<string> }>,
  key: K,
  userId: string | null
) {
  const current = map.get(key) || { label: key, events: 0, users: new Set<string>() };
  current.events += 1;
  if (userId) current.users.add(userId);
  map.set(key, current);
}

function sortAggregates<T extends { events: number }>(items: T[], limit: number): T[] {
  return items.sort((a, b) => b.events - a.events).slice(0, limit);
}

export async function getUserAnalyticsDebugPayload(params: URLSearchParams): Promise<UsageAnalyticsDebugPayload> {
  const range = params.get('range') || '7d';
  const rangeDays = range === '24h' ? 1 : range === '30d' ? 30 : range === '90d' ? 90 : 7;
  const end = new Date();
  const start = new Date(end.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const moduleFilter = normalizeText(params.get('module'), 80);
  const eventFilter = normalizeText(params.get('event'), 80);
  const userFilter = normalizeText(params.get('userId'), 80);

  const admin = createAdminClient();
  let eventQuery = admin
    .from('user_usage_events')
    .select(`
      id,
      occurred_at,
      event_name,
      event_category,
      module,
      path,
      normalized_path,
      user_id,
      session_id,
      duration_ms,
      metadata,
      profile:profiles!user_usage_events_user_id_fkey(
        full_name,
        team:org_teams!profiles_team_id_fkey(name),
        role:roles(display_name)
      ),
      session:user_usage_sessions(device_type)
    `)
    .gte('occurred_at', start.toISOString())
    .lte('occurred_at', end.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(1000);

  if (moduleFilter && moduleFilter !== 'all') {
    eventQuery = eventQuery.eq('module', moduleFilter);
  }
  if (eventFilter && eventFilter !== 'all') {
    eventQuery = eventQuery.eq('event_name', eventFilter);
  }
  if (userFilter && userFilter !== 'all') {
    eventQuery = eventQuery.eq('user_id', userFilter);
  }

  const activeSince = new Date(Date.now() - ACTIVE_SESSION_WINDOW_MINUTES * 60 * 1000).toISOString();
  const [eventsResult, sessionsResult] = await Promise.all([
    eventQuery,
    admin
      .from('user_usage_sessions')
      .select(`
        id,
        user_id,
        last_seen_at,
        entry_path,
        exit_path,
        device_type,
        browser_name,
        event_count,
        page_view_count,
        profile:profiles!user_usage_sessions_user_id_fkey(
          full_name,
          team:org_teams!profiles_team_id_fkey(name),
          role:roles(display_name)
        )
      `)
      .gte('last_seen_at', activeSince)
      .order('last_seen_at', { ascending: false })
      .limit(25),
  ]);

  if (eventsResult.error) {
    throw new Error(eventsResult.error.message);
  }
  if (sessionsResult.error) {
    throw new Error(sessionsResult.error.message);
  }

  const rawEvents = (eventsResult.data || []) as Array<Record<string, unknown>>;
  const rawSessions = (sessionsResult.data || []) as Array<Record<string, unknown>>;
  const uniqueUsers = new Set<string>();
  const uniqueSessions = new Set<string>();
  const moduleMap = new Map<string, { label: string; events: number; users: Set<string> }>();
  const pageMap = new Map<string, { label: string; events: number; users: Set<string> }>();
  const eventMap = new Map<string, { label: string; events: number; users: Set<string> }>();
  let durationTotal = 0;
  let durationCount = 0;

  for (const event of rawEvents) {
    const userId = typeof event.user_id === 'string' ? event.user_id : null;
    const sessionId = typeof event.session_id === 'string' ? event.session_id : null;
    if (userId) uniqueUsers.add(userId);
    if (sessionId) uniqueSessions.add(sessionId);

    const durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : null;
    if (durationMs !== null) {
      durationTotal += durationMs;
      durationCount += 1;
    }

    addAggregate(moduleMap, (typeof event.module === 'string' && event.module) || 'unknown', userId);
    addAggregate(eventMap, (typeof event.event_name === 'string' && event.event_name) || 'unknown', userId);
    if (event.event_name === 'page_view') {
      addAggregate(pageMap, (typeof event.normalized_path === 'string' && event.normalized_path) || 'unknown', userId);
    }
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    summary: {
      totalEvents: rawEvents.length,
      uniqueUsers: uniqueUsers.size,
      sessionCount: uniqueSessions.size,
      pageViews: rawEvents.filter((event) => event.event_name === 'page_view').length,
      errorEvents: rawEvents.filter((event) => event.event_category === 'error').length,
      activeSessions: rawSessions.length,
      avgDurationMs: durationCount > 0 ? Math.round(durationTotal / durationCount) : null,
    },
    topModules: sortAggregates(
      Array.from(moduleMap.values()).map((entry) => ({
        module: entry.label,
        events: entry.events,
        users: entry.users.size,
      })),
      10
    ),
    topPages: sortAggregates(
      Array.from(pageMap.values()).map((entry) => ({
        path: entry.label,
        views: entry.events,
        users: entry.users.size,
        events: entry.events,
      })),
      10
    ).map(({ path, views, users }) => ({ path, views, users })),
    topEvents: sortAggregates(
      Array.from(eventMap.values()).map((entry) => ({
        eventName: entry.label,
        events: entry.events,
        users: entry.users.size,
      })),
      10
    ),
    activeSessions: rawSessions.map((session) => {
      const profile = getSingle(session.profile as Record<string, unknown> | Record<string, unknown>[] | null);
      const team = getSingle(profile?.team as Record<string, unknown> | Record<string, unknown>[] | null);
      const role = getSingle(profile?.role as Record<string, unknown> | Record<string, unknown>[] | null);
      return {
        id: String(session.id || ''),
        userId: typeof session.user_id === 'string' ? session.user_id : null,
        userName: typeof profile?.full_name === 'string' ? profile.full_name : 'Unknown User',
        teamName: typeof team?.name === 'string' ? team.name : null,
        roleName: typeof role?.display_name === 'string' ? role.display_name : null,
        lastSeenAt: String(session.last_seen_at || ''),
        entryPath: typeof session.entry_path === 'string' ? session.entry_path : null,
        exitPath: typeof session.exit_path === 'string' ? session.exit_path : null,
        deviceType: typeof session.device_type === 'string' ? session.device_type : null,
        browserName: typeof session.browser_name === 'string' ? session.browser_name : null,
        eventCount: typeof session.event_count === 'number' ? session.event_count : 0,
        pageViewCount: typeof session.page_view_count === 'number' ? session.page_view_count : 0,
      };
    }),
    recentEvents: rawEvents.slice(0, 100).map((event) => {
      const profile = getSingle(event.profile as Record<string, unknown> | Record<string, unknown>[] | null);
      const team = getSingle(profile?.team as Record<string, unknown> | Record<string, unknown>[] | null);
      const role = getSingle(profile?.role as Record<string, unknown> | Record<string, unknown>[] | null);
      const session = getSingle(event.session as Record<string, unknown> | Record<string, unknown>[] | null);
      return {
        id: String(event.id || ''),
        occurredAt: String(event.occurred_at || ''),
        eventName: String(event.event_name || ''),
        eventCategory: String(event.event_category || ''),
        module: typeof event.module === 'string' ? event.module : null,
        path: typeof event.normalized_path === 'string' ? event.normalized_path : typeof event.path === 'string' ? event.path : null,
        userId: typeof event.user_id === 'string' ? event.user_id : null,
        userName: typeof profile?.full_name === 'string' ? profile.full_name : 'Unknown User',
        teamName: typeof team?.name === 'string' ? team.name : null,
        roleName: typeof role?.display_name === 'string' ? role.display_name : null,
        deviceType: typeof session?.device_type === 'string' ? session.device_type : null,
        sessionId: typeof event.session_id === 'string' ? event.session_id : null,
        metadata: sanitizeAnalyticsMetadata(event.metadata || {}),
      };
    }),
  };
}
