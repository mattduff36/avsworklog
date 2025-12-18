'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Clock, CheckCircle2, XCircle, User, Filter, Calendar, Package } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { AbsenceWithRelations } from '@/types/absence';
import { TimesheetStatusFilter, StatusFilter } from '@/types/common';
import { usePendingAbsences, useApproveAbsence, useRejectAbsence, useAbsenceSummaryForEmployee } from '@/lib/hooks/useAbsence';

interface TimesheetWithProfile extends Timesheet {
  user: {
    full_name: string;
    employee_id: string;
  };
}

function ApprovalsContent() {
  const { isManager, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  
  const [timesheets, setTimesheets] = useState<TimesheetWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'timesheets');
  const [timesheetFilter, setTimesheetFilter] = useState<TimesheetStatusFilter>('pending');
  const statusFilter: StatusFilter = timesheetFilter;
  
  // Absence hooks
  const { data: absences } = usePendingAbsences();
  const approveAbsence = useApproveAbsence();
  const rejectAbsence = useRejectAbsence();

  const fetchApprovals = useCallback(async (filter: StatusFilter) => {
    try {
      setLoading(true);
      
      // Build query for timesheets
      let timesheetQuery = supabase
        .from('timesheets')
        .select(`
          *,
          user:profiles!user_id (
            full_name,
            employee_id
          )
        `);

      // Apply status filter
      if (filter === 'pending') {
        timesheetQuery = timesheetQuery.eq('status', 'submitted');
      } else if (filter === 'approved') {
        timesheetQuery = timesheetQuery.eq('status', 'approved');
      } else if (filter === 'rejected') {
        timesheetQuery = timesheetQuery.eq('status', 'rejected');
      } else if (filter === 'processed') {
        timesheetQuery = timesheetQuery.eq('status', 'processed');
      } else if (filter === 'adjusted') {
        timesheetQuery = timesheetQuery.eq('status', 'adjusted');
      }
      // 'all' doesn't filter

      const { data: timesheetData, error: timesheetError } = await timesheetQuery
        .order('submitted_at', { ascending: false });

      if (timesheetError) throw timesheetError;
      setTimesheets(timesheetData || []);
    } catch (error) {
      console.error('Error fetching approvals:', error);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!authLoading) {
      if (!isManager) {
        router.push('/dashboard');
        return;
      }
      fetchApprovals(statusFilter);
    }
  }, [isManager, authLoading, router, fetchApprovals, statusFilter, activeTab]);

  const handleQuickApprove = async (type: 'timesheet', id: string) => {
    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;

      // Refresh data
      await fetchApprovals(statusFilter);
    } catch (error) {
      console.error('Error approving:', error);
    }
  };

  const handleQuickReject = async (type: 'timesheet', id: string) => {
    const comments = prompt('Enter rejection reason:');
    if (!comments) return;

    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          manager_comments: comments,
        })
        .eq('id', id);
      if (error) throw error;

      // Refresh data
      await fetchApprovals(statusFilter);
    } catch (error) {
      console.error('Error rejecting:', error);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading approvals...</p>
      </div>
    );
  }

  const totalCount = timesheets.length;

  const getFilterLabel = (filter: StatusFilter) => {
    switch (filter) {
      case 'pending': return 'Pending';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      case 'processed': return 'Processed';
      case 'adjusted': return 'Adjusted';
      case 'all': return 'All';
    }
  };

  // Get filter options (timesheet-focused approvals)
  const getFilterOptions = (): StatusFilter[] => {
    if (activeTab === 'timesheets') {
      return ['pending', 'approved', 'rejected', 'processed', 'adjusted', 'all'];
    }
    // Absences tab still reuses the same label set, but only 'pending' is relevant there
    return ['pending', 'approved', 'rejected'];
  };

  // Handle filter change (timesheet approvals only)
  const handleFilterChange = (filter: StatusFilter) => {
    if (activeTab === 'timesheets') {
      setTimesheetFilter(filter as TimesheetStatusFilter);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
        return (
          <Badge variant="warning">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'approved':
        return (
          <Badge variant="success" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      case 'processed':
        return (
          <Badge variant="default">
            Processed
          </Badge>
        );
      case 'adjusted':
        return (
          <Badge variant="default" className="bg-purple-500/10 text-purple-600 border-purple-500/20">
            Adjusted
          </Badge>
        );
      case 'draft':
        return (
          <Badge variant="secondary">
            <FileText className="h-3 w-3 mr-1" />
            Draft
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            {status}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Approvals</h1>
            <p className="text-slate-600 dark:text-slate-400">
              Review and manage submissions
            </p>
          </div>
          <Badge variant={statusFilter === 'pending' ? 'warning' : 'secondary'} className="text-lg px-4 py-2">
            {totalCount} {getFilterLabel(statusFilter)}
          </Badge>
        </div>
      </div>

      {totalCount === 0 ? (
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="flex flex-col items-center justify-center py-12">
            {statusFilter === 'pending' && <CheckCircle2 className="h-16 w-16 text-green-400 mb-4" />}
            {statusFilter === 'approved' && <CheckCircle2 className="h-16 w-16 text-green-400 mb-4" />}
            {statusFilter === 'rejected' && <XCircle className="h-16 w-16 text-red-400 mb-4" />}
            {statusFilter === 'all' && <FileText className="h-16 w-16 text-slate-400 mb-4" />}
            <h3 className="text-lg font-semibold text-white mb-2">
              {statusFilter === 'pending' && 'All caught up!'}
              {statusFilter === 'approved' && 'No approved submissions'}
              {statusFilter === 'rejected' && 'No rejected submissions'}
              {statusFilter === 'all' && 'No submissions yet'}
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              {statusFilter === 'pending' && 'There are no pending approvals at the moment'}
              {statusFilter === 'approved' && 'There are no approved submissions to display'}
              {statusFilter === 'rejected' && 'There are no rejected submissions to display'}
              {statusFilter === 'all' && 'No submissions have been made yet'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-3xl grid-cols-2 h-auto p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <TabsTrigger 
              value="timesheets" 
              className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
              style={activeTab === 'timesheets' ? {
                backgroundColor: 'hsl(210 90% 50%)', // Timesheet Blue
                color: 'white',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
              } : {}}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                <span className="text-sm font-medium">Timesheets</span>
                {timesheets.length > 0 && (
                  <Badge 
                    variant="secondary" 
                    className={activeTab === 'timesheets' ? "bg-white/20 text-white border-white/30" : ""}
                  >
                    {timesheets.length}
                  </Badge>
                )}
              </div>
            </TabsTrigger>
            <TabsTrigger 
              value="absences" 
              className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
              style={activeTab === 'absences' ? {
                backgroundColor: 'hsl(260 60% 50%)', // Purple for absences
                color: 'white',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
              } : {}}
            >
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                <span className="text-sm font-medium">Absences</span>
                {absences && absences.length > 0 && (
                  <Badge 
                    variant="secondary"
                    className={activeTab === 'absences' ? "bg-white/20 text-white border-white/30" : ""}
                  >
                    {absences.length}
                  </Badge>
                )}
              </div>
            </TabsTrigger>
          </TabsList>

          {/* Status Filter Buttons - Now below tabs */}
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 mt-6">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-400 mr-2">Filter by status:</span>
                <div className="flex gap-2 flex-wrap">
                  {getFilterOptions().map((filter) => (
                    <Button
                      key={filter}
                      variant={statusFilter === filter ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleFilterChange(filter)}
                      className={statusFilter === filter ? '' : 'border-slate-600 text-slate-300 hover:bg-slate-700/50'}
                    >
                      {filter === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                      {filter === 'approved' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {filter === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}
                      {filter === 'processed' && <Package className="h-3 w-3 mr-1" />}
                      {filter === 'adjusted' && <Package className="h-3 w-3 mr-1" />}
                      {getFilterLabel(filter)}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <TabsContent value="timesheets" className="mt-6 space-y-4">
            {timesheets.length === 0 ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                <CardContent className="py-12 text-center text-slate-600 dark:text-slate-400">
                  No pending timesheet approvals
                </CardContent>
              </Card>
            ) : (
              timesheets.map((timesheet) => (
                <Link key={timesheet.id} href={`/timesheets/${timesheet.id}`} className="block">
                  <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-timesheet/50 transition-all duration-200 cursor-pointer">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                          <FileText className="h-5 w-5 text-amber-600" />
                          <div>
                            <CardTitle className="text-lg">
                              Week Ending {formatDate(timesheet.week_ending)}
                            </CardTitle>
                            <CardDescription className="flex items-center gap-2 mt-1">
                              <User className="h-3 w-3" />
                              {timesheet.user?.full_name || 'Unknown'} 
                              {timesheet.user?.employee_id && ` (${timesheet.user.employee_id})`}
                            </CardDescription>
                          </div>
                        </div>
                        {getStatusBadge(timesheet.status)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                          {timesheet.submitted_at ? `Submitted ${formatDate(timesheet.submitted_at)}` : 'Not submitted'}
                          {timesheet.reg_number && ` • Reg: ${timesheet.reg_number}`}
                        </div>
                        {timesheet.status === 'submitted' && (
                          <div className="flex gap-2" onClick={(e) => e.preventDefault()}>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleQuickReject('timesheet', timesheet.id);
                              }}
                              className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all"
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleQuickApprove('timesheet', timesheet.id);
                              }}
                              className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all"
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </TabsContent>

          {/* Inspections tab removed - inspections no longer require approvals */}

          <TabsContent value="absences" className="mt-6 space-y-4">
            {!absences || absences.length === 0 ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                <CardContent className="py-12 text-center text-slate-600 dark:text-slate-400">
                  No pending absence approvals
                </CardContent>
              </Card>
            ) : (
              absences.map((absence) => (
                <AbsenceApprovalCard 
                  key={absence.id} 
                  absence={absence}
                  onApprove={approveAbsence}
                  onReject={rejectAbsence}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// Absence Approval Card Component
function AbsenceApprovalCard({ 
  absence, 
  onApprove, 
  onReject 
}: { 
  absence: AbsenceWithRelations;
  onApprove: ReturnType<typeof useApproveAbsence>;
  onReject: ReturnType<typeof useRejectAbsence>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const { data: summary } = useAbsenceSummaryForEmployee(absence.profile_id);
  
  async function handleApprove() {
    // Check allowance for Annual Leave
    if (absence.absence_reasons.name === 'Annual leave') {
      const projectedRemaining = (summary?.remaining || 0) - absence.duration_days;
      if (projectedRemaining < 0) {
        const confirmed = await import('@/lib/services/notification.service').then(m => 
          m.notify.confirm({
            title: 'Insufficient Allowance',
            description: 'Warning: This request exceeds the employee\'s available allowance. Approve anyway?',
            confirmText: 'Approve Anyway',
            destructive: true,
          })
        );
        if (!confirmed) {
          return;
        }
      }
    }
    
    try {
      await onApprove.mutateAsync(absence.id);
    } catch (error) {
      console.error('Error approving absence:', error);
    }
  }
  
  async function handleReject() {
    if (!rejectionReason.trim()) {
      toast.error('Rejection reason required', {
        description: 'Please provide a reason for rejecting this absence request.',
      });
      return;
    }
    
    try {
      await onReject.mutateAsync({ id: absence.id, reason: rejectionReason });
      setRejecting(false);
      setRejectionReason('');
    } catch (error) {
      console.error('Error rejecting absence:', error);
    }
  }
  
  const projectedRemaining = absence.absence_reasons.name === 'Annual leave' 
    ? (summary?.remaining || 0) - absence.duration_days 
    : null;
  
  return (
    <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-purple-500/50 transition-all duration-200">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <Calendar className="h-5 w-5 text-purple-600" />
            <div>
              <CardTitle className="text-lg">
                {absence.profiles.full_name}
                {absence.profiles.employee_id && ` (${absence.profiles.employee_id})`}
              </CardTitle>
              <CardDescription className="mt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="border-slate-600 text-slate-300">
                    {absence.absence_reasons.name}
                  </Badge>
                  {absence.absence_reasons.is_paid ? (
                    <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
                      Paid
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-slate-600 text-slate-400">
                      Unpaid
                    </Badge>
                  )}
                </div>
                <div className="text-xs mt-2">
                  <div>
                    {absence.end_date && absence.date !== absence.end_date
                      ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                      : formatDate(absence.date)
                    }
                    {absence.is_half_day && ` (${absence.half_day_session})`}
                  </div>
                  <div className="text-slate-500">
                    Duration: {absence.duration_days} days
                  </div>
                </div>
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {absence.notes && (
            <div className="p-3 bg-slate-800/30 rounded-lg">
              <p className="text-sm text-slate-400">
                <span className="text-slate-500 font-medium">Notes:</span> {absence.notes}
              </p>
            </div>
          )}
          
          {absence.absence_reasons.name === 'Annual leave' && summary && (
            <div className="p-3 bg-slate-800/30 rounded-lg">
              <h4 className="text-sm font-medium text-white mb-2">Employee Allowance Summary</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-slate-500">Allowance</p>
                  <p className="text-white font-medium">{summary.allowance} days</p>
                </div>
                <div>
                  <p className="text-slate-500">Approved Taken</p>
                  <p className="text-white font-medium">{summary.approved_taken} days</p>
                </div>
                <div>
                  <p className="text-slate-500">Pending</p>
                  <p className="text-amber-400 font-medium">{summary.pending_total} days</p>
                </div>
                <div>
                  <p className="text-slate-500">After Approval</p>
                  <p className={`font-medium ${projectedRemaining !== null && projectedRemaining < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {projectedRemaining} days
                  </p>
                </div>
              </div>
              {projectedRemaining !== null && projectedRemaining < 0 && (
                <div className="mt-2 p-2 bg-red-500/20 rounded border border-red-500/30">
                  <p className="text-xs text-red-300">
                    ⚠️ Warning: Approving will exceed available allowance
                  </p>
                </div>
              )}
            </div>
          )}
          
          {rejecting ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="rejectionReason">Rejection Reason *</Label>
                <Input
                  id="rejectionReason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Provide a reason for rejection..."
                  className="bg-white dark:bg-slate-900 border-slate-600"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRejecting(false);
                    setRejectionReason('');
                  }}
                  className="border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReject}
                  disabled={!rejectionReason.trim()}
                  className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Confirm Rejection
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Submitted {formatDate(absence.created_at)}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRejecting(true)}
                  className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleApprove}
                  className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approve
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><p className="text-muted-foreground">Loading...</p></div>}>
      <ApprovalsContent />
    </Suspense>
  );
}

