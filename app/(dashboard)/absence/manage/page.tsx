'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowUpDown, Calendar, ChevronLeft, ChevronRight, Plus, Filter, Trash2, Search, ExternalLink } from 'lucide-react';
import { 
  useAllAbsences, 
  useAllAbsenceReasons,
  useCreateAbsence,
  useDeleteAbsence
} from '@/lib/hooks/useAbsence';
import { formatDate, calculateDurationDays } from '@/lib/utils/date';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { BackButton } from '@/components/ui/back-button';
import Link from 'next/link';
import { AbsenceReasonsContent } from '@/app/(dashboard)/absence/manage/components/AbsenceReasonsContent';
import { AllowancesContent } from '@/app/(dashboard)/absence/manage/components/AllowancesContent';
import { AbsenceCalendarAdmin } from '@/app/(dashboard)/absence/manage/components/AbsenceCalendarAdmin';
import { AbsenceAboutHelper } from '@/app/(dashboard)/absence/components/AbsenceAboutHelper';
import { ManageOverviewAdminActions } from '@/app/(dashboard)/absence/manage/components/ManageOverviewAdminActions';

type ManageSortField = 'employee' | 'reason' | 'status' | 'date' | 'duration' | 'approved_at';
type ManageSortDirection = 'asc' | 'desc';

