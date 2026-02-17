'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useTimesheetRealtime } from '@/lib/hooks/useRealtime';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Clock, CheckCircle2, XCircle, User, Download, Trash2, Filter, Package, AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { Employee, TimesheetStatusFilter } from '@/types/common';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TimesheetWithProfile extends Timesheet {
  profile?: {
    full_name: string;
  };
}

export default function TimesheetsPage() {
  const { user, isManager } = useAuth();
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('timesheets');
  const router = useRouter();
  const [timesheets, setTimesheets] = useState<TimesheetWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<TimesheetStatusFilter>('all');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [timesheetToDelete, setTimesheetToDelete] = useState<{ id: string; weekEnding: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(12); // Show 12 timesheets initially
  const supabase = createClient();

  useEffect(() => {
    if (user && isManager) {
      const fetchEmployees = async () => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, employee_id')
            .order('full_name');
          
          if (error) throw error;
          setEmployees(data || []);
        } catch (err) {
          console.error('Error fetching employees:', err);
        }
      };

      fetchEmployees();
    }
  }, [user, isManager, supabase]);

  useEffect(() => {
    fetchTimesheets();
  }, [user?.id, isManager, selectedEmployeeId, statusFilter, fetchTimesheets]);

  // Listen for realtime updates to timesheets
  useTimesheetRealtime((payload) => {
    console.log('Realtime timesheet update:', payload);
    
    // Refetch timesheets when changes occur
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
      fetchTimesheets();
      
      // Show toast notification for significant changes
      if (payload.eventType === 'UPDATE' && payload.new && 'status' in payload.new) {
        const status = (payload.new as { status?: string }).status;
        if (status === 'approved') {
          toast.success('Timesheet approved!', {
            description: 'A timesheet has been approved by your manager.',
          });
        } else if (status === 'rejected') {
          toast.error('Timesheet rejected', {
            description: 'A timesheet has been rejected. Please review the comments.',
          });
        } else if (status === 'processed') {
          toast.success('Timesheet processed!', {
            description: 'A timesheet has been processed for payroll.',
          });
        }
      }
    }
  });

  const fetchTimesheets = useCallback(async () => {
    if (!user) return;
    setFetchError(null);
    
    try {
      let query = supabase
        .from('timesheets')
        .select(`
          *,
          profile:profiles!timesheets_user_id_fkey(full_name)
        `)
        .order('week_ending', { ascending: false });

      // Filter based on user role and selection
      if (!isManager) {
        // Regular employees only see their own
        query = query.eq('user_id', user.id);
      } else if (selectedEmployeeId && selectedEmployeeId !== 'all') {
        // Manager filtering by specific employee
        query = query.eq('user_id', selectedEmployeeId);
      }
      // If manager and 'all' selected, show all timesheets

      // Apply status filter
      if (statusFilter === 'pending') {
        query = query.eq('status', 'submitted');
      } else if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      // 'all' doesn't filter by status

      const { data, error } = await query;

      if (error) throw error;
      setTimesheets(data || []);
    } catch (error) {
      const message = (() => {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        try {
          return JSON.stringify(error);
        } catch {
          return String(error);
        }
      })();
      const isNetworkFailure =
        message.includes('Failed to fetch') || message.includes('NetworkError') || message.toLowerCase().includes('network');

      // Avoid escalating common mobile/offline network failures into centralized error logs
      if (isNetworkFailure) {
        console.warn('Unable to load timesheets (network):', error);
      } else {
        console.error('Error fetching timesheets:', error);
      }

      // Always set inline error state so the UI shows feedback even if toast fails
      if (!navigator.onLine || isNetworkFailure) {
        setFetchError('Unable to load timesheets. Please check your internet connection.');
        toast.error('Unable to load timesheets', {
          description: 'Please check your internet connection.',
        });
      } else {
        setFetchError('Unable to load timesheets. Please try again.');
        toast.error('Unable to load timesheets', {
          description: 'Something went wrong. Please try again.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [user, isManager, selectedEmployeeId, statusFilter, supabase]);

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending' },
      approved: { variant: 'success' as const, label: 'Approved' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
      processed: { variant: 'default' as const, label: 'Processed' },
      adjusted: { variant: 'default' as const, label: 'Adjusted' },
    };

    const config = variants[status as keyof typeof variants] || variants.draft;
    
    // Apply blue styling for final states (processed and adjusted)
    const isFinalState = status === 'processed' || status === 'adjusted';
    const blueClasses = isFinalState ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' : '';

    return <Badge variant={config.variant} className={blueClasses}>{config.label}</Badge>;
  };

  const getFilterLabel = (filter: TimesheetStatusFilter) => {
    switch (filter) {
      case 'all': return 'All';
      case 'draft': return 'Draft';
      case 'pending': return 'Pending';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      case 'processed': return 'Processed';
      case 'adjusted': return 'Adjusted';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Clock className="h-5 w-5 text-amber-600" />;
      case 'approved':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'processed':
        return <Package className="h-5 w-5 text-blue-600" />;
      default:
        return <FileText className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const handleDownloadPDF = async (e: React.MouseEvent, timesheetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDownloading(timesheetId);
    try {
      const response = await fetch(`/api/timesheets/${timesheetId}/pdf`);
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timesheet-${timesheetId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error('Failed to download PDF', {
        description: 'Please try again or contact support if the problem persists.',
      });
    } finally {
      setDownloading(null);
    }
  };

  const openDeleteDialog = (e: React.MouseEvent, timesheet: Timesheet) => {
    e.stopPropagation(); // Prevent card click
    setTimesheetToDelete({
      id: timesheet.id,
      weekEnding: formatDate(timesheet.week_ending),
    });
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!timesheetToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/timesheets/${timesheetToDelete.id}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete timesheet');
      }

      toast.success('Timesheet deleted successfully');
      setDeleteDialogOpen(false);
      setTimesheetToDelete(null);
      fetchTimesheets(); // Refresh list
    } catch (err) {
      console.error('Error deleting timesheet:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete timesheet');
    } finally {
      setDeleting(false);
    }
  };

  // Show loading while checking permissions
  if (permissionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Don't render if no permission (hook will redirect)
  if (!hasPermission) {
    return null;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      
      {/* Header */}
      <div className="bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Timesheets</h1>
            <p className="text-muted-foreground">
              Manage your weekly timesheets
            </p>
          </div>
          <Link href="/timesheets/new">
            <Button className="bg-timesheet hover:bg-timesheet-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg">
              <Plus className="h-4 w-4 mr-2" />
              New Timesheet
            </Button>
          </Link>
        </div>
        
        {/* Manager: Employee Filter */}
        {isManager && employees.length > 0 && (
          <div className="pt-4 border-t border-border">
            <div className="flex items-center gap-3 max-w-md">
              <Label htmlFor="employee-filter" className="text-white text-sm flex items-center gap-2 whitespace-nowrap">
                <User className="h-4 w-4" />
                View timesheets for:
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger id="employee-filter" className="h-10 border-border text-white">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Status Filter - Only show for managers */}
      {isManager && (
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-slate-400 mr-2">Filter by status:</span>
              <div className="flex gap-2 flex-wrap">
                {(['all', 'draft', 'pending', 'approved', 'rejected', 'processed', 'adjusted'] as TimesheetStatusFilter[]).map((filter) => (
                  <Button
                    key={filter}
                    variant="outline"
                    size="sm"
                    onClick={() => setStatusFilter(filter)}
                    className={statusFilter === filter ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
                  >
                    {filter === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                    {filter === 'approved' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {filter === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}
                    {filter === 'processed' && <Package className="h-3 w-3 mr-1" />}
                    {filter === 'adjusted' && <AlertTriangle className="h-3 w-3 mr-1" />}
                    {filter === 'draft' && <FileText className="h-3 w-3 mr-1" />}
                    {getFilterLabel(filter)}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {fetchError && !loading && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{fetchError}</p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto shrink-0"
              onClick={() => fetchTimesheets()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3 flex-1">
                    <Skeleton className="h-5 w-5" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : timesheets.length === 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No timesheets yet</h3>
            <p className="text-slate-400 mb-4">
              Create your first timesheet to get started
            </p>
            <Link href="/timesheets/new">
              <Button className="bg-timesheet hover:bg-timesheet-dark text-white transition-all duration-200 active:scale-95">
                <Plus className="h-4 w-4 mr-2" />
                Create Timesheet
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4">
            {timesheets.slice(0, displayCount).map((timesheet) => (
            <Card 
              key={timesheet.id} 
              className="border-border hover:shadow-lg hover:border-timesheet/50 transition-all duration-200 cursor-pointer"
              onClick={() => {
                // Redirect draft timesheets to /timesheets/new for editing with validation
                if (timesheet.status === 'draft' || timesheet.status === 'rejected') {
                  router.push(`/timesheets/new?id=${timesheet.id}`);
                } else {
                  router.push(`/timesheets/${timesheet.id}`);
                }
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(timesheet.status)}
                    <div>
                      <CardTitle className="text-lg text-white">
                        Week Ending {formatDate(timesheet.week_ending)}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {isManager && timesheet.profile?.full_name && (
                          <span className="font-medium text-white">
                            {timesheet.profile.full_name}
                            {timesheet.reg_number && ' • '}
                          </span>
                        )}
                        {timesheet.reg_number && `Reg: ${timesheet.reg_number}`}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(timesheet.status)}
                    {isManager && (
                      <Button
                        onClick={(e) => openDeleteDialog(e, timesheet)}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        title="Delete timesheet"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">
                    {timesheet.submitted_at
                      ? `Submitted ${formatDate(timesheet.submitted_at)}`
                      : 'Not yet submitted'}
                  </div>
                  {timesheet.status === 'rejected' && timesheet.manager_comments && (
                    <div className="text-red-600 text-xs">
                      See manager comments
                    </div>
                  )}
                  {/* Download PDF Button for submitted, approved, processed, and adjusted statuses */}
                  {(timesheet.status === 'submitted' || timesheet.status === 'approved' || timesheet.status === 'processed' || timesheet.status === 'adjusted') && (
                    <Button
                      onClick={(e) => handleDownloadPDF(e, timesheet.id)}
                      disabled={downloading === timesheet.id}
                      variant="outline"
                      size="sm"
                      className="bg-slate-900 border-timesheet text-timesheet hover:bg-timesheet hover:text-white transition-all duration-200"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {downloading === timesheet.id ? 'Downloading...' : 'Download PDF'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            ))}
          </div>

          {/* Show More Button */}
          {timesheets.length > displayCount && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => setDisplayCount(prev => prev + 12)}
                variant="outline"
                className="w-full max-w-xs border-border text-white hover:bg-slate-800"
              >
                Show More ({timesheets.length - displayCount} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Timesheet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the timesheet for week ending{' '}
              <span className="font-semibold">{timesheetToDelete?.weekEnding}</span>?
              <br />
              <br />
              This action cannot be undone. All timesheet entries will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

