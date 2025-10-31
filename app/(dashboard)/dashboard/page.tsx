'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatDate } from '@/lib/utils/date';
import { 
  Clock, 
  CheckCircle2, 
  XCircle,
  Plus,
  FileSpreadsheet,
  AlertTriangle,
  Wrench,
  PackageCheck,
  Clipboard,
  HardHat,
  Truck,
  FileCheck,
  ScrollText,
  CarFront,
  FileText
} from 'lucide-react';
import { getEnabledForms } from '@/lib/config/forms';
import { Database } from '@/types/database';

type RecentActivity = {
  id: string;
  type: 'timesheet' | 'inspection';
  title: string;
  user: string;
  status: string;
  created_at: string;
};

type Action = Database['public']['Tables']['actions']['Row'] & {
  vehicle_inspections?: {
    inspection_date: string;
    vehicles?: {
      reg_number: string;
    };
  };
  inspection_items?: {
    item_description: string;
    status: string;
  };
};

export default function DashboardPage() {
  const { profile, isManager, isAdmin } = useAuth();
  const formTypes = getEnabledForms();
  const supabase = createClient();

  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [topActions, setTopActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRAMSCount, setPendingRAMSCount] = useState(0);

  // Placeholder forms for future development (only shown to managers/admins)
  const placeholderForms = [
    { id: 'incident', title: 'Incident Report', icon: AlertTriangle, color: 'bg-red-500' },
    { id: 'maintenance', title: 'Maintenance Request', icon: Wrench, color: 'bg-purple-500' },
    { id: 'delivery', title: 'Delivery Note', icon: PackageCheck, color: 'bg-green-500' },
    { id: 'site-diary', title: 'Site Diary', icon: Clipboard, color: 'bg-cyan-500' },
    { id: 'plant-hire', title: 'Plant Hire', icon: Truck, color: 'bg-indigo-500' },
    { id: 'quality-check', title: 'Quality Check', icon: FileCheck, color: 'bg-emerald-500' },
    { id: 'daily-report', title: 'Daily Report', icon: ScrollText, color: 'bg-amber-500' },
  ];

  const showPlaceholders = isManager || isAdmin;

  useEffect(() => {
    if (isManager || isAdmin) {
      fetchRecentActivity();
      fetchTopActions();
    }
    fetchPendingRAMS();
  }, [isManager, isAdmin, profile]);

  const fetchRecentActivity = async () => {
    try {
      setLoading(true);
      
      // Fetch recent timesheets
      const { data: timesheets, error: timesheetsError } = await supabase
        .from('timesheets')
        .select(`
          id,
          status,
          created_at,
          profiles:user_id (
            full_name
          )
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      if (timesheetsError) throw timesheetsError;

      // Fetch recent inspections
      const { data: inspections, error: inspectionsError } = await supabase
        .from('vehicle_inspections')
        .select(`
          id,
          status,
          created_at,
          profiles:user_id (
            full_name
          ),
          vehicles (
            reg_number
          )
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      if (inspectionsError) throw inspectionsError;

      // Combine and format the data
      const combined: RecentActivity[] = [
        ...(timesheets || []).map((ts: any) => ({
          id: ts.id,
          type: 'timesheet' as const,
          title: 'Timesheet',
          user: ts.profiles?.full_name || 'Unknown User',
          status: ts.status,
          created_at: ts.created_at,
        })),
        ...(inspections || []).map((insp: any) => ({
          id: insp.id,
          type: 'inspection' as const,
          title: `Inspection - ${insp.vehicles?.reg_number || 'Unknown Vehicle'}`,
          user: insp.profiles?.full_name || 'Unknown User',
          status: insp.status,
          created_at: insp.created_at,
        })),
      ]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5);

      setRecentActivity(combined);
    } catch (error) {
      console.error('Error fetching recent activity:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTopActions = async () => {
    try {
      const { data, error } = await supabase
        .from('actions')
        .select(`
          *,
          vehicle_inspections (
            inspection_date,
            vehicles (
              reg_number
            )
          ),
          inspection_items (
            item_description,
            status
          )
        `)
        .eq('actioned', false)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      // Sort by priority: urgent > high > medium > low
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      const sortedData = (data || []).sort(
        (a, b) => priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder]
      );

      setTopActions(sortedData);
    } catch (error) {
      console.error('Error fetching top actions:', error);
    }
  };

  const fetchPendingRAMS = async () => {
    if (!profile?.id) return;
    
    try {
      const { count, error } = await supabase
        .from('rams_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', profile.id)
        .in('status', ['pending', 'read']);

      if (error) throw error;
      setPendingRAMSCount(count || 0);
    } catch (error) {
      console.error('Error fetching pending RAMS:', error);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Welcome Section */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
          Welcome back, {profile?.full_name}
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Manage your forms and documents
        </p>
      </div>

      {/* Quick Actions - Square Button Grid */}
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">Create New Form</h2>
        
        <TooltipProvider>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {/* Active Forms */}
            {formTypes.map((formType) => {
              const Icon = formType.icon;
              const showBadge = formType.id === 'rams' && pendingRAMSCount > 0;
              
              return (
                <Link key={formType.id} href={formType.href}>
                  <div className={`relative bg-${formType.color} hover:opacity-90 hover:scale-105 transition-all duration-200 rounded-lg p-6 text-center shadow-lg aspect-square flex flex-col items-center justify-center space-y-3 cursor-pointer`}>
                    {showBadge && (
                      <div className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full h-8 w-8 flex items-center justify-center text-sm font-bold shadow-lg">
                        {pendingRAMSCount}
                      </div>
                    )}
                    <Icon className="h-8 w-8 text-white" />
                    <span className="text-white font-semibold text-sm leading-tight">
                      {formType.title}
                    </span>
                  </div>
                </Link>
              );
            })}

            {/* Placeholder Forms - Only visible to managers/admins */}
            {showPlaceholders && placeholderForms.map((form) => {
              const Icon = form.icon;
              return (
                <Tooltip key={form.id}>
                  <TooltipTrigger asChild>
                    <div className={`${form.color} opacity-50 cursor-not-allowed rounded-lg p-6 text-center shadow-lg aspect-square flex flex-col items-center justify-center space-y-3`}>
                      <Icon className="h-8 w-8 text-white" />
                      <span className="text-white font-semibold text-sm leading-tight">
                        {form.title}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Coming in a future development phase</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </div>


      {/* Recent Activity - Manager/Admin Only */}
      {isManager && (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-slate-900 dark:text-white">
              <span>Recent Activity</span>
              <Badge variant="outline" className="text-slate-400 border-slate-600">
                Last 5 Submissions
              </Badge>
            </CardTitle>
            <CardDescription className="text-slate-400">
              Recent submissions across all form types
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-slate-400">
                <p>Loading recent activity...</p>
              </div>
            ) : recentActivity.length > 0 ? (
              <div className="space-y-3">
                {recentActivity.map((activity) => (
                  <Link
                    key={activity.id}
                    href={activity.type === 'timesheet' ? `/timesheets/${activity.id}` : `/inspections/${activity.id}`}
                    className="block"
                  >
                    <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors border border-slate-200 dark:border-slate-700/50">
                      <div className="flex items-center gap-3">
                        {activity.type === 'timesheet' ? (
                          <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <CarFront className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                        )}
                        <div>
                          <p className="font-medium text-slate-900 dark:text-white">{activity.title}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            by {activity.user} • {formatDate(activity.created_at)}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          activity.status === 'submitted'
                            ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                            : activity.status === 'approved'
                            ? 'border-green-500/30 text-green-400 bg-green-500/10'
                            : activity.status === 'rejected'
                            ? 'border-red-500/30 text-red-400 bg-red-500/10'
                            : 'border-slate-600 text-slate-400'
                        }
                      >
                        {activity.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
                <div className="flex justify-center gap-2 pt-4">
                  {formTypes.map((formType) => (
                    <Link key={formType.id} href={formType.listHref}>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="border-slate-600 text-slate-300 hover:bg-slate-700/50"
                      >
                        View All {formType.title}s
                      </Button>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                <FileSpreadsheet className="h-16 w-16 mx-auto mb-4 opacity-20 text-avs-yellow" />
                <p className="text-lg mb-2">No activity yet</p>
                <p className="text-sm text-slate-500 mb-6">
                  Recent form submissions will appear here
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {formTypes.map((formType) => (
                    <Link key={formType.id} href={formType.listHref}>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="border-slate-600 text-slate-300 hover:bg-slate-700/50"
                      >
                        View All {formType.title}s
                      </Button>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Manager Actions Section */}
      {isManager && (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 border-t-2 border-t-red-500">
          <CardHeader className="bg-red-50 dark:bg-red-500/10">
            <CardTitle className="flex items-center justify-between text-slate-900 dark:text-white">
              <span>High Priority Actions</span>
              <Link href="/actions">
                <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700/50">
                  View All Actions
                </Button>
              </Link>
            </CardTitle>
            <CardDescription className="text-slate-400">
              Highest priority items requiring attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-slate-400">
                <p>Loading actions...</p>
              </div>
            ) : topActions.length > 0 ? (
              <div className="space-y-3">
                {topActions.map((action) => {
                  const getPriorityColor = (priority: string) => {
                    switch (priority) {
                      case 'urgent':
                        return 'border-red-500/30 text-red-400 bg-red-500/20';
                      case 'high':
                        return 'border-orange-500/30 text-orange-400 bg-orange-500/20';
                      case 'medium':
                        return 'border-yellow-500/30 text-yellow-400 bg-yellow-500/20';
                      case 'low':
                        return 'border-blue-500/30 text-blue-400 bg-blue-500/20';
                      default:
                        return 'border-slate-600 text-slate-400';
                    }
                  };

                  return (
                    <div
                      key={action.id}
                      className="p-4 rounded-lg bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700/50"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                            <h3 className="font-semibold text-slate-900 dark:text-white">{action.title}</h3>
                            <Badge variant="outline" className={getPriorityColor(action.priority)}>
                              {action.priority.toUpperCase()}
                            </Badge>
                          </div>
                          {action.description && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{action.description}</p>
                          )}
                          <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                            {action.vehicle_inspections && (
                              <span>
                                Vehicle: {action.vehicle_inspections.vehicles?.reg_number || 'N/A'}
                              </span>
                            )}
                            {action.inspection_items && (
                              <span>
                                Issue: {action.inspection_items.item_description}
                              </span>
                            )}
                            <span>Created: {formatDate(action.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-20 text-amber-400" />
                <p className="text-lg mb-2">No pending actions</p>
                <p className="text-sm text-slate-500">
                  High priority items will appear here
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

