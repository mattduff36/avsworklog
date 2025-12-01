'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Bug,
  Database,
  Users,
  FileText,
  Clipboard,
  Calendar,
  ShieldAlert,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Package,
  History,
  Edit,
  Trash,
  Plus,
  Send,
  Check,
  Ban,
  ChevronDown,
  ChevronRight,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';

type DebugInfo = {
  environment: string;
  buildTime: string;
  nodeVersion: string;
  nextVersion: string;
};

type EntityStatus = {
  id: string;
  type: 'timesheet' | 'inspection' | 'absence' | 'rams';
  identifier: string;
  current_status: string;
  user_name: string;
  date: string;
};

type AuditLogEntry = {
  id: string;
  table_name: string;
  record_id: string;
  user_id: string | null;
  user_name: string;
  action: string;
  changes: Record<string, { old?: unknown; new?: unknown }> | null;
  created_at: string;
};

type ErrorLogEntry = {
  id: string;
  timestamp: string;
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: Record<string, unknown> | null;
};

export default function DebugPage() {
  const { profile, user } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  
  // Developer tab states
  const [timesheets, setTimesheets] = useState<EntityStatus[]>([]);
  const [inspections, setInspections] = useState<EntityStatus[]>([]);
  const [absences, setAbsences] = useState<EntityStatus[]>([]);
  const [ramsDocuments, setRamsDocuments] = useState<EntityStatus[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);
  const [clearingErrors, setClearingErrors] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<string[]>([]);
  const [expandedAudits, setExpandedAudits] = useState<string[]>([]);
  const [viewedErrors, setViewedErrors] = useState<Set<string>>(new Set());

  // Check if user is superadmin and viewing as actual role
  useEffect(() => {
    async function checkAccess() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser?.email) {
        setUserEmail(authUser.email);
        
        // Check if viewing as another role
        const viewAsRole = localStorage.getItem('viewAsRole') || 'actual';
        
        // Redirect if not superadmin or if viewing as another role
        if (authUser.email !== 'admin@mpdee.co.uk') {
          toast.error('Access denied: SuperAdmin only');
          router.push('/dashboard');
          return;
        }
        
        if (viewAsRole !== 'actual') {
          toast.error('Debug console only available in Actual Role mode');
          router.push('/dashboard');
          return;
        }
      }
      
      setLoading(false);
    }
    checkAccess();
  }, [supabase, router]);

  // Load viewed errors from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('viewedErrorLogs');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setViewedErrors(new Set(parsed));
      } catch (err) {
        console.error('Failed to parse viewed errors:', err);
      }
    }
  }, []);

  // Fetch debug info
  useEffect(() => {
    if (userEmail === 'admin@mpdee.co.uk') {
      fetchDebugInfo();
      fetchAllEntities();
      fetchAuditLogs();
      fetchErrorLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  const fetchDebugInfo = async () => {
    setDebugInfo({
      environment: process.env.NODE_ENV || 'development',
      buildTime: new Date().toISOString(),
      nodeVersion: typeof process !== 'undefined' ? process.version : 'N/A',
      nextVersion: '15.5.6',
    });
  };

  const fetchAllEntities = async () => {
    try {
      // Fetch timesheets
      const { data: timesheetData } = await supabase
        .from('timesheets')
        .select('id, status, week_ending, user_id, profiles!timesheets_user_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(50);

      if (timesheetData) {
        setTimesheets(
          timesheetData.map((t: any) => ({
            id: t.id,
            type: 'timesheet' as const,
            identifier: `Week ending ${new Date(t.week_ending).toLocaleDateString()}`,
            current_status: t.status,
            user_name: t.profiles?.full_name || 'Unknown',
            date: t.week_ending,
          }))
        );
      }

      // Fetch inspections
      const { data: inspectionData } = await supabase
        .from('vehicle_inspections')
        .select('id, status, inspection_date, user_id, profiles!vehicle_inspections_user_id_fkey(full_name), vehicles(reg_number)')
        .order('created_at', { ascending: false })
        .limit(50);

      if (inspectionData) {
        setInspections(
          inspectionData.map((i: any) => ({
            id: i.id,
            type: 'inspection' as const,
            identifier: `${i.vehicles?.reg_number || 'Unknown'} - ${new Date(i.inspection_date).toLocaleDateString()}`,
            current_status: i.status,
            user_name: i.profiles?.full_name || 'Unknown',
            date: i.inspection_date,
          }))
        );
      }

      // Fetch absences
      const { data: absenceData } = await supabase
        .from('absences')
        .select('id, status, date, profiles!absences_profile_id_fkey(full_name), absence_reasons(name)')
        .order('created_at', { ascending: false })
        .limit(50);

      if (absenceData) {
        setAbsences(
          absenceData.map((a: any) => ({
            id: a.id,
            type: 'absence' as const,
            identifier: `${a.absence_reasons?.name || 'Unknown'} - ${new Date(a.date).toLocaleDateString()}`,
            current_status: a.status,
            user_name: a.profiles?.full_name || 'Unknown',
            date: a.date,
          }))
        );
      }

      // Fetch RAMS
      const { data: ramsData } = await supabase
        .from('rams_documents')
        .select('id, title, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (ramsData) {
        setRamsDocuments(
          ramsData.map((r: any) => ({
            id: r.id,
            type: 'rams' as const,
            identifier: r.title || 'Untitled',
            current_status: 'active',
            user_name: 'System',
            date: r.created_at,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching entities:', error);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const { data: auditData, error } = await supabase
        .from('audit_log')
        .select('*, profiles!audit_log_user_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Error fetching audit logs:', error);
        toast.error('Failed to fetch audit logs: ' + error.message);
        return;
      }

      if (auditData) {
        setAuditLogs(
          auditData.map((log: any) => ({
            id: log.id,
            table_name: log.table_name,
            record_id: log.record_id,
            user_id: log.user_id,
            user_name: log.profiles?.full_name || 'System',
            action: log.action,
            changes: log.changes as Record<string, { old?: unknown; new?: unknown }> | null,
            created_at: log.created_at,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      toast.error('Failed to fetch audit logs');
    }
  };

  const fetchErrorLogs = async () => {
    try {
      const { data: errorData, error } = await supabase
        .from('error_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) {
        // Don't log or show error if table doesn't exist yet (first time setup)
        if (error.message.includes('does not exist') || error.code === 'PGRST204') {
          // Table doesn't exist yet - this is expected on first load
          setErrorLogs([]);
          return;
        }
        
        // For other errors, show a toast but don't console.error (to avoid logging loop)
        toast.error('Failed to fetch error logs. Table may need to be created.');
        return;
      }

      if (errorData) {
        // Fetch user names for all unique user IDs
        const uniqueUserIds = [...new Set(errorData.map(e => e.user_id).filter(Boolean))];
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', uniqueUserIds);

        // Create a map of user_id -> full_name
        const userIdToName = new Map(
          profilesData?.map(p => [p.id, p.full_name]) || []
        );

        // Add user names to error logs
        const enrichedErrorData = errorData.map(log => ({
          ...log,
          user_name: log.user_id ? userIdToName.get(log.user_id) || null : null,
        }));

        setErrorLogs(enrichedErrorData as ErrorLogEntry[]);
      }
    } catch (error) {
      // Silent fail - don't want to create error logging loops
      toast.error('Error loading error logs');
    }
  };

  const clearAllErrorLogs = async () => {
    if (!confirm('Are you sure you want to clear ALL error logs? This cannot be undone.')) {
      return;
    }

    setClearingErrors(true);
    try {
      const { error } = await supabase
        .from('error_logs')
        .delete()
        .gte('timestamp', '1970-01-01');

      if (error) throw error;

      toast.success('All error logs cleared successfully');
      fetchErrorLogs();
    } catch (error) {
      console.error('Error clearing error logs:', error);
      toast.error('Failed to clear error logs');
    } finally {
      setClearingErrors(false);
    }
  };

  const toggleErrorExpanded = (id: string) => {
    const isExpanding = !expandedErrors.includes(id);
    
    if (isExpanding) {
      // Auto-collapse all others and expand only this one
      setExpandedErrors([id]);
      
      // Mark as viewed immediately (both in state and localStorage)
      if (!viewedErrors.has(id)) {
        const newViewedErrors = new Set(viewedErrors);
        newViewedErrors.add(id);
        setViewedErrors(newViewedErrors);
        
        // Persist to localStorage
        localStorage.setItem('viewedErrorLogs', JSON.stringify(Array.from(newViewedErrors)));
      }
    } else {
      // Collapse this one
      setExpandedErrors(prev => prev.filter(x => x !== id));
    }
  };

  const toggleAuditExpanded = (id: string) => {
    setExpandedAudits(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const copyErrorToClipboard = async (log: ErrorLogEntry, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent toggling when clicking copy button
    
    const isMobile = log.user_agent.includes('Mobile') || log.user_agent.includes('iPhone') || log.user_agent.includes('Android');
    const browserMatch = log.user_agent.match(/(Chrome|Safari|Firefox|Edge)\/[\d.]+/);
    const browser = browserMatch ? browserMatch[0] : 'Unknown';

    const content = `ERROR LOG ENTRY
=================

Type: ${log.error_type}
Component: ${log.component_name || 'N/A'}
Device: ${isMobile ? 'Mobile' : 'Desktop'}
Browser: ${browser}

ERROR MESSAGE:
${log.error_message}

TIMESTAMP: ${new Date(log.timestamp).toLocaleString('en-GB')}
USER: ${log.user_name && log.user_email ? `${log.user_name} (${log.user_email})` : log.user_name || log.user_email || 'Anonymous'}
PAGE URL: ${log.page_url}

${log.error_stack ? `STACK TRACE:\n${log.error_stack}\n\n` : ''}${log.additional_data ? `ADDITIONAL DATA:\n${JSON.stringify(log.additional_data, null, 2)}` : ''}`;

    try {
      await navigator.clipboard.writeText(content);
      toast.success('Error log copied to clipboard');
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  const copyAuditToClipboard = async (log: AuditLogEntry, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent toggling when clicking copy button

    const content = `AUDIT LOG ENTRY
================

Table: ${formatTableName(log.table_name)}
Action: ${log.action.toUpperCase()}
User: ${log.user_name}
Timestamp: ${new Date(log.created_at).toLocaleString('en-GB')}
Record ID: ${log.record_id}

${log.changes && Object.keys(log.changes).length > 0 ? `CHANGES:\n${Object.entries(log.changes).map(([field, change]) => {
  let fieldChanges = `\n${field}:`;
  if (change.old !== undefined) {
    fieldChanges += `\n  - Old: ${formatValue(change.old)}`;
  }
  if (change.new !== undefined) {
    fieldChanges += `\n  + New: ${formatValue(change.new)}`;
  }
  return fieldChanges;
}).join('\n')}` : 'No detailed changes recorded'}`;

    try {
      await navigator.clipboard.writeText(content);
      toast.success('Audit log copied to clipboard');
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  const updateStatus = async (id: string, type: string, newStatus: string) => {
    setUpdating(id);
    try {
      let table = '';
      switch (type) {
        case 'timesheet':
          table = 'timesheets';
          break;
        case 'inspection':
          table = 'vehicle_inspections';
          break;
        case 'absence':
          table = 'absences';
          break;
        default:
          throw new Error('Invalid type');
      }

      const { error } = await supabase
        .from(table)
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;

      toast.success(`Status updated to ${newStatus}`);
      fetchAllEntities();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
    } finally {
      setUpdating(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft':
        return <FileText className="h-4 w-4 text-gray-500" />;
      case 'submitted':
        return <Clock className="h-4 w-4 text-amber-500" />;
      case 'approved':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'rejected':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'processed':
        return <Package className="h-4 w-4 text-blue-500" />;
      case 'adjusted':
        return <Edit className="h-4 w-4 text-purple-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-amber-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const getAvailableStatuses = (type: string) => {
    if (type === 'timesheet') {
      return ['draft', 'submitted', 'approved', 'rejected', 'processed', 'adjusted'];
    } else if (type === 'inspection') {
      return ['draft', 'submitted', 'approved', 'rejected'];
    } else if (type === 'absence') {
      return ['pending', 'approved', 'rejected'];
    }
    return [];
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (userEmail !== 'admin@mpdee.co.uk') {
    return null;
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-500 to-orange-500 rounded-lg p-6 text-white">
        <div className="flex items-center gap-3">
          <Bug className="h-8 w-8" />
          <div>
            <h1 className="text-3xl font-bold mb-2">SuperAdmin Debug Console</h1>
            <p className="text-red-100">
              Developer tools and system information
            </p>
          </div>
        </div>
      </div>

      {/* Debug Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500" />
              Environment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{debugInfo?.environment}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-green-500" />
              Logged In As
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold truncate">{profile?.full_name}</p>
            <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              Access Level
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="destructive" className="text-lg">SuperAdmin</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-purple-500" />
              Next.js Version
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{debugInfo?.nextVersion}</p>
          </CardContent>
        </Card>
      </div>

      {/* Developer Tools Tabs */}
      <Tabs defaultValue="errors" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6 lg:w-[900px]">
          <TabsTrigger value="errors">
            <Bug className="h-4 w-4 mr-2" />
            Error Log
          </TabsTrigger>
          <TabsTrigger value="audit">
            <History className="h-4 w-4 mr-2" />
            Audit Log
          </TabsTrigger>
          <TabsTrigger value="timesheets">
            <FileText className="h-4 w-4 mr-2" />
            Timesheets
          </TabsTrigger>
          <TabsTrigger value="inspections">
            <Clipboard className="h-4 w-4 mr-2" />
            Inspections
          </TabsTrigger>
          <TabsTrigger value="absences">
            <Calendar className="h-4 w-4 mr-2" />
            Absences
          </TabsTrigger>
        </TabsList>

        {/* Error Log Tab */}
        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Application Error Log</CardTitle>
                  <CardDescription>
                    Track all application errors and exceptions (Last 100 entries)
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={fetchErrorLogs}
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                  <Button
                    onClick={clearAllErrorLogs}
                    variant="destructive"
                    size="sm"
                    disabled={clearingErrors || errorLogs.length === 0}
                  >
                    {clearingErrors ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash className="h-4 w-4 mr-2" />
                    )}
                    Clear All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {errorLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50 text-green-500" />
                  <p className="font-semibold">No errors logged</p>
                  <p className="text-sm mt-1">Application errors will appear here when they occur</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* New Errors Section */}
                  {(() => {
                    const newErrors = errorLogs.filter(log => !viewedErrors.has(log.id));
                    const viewedErrorsList = errorLogs.filter(log => viewedErrors.has(log.id));

                    return (
                      <>
                        {newErrors.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-red-200 dark:border-red-900">
                              <Badge variant="destructive" className="font-semibold">
                                New
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {newErrors.length} unread error{newErrors.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="space-y-2">
                              {newErrors.map((log) => {
                                const isMobile = log.user_agent.includes('Mobile') || log.user_agent.includes('iPhone') || log.user_agent.includes('Android');
                                const browserMatch = log.user_agent.match(/(Chrome|Safari|Firefox|Edge)\/[\d.]+/);
                                const browser = browserMatch ? browserMatch[0] : 'Unknown';
                                const isExpanded = expandedErrors.includes(log.id);

                                return (
                                  <div
                                    key={log.id}
                                    className="border border-red-200 dark:border-red-900 rounded-lg overflow-hidden hover:border-red-300 dark:hover:border-red-800 transition-colors"
                                  >
                                    {/* Collapsed Header - Always Visible */}
                                    <div
                                      className="p-4 cursor-pointer hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors"
                                      onClick={() => toggleErrorExpanded(log.id)}
                                    >
                                      <div className="flex items-start gap-3">
                                        {isExpanded ? (
                                          <ChevronDown className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                        ) : (
                                          <ChevronRight className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                        )}
                                        <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap mb-1">
                                            <Badge variant="destructive" className="font-mono text-xs">
                                              {log.error_type}
                                            </Badge>
                                            {log.component_name && (
                                              <Badge variant="outline" className="text-xs">
                                                {log.component_name}
                                              </Badge>
                                            )}
                                            {isMobile && (
                                              <Badge variant="secondary" className="text-xs">
                                                📱 Mobile
                                              </Badge>
                                            )}
                                          </div>
                                          <p className="font-semibold text-red-700 dark:text-red-400 mb-2">
                                            {log.error_message}
                                          </p>
                                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                            <div className="flex items-center gap-1">
                                              <Clock className="h-3 w-3" />
                                              {new Date(log.timestamp).toLocaleString('en-GB', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                              })}
                                            </div>
                                            {log.user_name && (
                                              <>
                                                <span>•</span>
                                                <div className="flex items-center gap-1">
                                                  <Users className="h-3 w-3" />
                                                  {log.user_name}
                                                </div>
                                              </>
                                            )}
                                            {log.user_email && (
                                              <>
                                                <span>•</span>
                                                <span className="font-mono text-xs">
                                                  {log.user_email}
                                                </span>
                                              </>
                                            )}
                                            <span>•</span>
                                            <span className="font-mono">{browser}</span>
                                          </div>
                                        </div>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0 flex-shrink-0 hover:bg-red-100 dark:hover:bg-red-950"
                                          onClick={(e) => copyErrorToClipboard(log, e)}
                                          title="Copy to clipboard"
                                        >
                                          <Copy className="h-4 w-4 text-red-600 dark:text-red-400" />
                                        </Button>
                                      </div>
                                    </div>

                                    {/* Expanded Details - Only When Clicked */}
                                    {isExpanded && (
                                      <div className="border-t border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10 p-4 space-y-3">
                                        {/* Page URL */}
                                        <div>
                                          <p className="text-xs font-semibold text-muted-foreground mb-1">
                                            PAGE URL:
                                          </p>
                                          <p className="text-xs font-mono bg-muted/50 rounded p-2 break-all">
                                            {log.page_url}
                                          </p>
                                        </div>

                                        {/* Stack Trace */}
                                        {log.error_stack && (
                                          <div>
                                            <p className="text-xs font-semibold text-muted-foreground mb-1">
                                              STACK TRACE:
                                            </p>
                                            <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                                              {log.error_stack}
                                            </pre>
                                          </div>
                                        )}

                                        {/* Additional Data */}
                                        {log.additional_data && (
                                          <div>
                                            <p className="text-xs font-semibold text-muted-foreground mb-1">
                                              ADDITIONAL DATA:
                                            </p>
                                            <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                                              {JSON.stringify(log.additional_data, null, 2)}
                                            </pre>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Viewed Errors Section */}
                        {viewedErrorsList.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-muted">
                              <Badge variant="secondary" className="font-semibold">
                                Viewed
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {viewedErrorsList.length} viewed error{viewedErrorsList.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="space-y-2">
                              {viewedErrorsList.map((log) => {
                    const isMobile = log.user_agent.includes('Mobile') || log.user_agent.includes('iPhone') || log.user_agent.includes('Android');
                    const browserMatch = log.user_agent.match(/(Chrome|Safari|Firefox|Edge)\/[\d.]+/);
                    const browser = browserMatch ? browserMatch[0] : 'Unknown';
                    const isExpanded = expandedErrors.includes(log.id);

                    return (
                      <div
                        key={log.id}
                        className="border border-red-200 dark:border-red-900 rounded-lg overflow-hidden hover:border-red-300 dark:hover:border-red-800 transition-colors"
                      >
                        {/* Collapsed Header - Always Visible */}
                        <div
                          className="p-4 cursor-pointer hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors"
                          onClick={() => toggleErrorExpanded(log.id)}
                        >
                          <div className="flex items-start gap-3">
                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                            )}
                            <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <Badge variant="destructive" className="font-mono text-xs">
                                  {log.error_type}
                                </Badge>
                                {log.component_name && (
                                  <Badge variant="outline" className="text-xs">
                                    {log.component_name}
                                  </Badge>
                                )}
                                {isMobile && (
                                  <Badge variant="secondary" className="text-xs">
                                    📱 Mobile
                                  </Badge>
                                )}
                              </div>
                              <p className="font-semibold text-red-700 dark:text-red-400 mb-2">
                                {log.error_message}
                              </p>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {new Date(log.timestamp).toLocaleString('en-GB', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })}
                                </div>
                                {log.user_name && (
                                  <>
                                    <span>•</span>
                                    <div className="flex items-center gap-1">
                                      <Users className="h-3 w-3" />
                                      {log.user_name}
                                    </div>
                                  </>
                                )}
                                {log.user_email && (
                                  <>
                                    <span>•</span>
                                    <span className="font-mono text-xs">
                                      {log.user_email}
                                    </span>
                                  </>
                                )}
                                <span>•</span>
                                <span className="font-mono">{browser}</span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 flex-shrink-0 hover:bg-red-100 dark:hover:bg-red-950"
                              onClick={(e) => copyErrorToClipboard(log, e)}
                              title="Copy to clipboard"
                            >
                              <Copy className="h-4 w-4 text-red-600 dark:text-red-400" />
                            </Button>
                          </div>
                        </div>

                        {/* Expanded Details - Only When Clicked */}
                        {isExpanded && (
                          <div className="border-t border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10 p-4 space-y-3">
                            {/* Page URL */}
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">
                                PAGE URL:
                              </p>
                              <p className="text-xs font-mono bg-muted/50 rounded p-2 break-all">
                                {log.page_url}
                              </p>
                            </div>

                            {/* Stack Trace */}
                            {log.error_stack && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">
                                  STACK TRACE:
                                </p>
                                <pre className="text-xs font-mono bg-red-500/10 border border-red-500/20 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                                  {log.error_stack}
                                </pre>
                              </div>
                            )}

                            {/* Additional Data */}
                            {log.additional_data && Object.keys(log.additional_data).length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">
                                  ADDITIONAL DATA:
                                </p>
                                <pre className="text-xs font-mono bg-muted/50 rounded p-3 overflow-x-auto max-h-64 overflow-y-auto">
                                  {JSON.stringify(log.additional_data, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Database Change Log</CardTitle>
                  <CardDescription>
                    Track all database changes and modifications (Last 100 entries)
                  </CardDescription>
                </div>
                <Button
                  onClick={fetchAuditLogs}
                  variant="outline"
                  size="sm"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
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
                      <div
                        key={log.id}
                        className="border rounded-lg overflow-hidden hover:border-primary/50 transition-colors"
                      >
                        {/* Collapsed Header - Always Visible */}
                        <div
                          className="p-4 cursor-pointer hover:bg-accent transition-colors"
                          onClick={() => toggleAuditExpanded(log.id)}
                        >
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
                                <span className={`font-semibold ${getActionColor(log.action)}`}>
                                  {log.action.toUpperCase()}
                                </span>
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

                        {/* Expanded Details - Only When Clicked */}
                        {isExpanded && (
                          <div className="border-t bg-accent/30 p-4">
                            {/* Changes Details */}
                            {log.changes && Object.keys(log.changes).length > 0 ? (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-2">
                                  CHANGES:
                                </p>
                                <div className="space-y-2">
                                  {Object.entries(log.changes).map(([field, change]) => (
                                    <div
                                      key={field}
                                      className="bg-muted/50 rounded p-2 text-xs font-mono"
                                    >
                                      <div className="font-semibold text-foreground mb-1">
                                        {field}:
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {change.old !== undefined && (
                                          <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
                                            <div className="text-red-500 font-semibold mb-1">
                                              - Old:
                                            </div>
                                            <div className="text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">
                                              {formatValue(change.old)}
                                            </div>
                                          </div>
                                        )}
                                        {change.new !== undefined && (
                                          <div className="bg-green-500/10 border border-green-500/20 rounded p-2">
                                            <div className="text-green-500 font-semibold mb-1">
                                              + New:
                                            </div>
                                            <div className="text-green-700 dark:text-green-300 whitespace-pre-wrap break-all">
                                              {formatValue(change.new)}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground italic">
                                No detailed changes recorded
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timesheets Tab */}
        <TabsContent value="timesheets">
          <Card>
            <CardHeader>
              <CardTitle>Timesheet Status Manager</CardTitle>
              <CardDescription>
                Manually change timesheet statuses (Last 50 entries)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {timesheets.map((timesheet) => (
                  <div
                    key={timesheet.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      {getStatusIcon(timesheet.current_status)}
                      <div className="flex-1">
                        <p className="font-medium">{timesheet.identifier}</p>
                        <p className="text-sm text-muted-foreground">{timesheet.user_name}</p>
                      </div>
                      <Badge>{timesheet.current_status}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={timesheet.current_status}
                        onValueChange={(value) => updateStatus(timesheet.id, 'timesheet', value)}
                        disabled={updating === timesheet.id}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableStatuses('timesheet').map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {updating === timesheet.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inspections Tab */}
        <TabsContent value="inspections">
          <Card>
            <CardHeader>
              <CardTitle>Inspection Status Manager</CardTitle>
              <CardDescription>
                Manually change inspection statuses (Last 50 entries)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {inspections.map((inspection) => (
                  <div
                    key={inspection.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      {getStatusIcon(inspection.current_status)}
                      <div className="flex-1">
                        <p className="font-medium">{inspection.identifier}</p>
                        <p className="text-sm text-muted-foreground">{inspection.user_name}</p>
                      </div>
                      <Badge>{inspection.current_status}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={inspection.current_status}
                        onValueChange={(value) => updateStatus(inspection.id, 'inspection', value)}
                        disabled={updating === inspection.id}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableStatuses('inspection').map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {updating === inspection.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Absences Tab */}
        <TabsContent value="absences">
          <Card>
            <CardHeader>
              <CardTitle>Absence Status Manager</CardTitle>
              <CardDescription>
                Manually change absence statuses (Last 50 entries)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {absences.map((absence) => (
                  <div
                    key={absence.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      {getStatusIcon(absence.current_status)}
                      <div className="flex-1">
                        <p className="font-medium">{absence.identifier}</p>
                        <p className="text-sm text-muted-foreground">{absence.user_name}</p>
                      </div>
                      <Badge>{absence.current_status}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={absence.current_status}
                        onValueChange={(value) => updateStatus(absence.id, 'absence', value)}
                        disabled={updating === absence.id}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableStatuses('absence').map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {updating === absence.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Tab */}
      </Tabs>
    </div>
  );
}

