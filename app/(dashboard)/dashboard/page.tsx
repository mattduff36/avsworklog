'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { OfflineBanner } from '@/components/ui/offline-banner';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { 
  CheckCircle2,
  PackageCheck,
  Clipboard,
  FileCheck,
  ChevronRight,
  Bug,
  Truck,
  Wrench,
  Settings,
  FileText,
  Calendar
} from 'lucide-react';
import { getEnabledForms } from '@/lib/config/forms';
import { Database } from '@/types/database';
import type { ModuleName } from '@/types/roles';
import { toast } from 'sonner';
import { managerNavItems, adminNavItems } from '@/lib/config/navigation';

type PendingApprovalCount = {
  type: 'timesheets' | 'inspections' | 'absences' | 'pending' | 'logged' | 'completed' | 'workshop' | 'maintenance';
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  href: string;
};

/**
 * Safely applies alpha/opacity to an HSL color string.
 * Returns the color with 15% opacity if valid HSL, otherwise returns a fallback.
 * 
 * @param color - Color string (expected to be in HSL format like 'hsl(13 37% 48%)')
 * @returns HSL color with alpha channel or fallback color
 */
function applyAlphaToHSL(color: string): string {
  // Validate that the color is in HSL format
  if (typeof color === 'string' && color.trim().startsWith('hsl(') && color.includes(')')) {
    return color.replace(')', ' / 0.15)');
  }
  
  // Fallback: return semi-transparent slate if invalid format
  console.warn(`Invalid HSL color format: "${color}". Using fallback color.`);
  return 'hsl(215 16% 47% / 0.15)'; // slate-600 with 15% opacity
}

