'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { Plus, FileText, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';

export default function TimesheetsPage() {
  const { user, isManager } = useAuth();
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    fetchTimesheets();
  }, [user]);

  const fetchTimesheets = async () => {
    if (!user) return;
    
    try {
      let query = supabase
        .from('timesheets')
        .select('*')
        .order('week_ending', { ascending: false });

      // If not manager, only show own timesheets
      if (!isManager) {
        query = query.eq('user_id', user.id);
      }

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Timesheets</h1>
          <p className="text-slate-400">
            Manage your weekly timesheets
          </p>
        </div>
        <Link href="/timesheets/new">
          <Button className="bg-timesheet hover:bg-timesheet/90 text-white">
            <Plus className="h-4 w-4 mr-2" />
            New Timesheet
          </Button>
        </Link>
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
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No timesheets yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first timesheet to get started
            </p>
            <Link href="/timesheets/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Timesheet
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {timesheets.map((timesheet) => (
            <Link key={timesheet.id} href={`/timesheets/${timesheet.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(timesheet.status)}
                      <div>
                        <CardTitle className="text-lg">
                          Week Ending {formatDate(timesheet.week_ending)}
                        </CardTitle>
                        <CardDescription>
                          {timesheet.reg_number && `Reg: ${timesheet.reg_number}`}
                        </CardDescription>
                      </div>
                    </div>
                    {getStatusBadge(timesheet.status)}
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
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

