'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
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
import { Plus, FileText, Clock, CheckCircle2, XCircle, User, Download } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { toast } from 'sonner';

type Employee = {
  id: string;
  full_name: string;
  employee_id: string | null;
};

export default function TimesheetsPage() {
  const { user, isManager } = useAuth();
  const router = useRouter();
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [downloading, setDownloading] = useState<string | null>(null);
  const supabase = createClient();

  // Fetch employees if manager
  useEffect(() => {
    if (user && isManager) {
      fetchEmployees();
    }
  }, [user, isManager]);

  useEffect(() => {
    fetchTimesheets();
  }, [user, isManager, selectedEmployeeId]);

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
        }
      }
    }
  });

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

  const fetchTimesheets = async () => {
    if (!user) return;
    
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

      const { data, error } = await query;

      if (error) throw error;
      setTimesheets(data || []);
    } catch (error) {
      console.error('Error fetching timesheets:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending' },
      approved: { variant: 'success' as const, label: 'Approved' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
    };

    const config = variants[status as keyof typeof variants] || variants.draft;

    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'submitted':
        return <Clock className="h-5 w-5 text-amber-600" />;
      case 'approved':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-600" />;
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
      alert('Failed to download PDF');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Timesheets</h1>
            <p className="text-slate-600 dark:text-slate-400">
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
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 max-w-md">
              <Label htmlFor="employee-filter" className="text-slate-900 dark:text-white text-sm flex items-center gap-2 whitespace-nowrap">
                <User className="h-4 w-4" />
                View timesheets for:
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger id="employee-filter" className="h-10 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white">
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
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No timesheets yet</h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
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
        <div className="grid gap-4">
          {timesheets.map((timesheet) => (
            <Card 
              key={timesheet.id} 
              className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-timesheet/50 transition-all duration-200 cursor-pointer"
              onClick={() => router.push(`/timesheets/${timesheet.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(timesheet.status)}
                    <div>
                      <CardTitle className="text-lg text-slate-900 dark:text-white">
                        Week Ending {formatDate(timesheet.week_ending)}
                      </CardTitle>
                      <CardDescription className="text-slate-600 dark:text-slate-400">
                        {isManager && (timesheet as any).profile?.full_name && (
                          <span className="font-medium text-slate-900 dark:text-white">
                            {(timesheet as any).profile.full_name}
                            {timesheet.reg_number && ' • '}
                          </span>
                        )}
                        {timesheet.reg_number && `Reg: ${timesheet.reg_number}`}
                      </CardDescription>
                    </div>
                  </div>
                  {getStatusBadge(timesheet.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-slate-600 dark:text-slate-400">
                    {timesheet.submitted_at
                      ? `Submitted ${formatDate(timesheet.submitted_at)}`
                      : 'Not yet submitted'}
                  </div>
                  {timesheet.status === 'rejected' && timesheet.manager_comments && (
                    <div className="text-red-600 text-xs">
                      See manager comments
                    </div>
                  )}
                  {/* Download PDF Button for Approved/Pending */}
                  {(timesheet.status === 'approved' || timesheet.status === 'submitted') && (
                    <Button
                      onClick={(e) => handleDownloadPDF(e, timesheet.id)}
                      disabled={downloading === timesheet.id}
                      variant="outline"
                      size="sm"
                      className="bg-white dark:bg-slate-900 border-timesheet text-timesheet hover:bg-timesheet hover:text-white transition-all duration-200"
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
      )}
    </div>
  );
}