export default function AdminAbsencePage() {
  const { isAdmin, isManager, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const canManage = isAdmin || isManager;
  
  // Filters
  const [profileId, setProfileId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [listSearch, setListSearch] = useState('');

  // Sort + pagination
  const [sortField, setSortField] = useState<ManageSortField>('date');
  const [sortDirection, setSortDirection] = useState<ManageSortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 25;
  const [activeTab, setActiveTab] = useState<'overview' | 'calendar' | 'reasons' | 'allowances'>('overview');
  
  // Data
  const { data: absences, isLoading } = useAllAbsences({ 
    profileId, 
    dateFrom, 
    dateTo, 
    reasonId, 
    status,
    includeArchived,
  });
  const filteredAbsences = useMemo(() => {
    const term = listSearch.trim().toLowerCase();
    const filtered = (absences || []).filter((absence) => {
      if (!term) return true;
      return (
        absence.profiles.full_name.toLowerCase().includes(term) ||
        (absence.profiles.employee_id || '').toLowerCase().includes(term) ||
        absence.absence_reasons.name.toLowerCase().includes(term) ||
        (absence.notes || '').toLowerCase().includes(term)
      );
    });

    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Keep pending leave requests at the top so managers/admins can review immediately.
      const pendingPriority = (statusValue: string) => (statusValue === 'pending' ? 0 : 1);
      const pendingOrder = pendingPriority(a.status) - pendingPriority(b.status);
      if (pendingOrder !== 0) {
        return pendingOrder;
      }

      switch (sortField) {
        case 'employee':
          return dir * a.profiles.full_name.localeCompare(b.profiles.full_name);
        case 'reason':
          return dir * a.absence_reasons.name.localeCompare(b.absence_reasons.name);
        case 'status':
          return dir * a.status.localeCompare(b.status);
        case 'date':
          return dir * a.date.localeCompare(b.date);
        case 'duration':
          return dir * ((a.duration_days || 0) - (b.duration_days || 0));
        case 'approved_at': {
          const aDate = a.approved_at || '';
          const bDate = b.approved_at || '';
          if (!aDate && !bDate) return 0;
          if (!aDate) return 1;
          if (!bDate) return -1;
          return dir * aDate.localeCompare(bDate);
        }
        default:
          return 0;
      }
    });
  }, [absences, listSearch, sortField, sortDirection]);
  const pendingCount = useMemo(
    () => (absences || []).filter((absence) => absence.status === 'pending').length,
    [absences]
  );

  const totalPages = Math.max(1, Math.ceil(filteredAbsences.length / PAGE_SIZE));
  const paginatedAbsences = useMemo(
    () => filteredAbsences.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredAbsences, currentPage]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [listSearch, sortField, sortDirection, profileId, dateFrom, dateTo, reasonId, status]);

  const { data: reasons } = useAllAbsenceReasons();
  const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string; employee_id: string | null }>>([]);
  
  // Mutations
  const createAbsence = useCreateAbsence();
  const deleteAbsence = useDeleteAbsence();
  
  // Dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Check admin/manager access
  useEffect(() => {
    if (!authLoading && !isAdmin && !isManager) {
      router.push('/dashboard');
    }
  }, [isAdmin, isManager, authLoading, router]);

  useEffect(() => {
    if (authLoading) return;
    const tabParam = searchParams.get('tab') || 'overview';
    const requestedTab = tabParam === 'records' ? 'overview' : tabParam;
    const allowedTabs: Array<'overview' | 'calendar' | 'reasons' | 'allowances'> = ['overview', 'calendar'];
    if (isAdmin) allowedTabs.push('reasons', 'allowances');
    else if (isManager) allowedTabs.push('allowances');

    if (allowedTabs.includes(requestedTab as typeof allowedTabs[number])) {
      setActiveTab(requestedTab as 'overview' | 'calendar' | 'reasons' | 'allowances');
    } else {
      const fallback = allowedTabs[0];
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', fallback);
      if (includeArchived) {
        params.set('archived', '1');
      } else {
        params.delete('archived');
      }
      router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, authLoading, isAdmin, isManager, router, includeArchived]);

  useEffect(() => {
    const archivedParam = searchParams.get('archived');
    setIncludeArchived(archivedParam === '1');
  }, [searchParams]);

  useEffect(() => {
    if (!isAdmin && activeTab === 'reasons') {
      setActiveTab('overview');
    }
  }, [isAdmin, activeTab]);

  function handleTabChange(nextTab: 'overview' | 'calendar' | 'reasons' | 'allowances') {
    if (!isAdmin && nextTab === 'reasons') return;
    if (!canManage && nextTab === 'allowances') return;
    setActiveTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', nextTab);
    if (includeArchived) {
      params.set('archived', '1');
    } else {
      params.delete('archived');
    }
    router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
  }

  function handleIncludeArchivedChange(nextValue: boolean) {
    setIncludeArchived(nextValue);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', activeTab);
    if (nextValue) {
      params.set('archived', '1');
    } else {
      params.delete('archived');
    }
    router.replace(`/absence/manage?${params.toString()}`, { scroll: false });
  }
  
  // Fetch profiles
  useEffect(() => {
    async function fetchProfiles() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .order('full_name');
      
      if (error) {
        console.error('Error fetching profiles:', error);
        return;
      }
      
      setProfiles(data || []);
    }
    
    fetchProfiles();
  }, [supabase]);
  
  // Calculate duration
  const duration = startDate 
    ? calculateDurationDays(
        new Date(startDate),
        endDate ? new Date(endDate) : null,
        isHalfDay
      )
    : 0;
  
  function handleSort(field: ManageSortField) {
    if (field === sortField) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection(field === 'approved_at' || field === 'date' ? 'desc' : 'asc');
  }

  function formatDuration(days: number): string {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  // Handle create
  async function handleCreate() {
    if (!selectedProfileId || !selectedReasonId || !startDate) {
      toast.error('Please fill in all required fields');
      return;
    }
    
    setSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      await createAbsence.mutateAsync({
        profile_id: selectedProfileId,
        date: startDate,
        end_date: endDate || null,
        reason_id: selectedReasonId,
        duration_days: duration,
        is_half_day: isHalfDay,
        half_day_session: isHalfDay ? halfDaySession : null,
        notes: notes || null,
        status: 'approved',
        created_by: user.id,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      });
      
      toast.success('Absence created and approved');
      
      // Reset form
      setSelectedProfileId('');
      setSelectedReasonId('');
      setStartDate('');
      setEndDate('');
      setIsHalfDay(false);
      setNotes('');
      setShowCreateDialog(false);
    } catch (error) {
      console.error('Error creating absence:', error);
      toast.error('Failed to create absence');
    } finally {
      setSubmitting(false);
    }
  }
  
  // Handle delete
  function handleDelete(id: string) {
    setDeleteTargetId(id);
    setShowDeleteDialog(true);
  }

  async function confirmDeleteAbsence() {
    if (!deleteTargetId) return;
    setDeleteSubmitting(true);
    try {
      await deleteAbsence.mutateAsync(deleteTargetId);
      toast.success('Absence deleted');
      setShowDeleteDialog(false);
      setDeleteTargetId(null);
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('Failed to delete absence');
    } finally {
      setDeleteSubmitting(false);
    }
  }
  
  if (authLoading || isLoading) {
    return (
      <div className="space-y-6 max-w-7xl">
        <Card className="">
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (!isAdmin && !isManager) return null;
  
  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <BackButton />
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Absence Management
              </h1>
              <p className="text-muted-foreground">
                View and manage all employee absences
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="w-full sm:w-auto bg-absence hover:bg-absence-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Absence
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as 'overview' | 'calendar' | 'reasons' | 'allowances')} className="space-y-6">
        <div className="flex items-center justify-end">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            {isAdmin && <TabsTrigger value="reasons">Reasons</TabsTrigger>}
            {canManage && <TabsTrigger value="allowances">Allowances</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6 mt-0">
          {canManage && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-foreground">Admin Actions</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Run bulk absence booking and prepare next-year setup actions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ManageOverviewAdminActions />
              </CardContent>
            </Card>
          )}

          {/* Absences Table */}
          <Card className="border-border">
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle className="text-foreground">
                    Absence Records
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {filteredAbsences.length} records found{pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
                  </CardDescription>
                </div>
                {pendingCount > 0 && (
                  <Link href="/approvals?tab=absences" className="w-full md:w-auto">
                    <Button
                      variant="outline"
                      className="w-full md:w-auto border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Review Pending in Approvals
                    </Button>
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border/60 bg-slate-900/20 p-4 mb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                  <h3 className="flex items-center gap-2 text-foreground font-medium">
                    <Filter className="h-4 w-4" />
                    Filters
                  </h3>
                  {(profileId || dateFrom || dateTo || reasonId || status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setProfileId('');
                        setDateFrom('');
                        setDateTo('');
                        setReasonId('');
                        setStatus('');
                      }}
                      className="border-border text-muted-foreground"
                    >
                      Clear Filters
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div>
                    <Label>Employee</Label>
                    <Select value={profileId || 'all'} onValueChange={(value) => setProfileId(value === 'all' ? '' : value)}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="All employees" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All employees</SelectItem>
                        {profiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.full_name} {profile.employee_id ? `(${profile.employee_id})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>From Date</Label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div>
                    <Label>To Date</Label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="bg-background border-border text-foreground"
                    />
                  </div>

                  <div>
                    <Label>Reason</Label>
                    <Select value={reasonId || 'all'} onValueChange={(value) => setReasonId(value === 'all' ? '' : value)}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="All reasons" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All reasons</SelectItem>
                        {reasons?.map((reason) => (
                          <SelectItem key={reason.id} value={reason.id}>
                            {reason.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Status</Label>
                    <Select value={status || 'all'} onValueChange={(value) => setStatus(value === 'all' ? '' : value)}>
                      <SelectTrigger className="bg-background border-border text-foreground">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeArchived}
                      onChange={(event) => handleIncludeArchivedChange(event.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-muted-foreground">Include archived records</span>
                  </label>
                  <Link href="/absence/archive-report" className="text-sm text-absence hover:underline">
                    Open archive report
                  </Link>
                </div>
              </div>

              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                  placeholder="Search records..."
                  className="pl-11 bg-slate-900/50 border-slate-600 text-white"
                />
              </div>

              {filteredAbsences.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">No absences found</h3>
                  <p className="text-muted-foreground">Try adjusting your filters</p>
                </div>
              ) : (
                <>
                  <div className="hidden md:block border border-slate-700 rounded-lg overflow-hidden">
                    <Table className="min-w-full">
                      <TableHeader>
                        <TableRow className="border-border">
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('employee')}>
                            <div className="flex items-center gap-2">Employee <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('reason')}>
                            <div className="flex items-center gap-2">Reason <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('date')}>
                            <div className="flex items-center gap-2">Date <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('duration')}>
                            <div className="flex items-center gap-2">Duration <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground cursor-pointer" onClick={() => handleSort('approved_at')}>
                            <div className="flex items-center gap-2">Date Approved <ArrowUpDown className="h-3 w-3" /></div>
                          </TableHead>
                          <TableHead className="bg-slate-900 text-muted-foreground">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedAbsences.map((absence) => (
                          <TableRow key={absence.id} className="border-slate-700 hover:bg-slate-800/30">
                            <TableCell className={
                              absence.status === 'pending'
                                ? 'text-amber-300'
                                : absence.status === 'rejected'
                                ? 'text-red-400'
                                : 'text-white'
                            }>
                              {absence.profiles.full_name}
                              {absence.profiles.employee_id && (
                                <span className="text-muted-foreground"> ({absence.profiles.employee_id})</span>
                              )}
                              {absence.record_source === 'archived' && (
                                <span className="ml-2 text-xs px-2 py-0.5 rounded border border-blue-500/30 text-blue-300">
                                  Archived
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={
                                    absence.absence_reasons.is_paid
                                      ? { backgroundColor: absence.absence_reasons.color || '#6b7280' }
                                      : { border: `1.5px solid ${absence.absence_reasons.color || '#6b7280'}` }
                                  }
                                />
                                <span className="text-muted-foreground">{absence.absence_reasons.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {absence.end_date && absence.date !== absence.end_date
                                ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                                : formatDate(absence.date)}
                              {absence.is_half_day && ` (${absence.half_day_session})`}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{formatDuration(absence.duration_days)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {absence.approved_at ? formatDate(absence.approved_at) : <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(absence.id)}
                                  disabled={absence.record_source === 'archived'}
                                  className="px-2 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                                {absence.status === 'pending' && absence.record_source !== 'archived' && (
                                  <Link href="/approvals?tab=absences">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                                    >
                                      Review
                                    </Button>
                                  </Link>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="md:hidden space-y-3">
                    {paginatedAbsences.map((absence) => (
                      <div
                        key={absence.id}
                        className="p-4 rounded-lg bg-slate-800/30 border border-border/50 hover:border-slate-600 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className={`font-semibold ${
                                absence.status === 'pending'
                                  ? 'text-amber-300'
                                  : absence.status === 'rejected'
                                  ? 'text-red-400'
                                  : 'text-white'
                              }`}>
                                {absence.profiles.full_name}
                                {absence.profiles.employee_id && ` (${absence.profiles.employee_id})`}
                              </h3>
                              {absence.record_source === 'archived' && (
                                <span className="text-[10px] px-2 py-0.5 rounded border border-blue-500/30 text-blue-300">
                                  Archived
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={
                                  absence.absence_reasons.is_paid
                                    ? { backgroundColor: absence.absence_reasons.color || '#6b7280' }
                                    : { border: `1.5px solid ${absence.absence_reasons.color || '#6b7280'}` }
                                }
                              />
                              <span className="text-sm text-muted-foreground">{absence.absence_reasons.name}</span>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {absence.end_date && absence.date !== absence.end_date
                                ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                                : formatDate(absence.date)}
                              {absence.is_half_day && ` (${absence.half_day_session})`}
                              {' · '}{formatDuration(absence.duration_days)}
                              {absence.approved_at && ` · Approved ${formatDate(absence.approved_at)}`}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(absence.id)}
                              disabled={absence.record_source === 'archived'}
                              className="px-2 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            {absence.status === 'pending' && absence.record_source !== 'archived' && (
                              <Link href="/approvals?tab=absences">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                                >
                                  Review
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-4">
                      <p className="text-sm text-muted-foreground">
                        Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredAbsences.length)} of {filteredAbsences.length}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage <= 1}
                          onClick={() => setCurrentPage((p) => p - 1)}
                          className="border-slate-600"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage >= totalPages}
                          onClick={() => setCurrentPage((p) => p + 1)}
                          className="border-slate-600"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="space-y-6 mt-0">
          <AbsenceCalendarAdmin />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="reasons" className="space-y-6 mt-0">
            <AbsenceReasonsContent />
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="allowances" className="space-y-6 mt-0">
            <AllowancesContent />
          </TabsContent>
        )}
      </Tabs>

      <AbsenceAboutHelper variant="manage" />

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create Absence Entry</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Create an absence entry for any employee
            </DialogDescription>
          </DialogHeader>
          
          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">Employee *</Label>
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger className="bg-slate-950 border-border text-foreground">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.full_name} {profile.employee_id ? `(${profile.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">Reason *</Label>
              <Select value={selectedReasonId} onValueChange={setSelectedReasonId}>
                <SelectTrigger className="bg-slate-950 border-border text-foreground">
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {reasons?.filter(r => r.is_active).map(reason => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.name} ({reason.is_paid ? 'Paid' : 'Unpaid'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">Start Date *</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate && endDate < e.target.value) {
                      setEndDate('');
                    }
                  }}
                  className="bg-slate-950 border-border text-foreground"
                />
              </div>
              
              <div className="space-y-1.5">
                <Label className="text-foreground font-medium">End Date (optional)</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  disabled={!startDate || isHalfDay}
                  className="bg-slate-950 border-border text-foreground"
                />
              </div>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">Duration options</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-slate-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked={isHalfDay}
                  onChange={(e) => {
                    setIsHalfDay(e.target.checked);
                    if (e.target.checked) setEndDate('');
                  }}
                  className="rounded border-border"
                />
                <span className="text-sm text-slate-400/90">Half Day</span>
              </div>
              
              {isHalfDay && (
                <div className="flex gap-3 pt-1">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value="AM"
                      checked={halfDaySession === 'AM'}
                      onChange={() => setHalfDaySession('AM')}
                    />
                    <span className="text-sm text-slate-400/90">AM</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value="PM"
                      checked={halfDaySession === 'PM'}
                      onChange={() => setHalfDaySession('PM')}
                    />
                    <span className="text-sm text-slate-400/90">PM</span>
                  </label>
                </div>
              )}
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-foreground font-medium">Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="bg-slate-950 border-border text-foreground"
              />
            </div>
            
            
            {startDate && (
              <div className="bg-slate-800/30 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  Duration: <span className="text-white font-medium">{formatDuration(duration)}</span>
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || !selectedProfileId || !selectedReasonId || !startDate}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {submitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Absence</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Are you sure you want to delete this absence record? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-300">This will permanently remove the absence record.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} className="border-border text-muted-foreground">
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteAbsence} disabled={deleteSubmitting || !deleteTargetId}>
              {deleteSubmitting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

