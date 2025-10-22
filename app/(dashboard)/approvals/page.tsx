'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Clipboard, Clock, CheckCircle2, XCircle, User, Filter } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { VehicleInspection } from '@/types/inspection';

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

interface TimesheetWithProfile extends Timesheet {
  user: {
    full_name: string;
    employee_id: string;
  };
}

interface InspectionWithDetails extends VehicleInspection {
  user: {
    full_name: string;
    employee_id: string;
  };
  vehicles: {
    reg_number: string;
  };
}

export default function ApprovalsPage() {
  const { isManager, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  
  const [timesheets, setTimesheets] = useState<TimesheetWithProfile[]>([]);
  const [inspections, setInspections] = useState<InspectionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('timesheets');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');

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
      }
      // 'all' doesn't filter

      const { data: timesheetData, error: timesheetError } = await timesheetQuery
        .order('submitted_at', { ascending: false });

      if (timesheetError) throw timesheetError;
      setTimesheets(timesheetData || []);

      // Build query for inspections
      let inspectionQuery = supabase
        .from('vehicle_inspections')
        .select(`
          *,
          user:profiles!user_id (
            full_name,
            employee_id
          ),
          vehicles (
            reg_number
          )
        `);

      // Apply status filter
      if (filter === 'pending') {
        inspectionQuery = inspectionQuery.eq('status', 'submitted');
      } else if (filter === 'approved') {
        inspectionQuery = inspectionQuery.eq('status', 'approved');
      } else if (filter === 'rejected') {
        inspectionQuery = inspectionQuery.eq('status', 'rejected');
      }

      const { data: inspectionData, error: inspectionError } = await inspectionQuery
        .order('submitted_at', { ascending: false });

      if (inspectionError) throw inspectionError;
      setInspections(inspectionData || []);
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
  }, [isManager, authLoading, router, fetchApprovals, statusFilter]);

  const handleQuickApprove = async (type: 'timesheet' | 'inspection', id: string) => {
    try {
      if (type === 'timesheet') {
        const { error } = await supabase
          .from('timesheets')
          .update({
            status: 'approved',
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('vehicle_inspections')
          .update({
            status: 'approved',
            reviewed_at: new Date().toISOString(),
          })
          .eq('id', id);
        if (error) throw error;
      }

      // Refresh data
      await fetchApprovals(statusFilter);
    } catch (error) {
      console.error('Error approving:', error);
    }
  };

  const handleQuickReject = async (type: 'timesheet' | 'inspection', id: string) => {
    const comments = prompt('Enter rejection reason:');
    if (!comments) return;

    try {
      if (type === 'timesheet') {
        const { error } = await supabase
          .from('timesheets')
          .update({
            status: 'rejected',
            reviewed_at: new Date().toISOString(),
            manager_comments: comments,
          })
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('vehicle_inspections')
          .update({
            status: 'rejected',
            reviewed_at: new Date().toISOString(),
            manager_comments: comments,
          })
          .eq('id', id);
        if (error) throw error;
      }

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

  const totalCount = timesheets.length + inspections.length;

  const getFilterLabel = (filter: StatusFilter) => {
    switch (filter) {
      case 'pending': return 'Pending';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      case 'all': return 'All';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Approvals</h1>
          <p className="text-slate-400">
            Review and manage submissions
          </p>
        </div>
        <Badge variant={statusFilter === 'pending' ? 'warning' : 'secondary'} className="text-lg px-4 py-2">
          {totalCount} {getFilterLabel(statusFilter)}
        </Badge>
      </div>

      {/* Status Filter Buttons */}
      <Card className="bg-slate-800/40 backdrop-blur-xl border-slate-700/50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-400 mr-2">Filter by status:</span>
            <div className="flex gap-2 flex-wrap">
              {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((filter) => (
                <Button
                  key={filter}
                  variant={statusFilter === filter ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatusFilter(filter)}
                  className={statusFilter === filter ? '' : 'border-slate-600 text-slate-300 hover:bg-slate-700/50'}
                >
                  {filter === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                  {filter === 'approved' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                  {filter === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}
                  {getFilterLabel(filter)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {totalCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            {statusFilter === 'pending' && <CheckCircle2 className="h-16 w-16 text-green-600 mb-4" />}
            {statusFilter === 'approved' && <CheckCircle2 className="h-16 w-16 text-green-600 mb-4" />}
            {statusFilter === 'rejected' && <XCircle className="h-16 w-16 text-red-600 mb-4" />}
            {statusFilter === 'all' && <FileText className="h-16 w-16 text-slate-400 mb-4" />}
            <h3 className="text-lg font-semibold mb-2">
              {statusFilter === 'pending' && 'All caught up!'}
              {statusFilter === 'approved' && 'No approved submissions'}
              {statusFilter === 'rejected' && 'No rejected submissions'}
              {statusFilter === 'all' && 'No submissions yet'}
            </h3>
            <p className="text-muted-foreground">
              {statusFilter === 'pending' && 'There are no pending approvals at the moment'}
              {statusFilter === 'approved' && 'There are no approved submissions to display'}
              {statusFilter === 'rejected' && 'There are no rejected submissions to display'}
              {statusFilter === 'all' && 'No submissions have been made yet'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-md grid-cols-2 bg-transparent gap-2">
            <TabsTrigger 
              value="timesheets" 
              className="flex items-center gap-2 bg-timesheet/80 text-white data-[state=active]:bg-timesheet data-[state=active]:shadow-lg data-[state=active]:scale-105 transition-all"
            >
              <FileText className="h-4 w-4" />
              Timesheets
              {timesheets.length > 0 && (
                <Badge variant="secondary" className="ml-1 bg-white/20 text-white border-white/30">
                  {timesheets.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger 
              value="inspections" 
              className="flex items-center gap-2 bg-inspection/80 text-white data-[state=active]:bg-inspection data-[state=active]:shadow-lg data-[state=active]:scale-105 transition-all"
            >
              <Clipboard className="h-4 w-4" />
              Inspections
              {inspections.length > 0 && (
                <Badge variant="secondary" className="ml-1 bg-white/20 text-white border-white/30">
                  {inspections.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timesheets" className="mt-6 space-y-4">
            {timesheets.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No pending timesheet approvals
                </CardContent>
              </Card>
            ) : (
              timesheets.map((timesheet) => (
                <Card key={timesheet.id} className="hover:shadow-md transition-shadow">
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
                      <Badge variant="warning">
                        <Clock className="h-3 w-3 mr-1" />
                        Pending
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        Submitted {formatDate(timesheet.submitted_at || '')}
                        {timesheet.reg_number && ` • Reg: ${timesheet.reg_number}`}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleQuickReject('timesheet', timesheet.id)}
                          className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all"
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleQuickApprove('timesheet', timesheet.id)}
                          className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                        <Link href={`/timesheets/${timesheet.id}`}>
                          <Button size="sm">
                            View Details
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="inspections" className="mt-6 space-y-4">
            {inspections.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No pending inspection approvals
                </CardContent>
              </Card>
            ) : (
              inspections.map((inspection) => (
                <Card key={inspection.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <Clipboard className="h-5 w-5 text-amber-600" />
                        <div>
                          <CardTitle className="text-lg">
                            {inspection.vehicles?.reg_number || 'Unknown Vehicle'}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            <div className="flex items-center gap-2">
                              <User className="h-3 w-3" />
                              {inspection.user?.full_name || 'Unknown'}
                              {inspection.user?.employee_id && ` (${inspection.user.employee_id})`}
                            </div>
                            <div className="text-xs mt-1">
                              {formatDate(inspection.inspection_date)}
                            </div>
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant="warning">
                        <Clock className="h-3 w-3 mr-1" />
                        Pending
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        Submitted {formatDate(inspection.submitted_at || '')}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleQuickReject('inspection', inspection.id)}
                          className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all"
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleQuickApprove('inspection', inspection.id)}
                          className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                        <Link href={`/inspections/${inspection.id}`}>
                          <Button size="sm">
                            View Details
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

