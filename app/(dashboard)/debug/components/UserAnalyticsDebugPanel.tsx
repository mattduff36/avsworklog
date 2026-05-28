'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, BarChart3, Clock, Eye, Loader2, RefreshCw, Route, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { UsageAnalyticsPayload } from '../types';

type AnalyticsRange = '24h' | '7d' | '30d' | '90d';

const EVENT_FILTERS = [
  { value: 'all', label: 'All events' },
  { value: 'session_started', label: 'Session started' },
  { value: 'session_heartbeat', label: 'Heartbeat' },
  { value: 'page_view', label: 'Page views' },
  { value: 'route_changed', label: 'Route changes' },
  { value: 'visibility_resume', label: 'Visibility resumes' },
  { value: 'auth_login_success', label: 'Login success' },
  { value: 'auth_login_failed', label: 'Login failed' },
  { value: 'auth_logout', label: 'Logout' },
  { value: 'error_observed', label: 'Errors observed' },
] as const;

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Unknown';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(value: number | null): string {
  if (value === null) return 'N/A';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
}

function StatCard({ title, value, description, icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function UserAnalyticsDebugPanel() {
  const [payload, setPayload] = useState<UsageAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [moduleFilter, setModuleFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ range });
      if (moduleFilter.trim()) params.set('module', moduleFilter.trim());
      if (eventFilter !== 'all') params.set('event', eventFilter);

      const response = await fetch(`/api/debug/user-analytics?${params.toString()}`, {
        cache: 'no-store',
      });
      const nextPayload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(nextPayload?.error || 'Failed to load usage analytics');
      }

      setPayload(nextPayload as UsageAnalyticsPayload);
      if (
        selectedSessionId &&
        !(nextPayload as UsageAnalyticsPayload).activeSessions.some((session) => session.id === selectedSessionId)
      ) {
        setSelectedSessionId(null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load usage analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, eventFilter]);

  const selectedSession = useMemo(
    () => payload?.activeSessions.find((session) => session.id === selectedSessionId) || null,
    [payload?.activeSessions, selectedSessionId]
  );

  const selectedSessionEvents = useMemo(
    () => payload?.recentEvents.filter((event) => event.sessionId === selectedSessionId) || [],
    [payload?.recentEvents, selectedSessionId]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                User Usage Analytics
              </CardTitle>
              <CardDescription>
                Internal first-party usage data for investigations, adoption trends, and support triage.
              </CardDescription>
            </div>
            <Button onClick={fetchAnalytics} variant="outline" size="sm" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date range</Label>
              <Select value={range} onValueChange={(value) => setRange(value as AnalyticsRange)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Event type</Label>
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_FILTERS.map((event) => (
                    <SelectItem key={event.value} value={event.value}>
                      {event.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Module</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={moduleFilter}
                    onChange={(event) => setModuleFilter(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void fetchAnalytics();
                    }}
                    placeholder="e.g. timesheets"
                    className="pl-10"
                  />
                </div>
                <Button variant="outline" onClick={fetchAnalytics} disabled={loading}>
                  Apply
                </Button>
              </div>
            </div>
          </div>

          {payload ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Showing {formatDateTime(payload.range.start)} to {formatDateTime(payload.range.end)}. Raw analytics are retained for 180 days; rollups keep longer-term trends.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {payload ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <StatCard title="Events" value={formatNumber(payload.summary.totalEvents)} description="Tracked usage events" icon={<Activity className="h-4 w-4" />} />
            <StatCard title="Users" value={formatNumber(payload.summary.uniqueUsers)} description="Unique users in range" icon={<Users className="h-4 w-4" />} />
            <StatCard title="Sessions" value={formatNumber(payload.summary.sessionCount)} description="Sessions with events" icon={<Clock className="h-4 w-4" />} />
            <StatCard title="Page Views" value={formatNumber(payload.summary.pageViews)} description="Navigation page views" icon={<Eye className="h-4 w-4" />} />
            <StatCard title="Active Now" value={formatNumber(payload.summary.activeSessions)} description="Seen in last 5 minutes" icon={<Route className="h-4 w-4" />} />
            <StatCard title="Avg Duration" value={formatDuration(payload.summary.avgDurationMs)} description="For events with duration" icon={<Clock className="h-4 w-4" />} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Modules</CardTitle>
                <CardDescription>Most used app areas by event volume</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {payload.topModules.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No module data yet.</p>
                ) : (
                  payload.topModules.map((module) => (
                    <div key={module.module} className="flex items-center justify-between rounded-md border p-2">
                      <span className="font-mono text-sm">{module.module}</span>
                      <div className="flex gap-2">
                        <Badge variant="secondary">{formatNumber(module.events)} events</Badge>
                        <Badge variant="outline">{formatNumber(module.users)} users</Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Pages</CardTitle>
                <CardDescription>Most viewed routes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {payload.topPages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No page views yet.</p>
                ) : (
                  payload.topPages.map((page) => (
                    <div key={page.path} className="rounded-md border p-2">
                      <p className="truncate font-mono text-sm">{page.path}</p>
                      <div className="mt-2 flex gap-2">
                        <Badge variant="secondary">{formatNumber(page.views)} views</Badge>
                        <Badge variant="outline">{formatNumber(page.users)} users</Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Event Mix</CardTitle>
                <CardDescription>Distribution by event name</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {payload.topEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events yet.</p>
                ) : (
                  payload.topEvents.map((event) => (
                    <div key={event.eventName} className="flex items-center justify-between rounded-md border p-2">
                      <span className="font-mono text-sm">{event.eventName}</span>
                      <Badge variant="secondary">{formatNumber(event.events)}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Sessions</CardTitle>
              <CardDescription>Click a session to review its recent timeline.</CardDescription>
            </CardHeader>
            <CardContent>
              {payload.activeSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active sessions in the last 5 minutes.</p>
              ) : (
                <div className="grid gap-2 xl:grid-cols-2">
                  {payload.activeSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedSessionId(session.id === selectedSessionId ? null : session.id)}
                      className={`rounded-lg border p-3 text-left transition-colors hover:border-primary/70 ${
                        session.id === selectedSessionId ? 'border-primary bg-primary/10' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{session.userName}</p>
                          <p className="text-xs text-muted-foreground">
                            {session.roleName || 'Unknown role'}{session.teamName ? ` • ${session.teamName}` : ''}
                          </p>
                        </div>
                        <Badge variant="outline">{session.deviceType || 'unknown'}</Badge>
                      </div>
                      <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{session.exitPath || session.entryPath || 'No path'}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{formatDateTime(session.lastSeenAt)}</span>
                        <span>{formatNumber(session.eventCount)} events</span>
                        <span>{formatNumber(session.pageViewCount)} views</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedSession ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Session Timeline: {selectedSession.userName}</CardTitle>
                <CardDescription>Recent events for the selected active session.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedSessionEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent events for this session in the current query window.</p>
                ) : (
                  selectedSessionEvents.map((event) => (
                    <div key={event.id} className="rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={event.eventCategory === 'error' ? 'destructive' : 'secondary'}>{event.eventName}</Badge>
                        {event.module ? <Badge variant="outline">{event.module}</Badge> : null}
                        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</span>
                      </div>
                      <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{event.path || 'No path'}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Event Stream</CardTitle>
              <CardDescription>Latest normalized events stored in the analytics pipeline.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {payload.recentEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No usage events found for the current filters.</p>
              ) : (
                payload.recentEvents.map((event) => (
                  <div key={event.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={event.eventCategory === 'error' ? 'destructive' : 'secondary'}>{event.eventName}</Badge>
                      {event.module ? <Badge variant="outline">{event.module}</Badge> : null}
                      {event.deviceType ? <Badge variant="outline">{event.deviceType}</Badge> : null}
                      <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                      <p className="truncate">
                        <span className="font-medium text-foreground">{event.userName}</span>
                        {event.teamName ? ` • ${event.teamName}` : ''}
                      </p>
                      <p className="truncate font-mono">{event.path || 'No path'}</p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {loading ? <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin" /> : <BarChart3 className="mx-auto mb-3 h-8 w-8 opacity-50" />}
            <p>{loading ? 'Loading usage analytics...' : 'Usage analytics will appear here once events are recorded.'}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
