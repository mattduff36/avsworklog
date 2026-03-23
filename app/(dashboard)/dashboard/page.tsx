'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabletModeToggleActions } from '@/components/layout/TabletModeToggleActions';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { 
  CheckCircle2,
  ChevronRight,
  Bug,
  Lightbulb,
  Wrench,
  Settings,
  FileText,
  Calendar,
  Loader2
} from 'lucide-react';
import { getEnabledForms } from '@/lib/config/forms';
import type { ModuleName } from '@/types/roles';
import { ALL_MODULES } from '@/types/roles';
import { managerNavItems, adminNavItems, getFilteredNavByPermissions } from '@/lib/config/navigation';

type PendingApprovalCount = {
  type: 'timesheets' | 'inspections' | 'absences' | 'pending' | 'logged' | 'completed' | 'workshop' | 'maintenance' | 'suggestions' | 'errors';
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

function isExpectedNetworkError(error: unknown): boolean {
  if (!navigator.onLine) return true;
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed')
  );
}

export default function DashboardPage() {
  const { profile, isManager, isAdmin, isActualSuperAdmin, isViewingAs, effectiveRole } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const formTypes = getEnabledForms();
  const supabase = createClient();

  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalCount[]>([]);
  const [actionsSummary, setActionsSummary] = useState<PendingApprovalCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRAMSCount, setPendingRAMSCount] = useState(0);
  const [hasRAMSAssignments, setHasRAMSAssignments] = useState(false);
  const [newSuggestionsCount, setNewSuggestionsCount] = useState(0);
  const [newErrorReportsCount, setNewErrorReportsCount] = useState(0);
  const [pendingQuotesCount, setPendingQuotesCount] = useState(0);
  const [errorLogsCount, setErrorLogsCount] = useState(0);
  const [userPermissions, setUserPermissions] = useState<Set<ModuleName>>(new Set());
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [ramsLoading, setRamsLoading] = useState(true);
  const [badgesLoading, setBadgesLoading] = useState(true);
  
  // Intro animation state (all devices)
  const [showIntro, setShowIntro] = useState(true);
  
  // Hide intro after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowIntro(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // useAuth flags already reflect the effective (view-as) role
  const isSuperAdmin = isActualSuperAdmin;
  const effectiveIsManager = isManager;
  const effectiveIsAdmin = isAdmin;

  // Fetch user permissions (useAuth flags already respect View As mode)
  useEffect(() => {
    async function fetchPermissions() {
      if (!profile?.id) {
        setPermissionsLoading(false);
        return;
      }
      
      setPermissionsLoading(true);
      
      // Admin keeps full access by definition.
      if (isAdmin) {
        setUserPermissions(new Set(ALL_MODULES));
        setPermissionsLoading(false);
        return;
      }
      
      try {
        const response = await fetch('/api/me/permissions', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load permissions');
        }

        setUserPermissions(new Set<ModuleName>((data.enabled_modules || []) as ModuleName[]));
      } catch (error) {
        console.error('Error fetching permissions:', error);
        setUserPermissions(new Set());
      } finally {
        setPermissionsLoading(false);
      }
    }
    fetchPermissions();
  }, [profile?.id, isManager, isAdmin, isViewingAs, effectiveRole, supabase]);

  const canViewApprovals = userPermissions.has('approvals');
  const canViewActions = userPermissions.has('actions');
  const canViewMaintenance = userPermissions.has('maintenance');
  const canViewWorkshopTasks = userPermissions.has('workshop-tasks');
  const canViewSuggestions = userPermissions.has('suggestions');
  const canViewErrorReports = userPermissions.has('error-reports');

  function buildPendingApprovalsSummary(timesheetsCount: number, absencesCount: number): PendingApprovalCount[] {
    return [
      {
        type: 'timesheets',
        label: 'Timesheets',
        count: timesheetsCount,
        icon: FileText,
        color: 'hsl(210 90% 50%)',
        href: '/approvals?tab=timesheets',
      },
      {
        type: 'absences',
        label: 'Absences',
        count: absencesCount,
        icon: Calendar,
        color: 'hsl(260 60% 50%)',
        href: '/approvals?tab=absences',
      },
    ];
  }

  function buildActionsSummary(params: {
    workshopTotal: number;
    maintenanceTotal: number;
    suggestionsTotal: number;
    errorsTotal: number;
  }): PendingApprovalCount[] {
    return [
      {
        type: 'workshop',
        label: 'Workshop Tasks',
        count: params.workshopTotal,
        icon: Wrench,
        color: 'hsl(13 37% 48%)',
        href: '/workshop-tasks',
      },
      {
        type: 'maintenance',
        label: 'Maintenance & Service',
        count: params.maintenanceTotal,
        icon: Settings,
        color: 'hsl(0 84% 60%)',
        href: '/maintenance',
      },
      {
        type: 'suggestions',
        label: 'Suggestions',
        count: params.suggestionsTotal,
        icon: Lightbulb,
        color: 'hsl(48 87% 69%)',
        href: '/suggestions/manage',
      },
      {
        type: 'errors',
        label: 'Error Reports',
        count: params.errorsTotal,
        icon: Bug,
        color: 'hsl(48 87% 69%)',
        href: '/admin/errors/manage',
      },
    ];
  }

  async function fetchDashboardMetrics() {
    if (!navigator.onLine) {
      return {
        pendingApprovals: canViewApprovals ? buildPendingApprovalsSummary(0, 0) : [],
        actionsSummary: canViewActions
          ? buildActionsSummary({ workshopTotal: 0, maintenanceTotal: 0, suggestionsTotal: 0, errorsTotal: 0 })
          : [],
        newSuggestionsCount: 0,
        newErrorReportsCount: 0,
        pendingQuotesCount: 0,
        errorLogsCount: 0,
      };
    }

    const approvalsPromise = canViewApprovals
      ? Promise.all([
          supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
          supabase.from('absences').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        ])
      : Promise.resolve(null);

    const workshopPromise = canViewActions && canViewWorkshopTasks
      ? Promise.all([
          supabase
            .from('actions')
            .select('id', { count: 'exact', head: true })
            .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
            .eq('status', 'pending'),
          supabase
            .from('actions')
            .select('id', { count: 'exact', head: true })
            .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
            .eq('status', 'logged'),
        ])
      : Promise.resolve(null);

    const maintenancePromise = canViewActions && canViewMaintenance
      ? fetch('/api/maintenance')
      : Promise.resolve(null);

    const suggestionsPromise = canViewSuggestions
      ? Promise.all([
          supabase.from('suggestions').select('id', { count: 'exact', head: true }).eq('status', 'new'),
          supabase.from('suggestions').select('id', { count: 'exact', head: true }).in('status', ['under_review', 'planned']),
        ])
      : Promise.resolve(null);

    const errorsPromise = canViewErrorReports
      ? Promise.all([
          supabase.from('error_reports').select('id', { count: 'exact', head: true }).eq('status', 'new'),
          supabase.from('error_reports').select('id', { count: 'exact', head: true }).eq('status', 'investigating'),
        ])
      : Promise.resolve(null);

    const [approvals, workshop, maintenanceResponse, suggestions, errors, quotes, errorLogs] = await Promise.all([
      approvalsPromise,
      workshopPromise,
      maintenancePromise,
      suggestionsPromise,
      errorsPromise,
      supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'pending_internal_approval'),
      supabase.from('error_logs').select('id', { count: 'exact', head: true }),
    ]);

    if (approvals) {
      const [timesheetsResult, absencesResult] = approvals;
      if (timesheetsResult.error) throw timesheetsResult.error;
      if (absencesResult.error) throw absencesResult.error;
    }
    if (workshop) {
      const [workshopPendingResult, workshopInProgressResult] = workshop;
      if (workshopPendingResult.error) throw workshopPendingResult.error;
      if (workshopInProgressResult.error) throw workshopInProgressResult.error;
    }
    if (suggestions) {
      const [suggestionsNewResult, suggestionsReviewResult] = suggestions;
      if (suggestionsNewResult.error) throw suggestionsNewResult.error;
      if (suggestionsReviewResult.error) throw suggestionsReviewResult.error;
    }
    if (errors) {
      const [errorsNewResult, errorsInvestigatingResult] = errors;
      if (errorsNewResult.error) throw errorsNewResult.error;
      if (errorsInvestigatingResult.error) throw errorsInvestigatingResult.error;
    }
    if (quotes.error) throw quotes.error;
    if (errorLogs.error) throw errorLogs.error;

    let maintenanceTotal = 0;
    if (maintenanceResponse?.ok) {
      const maintenanceData = await maintenanceResponse.json();
      const vehicles = (maintenanceData.vehicles || []) as Array<{
        tax_status?: { status: string };
        mot_status?: { status: string };
        service_status?: { status: string };
        cambelt_status?: { status: string };
        first_aid_status?: { status: string };
      }>;

      for (const vehicle of vehicles) {
        const statuses = [
          vehicle.tax_status?.status,
          vehicle.mot_status?.status,
          vehicle.service_status?.status,
          vehicle.cambelt_status?.status,
          vehicle.first_aid_status?.status,
        ];
        maintenanceTotal += statuses.filter((status) => status === 'overdue' || status === 'due_soon').length;
      }
    }

    const timesheetsCount = approvals?.[0].count || 0;
    const absencesCount = approvals?.[1].count || 0;
    const workshopTotal = (workshop?.[0].count || 0) + (workshop?.[1].count || 0);
    const suggestionsNewCount = suggestions?.[0].count || 0;
    const suggestionsReviewCount = suggestions?.[1].count || 0;
    const errorsNewCount = errors?.[0].count || 0;
    const errorsInvestigatingCount = errors?.[1].count || 0;

    return {
      pendingApprovals: canViewApprovals ? buildPendingApprovalsSummary(timesheetsCount, absencesCount) : [],
      actionsSummary: canViewActions
        ? buildActionsSummary({
            workshopTotal,
            maintenanceTotal,
            suggestionsTotal: suggestionsNewCount + suggestionsReviewCount,
            errorsTotal: errorsNewCount + errorsInvestigatingCount,
          })
        : [],
      newSuggestionsCount: suggestionsNewCount,
      newErrorReportsCount: errorsNewCount,
      pendingQuotesCount: quotes.count || 0,
      errorLogsCount: errorLogs.count || 0,
    };
  }

  useEffect(() => {
    let active = true;

    async function loadDashboardMetrics() {
      if (permissionsLoading) return;

      setLoading(true);
      setBadgesLoading(true);
      try {
        const metrics = await fetchDashboardMetrics();
        if (!active) return;

        setPendingApprovals(metrics.pendingApprovals);
        setActionsSummary(metrics.actionsSummary);
        setNewSuggestionsCount(metrics.newSuggestionsCount);
        setNewErrorReportsCount(metrics.newErrorReportsCount);
        setPendingQuotesCount(metrics.pendingQuotesCount);
        setErrorLogsCount(metrics.errorLogsCount);
      } catch (error) {
        console.error('Error loading dashboard metrics:', error);
        if (active) {
          setPendingApprovals(canViewApprovals ? buildPendingApprovalsSummary(0, 0) : []);
          setActionsSummary(
            canViewActions
              ? buildActionsSummary({ workshopTotal: 0, maintenanceTotal: 0, suggestionsTotal: 0, errorsTotal: 0 })
              : []
          );
          setNewSuggestionsCount(0);
          setNewErrorReportsCount(0);
          setPendingQuotesCount(0);
          setErrorLogsCount(0);
        }
      } finally {
        if (active) {
          setLoading(false);
          setBadgesLoading(false);
        }
      }
    }

    void loadDashboardMetrics();
    void fetchPendingRAMS();

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoading, canViewApprovals, canViewActions, canViewWorkshopTasks, canViewMaintenance, canViewSuggestions, canViewErrorReports, profile?.id]);

  const fetchPendingRAMS = async () => {
    if (!profile?.id) {
      // Don't set ramsLoading to false - keep it in loading state until profile loads
      // The loading condition already handles !profile?.id case
      return;
    }
    
    try {
      setRamsLoading(true);
      if (!navigator.onLine) {
        setHasRAMSAssignments(false);
        setPendingRAMSCount(0);
        return;
      }

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
      if (!isExpectedNetworkError(error)) {
        console.warn('Unexpected error fetching RAMS assignments:', error);
      }
      setHasRAMSAssignments(false);
      setPendingRAMSCount(0);
    } finally {
      setRamsLoading(false);
    }
  };

  const visibleManagerTiles = getFilteredNavByPermissions(managerNavItems, userPermissions, effectiveIsAdmin);
  const visibleAdminTiles = getFilteredNavByPermissions(adminNavItems, userPermissions, effectiveIsAdmin);
  const visibleManagementTiles = [...visibleManagerTiles, ...visibleAdminTiles];
  const totalPendingApprovalsCount = pendingApprovals.reduce((sum, a) => sum + a.count, 0);

  const visibleActionsSummary = actionsSummary.filter((item) => {
    if (item.type === 'workshop') return canViewWorkshopTasks;
    if (item.type === 'maintenance') return canViewMaintenance;
    if (item.type === 'suggestions') return canViewSuggestions;
    if (item.type === 'errors') return canViewErrorReports;
    return true;
  });
  const totalActionsCount = visibleActionsSummary.reduce((sum, a) => sum + a.count, 0);
  const managementTileBadgeCountByHref: Record<string, number> = {
    '/approvals': totalPendingApprovalsCount,
    '/actions': totalActionsCount,
    '/suggestions/manage': newSuggestionsCount,
    '/admin/errors/manage': newErrorReportsCount,
    '/quotes': pendingQuotesCount,
    '/debug': errorLogsCount,
  };
  const hasManagementTileBadge = (href: string) => href in managementTileBadgeCountByHref;
  const getManagementTileBadgeCount = (href: string) => managementTileBadgeCountByHref[href] || 0;

  return (
    <div className="space-y-8 max-w-6xl">
      
      {/* Welcome Section */}
      <div className="bg-slate-900 rounded-lg p-4 md:p-5 border border-slate-700 relative overflow-hidden">
        {/* Intro Animation Overlay (All Devices) */}
        <div 
          className={`flex absolute inset-0 bg-slate-900 items-center justify-center z-10 transition-opacity duration-700 ${
            showIntro ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-2">
            <Image
              src="/icon-192x192.png"
              alt=""
              width={36}
              height={36}
              className="h-8 w-8 md:h-9 md:w-9"
            />
            <span className="text-2xl md:text-3xl font-bold text-avs-yellow tracking-wide">
              SquiresApp
            </span>
          </div>
        </div>
        
        {/* Actual Content */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Welcome back, {profile?.full_name}
            </h1>
            <p className="text-slate-400 mt-1">
              {isSuperAdmin ? 'SuperAdmin' : (profile?.role?.display_name || 'No Role Assigned')}
            </p>
          </div>
          <div className="flex items-center justify-end">
            <TabletModeToggleActions size="dashboard" />
          </div>
        </div>
      </div>

      {/* Quick Actions - Square Button Grid */}
      <div>
        {(permissionsLoading || ramsLoading || !profile?.id) ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-avs-yellow" />
          </div>
        ) : (
          <TooltipProvider>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {/* Active Forms */}
              {formTypes
              .filter(formType => {
                // Map form IDs to module names for permission checking
                const moduleMap: Record<string, ModuleName> = {
                  'timesheet': 'timesheets',
                  'inspection': 'inspections',
                  'plant-inspection': 'plant-inspections',
                  'hgv-inspection': 'hgv-inspections',
                  'rams': 'rams',
                  'absence': 'absence',
                  'maintenance': 'maintenance',
                  'fleet': 'maintenance',
                  'workshop': 'workshop-tasks',
                };
                
                const moduleName = moduleMap[formType.id];
                
                // Check module permission (admin permissions are expanded to full set above).
                if (moduleName && !userPermissions.has(moduleName)) {
                  return false;
                }
                
                // Hide RAMS for employees with no assignments
                if (formType.id === 'rams' && !effectiveIsManager && !effectiveIsAdmin && !hasRAMSAssignments) {
                  return false;
                }
                return true;
              })
              .map((formType, index) => {
              const Icon = formType.icon;
              const showBadge = formType.id === 'rams' && pendingRAMSCount > 0;
              // Yellow backgrounds need dark text for contrast
              const needsDarkText = formType.color === 'avs-yellow';
              const textColorClass = needsDarkText ? 'text-slate-900' : 'text-white';
              
              return (
                <Link key={formType.id} href={formType.href}>
                  <div
                    className={`relative overflow-hidden bg-${formType.color} hover:opacity-90 hover:scale-105 transition-all duration-200 rounded-lg p-6 text-center shadow-lg aspect-square flex flex-col items-center justify-center space-y-3 cursor-pointer animate-tile-pop ${textColorClass}`}
                    style={{ animationDelay: `${index * 75}ms` }}
                  >
                    {showBadge && (
                      <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-10 w-10 flex items-center justify-center text-base font-bold shadow-lg ring-2 ring-white">
                        {pendingRAMSCount}
                      </div>
                    )}
                    <Icon className={tabletModeEnabled ? 'h-12 w-12' : 'h-8 w-8'} />
                    <span className={`font-semibold leading-tight ${tabletModeEnabled ? 'text-base' : 'text-2xl'}`}>
                      {formType.title}
                    </span>
                    {formType.subtitle && (
                      <span
                        className={`pointer-events-none absolute bottom-2 left-2 right-2 truncate leading-tight opacity-90 max-[350px]:hidden ${tabletModeEnabled ? 'text-xs' : 'text-base'} ${textColorClass}`}
                        aria-hidden
                      >
                        {formType.subtitle}
                      </span>
                    )}
                  </div>
                </Link>
              );
              })}
            </div>
          </TooltipProvider>
        )}
      </div>

      {/* Manager/Admin Quick Access - Smaller Tiles */}
      {visibleManagementTiles.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-3">
            Management Tools
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {/* Manager Links - Using shared navigation config */}
            {visibleManagerTiles.filter(link => link.href !== '/absence/manage').map((link, index) => {
              const Icon = link.icon;
              const canHaveBadge = hasManagementTileBadge(link.href);
              const badgeCount = getManagementTileBadgeCount(link.href);
              
              return (
                <Link key={link.href} href={link.href}>
                  <div 
                    className="relative bg-slate-800 dark:bg-slate-900 border-4 border-slate-600 hover:border-slate-500 hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer animate-tile-pop"
                    style={{ height: '100px', animationDelay: `${index * 75}ms` }}
                  >
                    {badgesLoading && canHaveBadge ? (
                      <div className="absolute top-2 right-2 bg-slate-500/80 rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-slate-700 animate-pulse">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      </div>
                    ) : badgeCount > 0 ? (
                      <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-lg ring-2 ring-slate-800">
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </div>
                    ) : null}
                    <div className="flex flex-col items-start justify-between h-full">
                      <Icon className="h-6 w-6 text-muted-foreground" />
                      <span className="text-white font-semibold text-base leading-tight">
                        {link.label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
            
            {/* Admin Links - Using shared navigation config */}
            {visibleAdminTiles.map((link, index) => {
              const Icon = link.icon;
              const animationIndex = visibleManagerTiles.length + index;
              const canHaveBadge = hasManagementTileBadge(link.href);
              const badgeCount = getManagementTileBadgeCount(link.href);
              
              return (
                <Link key={link.href} href={link.href}>
                  <div 
                    className="relative bg-slate-800 dark:bg-slate-900 border-4 border-slate-600 hover:border-slate-500 hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer animate-tile-pop"
                    style={{ height: '100px', animationDelay: `${animationIndex * 75}ms` }}
                  >
                    {badgesLoading && canHaveBadge ? (
                      <div className="absolute top-2 right-2 bg-slate-500/80 rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-slate-700 animate-pulse">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      </div>
                    ) : badgeCount > 0 ? (
                      <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-lg ring-2 ring-slate-800">
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </div>
                    ) : null}
                    <div className="flex flex-col items-start justify-between h-full">
                      <Icon className="h-6 w-6 text-muted-foreground" />
                      <span className="text-white font-semibold text-base leading-tight">
                        {link.label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
            
            {/* SuperAdmin Only - Debug Link (only when viewing as actual role) */}
            {(isActualSuperAdmin || profile?.role?.is_super_admin) && !isViewingAs && (() => {
              const Icon = Bug;
              const animationIndex = visibleManagementTiles.length;
              
              return (
                <Link key="/debug" href="/debug">
                  <div 
                    className="relative bg-slate-800 dark:bg-slate-900 border-4 border-red-600 hover:border-red-500 hover:scale-105 transition-all duration-200 rounded-lg p-4 shadow-md cursor-pointer animate-tile-pop"
                    style={{ height: '100px', animationDelay: `${animationIndex * 75}ms` }}
                  >
                    {badgesLoading ? (
                      <div className="absolute top-2 right-2 bg-slate-500/80 rounded-full h-6 w-6 flex items-center justify-center shadow-lg ring-2 ring-slate-700 animate-pulse">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      </div>
                    ) : getManagementTileBadgeCount('/debug') > 0 ? (
                      <div className="absolute top-2 right-2 bg-red-500 text-white rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shadow-lg ring-2 ring-slate-800">
                        {getManagementTileBadgeCount('/debug') > 99 ? '99+' : getManagementTileBadgeCount('/debug')}
                      </div>
                    ) : null}
                    <div className="flex flex-col items-start justify-between h-full">
                      <Icon className="h-6 w-6 text-red-500" />
                      <span className="font-semibold text-base leading-tight text-red-500">
                        Debug
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
      {canViewApprovals && (
        <Card className="border-border animate-card-fade" style={{ animationDelay: '300ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-white">
              <span>Pending Approvals</span>
              <Link href="/approvals">
                <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-slate-700/50">
                  View All Approvals
                </Button>
              </Link>
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Outstanding approval requests across all types
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
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
                      <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all duration-200 border border-border/50 hover:border-slate-300 dark:hover:border-border">
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
                            <p className="text-sm text-muted-foreground">
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
                          <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-muted-foreground transition-colors" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
                
                {pendingApprovals.reduce((sum, a) => sum + a.count, 0) === 0 && (
                  <div className="text-center py-8 text-slate-400 mt-4">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-20 text-green-400" />
                    <p className="text-lg mb-1">All caught up!</p>
                    <p className="text-sm text-muted-foreground">
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
      {canViewActions && (
        <Card className="border-border animate-card-fade" style={{ animationDelay: '400ms' }}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-white">
              <span>Manager Actions</span>
              <Link href="/actions">
                <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-slate-700/50">
                  View All Actions
                </Button>
              </Link>
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Track and manage all action items
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Loading actions...</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleActionsSummary.map((actionType) => {
                  const Icon = actionType.icon;
                  
                  return (
                    <Link
                      key={actionType.type}
                      href={actionType.href}
                      className="block group"
                    >
                      <div className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-all duration-200 border border-border/50 hover:border-slate-300 dark:hover:border-border">
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
                            <p className="text-sm text-muted-foreground">
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
                          <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-muted-foreground transition-colors" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
                
                {visibleActionsSummary.reduce((sum, a) => sum + a.count, 0) === 0 && (
                  <div className="text-center py-8 text-slate-400 mt-4">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-20 text-green-400" />
                    <p className="text-lg mb-1">All clear!</p>
                    <p className="text-sm text-muted-foreground">
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

