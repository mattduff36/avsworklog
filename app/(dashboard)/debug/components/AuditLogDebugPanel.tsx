'use client';

import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchAdminTeamDirectory } from '@/lib/admin/team-directory-client';
import {
  Ban,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Edit,
  FilePenLine,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AuditLogEntry } from '../types';

type AuditTimeFilter = 'all' | '24h' | '7d' | '30d' | '90d';
type AuditChangeFilter = 'all' | 'with_changes' | 'without_changes';
type AuditTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
const AUDIT_LOG_PAGE_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 300;

interface AuditLogFacets {
  users: Array<{ id: string; label: string }>;
  hasSystemEntry: boolean;
  tables: string[];
  actions: Array<{ value: string; label: string }>;
}

interface AuditSummaryMetric {
  title: string;
  value: string;
  detail: string;
  tone: AuditTone;
  icon: ReactNode;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

function getAuditMetricClasses(tone: AuditTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-100';
    case 'info':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-100';
    default:
      return 'border-slate-500/30 bg-slate-500/10 text-slate-100';
  }
}

function getActionBadgeClass(action: string): string {
  switch (action.toLowerCase()) {
    case 'created':
    case 'insert':
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'updated':
    case 'update':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
    case 'submitted':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'deleted':
    case 'delete':
    case 'rejected':
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    default:
      return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
  }
}

function getTableBadgeClass(tableName: string): string {
  const normalized = tableName.toLowerCase();
  if (normalized.includes('timesheet')) return 'border-[hsl(var(--timesheet-primary)/0.30)] bg-[hsl(var(--timesheet-primary)/0.10)] text-timesheet';
  if (normalized.includes('hgv')) return 'border-[hsl(var(--hgv-inspection-primary)/0.30)] bg-[hsl(var(--hgv-inspection-primary)/0.10)] text-hgv-inspection';
  if (normalized.includes('plant')) return 'border-[hsl(var(--plant-inspection-primary)/0.30)] bg-[hsl(var(--plant-inspection-primary)/0.10)] text-plant-inspection';
  if (normalized.includes('inspection')) return 'border-[hsl(var(--inspection-primary)/0.30)] bg-[hsl(var(--inspection-primary)/0.10)] text-inspection';
  if (normalized.includes('absence')) return 'border-[hsl(var(--absence-primary)/0.30)] bg-[hsl(var(--absence-primary)/0.10)] text-absence';
  if (normalized.includes('van') || normalized.includes('fleet')) return 'border-[hsl(var(--fleet-primary)/0.30)] bg-[hsl(var(--fleet-primary)/0.10)] text-fleet';
  if (normalized.includes('workshop') || normalized.includes('action')) return 'border-[hsl(var(--workshop-primary)/0.30)] bg-[hsl(var(--workshop-primary)/0.10)] text-workshop';
  if (normalized.includes('inventory')) return 'border-[hsl(var(--inventory-primary)/0.30)] bg-[hsl(var(--inventory-primary)/0.10)] text-inventory';
  if (normalized.includes('report')) return 'border-[hsl(var(--report-primary)/0.30)] bg-[hsl(var(--report-primary)/0.10)] text-report';
  if (normalized.includes('error') || normalized.includes('debug')) return 'border-[hsl(var(--debug-primary)/0.30)] bg-[hsl(var(--debug-primary)/0.10)] text-red-300';
  if (normalized.includes('rams') || normalized.includes('project')) return 'border-[hsl(var(--rams-primary)/0.30)] bg-[hsl(var(--rams-primary)/0.10)] text-rams';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
}

function getTopEntry(values: string[]): { label: string; count: number } | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)[0] || null;
}

function formatAuditTimestamp(createdAt: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!createdAt) return 'Unknown';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-GB', options);
}

