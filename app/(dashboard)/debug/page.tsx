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
import { Input } from '@/components/ui/input';
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
  const [updating, setUpdating] = useState<string | null>(null);

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

  // Fetch debug info
  useEffect(() => {
    if (userEmail === 'admin@mpdee.co.uk') {
      fetchDebugInfo();
      fetchAllEntities();
      fetchAuditLogs();
    }
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
      const { data: auditData } = await supabase
        .from('audit_log')
        .select('*, profiles!audit_log_user_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (auditData) {
        setAuditLogs(
          auditData.map((log: Database['public']['Tables']['audit_log']['Row'] & { profiles?: { full_name: string } | null }) => ({
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
      case 'pending':
        return <Clock className="h-4 w-4 text-amber-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const getAvailableStatuses = (type: string) => {
    if (type === 'timesheet') {
      return ['draft', 'submitted', 'approved', 'rejected', 'processed'];
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
      <Tabs defaultValue="audit" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 lg:w-[800px]">
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
          <TabsTrigger value="system">
            <Database className="h-4 w-4 mr-2" />
            System
          </TabsTrigger>
        </TabsList>

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
                <div className="space-y-3">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="border rounded-lg p-4 hover:bg-accent transition-colors"
                    >
                      {/* Header Row */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3 flex-1">
                          {getActionIcon(log.action)}
                          <div className="flex-1">
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
                        </div>
                      </div>

                      {/* Changes Details */}
                      {log.changes && Object.keys(log.changes).length > 0 && (
                        <div className="mt-3 pt-3 border-t">
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
                      )}

                      {/* No changes data */}
                      {(!log.changes || Object.keys(log.changes).length === 0) && (
                        <div className="mt-2 text-xs text-muted-foreground italic">
                          No detailed changes recorded
                        </div>
                      )}
                    </div>
                  ))}
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
        <TabsContent value="system">
          <Card>
            <CardHeader>
              <CardTitle>System Information</CardTitle>
              <CardDescription>Runtime and environment details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Environment</Label>
                  <p className="text-sm font-mono bg-accent p-2 rounded mt-1">
                    {debugInfo?.environment}
                  </p>
                </div>
                <div>
                  <Label>Next.js Version</Label>
                  <p className="text-sm font-mono bg-accent p-2 rounded mt-1">
                    {debugInfo?.nextVersion}
                  </p>
                </div>
                <div>
                  <Label>User ID</Label>
                  <p className="text-sm font-mono bg-accent p-2 rounded mt-1 truncate">
                    {user?.id || 'N/A'}
                  </p>
                </div>
                <div>
                  <Label>Profile Role</Label>
                  <p className="text-sm font-mono bg-accent p-2 rounded mt-1">
                    {profile?.role?.name || 'N/A'}
                  </p>
                </div>
              </div>
              
              <div className="pt-4 border-t">
                <Button
                  onClick={() => {
                    fetchAllEntities();
                    fetchAuditLogs();
                  }}
                  className="w-full"
                  variant="outline"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh All Data
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

