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
  FileText,
  Calendar,
  ChevronRight
} from 'lucide-react';
import { getEnabledForms } from '@/lib/config/forms';
import { Database } from '@/types/database';
import type { ModuleName } from '@/types/roles';

type PendingApprovalCount = {
  type: 'timesheets' | 'inspections' | 'absences';
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  href: string;
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

  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalCount[]>([]);
  const [topActions, setTopActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRAMSCount, setPendingRAMSCount] = useState(0);
  const [hasRAMSAssignments, setHasRAMSAssignments] = useState(false);
  const [userPermissions, setUserPermissions] = useState<Set<ModuleName>>(new Set());

  // Placeholder forms for future development (only shown to managers/admins)
  const placeholderForms = [
    { id: 'maintenance', title: 'Maintenance Request', icon: Wrench, color: 'bg-red-500' },
    { id: 'delivery', title: 'Delivery Note', icon: PackageCheck, color: 'bg-rose-500' },
    { id: 'site-diary', title: 'Site Diary', icon: Clipboard, color: 'bg-cyan-500' },
    { id: 'plant-hire', title: 'Plant Hire', icon: Truck, color: 'bg-indigo-500' },
    { id: 'quality-check', title: 'Quality Check', icon: FileCheck, color: 'bg-emerald-500' },
    { id: 'daily-report', title: 'Daily Report', icon: ScrollText, color: 'bg-amber-500' },
  ];

  const showPlaceholders = isManager || isAdmin;

  // Fetch user permissions
  useEffect(() => {
    async function fetchPermissions() {
      if (!profile?.id) return;
      
      // Managers and admins have all permissions
      if (isManager || isAdmin) {
        setUserPermissions(new Set([
          'timesheets', 'inspections', 'rams', 'absence', 'toolbox-talks',
          'approvals', 'actions', 'reports', 'admin-users', 'admin-vehicles'
        ] as ModuleName[]));
        return;
      }
      
      try {
        const { data } = await supabase
          .from('profiles')
          .select(`
            role_id,
            roles!inner(
              role_permissions(
                module_name,
                enabled
              )
            )
          `)
          .eq('id', profile.id)
          .single();
        
        // Build Set of enabled permissions
        const enabledModules = new Set<ModuleName>();
        data?.roles?.role_permissions?.forEach((perm: any) => {
          if (perm.enabled) {
            enabledModules.add(perm.module_name as ModuleName);
          }
        });
        
        setUserPermissions(enabledModules);
      } catch (error) {
        console.error('Error fetching permissions:', error);
        setUserPermissions(new Set());
      }
    }
    fetchPermissions();
  }, [profile?.id, isManager, isAdmin, supabase]);

  useEffect(() => {
    if (isManager || isAdmin) {
      fetchPendingApprovals();
      fetchTopActions();
    }
    fetchPendingRAMS();
  }, [isManager, isAdmin, profile]);

  const fetchPendingApprovals = async () => {
    try {
      setLoading(true);
      
      // Fetch pending timesheets count
      const { count: timesheetsCount, error: timesheetsError } = await supabase
        .from('timesheets')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'submitted');

      if (timesheetsError) throw timesheetsError;

      // Fetch pending inspections count
      const { count: inspectionsCount, error: inspectionsError } = await supabase
        .from('vehicle_inspections')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'submitted');

      if (inspectionsError) throw inspectionsError;

      // Fetch pending absences count
      const { count: absencesCount, error: absencesError } = await supabase
        .from('absences')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (absencesError) throw absencesError;

      // Build dynamic approval types array
      const approvalTypes: PendingApprovalCount[] = [
        {
          type: 'timesheets',
          label: 'Timesheets',
          count: timesheetsCount || 0,
          icon: FileText,
          color: 'hsl(210 90% 50%)', // Blue
          href: '/approvals?tab=timesheets'
        },
        {
          type: 'inspections',
          label: 'Inspections',
          count: inspectionsCount || 0,
          icon: Clipboard,
          color: 'hsl(30 95% 55%)', // Orange
          href: '/approvals?tab=inspections'
        },
        {
          type: 'absences',
          label: 'Absences',
          count: absencesCount || 0,
          icon: Calendar,
          color: 'hsl(260 60% 50%)', // Purple
          href: '/approvals?tab=absences'
        }
      ];

      setPendingApprovals(approvalTypes);
    } catch (error) {
      console.error('Error fetching pending approvals:', error);
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
      // Get total count of all assignments
      const { count: totalCount, error: totalError } = await supabase
        .from('rams_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', profile.id);

      if (totalError) throw totalError;
      setHasRAMSAssignments((totalCount || 0) > 0);

      // Get count of pending assignments for badge
      const { count: pendingCount, error: pendingError } = await supabase
        .from('rams_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', profile.id)
        .in('status', ['pending', 'read']);

      if (pendingError) throw pendingError;
      setPendingRAMSCount(pendingCount || 0);
    } catch (error) {
      console.error('Error fetching RAMS assignments:', error);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Welcome Section */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
          Welcome back, {profile?.full_name}
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1 capitalize">
          {profile?.role?.replace(/-/g, ' ')}
        </p>
      </div>

      {/* Quick Actions - Square Button Grid */}
      <div>
        <TooltipProvider>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {/* Active Forms */}
            {formTypes
              .filter(formType => {
                // Map form IDs to module names for permission checking
                const moduleMap: Record<string, ModuleName> = {
                  'timesheet': 'timesheets',
                  'inspection': 'inspections',
                  'rams': 'rams',
                  'absence': 'absence',
                };
                
                const moduleName = moduleMap[formType.id];
                
                // Check if user has permission to this module
                // Managers and admins always have access
                if (!isManager && !isAdmin && moduleName && !userPermissions.has(moduleName)) {
                  return false;
                }
                
                // Hide RAMS for employees with no assignments
                if (formType.id === 'rams' && !isManager && !isAdmin && !hasRAMSAssignments) {
                  return false;
                }
                return true;
              })
              .map((formType) => {
              const Icon = formType.icon;
              const showBadge = formType.id === 'rams' && pendingRAMSCount > 0;
              
              return (
                <Link key={formType.id} href={formType.href}>
                  <div className={`relative bg-${formType.color} hover:opacity-90 hover:scale-105 transition-all duration-200 rounded-lg p-6 text-center shadow-lg aspect-square flex flex-col items-center justify-center space-y-3 cursor-pointer`}>
                    {showBadge && (
                      <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-10 w-10 flex items-center justify-center text-base font-bold shadow-lg ring-2 ring-white">
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
              
              // Check if this form has a working href
              if (form.href) {
                return (
                  <Link key={form.id} href={form.href}>
                    <div className={`relative ${form.color} hover:opacity-90 hover:scale-105 transition-all duration-200 rounded-lg p-6 text-center shadow-lg aspect-square flex flex-col items-center justify-center space-y-3 cursor-pointer`}>
                      <Icon className="h-8 w-8 text-white" />
                      <span className="text-white font-semibold text-sm leading-tight">
                        {form.title}
                      </span>
                    </div>
                  </Link>
                );
              }
              
              // Disabled placeholder forms
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


      {/* Pending Approvals Summary - Manager/Admin Only */}
      {isManager && (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-slate-900 dark:text-white">
              <span>Pending Approvals</span>
              <Link href="/approvals">
                <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700/50">
                  View All
                </Button>
              </Link>
            </CardTitle>
            <CardDescription className="text-slate-400">
              Outstanding approval requests across all types
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-slate-400">
                <p>Loading pending approvals...</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingApprovals.map((approval) => {
                  const Icon = approval.icon;
                  
                  return (
                    <Link
                      key={approval.type}
                      href={approval.href}
                      className="block group"
                    >
                      <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all duration-200 border border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600">
                        <div className="flex items-center gap-4">
                          <div 
                            className="flex items-center justify-center w-10 h-10 rounded-lg"
                            style={{ backgroundColor: `${approval.color}15` }}
                          >
                            <Icon 
                              className="h-5 w-5" 
                              style={{ color: approval.color }}
                            />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">
                              {approval.label}
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                              {approval.count === 0 ? 'No' : approval.count} pending {approval.count === 1 ? 'request' : 'requests'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {approval.count > 0 && (
                            <Badge 
                              variant="outline" 
                              className="text-base px-3 py-1 font-semibold border-amber-500/30 text-amber-400 bg-amber-500/10"
                            >
                              {approval.count}
                            </Badge>
                          )}
                          <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
                
                {pendingApprovals.reduce((sum, a) => sum + a.count, 0) === 0 && (
                  <div className="text-center py-8 text-slate-400 mt-4">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-20 text-green-400" />
                    <p className="text-lg mb-1">All caught up!</p>
                    <p className="text-sm text-slate-500">
                      No pending approvals at the moment
                    </p>
                  </div>
                )}
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

