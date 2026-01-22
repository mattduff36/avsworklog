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
import { Switch } from '@/components/ui/switch';
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
  Filter,
  Search,
  Smartphone,
  Monitor,
  Car,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { DVLASyncDebugPanel } from './components/DVLASyncDebugPanel';

type DebugInfo = {
  environment: string;
  buildTime: string;
  nodeVersion: string;
  nextVersion: string;
};

type EntityStatus = {
  id: string;
  type: 'timesheet' | 'inspection' | 'absence';
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
  const { profile } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  
  // Developer tab states
  const [timesheets, setTimesheets] = useState<EntityStatus[]>([]);
  const [inspections, setInspections] = useState<EntityStatus[]>([]);
  const [absences, setAbsences] = useState<EntityStatus[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);
  const [clearingErrors, setClearingErrors] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<string[]>([]);
  const [expandedAudits, setExpandedAudits] = useState<string[]>([]);
  const [viewedErrors, setViewedErrors] = useState<Set<string>>(new Set());
  
  // Error log filter states
  const [filterLocalhost, setFilterLocalhost] = useState(true);
  const [filterAdminAccount, setFilterAdminAccount] = useState(true);
  const [filterErrorType, setFilterErrorType] = useState<string>('all');
  const [filterDeviceType, setFilterDeviceType] = useState<string>('all'); // 'all', 'mobile', 'desktop'
  const [filterComponent, setFilterComponent] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Test vehicle purge states
  const [testVehiclePrefix, setTestVehiclePrefix] = useState('TE57');
  const [testVehicles, setTestVehicles] = useState<Array<{ id: string; reg_number: string; nickname: string | null; status: string }>>([]);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [loadingTestVehicles, setLoadingTestVehicles] = useState(false);
  const [purgePreview, setPurgePreview] = useState<Record<string, number> | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeActions, setPurgeActions] = useState({
    inspections: true,
    workshop_tasks: true,
    maintenance: true,
    attachments: true,
    archives: true,
  });

  // Check if user is superadmin and viewing as actual role
  useEffect(() => {
    async function checkAccess() {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      
      // SECURITY: Redirect if not authenticated
      if (authError || !authUser) {
        router.push('/login');
        return;
      }
      
      setUserEmail(authUser.email || '');
      
      // Check if viewing as another role
      const viewAsRole = localStorage.getItem('viewAsRole') || 'actual';
      
      // SECURITY: Redirect if not superadmin
      if (authUser.email !== 'admin@mpdee.co.uk') {
        toast.error('Access denied: SuperAdmin only');
        router.push('/dashboard');
        return;
      }
      
      // Redirect if viewing as another role (debug must be in actual role mode)
      if (viewAsRole !== 'actual') {
        toast.error('Debug console only available in Actual Role mode');
        router.push('/dashboard');
        return;
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
          timesheetData.map((t: { id: string; week_ending: string; status: string; profiles?: { full_name: string } }) => ({
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
          inspectionData.map((i: { id: string; inspection_date: string; status: string; vehicles?: { reg_number: string }; profiles?: { full_name: string } }) => ({
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
          absenceData.map((a: { id: string; status: string; date: string; absence_reasons?: { name: string } | null; profiles?: { full_name: string } | null }) => ({
            id: a.id,
            type: 'absence' as const,
            identifier: `${a.absence_reasons?.name || 'Unknown'} - ${new Date(a.date).toLocaleDateString()}`,
            current_status: a.status,
            user_name: a.profiles?.full_name || 'Unknown',
            date: a.date,
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
          auditData.map((log: { id: string; table_name: string; record_id: string; user_id: string | null; action: string; changes: unknown; created_at: string; profiles?: { full_name: string } | null }) => ({
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
      // Fetch all error logs - filtering will be done in UI
      const { data: errorData, error } = await supabase
        .from('error_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(200); // Increased limit since we're filtering in UI

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
    const confirmed = await import('@/lib/services/notification.service').then(m => 
      m.notify.confirm({
        title: 'Clear All Error Logs',
        description: 'Are you sure you want to clear ALL error logs? This cannot be undone.',
        confirmText: 'Clear All',
        destructive: true,
      })
    );
    if (!confirmed) {
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
      
      // Mark as viewed in localStorage only (will move to "Viewed" section on next page load)
      if (!viewedErrors.has(id)) {
        try {
          const storedViewed = localStorage.getItem('viewedErrorLogs');
          const currentViewed = storedViewed ? new Set(JSON.parse(storedViewed)) : new Set<string>();
          currentViewed.add(id);
          localStorage.setItem('viewedErrorLogs', JSON.stringify(Array.from(currentViewed)));
        } catch (error) {
          console.warn('Failed to update viewed errors in localStorage:', error);
        }
        // Note: NOT updating viewedErrors state here, so error stays in "New" section until reload
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
      return ['draft', 'submitted'];
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

  // Test vehicle purge functions
  const fetchTestVehicles = async () => {
    setLoadingTestVehicles(true);
    try {
      const response = await fetch(`/api/debug/test-vehicles?prefix=${testVehiclePrefix}`);
      const data = await response.json();

      if (data.success) {
        setTestVehicles(data.vehicles || []);
        setSelectedVehicleIds([]);
        setPurgePreview(null);
      } else {
        toast.error(data.error || 'Failed to fetch test vehicles');
      }
    } catch (error) {
      console.error('Error fetching test vehicles:', error);
      toast.error('Failed to fetch test vehicles');
    } finally {
      setLoadingTestVehicles(false);
    }
  };

  const previewPurge = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one vehicle');
      return;
    }

    setPurging(true);
    try {
      const response = await fetch('/api/debug/test-vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'preview',
          vehicle_ids: selectedVehicleIds,
          prefix: testVehiclePrefix,
          actions: purgeActions,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setPurgePreview(data.counts);
        toast.success('Preview generated');
      } else {
        toast.error(data.error || 'Failed to preview purge');
      }
    } catch (error) {
      console.error('Error previewing purge:', error);
      toast.error('Failed to preview purge');
    } finally {
      setPurging(false);
    }
  };

  const executePurge = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one vehicle');
      return;
    }

    const notificationService = await import('@/lib/services/notification.service');
    const confirmed = await notificationService.notify.confirm({
      title: 'Confirm Purge',
      description: `This will permanently delete selected records for ${selectedVehicleIds.length} vehicle(s). This cannot be undone.`,
      confirmText: 'Purge Records',
      destructive: true,
    });

    if (!confirmed) {
      return;
    }

    setPurging(true);
    try {
      const response = await fetch('/api/debug/test-vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'execute',
          vehicle_ids: selectedVehicleIds,
          prefix: testVehiclePrefix,
          actions: purgeActions,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Purged records for ${data.affected_vehicles} vehicle(s)`);
        setPurgePreview(null);
        fetchTestVehicles(); // Refresh list
      } else {
        toast.error(data.error || 'Failed to execute purge');
      }
    } catch (error) {
      console.error('Error executing purge:', error);
      toast.error('Failed to execute purge');
    } finally {
      setPurging(false);
    }
  };

  const archiveVehicles = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one vehicle');
      return;
    }

    const notificationService = await import('@/lib/services/notification.service');
    const confirmed = await notificationService.notify.confirm({
      title: 'Archive Vehicles',
      description: `This will archive ${selectedVehicleIds.length} vehicle(s) (soft delete). The vehicles will be marked as archived and moved to vehicle_archive.`,
      confirmText: 'Archive',
      destructive: false,
    });

    if (!confirmed) {
      return;
    }

    setPurging(true);
    try {
      const response = await fetch('/api/debug/test-vehicles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_ids: selectedVehicleIds,
          prefix: testVehiclePrefix,
          mode: 'archive',
          archive_reason: 'Test Data Cleanup',
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Archived ${data.archived_count} vehicle(s)`);
        fetchTestVehicles(); // Refresh list
      } else {
        if (data.failed_vehicles && data.failed_vehicles.length > 0) {
          const failedList = data.failed_vehicles.map((v: any) => v.reg_number).join(', ');
          toast.error(`Archived ${data.archived_count} of ${data.total_requested}. Failed: ${failedList}`);
        } else {
          toast.error(data.error || 'Failed to archive vehicles');
        }
        fetchTestVehicles(); // Refresh list even on partial failure
      }
    } catch (error) {
      console.error('Error archiving vehicles:', error);
      toast.error('Failed to archive vehicles');
    } finally {
      setPurging(false);
    }
  };

  const hardDeleteVehicles = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one vehicle');
      return;
    }

    const notificationService = await import('@/lib/services/notification.service');
    const confirmed = await notificationService.notify.confirm({
      title: '⚠️ HARD DELETE VEHICLES',
      description: `This will PERMANENTLY DELETE ${selectedVehicleIds.length} vehicle(s) and ALL associated records from the database. This is IRREVERSIBLE and DANGEROUS. Only use for test data cleanup.`,
      confirmText: 'I understand - DELETE PERMANENTLY',
      destructive: true,
    });

    if (!confirmed) {
      return;
    }

    setPurging(true);
    try {
      const response = await fetch('/api/debug/test-vehicles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_ids: selectedVehicleIds,
          prefix: testVehiclePrefix,
          mode: 'hard_delete',
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Hard deleted ${data.affected_vehicles} vehicle(s) and ${Object.values(data.deleted_counts).reduce((a: number, b: any) => a + Number(b), 0)} total records`);
        setPurgePreview(null);
        fetchTestVehicles(); // Refresh list
      } else {
        toast.error(data.error || 'Failed to delete vehicles');
      }
    } catch (error) {
      console.error('Error deleting vehicles:', error);
      toast.error('Failed to delete vehicles');
    } finally {
      setPurging(false);
    }
  };

  // Filter error logs based on selected filters
  const getFilteredErrorLogs = () => {
    let filtered = [...errorLogs];

    // Filter by localhost
    if (filterLocalhost) {
      filtered = filtered.filter(log => !log.page_url.toLowerCase().includes('localhost'));
    }

    // Filter by admin account
    if (filterAdminAccount) {
      filtered = filtered.filter(log => log.user_email !== 'admin@mpdee.co.uk');
    }

    // Filter by error type
    if (filterErrorType !== 'all') {
      filtered = filtered.filter(log => log.error_type === filterErrorType);
    }

    // Filter by device type
    if (filterDeviceType !== 'all') {
      filtered = filtered.filter(log => {
        const isMobile = log.user_agent.includes('Mobile') || log.user_agent.includes('iPhone') || log.user_agent.includes('Android');
        return filterDeviceType === 'mobile' ? isMobile : !isMobile;
      });
    }

    // Filter by component
    if (filterComponent !== 'all') {
      filtered = filtered.filter(log => log.component_name === filterComponent);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log => 
        log.error_message.toLowerCase().includes(query) ||
        (log.error_stack && log.error_stack.toLowerCase().includes(query)) ||
        (log.component_name && log.component_name.toLowerCase().includes(query)) ||
        log.page_url.toLowerCase().includes(query)
      );
    }

    return filtered;
  };

  // Get unique error types for filter dropdown
  const uniqueErrorTypes = Array.from(new Set(errorLogs.map(log => log.error_type))).sort();
  
  // Get unique components for filter dropdown (excluding null)
  const uniqueComponents = Array.from(new Set(errorLogs.map(log => log.component_name).filter(Boolean))).sort();

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
          <Bug className="h-6 md:h-8 w-6 md:w-8" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2">SuperAdmin Debug Console</h1>
            <p className="text-sm md:text-base text-red-100">
              Developer tools and system information
            </p>
          </div>
        </div>
      </div>

      {/* Debug Info Cards - Compact on mobile, full on desktop */}
      <div className="grid grid-cols-4 gap-2 md:gap-4">
        <Card className="">
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <Database className="h-3 md:h-4 w-3 md:w-4 text-blue-500" />
              <span className="hidden md:inline">Environment</span>
              <span className="md:hidden">Env</span>
            </CardDescription>
            <CardTitle className="text-base md:text-2xl font-bold text-foreground truncate">{debugInfo?.environment}</CardTitle>
          </CardHeader>
        </Card>

        <Card className="">
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <Users className="h-3 md:h-4 w-3 md:w-4 text-green-500" />
              <span className="hidden md:inline">Logged In</span>
              <span className="md:hidden">User</span>
            </CardDescription>
            <CardTitle className="text-xs md:text-lg font-bold text-foreground truncate">{profile?.full_name}</CardTitle>
          </CardHeader>
        </Card>

        <Card className="">
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <ShieldAlert className="h-3 md:h-4 w-3 md:w-4 text-red-500" />
              <span className="hidden md:inline">Access</span>
              <span className="md:hidden">Role</span>
            </CardDescription>
            <CardTitle className="text-xs md:text-base font-bold text-red-600 dark:text-red-400">SuperAdmin</CardTitle>
          </CardHeader>
        </Card>

        <Card className="">
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <Clock className="h-3 md:h-4 w-3 md:w-4 text-purple-500" />
              <span className="hidden md:inline">Next.js</span>
              <span className="md:hidden">Ver</span>
            </CardDescription>
            <CardTitle className="text-base md:text-2xl font-bold text-foreground">{debugInfo?.nextVersion}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Developer Tools Tabs */}
      <Tabs defaultValue="errors" className="space-y-4">
        <TabsList className="grid w-full grid-cols-7 md:grid-cols-7 gap-1 md:gap-0 h-auto md:h-10 p-1 bg-slate-100 dark:bg-slate-800">
          <TabsTrigger value="errors" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Bug className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Error Log</span>
            <span className="md:hidden data-[state=active]:inline hidden">Errors</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <History className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Audit Log</span>
            <span className="md:hidden data-[state=active]:inline hidden">Audit</span>
          </TabsTrigger>
          <TabsTrigger value="timesheets" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <FileText className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Timesheets</span>
            <span className="md:hidden data-[state=active]:inline hidden">Sheets</span>
          </TabsTrigger>
          <TabsTrigger value="inspections" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Clipboard className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Inspections</span>
            <span className="md:hidden data-[state=active]:inline hidden">Inspect</span>
          </TabsTrigger>
          <TabsTrigger value="absences" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Calendar className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Absences</span>
            <span className="md:hidden data-[state=active]:inline hidden">Absent</span>
          </TabsTrigger>
          <TabsTrigger value="dvla" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <RefreshCw className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">DVLA Sync</span>
            <span className="md:hidden data-[state=active]:inline hidden">DVLA</span>
          </TabsTrigger>
          <TabsTrigger value="test-vehicles" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Car className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Test Vehicles</span>
            <span className="md:hidden data-[state=active]:inline hidden">Test</span>
          </TabsTrigger>
        </TabsList>

        {/* Error Log Tab */}
        <TabsContent value="errors">
          <Card className="">
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
              {/* Error Log Filters */}
              <div className="mb-4 p-3 border border-border rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 mb-3">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm text-foreground">Filters</h3>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {getFilteredErrorLogs().length} / {errorLogs.length}
                  </Badge>
                </div>

                {/* Search Bar */}
                <div className="mb-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search errors..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-11 h-9"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Toggle Filters */}
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="filter-localhost" className="text-xs font-medium">
                      Hide Localhost
                    </Label>
                    <Switch
                      id="filter-localhost"
                      checked={filterLocalhost}
                      onCheckedChange={setFilterLocalhost}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="filter-admin" className="text-xs font-medium">
                      Hide Admin
                    </Label>
                    <Switch
                      id="filter-admin"
                      checked={filterAdminAccount}
                      onCheckedChange={setFilterAdminAccount}
                    />
                  </div>

                  {/* Dropdown Filters */}
                  <div>
                    <Select value={filterErrorType} onValueChange={setFilterErrorType}>
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder="Error Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {uniqueErrorTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Select value={filterDeviceType} onValueChange={setFilterDeviceType}>
                      <SelectTrigger className="w-full h-9">
                        <SelectValue placeholder="Device" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Devices</SelectItem>
                        <SelectItem value="mobile">
                          <div className="flex items-center gap-2">
                            <Smartphone className="h-3 w-3" />
                            Mobile
                          </div>
                        </SelectItem>
                        <SelectItem value="desktop">
                          <div className="flex items-center gap-2">
                            <Monitor className="h-3 w-3" />
                            Desktop
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Component Filter */}
                  {uniqueComponents.length > 0 && (
                    <div className="lg:col-span-4">
                      <Select value={filterComponent} onValueChange={setFilterComponent}>
                        <SelectTrigger className="w-full h-9">
                          <SelectValue placeholder="Component" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Components</SelectItem>
                          {uniqueComponents.map((component) => (
                            <SelectItem key={component} value={component}>
                              {component}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Active Filters Summary */}
                {(searchQuery || filterErrorType !== 'all' || filterDeviceType !== 'all' || filterComponent !== 'all' || filterLocalhost || filterAdminAccount) && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-1.5 flex-wrap text-xs">
                      <span className="text-muted-foreground">Active:</span>
                      {filterLocalhost && <Badge variant="secondary" className="text-xs h-5">No Localhost</Badge>}
                      {filterAdminAccount && <Badge variant="secondary" className="text-xs h-5">No Admin</Badge>}
                      {filterErrorType !== 'all' && <Badge variant="secondary" className="text-xs h-5">{filterErrorType}</Badge>}
                      {filterDeviceType !== 'all' && <Badge variant="secondary" className="text-xs h-5">{filterDeviceType === 'mobile' ? '📱' : '🖥️'}</Badge>}
                      {filterComponent !== 'all' && <Badge variant="secondary" className="text-xs h-5">{filterComponent}</Badge>}
                      {searchQuery && <Badge variant="secondary" className="text-xs h-5">Search</Badge>}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 text-xs px-2 ml-auto"
                        onClick={() => {
                          setSearchQuery('');
                          setFilterErrorType('all');
                          setFilterDeviceType('all');
                          setFilterComponent('all');
                          setFilterLocalhost(true);
                          setFilterAdminAccount(true);
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {errorLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50 text-green-500" />
                  <p className="font-semibold">No errors logged</p>
                  <p className="text-sm mt-1">Application errors will appear here when they occur</p>
                </div>
              ) : getFilteredErrorLogs().length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Filter className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-semibold">No errors match your filters</p>
                  <p className="text-sm mt-1">Try adjusting your filter settings above</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setSearchQuery('');
                      setFilterErrorType('all');
                      setFilterDeviceType('all');
                      setFilterComponent('all');
                      setFilterLocalhost(false);
                      setFilterAdminAccount(false);
                    }}
                  >
                    Clear All Filters
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* New Errors Section */}
                  {(() => {
                    const filteredLogs = getFilteredErrorLogs();
                    const newErrors = filteredLogs.filter(log => !viewedErrors.has(log.id));
                    const viewedErrorsList = filteredLogs.filter(log => viewedErrors.has(log.id));

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
          <Card className="">
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
          <Card className="">
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
          <Card className="">
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
          <Card className="">
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

        {/* DVLA Sync Tab */}
        <TabsContent value="dvla">
          <DVLASyncDebugPanel />
        </TabsContent>

        {/* Test Vehicles Tab */}
        <TabsContent value="test-vehicles">
          <Card className="">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Car className="h-5 w-5 text-red-500" />
                    Test Vehicle Cleanup
                  </CardTitle>
                  <CardDescription>
                    Manage and purge test vehicle data (TE57 prefix only)
                  </CardDescription>
                </div>
                <Button
                  onClick={fetchTestVehicles}
                  variant="outline"
                  size="sm"
                  disabled={loadingTestVehicles}
                >
                  {loadingTestVehicles ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Prefix Configuration */}
              <div className="space-y-2">
                <Label htmlFor="vehicle-prefix" className="text-sm font-medium">
                  Vehicle Registration Prefix
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="vehicle-prefix"
                    value={testVehiclePrefix}
                    onChange={(e) => setTestVehiclePrefix(e.target.value.toUpperCase())}
                    placeholder="TE57"
                    className="w-32 font-mono"
                  />
                  <Button
                    onClick={fetchTestVehicles}
                    disabled={loadingTestVehicles || !testVehiclePrefix.trim()}
                  >
                    Load Vehicles
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Only vehicles starting with this prefix can be managed here
                </p>
              </div>

              {/* Vehicle Selection */}
              {testVehicles.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Select Vehicles ({selectedVehicleIds.length} of {testVehicles.length} selected)
                    </Label>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedVehicleIds(testVehicles.map(v => v.id))}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedVehicleIds([])}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                    {testVehicles.map((vehicle) => (
                      <div
                        key={vehicle.id}
                        className="flex items-center gap-3 p-3 hover:bg-accent cursor-pointer"
                        onClick={() => {
                          setSelectedVehicleIds(prev =>
                            prev.includes(vehicle.id)
                              ? prev.filter(id => id !== vehicle.id)
                              : [...prev, vehicle.id]
                          );
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedVehicleIds.includes(vehicle.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedVehicleIds(prev =>
                              prev.includes(vehicle.id)
                                ? prev.filter(id => id !== vehicle.id)
                                : [...prev, vehicle.id]
                            );
                          }}
                          className="h-4 w-4"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold">
                              {vehicle.reg_number}
                            </span>
                            {vehicle.nickname && (
                              <span className="text-sm text-muted-foreground">
                                ({vehicle.nickname})
                              </span>
                            )}
                            <Badge variant={vehicle.status === 'active' ? 'default' : 'secondary'} className="text-xs">
                              {vehicle.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {testVehicles.length === 0 && !loadingTestVehicles && (
                <div className="text-center py-8 text-muted-foreground">
                  <Car className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No vehicles found matching prefix "{testVehiclePrefix}"</p>
                  <p className="text-sm mt-1">Click "Load Vehicles" to search</p>
                </div>
              )}

              {/* Action Selection */}
              {selectedVehicleIds.length > 0 && (
                <>
                  <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
                    <Label className="text-sm font-medium">
                      Records to Purge
                    </Label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="purge-inspections"
                          checked={purgeActions.inspections}
                          onChange={(e) => setPurgeActions(prev => ({ ...prev, inspections: e.target.checked }))}
                          className="h-4 w-4"
                        />
                        <Label htmlFor="purge-inspections" className="text-sm font-normal cursor-pointer">
                          Vehicle Inspections (and items, photos)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="purge-tasks"
                          checked={purgeActions.workshop_tasks}
                          onChange={(e) => setPurgeActions(prev => ({ ...prev, workshop_tasks: e.target.checked }))}
                          className="h-4 w-4"
                        />
                        <Label htmlFor="purge-tasks" className="text-sm font-normal cursor-pointer">
                          Workshop Tasks (and comments, attachments)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="purge-maintenance"
                          checked={purgeActions.maintenance}
                          onChange={(e) => setPurgeActions(prev => ({ ...prev, maintenance: e.target.checked }))}
                          className="h-4 w-4"
                        />
                        <Label htmlFor="purge-maintenance" className="text-sm font-normal cursor-pointer">
                          Maintenance Records (history, DVLA logs, MOT data)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="purge-attachments"
                          checked={purgeActions.attachments}
                          onChange={(e) => setPurgeActions(prev => ({ ...prev, attachments: e.target.checked }))}
                          className="h-4 w-4"
                        />
                        <Label htmlFor="purge-attachments" className="text-sm font-normal cursor-pointer">
                          Workshop Attachments (usually cascades with tasks)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="purge-archives"
                          checked={purgeActions.archives}
                          onChange={(e) => setPurgeActions(prev => ({ ...prev, archives: e.target.checked }))}
                          className="h-4 w-4"
                        />
                        <Label htmlFor="purge-archives" className="text-sm font-normal cursor-pointer">
                          Vehicle Archive Entries
                        </Label>
                      </div>
                    </div>
                  </div>

                  {/* Preview Results */}
                  {purgePreview && (
                    <div className="p-4 border border-yellow-500 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
                      <div className="flex items-start gap-2 mb-3">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-yellow-900 dark:text-yellow-300">
                            Preview: Records to be deleted
                          </h4>
                          <p className="text-sm text-yellow-800 dark:text-yellow-400 mt-1">
                            {selectedVehicleIds.length} vehicle(s) selected
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {Object.entries(purgePreview).map(([key, value]) => (
                          <div key={key} className="flex justify-between p-2 bg-white dark:bg-slate-900 rounded">
                            <span className="text-muted-foreground capitalize">
                              {key.replace(/_/g, ' ')}:
                            </span>
                            <span className="font-mono font-semibold text-yellow-900 dark:text-yellow-300">
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="space-y-3 pt-4 border-t">
                    <div className="flex gap-2">
                      <Button
                        onClick={previewPurge}
                        variant="outline"
                        disabled={purging || selectedVehicleIds.length === 0}
                      >
                        <Search className="h-4 w-4 mr-2" />
                        Preview Counts
                      </Button>
                      <Button
                        onClick={executePurge}
                        variant="destructive"
                        disabled={purging || selectedVehicleIds.length === 0}
                      >
                        {purging ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash className="h-4 w-4 mr-2" />
                        )}
                        Purge Selected Records
                      </Button>
                    </div>

                    <div className="pt-3 border-t">
                      <p className="text-sm font-medium text-muted-foreground mb-3">
                        Vehicle Actions (records must be purged first):
                      </p>
                      <div className="flex gap-2">
                        <Button
                          onClick={archiveVehicles}
                          variant="outline"
                          disabled={purging || selectedVehicleIds.length === 0}
                        >
                          Archive Vehicles
                        </Button>
                        <Button
                          onClick={hardDeleteVehicles}
                          variant="destructive"
                          disabled={purging || selectedVehicleIds.length === 0}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          <AlertTriangle className="h-4 w-4 mr-2" />
                          Hard Delete Vehicles
                        </Button>
                      </div>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                        ⚠️ Hard Delete permanently removes vehicles from the database
                      </p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Tab */}
      </Tabs>
    </div>
  );
}