export default function DashboardPage() {
  const { profile, isManager, isAdmin } = useAuth();
  const { isOnline } = useOfflineSync();
  const formTypes = getEnabledForms();
  const supabase = createClient();

  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalCount[]>([]);
  const [actionsSummary, setActionsSummary] = useState<PendingApprovalCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRAMSCount, setPendingRAMSCount] = useState(0);
  const [hasRAMSAssignments, setHasRAMSAssignments] = useState(false);
  const [userPermissions, setUserPermissions] = useState<Set<ModuleName>>(new Set());
  const [userEmail, setUserEmail] = useState<string>('');
  const [viewAsRole, setViewAsRole] = useState<string>('actual');

  // Placeholder forms for future development (only shown to superadmin)
  const placeholderForms = [
    { id: 'delivery', title: 'Delivery Note', icon: PackageCheck, color: 'bg-rose-500' },
    { id: 'site-diary', title: 'Site Diary', icon: Clipboard, color: 'bg-cyan-500' },
    { id: 'plant-hire', title: 'Plant Hire', icon: Truck, color: 'bg-indigo-500' },
    { id: 'quality-check', title: 'Quality Check', icon: FileCheck, color: 'bg-emerald-500' },
  ];

  // Only show placeholders to superadmin when viewing as actual role
  const isSuperAdmin = userEmail === 'admin@mpdee.co.uk';
  const showPlaceholders = isSuperAdmin && viewAsRole === 'actual';
  
  // Determine if user should see manager/admin features based on View As mode
  const effectiveIsManager = isManager && !(isSuperAdmin && viewAsRole === 'employee');
  const effectiveIsAdmin = isAdmin && !(isSuperAdmin && viewAsRole === 'employee');

  // Fetch user email and view as role
  useEffect(() => {
    async function fetchUserEmail() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    }
    fetchUserEmail();
    
    // Check viewAs mode from localStorage
    const storedViewAs = localStorage.getItem('viewAsRole');
    if (storedViewAs) {
      setViewAsRole(storedViewAs);
    }
  }, [supabase]);

  // Fetch user permissions (respects View As mode)
  useEffect(() => {
    async function fetchPermissions() {
      if (!profile?.id) return;
      
      // When viewing as different roles, simulate their permissions
      if (isSuperAdmin && viewAsRole !== 'actual') {
        if (viewAsRole === 'admin' || viewAsRole === 'manager') {
          setUserPermissions(new Set(['timesheets', 'inspections', 'absence', 'rams', 'maintenance', 'workshop-tasks', 'approvals', 'actions', 'reports'] as ModuleName[]));
        } else if (viewAsRole === 'employee') {
          // Simulate basic employee permissions (timesheets and inspections only)
          setUserPermissions(new Set(['timesheets', 'inspections'] as ModuleName[]));
        }
        return;
      }
      
      // Managers and admins have all permissions
      if (isManager || isAdmin) {
        setUserPermissions(new Set([
          'timesheets', 'inspections', 'rams', 'absence', 'maintenance', 'toolbox-talks', 'workshop-tasks',
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
        data?.roles?.role_permissions?.forEach((perm: { enabled: boolean; module_name: string }) => {
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
  }, [profile?.id, isManager, isAdmin, supabase, isSuperAdmin, viewAsRole]);

  useEffect(() => {
    // Only fetch manager/admin data if actually a manager/admin and not viewing as employee
    const shouldFetchManagerData = (isManager || isAdmin) && !(isSuperAdmin && viewAsRole === 'employee');
    
    if (shouldFetchManagerData) {
      fetchPendingApprovals();
      fetchTopActions();
    }
    fetchPendingRAMS();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, isAdmin, profile, isSuperAdmin, viewAsRole]);

  const fetchPendingApprovals = async () => {
    // Skip fetching if offline - rely on cached page data
    if (!isOnline) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Fetch pending timesheets count
      const { count: timesheetsCount, error: timesheetsError } = await supabase
        .from('timesheets')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'submitted');

      if (timesheetsError) throw timesheetsError;

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
      try {
        toast.error('Unable to load dashboard data', {
          description: 'Please check your internet connection and try again.',
        });
      } catch (toastError) {
        console.error('Unable to load dashboard data (toast unavailable)');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchTopActions = async () => {
    try {
      // Fetch all actions to count workshop tasks
      const { data: allActions, error: actionsError } = await supabase
        .from('actions')
        .select('*');

      if (actionsError) {
        console.error('Error fetching actions:', actionsError);
        // Initialize with empty data on error
        setActionsSummary([
          {
            type: 'workshop',
            label: 'Workshop Tasks',
            count: 0,
            icon: Wrench,
            color: 'hsl(13 37% 48%)',
            href: '/workshop-tasks'
          },
          {
            type: 'maintenance',
            label: 'Maintenance & Service',
            count: 0,
            icon: Settings,
            color: 'hsl(0 84% 60%)',
            href: '/fleet'
          },
          {
            type: 'inspections',
            label: 'Site Audit Inspections',
            count: 0,
            icon: FileText,
            color: 'hsl(215 20% 50%)',
            href: '#'
          }
        ]);
        return;
      }

      // Filter workshop tasks
      const workshopTasks = (allActions || []).filter(a => 
        a.action_type === 'inspection_defect' || a.action_type === 'workshop_vehicle_task'
      );

      const workshopPending = workshopTasks.filter(t => t.status === 'pending').length;
      const workshopInProgress = workshopTasks.filter(t => t.status === 'logged').length;
      const workshopTotal = workshopPending + workshopInProgress;

      // Fetch maintenance data to count alerts
      let maintenanceOverdue = 0;
      let maintenanceDueSoon = 0;

      try {
        const maintenanceResponse = await fetch('/api/maintenance');
        if (maintenanceResponse.ok) {
          const maintenanceData = await maintenanceResponse.json();
          const vehicles = maintenanceData.vehicles || [];
          
          vehicles.forEach((vehicle: { tax_status?: { status: string }, mot_status?: { status: string }, service_status?: { status: string }, cambelt_status?: { status: string }, first_aid_status?: { status: string } }) => {
            // Check Tax
            if (vehicle.tax_status?.status === 'overdue') maintenanceOverdue++;
            else if (vehicle.tax_status?.status === 'due_soon') maintenanceDueSoon++;
            
            // Check MOT
            if (vehicle.mot_status?.status === 'overdue') maintenanceOverdue++;
            else if (vehicle.mot_status?.status === 'due_soon') maintenanceDueSoon++;
            
            // Check Service
            if (vehicle.service_status?.status === 'overdue') maintenanceOverdue++;
            else if (vehicle.service_status?.status === 'due_soon') maintenanceDueSoon++;
            
            // Check Cambelt
            if (vehicle.cambelt_status?.status === 'overdue') maintenanceOverdue++;
            else if (vehicle.cambelt_status?.status === 'due_soon') maintenanceDueSoon++;
            
            // Check First Aid
            if (vehicle.first_aid_status?.status === 'overdue') maintenanceOverdue++;
            else if (vehicle.first_aid_status?.status === 'due_soon') maintenanceDueSoon++;
          });
        }
      } catch (maintenanceError) {
        console.error('Error fetching maintenance data:', maintenanceError);
        // Continue with 0 counts if maintenance fetch fails
      }

      const maintenanceTotal = maintenanceOverdue + maintenanceDueSoon;

      // Build actions summary array
      const actionTypes: PendingApprovalCount[] = [
        {
          type: 'workshop',
          label: 'Workshop Tasks',
          count: workshopTotal,
          icon: Wrench,
          color: 'hsl(13 37% 48%)', // Workshop rust/brown color
          href: '/workshop-tasks'
        },
        {
          type: 'maintenance',
          label: 'Maintenance & Service',
          count: maintenanceTotal,
          icon: Settings,
          color: 'hsl(0 84% 60%)', // Red
          href: '/maintenance'
        },
        {
          type: 'inspections',
          label: 'Site Audit Inspections',
          count: 0,
          icon: FileText,
          color: 'hsl(215 20% 50%)', // Slate/Gray
          href: '#'
        }
      ];

      setActionsSummary(actionTypes);
    } catch (error) {
      console.error('Error fetching actions summary:', error);
      try {
        toast.error('Unable to load actions data', {
          description: 'Please check your internet connection and try again.',
        });
      } catch (toastError) {
        console.error('Unable to load actions data (toast unavailable)');
      }
      // Initialize with empty data on error
      setActionsSummary([
        {
          type: 'workshop',
          label: 'Workshop Tasks',
          count: 0,
          icon: Wrench,
          color: 'hsl(13 37% 48%)',
          href: '/workshop-tasks'
        },
        {
          type: 'maintenance',
          label: 'Maintenance & Service',
          count: 0,
          icon: Settings,
          color: 'hsl(0 84% 60%)',
          href: '/maintenance'
        },
        {
          type: 'inspections',
          label: 'Site Audit Inspections',
          count: 0,
          icon: FileText,
          color: 'hsl(215 20% 50%)',
          href: '#'
        }
      ]);
    } finally {
      setLoading(false);
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
      {/* Offline Banner */}
      {!isOnline && <OfflineBanner />}
      
      {/* Welcome Section */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-700">
        <h1 className="text-3xl font-bold text-white">
          Welcome back, {profile?.full_name}
        </h1>
        <p className="text-slate-400 mt-1">
          {isSuperAdmin ? 'SuperAdmin' : (profile?.role?.display_name || 'No Role Assigned')}
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
                  'maintenance': 'maintenance',
                  'workshop': 'workshop-tasks',
                };
                
                const moduleName = moduleMap[formType.id];
                
                // Check if user has permission to this module
                // Managers and admins always have access (unless viewing as employee)
                if (!effectiveIsManager && !effectiveIsAdmin && moduleName && !userPermissions.has(moduleName)) {
                  return false;
                }
                
                // Hide RAMS for employees with no assignments
                if (formType.id === 'rams' && !effectiveIsManager && !effectiveIsAdmin && !hasRAMSAssignments) {
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
                    <span className="text-white font-semibold text-2xl leading-tight">
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
                      <span className="text-white font-semibold text-2xl leading-tight">
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
                      <span className="text-white font-semibold text-2xl leading-tight">
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

      {/* Manager/Admin Quick Access - Smaller Tiles */}
      {effectiveIsManager && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-3">
            Management Tools
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {/* Manager Links - Using shared navigation config */}
            {managerNavItems.map((link) => {
              const Icon = link.icon;
              // Define colors for each manager link
              const colorMap: Record<string, { borderColor: string; iconColor: string; hoverBorder: string }> = {
                '/approvals': { borderColor: 'border-blue-500', iconColor: 'text-blue-400', hoverBorder: 'hover:border-blue-400' },
                '/actions': { borderColor: 'border-purple-500', iconColor: 'text-purple-400', hoverBorder: 'hover:border-purple-400' },
                '/toolbox-talks': { borderColor: 'border-red-500', iconColor: 'text-red-400', hoverBorder: 'hover:border-red-400' },
                '/reports': { borderColor: 'border-emerald-500', iconColor: 'text-emerald-400', hoverBorder: 'hover:border-emerald-400' },
              };
              const colors = colorMap[link.href] || { borderColor: 'border-slate-500', iconColor: 'text-slate-400', hoverBorder: 'hover:border-slate-400' };
              
              return (
                <Link key={link.href} href={link.href}>
                  <div className={`bg-slate-800 dark:bg-slate-900 border-4 ${colors.borderColor} ${colors.hoverBorder} hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer`}
                       style={{ height: '100px' }}>
                    <div className="flex flex-col items-start justify-between h-full">
                      <Icon className={`h-6 w-6 ${colors.iconColor}`} />
                      <span className="text-white font-semibold text-base leading-tight">
                        {link.label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
            
            {/* Admin Links - Using shared navigation config */}
            {effectiveIsAdmin && adminNavItems.map((link) => {
              const Icon = link.icon;
              // Define colors for each admin link
              const colorMap: Record<string, { borderColor: string; iconColor: string; hoverBorder: string }> = {
                '/admin/users': { borderColor: 'border-slate-400', iconColor: 'text-slate-300', hoverBorder: 'hover:border-slate-300' },
                '/fleet?tab=vehicles': { borderColor: 'border-slate-500', iconColor: 'text-slate-400', hoverBorder: 'hover:border-slate-400' },
              };
              const colors = colorMap[link.href] || { borderColor: 'border-slate-500', iconColor: 'text-slate-400', hoverBorder: 'hover:border-slate-400' };
              
              return (
                <Link key={link.href} href={link.href}>
                  <div className={`bg-slate-800 dark:bg-slate-900 border-4 ${colors.borderColor} ${colors.hoverBorder} hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer`}
                       style={{ height: '100px' }}>
                    <div className="flex flex-col items-start justify-between h-full">
                      <Icon className={`h-6 w-6 ${colors.iconColor}`} />
                      <span className="text-white font-semibold text-base leading-tight">
                        {link.label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
            
            {/* SuperAdmin Only - Debug Link (only when viewing as actual role) */}
            {isSuperAdmin && viewAsRole === 'actual' && (() => {
              const link = { href: '/debug', label: 'Debug', icon: Bug, borderColor: 'border-yellow-500', iconColor: 'text-yellow-400', hoverBorder: 'hover:border-yellow-400' };
              const Icon = link.icon;
              return (
                <Link key={link.href} href={link.href}>
                  <div className={`bg-slate-800 dark:bg-slate-900 border-4 ${link.borderColor} ${link.hoverBorder} hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer`}
                       style={{ height: '100px' }}>
                    <div className="flex flex-col items-start justify-between h-full">
                      <Icon className={`h-6 w-6 ${link.iconColor}`} />
                      <span className="text-white font-semibold text-base leading-tight">
                        {link.label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })()}
          </div>
        </div>
      )}

      {/* Pending Approvals Summary - Manager/Admin Only */}
      {effectiveIsManager && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-white">
              <span>Pending Approvals</span>
              <Link href="/approvals">
                <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700/50">
                  View All Approvals
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
                      <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all duration-200 border border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600">
                        <div className="flex items-center gap-4">
                          <div 
                            className="flex items-center justify-center w-10 h-10 rounded-lg"
                            style={{ backgroundColor: applyAlphaToHSL(approval.color) }}
                          >
                            <Icon 
                              className="h-5 w-5" 
                              style={{ color: approval.color }}
                            />
                          </div>
                          <div>
                            <p className="font-medium text-white group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">
                              {approval.label}
                            </p>
                            <p className="text-sm text-slate-400">
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
      {effectiveIsManager && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-white">
              <span>Manager Actions</span>
              <Link href="/actions">
                <Button variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700/50">
                  View All Actions
                </Button>
              </Link>
            </CardTitle>
            <CardDescription className="text-slate-400">
              Track and manage all action items
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-slate-400">
                <p>Loading actions...</p>
              </div>
            ) : (
              <div className="space-y-2">
                {actionsSummary.map((actionType) => {
                  const Icon = actionType.icon;
                  const isComingSoon = actionType.type === 'inspections';
                  
                  // For "coming soon" items, render as non-clickable
                  if (isComingSoon) {
                    return (
                      <div
                        key={actionType.type}
                        className="opacity-60"
                      >
                        <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 border border-slate-700/50">
                          <div className="flex items-center gap-4">
                          <div 
                            className="flex items-center justify-center w-10 h-10 rounded-lg"
                            style={{ backgroundColor: applyAlphaToHSL(actionType.color) }}
                          >
                            <Icon 
                              className="h-5 w-5" 
                              style={{ color: actionType.color }}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-white">
                                {actionType.label}
                              </p>
                              <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/30 text-xs">
                                Coming Soon
                              </Badge>
                            </div>
                            <p className="text-sm text-slate-400">
                              Site safety audits and compliance checks
                            </p>
                          </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  // Regular clickable action type
                  return (
                    <Link
                      key={actionType.type}
                      href={actionType.href}
                      className="block group"
                    >
                      <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all duration-200 border border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600">
                        <div className="flex items-center gap-4">
                          <div 
                            className="flex items-center justify-center w-10 h-10 rounded-lg"
                            style={{ backgroundColor: applyAlphaToHSL(actionType.color) }}
                          >
                            <Icon 
                              className="h-5 w-5" 
                              style={{ color: actionType.color }}
                            />
                          </div>
                          <div>
                            <p className="font-medium text-white group-hover:text-slate-700 dark:group-hover:text-slate-200 transition-colors">
                              {actionType.label}
                            </p>
                            <p className="text-sm text-slate-400">
                              {actionType.count === 0 ? 'No' : actionType.count} {actionType.count === 1 ? 'item' : 'items'} {actionType.count === 0 ? '' : 'requiring attention'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {actionType.count > 0 && (
                            <Badge 
                              variant="outline" 
                              className="text-base px-3 py-1 font-semibold border-amber-500/30 text-amber-400 bg-amber-500/10"
                            >
                              {actionType.count}
                            </Badge>
                          )}
                          <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
                
                {actionsSummary.reduce((sum, a) => sum + a.count, 0) === 0 && (
                  <div className="text-center py-8 text-slate-400 mt-4">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-20 text-green-400" />
                    <p className="text-lg mb-1">All clear!</p>
                    <p className="text-sm text-slate-500">
                      No actions at the moment
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