function AuditMetricCard({ metric }: { metric: AuditSummaryMetric }) {
  return (
    <div className={`rounded-xl border p-4 ${getAuditMetricClasses(metric.tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{metric.title}</p>
          <p className="mt-2 text-xl font-bold">{metric.value}</p>
        </div>
        <span className="opacity-85">{metric.icon}</span>
      </div>
      <p className="mt-2 text-sm leading-5 opacity-85">{metric.detail}</p>
    </div>
  );
}

export function AuditLogDebugPanel() {
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(true);
  const [loadingMoreAudits, setLoadingMoreAudits] = useState(false);
  const [expandedAudits, setExpandedAudits] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [selectedTable, setSelectedTable] = useState('all');
  const [selectedAction, setSelectedAction] = useState('all');
  const [selectedTimeWindow, setSelectedTimeWindow] = useState<AuditTimeFilter>('all');
  const [selectedChangeFilter, setSelectedChangeFilter] = useState<AuditChangeFilter>('all');
  const [teamNameById, setTeamNameById] = useState<Record<string, string>>({});
  const [facets, setFacets] = useState<AuditLogFacets | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searchApplied, setSearchApplied] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    void fetchTeamDirectory();
  }, []);

  const fetchTeamDirectory = async () => {
    try {
      const directory = await fetchAdminTeamDirectory();
      const teams = directory.teams || [];
      const mappedById = teams.reduce<Record<string, string>>((acc, team) => {
        const teamId = team.id || team.team_id;
        if (!teamId) return acc;
        acc[teamId] = team.name || teamId;
        return acc;
      }, {});
      setTeamNameById(mappedById);
    } catch (error) {
      console.error('Error fetching team directory for audit filters:', error);
    }
  };

  const buildAuditLogParams = (cursor?: string | null, includeFacets = false) => {
    const params = new URLSearchParams();
    params.set('limit', String(AUDIT_LOG_PAGE_SIZE));
    if (includeFacets) params.set('includeFacets', '1');
    if (cursor) params.set('cursor', cursor);
    if (debouncedSearchQuery.trim().length >= 3) params.set('q', debouncedSearchQuery.trim());
    if (selectedUserId !== 'all') params.set('userId', selectedUserId);
    if (selectedTeamId !== 'all') params.set('teamId', selectedTeamId);
    if (selectedTable !== 'all') params.set('table', selectedTable);
    if (selectedAction !== 'all') params.set('action', selectedAction);
    if (selectedTimeWindow !== 'all') params.set('timeWindow', selectedTimeWindow);
    if (selectedChangeFilter !== 'all') params.set('changeFilter', selectedChangeFilter);
    return params;
  };

  const fetchAuditLogs = useCallback(async (options?: { cursor?: string | null; append?: boolean }) => {
    const isAppend = Boolean(options?.append && options.cursor);
    if (isAppend) {
      setLoadingMoreAudits(true);
    } else {
      setAuditLogsLoading(true);
    }

    try {
      const params = buildAuditLogParams(options?.cursor, !isAppend);
      const response = await fetch(`/api/debug/audit-logs?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(payload.error || 'Failed to fetch audit logs');
        return;
      }

      const nextLogs = (payload.logs || []) as AuditLogEntry[];
      setAuditLogs((current) => {
        if (!isAppend) return nextLogs;
        const seen = new Set(current.map((log) => log.id));
        return [...current, ...nextLogs.filter((log) => !seen.has(log.id))];
      });
      setHasMore(Boolean(payload.pagination?.has_more));
      setNextCursor(payload.pagination?.next_cursor || null);
      setSearchApplied(Boolean(payload.searchApplied));
      if (payload.facets) {
        setFacets(payload.facets as AuditLogFacets);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      toast.error('Failed to fetch audit logs');
    } finally {
      setAuditLogsLoading(false);
      setLoadingMoreAudits(false);
    }
  }, [
    debouncedSearchQuery,
    selectedAction,
    selectedChangeFilter,
    selectedTable,
    selectedTeamId,
    selectedTimeWindow,
    selectedUserId,
  ]);

  useEffect(() => {
    void fetchAuditLogs();
  }, [fetchAuditLogs]);

  const loadMoreAuditLogs = async () => {
    if (!nextCursor || loadingMoreAudits) return;
    await fetchAuditLogs({ cursor: nextCursor, append: true });
  };

  const toggleAuditExpanded = (id: string) => {
    setExpandedAudits((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const formatTableName = (tableName: string) => {
    return tableName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getTeamName = useCallback((teamId: string | null): string => {
    if (!teamId) return 'Unassigned';
    return teamNameById[teamId] || teamId;
  }, [teamNameById]);

  const hasChangeDetails = (changes: AuditLogEntry['changes']): boolean => {
    return Boolean(changes && Object.keys(changes).length > 0);
  };

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    selectedUserId !== 'all' ||
    selectedTeamId !== 'all' ||
    selectedTable !== 'all' ||
    selectedAction !== 'all' ||
    selectedTimeWindow !== 'all' ||
    selectedChangeFilter !== 'all';

  const userOptions = useMemo(() => {
    const users = [...(facets?.users || [])].sort((a, b) => a.label.localeCompare(b.label));
    return { users, hasSystemEntry: facets?.hasSystemEntry ?? true };
  }, [facets]);

  const teamOptions = useMemo(() => {
    const teams = Object.entries(teamNameById)
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { teams, hasUnassigned: true };
  }, [teamNameById]);

  const tableOptions = useMemo(() => {
    return [...(facets?.tables || [])].sort((a, b) =>
      formatTableName(a).localeCompare(formatTableName(b))
    );
  }, [facets]);

  const actionOptions = useMemo(() => {
    return [...(facets?.actions || [])].sort((a, b) => a.label.localeCompare(b.label));
  }, [facets]);

  const auditSummary = useMemo(() => {
    const entries = auditLogs;
    const uniqueUsers = new Set(entries.map((log) => log.user_id || 'system')).size;
    const withChanges = entries.filter((log) => hasChangeDetails(log.changes)).length;
    const destructiveActions = entries.filter((log) =>
      ['deleted', 'delete', 'rejected'].includes(log.action.toLowerCase())
    ).length;
    const topTable = getTopEntry(entries.map((log) => formatTableName(log.table_name)));
    const topTeam = getTopEntry(entries.map((log) => getTeamName(log.team_id)));
    const latestEntry = entries[0] || null;

    const metrics: AuditSummaryMetric[] = [
      {
        title: 'Visible changes',
        value: formatNumber(entries.length),
        detail: hasActiveFilters
          ? `Of the ${formatNumber(auditLogs.length)} loaded matches. Filters search the full audit log.`
          : `Loaded pages only. Latest ${formatNumber(auditLogs.length)} audit entries.`,
        tone: 'info',
        icon: <BarChart3 className="h-5 w-5" />,
      },
      {
        title: 'Field-level detail',
        value: formatNumber(withChanges),
        detail: `${formatNumber(entries.length - withChanges)} entries have no detailed before/after values recorded.`,
        tone: withChanges > 0 ? 'success' : 'neutral',
        icon: <FilePenLine className="h-5 w-5" />,
      },
      {
        title: 'Highest activity area',
        value: topTable?.label || 'No data',
        detail: topTable ? `${formatNumber(topTable.count)} entries relate to this table/module.` : 'No table activity is visible with the current filters.',
        tone: 'warning',
        icon: <Database className="h-5 w-5" />,
      },
      {
        title: 'Risk signal',
        value: `${formatNumber(destructiveActions)} critical actions`,
        detail: destructiveActions > 0
          ? 'Delete or rejection events are visible and may need closer review.'
          : 'No delete or rejection events are visible in this view.',
        tone: destructiveActions > 0 ? 'danger' : 'success',
        icon: <ShieldCheck className="h-5 w-5" />,
      },
    ];

    const headline = entries.length === 0
      ? 'No audit entries match the current filters.'
      : `${formatNumber(uniqueUsers)} users or system processes changed ${formatNumber(entries.length)} records${topTeam ? `, with ${topTeam.label} showing the most visible activity` : ''}.`;

    return {
      headline,
      metrics,
      latestEntry,
      topTeam,
    };
  }, [auditLogs, getTeamName, hasActiveFilters]);

  const clearFilters = () => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setSelectedUserId('all');
    setSelectedTeamId('all');
    setSelectedTable('all');
    setSelectedAction('all');
    setSelectedTimeWindow('all');
    setSelectedChangeFilter('all');
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  };

  const copyAuditToClipboard = async (log: AuditLogEntry, e: MouseEvent) => {
    e.stopPropagation();

    const content = `AUDIT LOG ENTRY
================

Table: ${formatTableName(log.table_name)}
Action: ${log.action.toUpperCase()}
User: ${log.user_name}
Team: ${getTeamName(log.team_id)}
Timestamp: ${formatAuditTimestamp(log.created_at)}
Record ID: ${log.record_id}

${log.changes && Object.keys(log.changes).length > 0
  ? `CHANGES:\n${Object.entries(log.changes)
      .map(([field, change]) => {
        let fieldChanges = `\n${field}:`;
        if (change.old !== undefined) {
          fieldChanges += `\n  - Old: ${formatValue(change.old)}`;
        }
        if (change.new !== undefined) {
          fieldChanges += `\n  + New: ${formatValue(change.new)}`;
        }
        return fieldChanges;
      })
      .join('\n')}`
  : 'No detailed changes recorded'}`;

    try {
      await navigator.clipboard.writeText(content);
      toast.success('Audit log copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const getActionIcon = (action: string) => {
    switch (action.toLowerCase()) {
      case 'created':
      case 'insert':
        return <Plus className="h-4 w-4 text-green-500" />;
      case 'updated':
      case 'update':
        return <Edit className="h-4 w-4 text-blue-500" />;
      case 'deleted':
      case 'delete':
        return <Trash className="h-4 w-4 text-red-500" />;
      case 'submitted':
        return <Send className="h-4 w-4 text-amber-500" />;
      case 'approved':
        return <Check className="h-4 w-4 text-green-500" />;
      case 'rejected':
        return <Ban className="h-4 w-4 text-red-500" />;
      default:
        return <History className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <Card className="overflow-hidden border-avs-yellow/20 bg-slate-950/60">
      <div className="pointer-events-none h-1 bg-gradient-to-r from-orange-500 to-red-600" />
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5 text-avs-yellow" />
              Database Change Log
            </CardTitle>
            <CardDescription>
              Track all database changes and modifications (Showing {formatNumber(auditLogs.length)} loaded entries{hasMore ? ', more available' : ''})
            </CardDescription>
          </div>
          <Button onClick={() => fetchAuditLogs()} variant="outline" size="sm" disabled={loadingMoreAudits || auditLogsLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loadingMoreAudits ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-5 space-y-4">
          {auditLogs.length > 0 && (
            <div className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
              <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-avs-yellow">Audit Summary</p>
                  <p className="mt-1 text-sm text-slate-300">{auditSummary.headline}</p>
                </div>
                {auditSummary.latestEntry ? (
                  <Badge variant="outline" className="border-orange-500/30 bg-orange-500/10 text-orange-300">
                    Latest: {formatAuditTimestamp(auditSummary.latestEntry.created_at)}
                  </Badge>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {auditSummary.metrics.map((metric) => (
                  <AuditMetricCard key={metric.title} metric={metric} />
                ))}
              </div>
            </div>
          )}

            <div className="space-y-4 rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
            <div className="flex flex-col md:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search user, team, module, action, record ID, or change values..."
                  className="pl-10"
                />
                {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Type at least 3 characters to search the full audit log.</p>
                ) : null}
              </div>
              <Button variant="outline" onClick={clearFilters} disabled={!hasActiveFilters}>
                <X className="h-4 w-4 mr-2" />
                Clear Filters
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">User</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All users" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All users</SelectItem>
                    {userOptions.hasSystemEntry && <SelectItem value="system">System</SelectItem>}
                    {userOptions.users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Team</Label>
                <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    {teamOptions.hasUnassigned && <SelectItem value="unassigned">Unassigned</SelectItem>}
                    {teamOptions.teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Module (Table)</Label>
                <Select value={selectedTable} onValueChange={setSelectedTable}>
                  <SelectTrigger>
                    <SelectValue placeholder="All modules" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All modules</SelectItem>
                    {tableOptions.map((tableName) => (
                      <SelectItem key={tableName} value={tableName}>
                        {formatTableName(tableName)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Type (Action)</Label>
                <Select value={selectedAction} onValueChange={setSelectedAction}>
                  <SelectTrigger>
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    {actionOptions.map((action) => (
                      <SelectItem key={action.value} value={action.value}>
                        {action.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Time Window</Label>
                <Select value={selectedTimeWindow} onValueChange={(value) => setSelectedTimeWindow(value as AuditTimeFilter)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any time</SelectItem>
                    <SelectItem value="24h">Last 24 hours</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="90d">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Change Details</Label>
                <Select
                  value={selectedChangeFilter}
                  onValueChange={(value) => setSelectedChangeFilter(value as AuditChangeFilter)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All entries" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All entries</SelectItem>
                    <SelectItem value="with_changes">With field-level changes</SelectItem>
                    <SelectItem value="without_changes">Without field-level changes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {hasMore && hasActiveFilters ? (
              <p className="text-xs text-muted-foreground">
                Showing the first {formatNumber(auditLogs.length)} matches
                {searchApplied ? ' for this search' : ''}. Refine the filter or click Show more.
              </p>
            ) : null}
            </div>
          </div>

        {auditLogsLoading && auditLogs.length === 0 ? (
          <PanelLoader message="Loading audit logs..." accent="debug" className="py-8" />
        ) : auditLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>{hasActiveFilters ? 'No audit log entries match the current filters' : 'No audit log entries found'}</p>
            <p className="text-sm mt-1">
              {hasActiveFilters ? 'Try clearing filters or using a more specific search.' : 'Database changes will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {auditLogs.map((log) => {
              const isExpanded = expandedAudits.includes(log.id);

              return (
                <div key={log.id} className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/30 transition-colors hover:border-orange-500/50">
                  <div className="cursor-pointer p-4 transition-colors hover:bg-orange-500/5" onClick={() => toggleAuditExpanded(log.id)}>
                    <div className="flex items-start gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      )}
                      {getActionIcon(log.action)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`font-mono text-xs ${getTableBadgeClass(log.table_name)}`}>
                            {formatTableName(log.table_name)}
                          </Badge>
                          <Badge variant="outline" className={getActionBadgeClass(log.action)}>
                            {log.action.toUpperCase()}
                          </Badge>
                          <span className="text-muted-foreground text-sm">by</span>
                          <Badge variant="secondary" className="gap-1">
                            <Users className="h-3 w-3" />
                            {log.user_name}
                          </Badge>
                          <Badge variant="outline" className="border-avs-yellow/30 bg-avs-yellow/10 text-avs-yellow">{getTeamName(log.team_id)}</Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatAuditTimestamp(log.created_at, {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                          <span className="ml-2">•</span>
                          <span className="font-mono text-xs">ID: {log.record_id.slice(0, 8)}...</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 flex-shrink-0 hover:bg-accent"
                        onClick={(e) => copyAuditToClipboard(log, e)}
                        title="Copy to clipboard"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-700/70 bg-slate-900/55 p-4">
                      {log.changes && Object.keys(log.changes).length > 0 ? (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2">CHANGES:</p>
                          <div className="space-y-2">
                            {Object.entries(log.changes).map(([field, change]) => (
                              <div key={field} className="rounded border border-slate-700/70 bg-slate-950/45 p-2 text-xs font-mono">
                                <div className="font-semibold text-foreground mb-1">{field}:</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {change.old !== undefined && (
                                    <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
                                      <div className="text-red-500 font-semibold mb-1">- Old:</div>
                                      <div className="text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">{formatValue(change.old)}</div>
                                    </div>
                                  )}
                                  {change.new !== undefined && (
                                    <div className="bg-green-500/10 border border-green-500/20 rounded p-2">
                                      <div className="text-green-500 font-semibold mb-1">+ New:</div>
                                      <div className="text-green-700 dark:text-green-300 whitespace-pre-wrap break-all">{formatValue(change.new)}</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground italic">No detailed changes recorded</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center pt-4 border-t">
            <Button onClick={loadMoreAuditLogs} variant="outline" disabled={loadingMoreAudits}>
              {loadingMoreAudits ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-2" />
                  Show {AUDIT_LOG_PAGE_SIZE.toLocaleString('en-GB')} More Entries
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
