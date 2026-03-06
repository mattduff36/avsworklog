'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, ChevronDown, ChevronRight, Clock, Copy, Edit, History, Loader2, Plus, RefreshCw, Send, Trash, Users, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { AuditLogEntry } from '../types';

interface AuditLogDebugPanelProps {
  supabase: ReturnType<typeof createClient>;
}

export function AuditLogDebugPanel({ supabase }: AuditLogDebugPanelProps) {
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLogsLimit, setAuditLogsLimit] = useState(100);
  const [loadingMoreAudits, setLoadingMoreAudits] = useState(false);
  const [expandedAudits, setExpandedAudits] = useState<string[]>([]);

  useEffect(() => {
    void fetchAuditLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAuditLogs = async (limit?: number) => {
    const effectiveLimit = limit ?? auditLogsLimit;

    try {
      const { data: auditData, error } = await supabase
        .from('audit_log')
        .select('*, profiles!audit_log_user_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(effectiveLimit);

      if (error) {
        console.error('Error fetching audit logs:', error);
        toast.error(`Failed to fetch audit logs: ${error.message}`);
        return;
      }

      if (auditData) {
        setAuditLogs(
          auditData.map(
            (log: {
              id: string;
              table_name: string;
              record_id: string;
              user_id: string | null;
              action: string;
              changes: unknown;
              created_at: string;
              profiles?: { full_name: string } | null;
            }) => ({
              id: log.id,
              table_name: log.table_name,
              record_id: log.record_id,
              user_id: log.user_id,
              user_name: log.profiles?.full_name || 'System',
              action: log.action,
              changes: log.changes as Record<string, { old?: unknown; new?: unknown }> | null,
              created_at: log.created_at,
            }),
          ),
        );
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      toast.error('Failed to fetch audit logs');
    }
  };

  const loadMoreAuditLogs = async () => {
    setLoadingMoreAudits(true);
    const newLimit = auditLogsLimit + 100;
    setAuditLogsLimit(newLimit);
    await fetchAuditLogs(newLimit);
    setLoadingMoreAudits(false);
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
Timestamp: ${new Date(log.created_at).toLocaleString('en-GB')}
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

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case 'created':
      case 'insert':
        return 'text-green-500';
      case 'updated':
      case 'update':
        return 'text-blue-500';
      case 'deleted':
      case 'delete':
        return 'text-red-500';
      case 'submitted':
        return 'text-amber-500';
      case 'approved':
        return 'text-green-500';
      case 'rejected':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Database Change Log</CardTitle>
            <CardDescription>Track all database changes and modifications (Showing {auditLogs.length} entries)</CardDescription>
          </div>
          <Button onClick={() => fetchAuditLogs(auditLogsLimit)} variant="outline" size="sm" disabled={loadingMoreAudits}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loadingMoreAudits ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {auditLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No audit log entries found</p>
            <p className="text-sm mt-1">Database changes will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {auditLogs.map((log) => {
              const isExpanded = expandedAudits.includes(log.id);

              return (
                <div key={log.id} className="border rounded-lg overflow-hidden hover:border-primary/50 transition-colors">
                  <div className="p-4 cursor-pointer hover:bg-accent transition-colors" onClick={() => toggleAuditExpanded(log.id)}>
                    <div className="flex items-start gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      )}
                      {getActionIcon(log.action)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="font-mono text-xs">
                            {formatTableName(log.table_name)}
                          </Badge>
                          <span className={`font-semibold ${getActionColor(log.action)}`}>{log.action.toUpperCase()}</span>
                          <span className="text-muted-foreground text-sm">by</span>
                          <Badge variant="secondary" className="gap-1">
                            <Users className="h-3 w-3" />
                            {log.user_name}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {new Date(log.created_at).toLocaleString('en-GB', {
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
                    <div className="border-t bg-accent/30 p-4">
                      {log.changes && Object.keys(log.changes).length > 0 ? (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-2">CHANGES:</p>
                          <div className="space-y-2">
                            {Object.entries(log.changes).map(([field, change]) => (
                              <div key={field} className="bg-muted/50 rounded p-2 text-xs font-mono">
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

        {auditLogs.length > 0 && auditLogs.length >= auditLogsLimit && (
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
                  Show 100 More Entries
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
