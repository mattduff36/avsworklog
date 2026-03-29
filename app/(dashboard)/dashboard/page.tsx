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
import { managerNavItems, adminNavItems, getFilteredNavByPermissions } from '@/lib/config/navigation';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { useRamsAssignmentSummary } from '@/lib/hooks/useNavMetrics';

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

export default function DashboardPage() {
  const { profile, isManager, isAdmin, isActualSuperAdmin, isViewingAs, effectiveRole } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const formTypes = getEnabledForms();

  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalCount[]>([]);
  const [actionsSummary, setActionsSummary] = useState<PendingApprovalCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSuggestionsCount, setNewSuggestionsCount] = useState(0);
  const [newErrorReportsCount, setNewErrorReportsCount] = useState(0);
  const [pendingQuotesCount, setPendingQuotesCount] = useState(0);
  const [errorLogsCount, setErrorLogsCount] = useState(0);
  const [badgesLoading, setBadgesLoading] = useState(true);
  const {
    enabledModuleSet: userPermissions,
    effectiveTeamName,
    isLoading: permissionsLoading,
  } = usePermissionSnapshot();
  const { data: ramsSummary, isLoading: ramsLoading } = useRamsAssignmentSummary(profile?.id);
  const pendingRAMSCount = ramsSummary?.pendingCount || 0;
  const hasRAMSAssignments = ramsSummary?.hasAssignments || false;
  
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

  const roleLabel = effectiveRole?.display_name || (isSuperAdmin ? 'SuperAdmin' : (profile?.role?.display_name || 'No Role Assigned'));
  const dashboardTeamName = effectiveTeamName || profile?.team?.name || null;
  const headerSubtitle = dashboardTeamName ? `${dashboardTeamName} · ${roleLabel}` : roleLabel;

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
    const response = await fetch('/api/dashboard/summary', { cache: 'no-store' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load dashboard summary');
    }

    const timesheetsCount = payload.metrics?.approvals?.timesheets || 0;
    const absencesCount = payload.metrics?.approvals?.absences || 0;
    const workshopTotal = payload.metrics?.actions?.workshop || 0;
    const maintenanceTotal = payload.metrics?.actions?.maintenance || 0;
    const suggestionsTotal = payload.metrics?.actions?.suggestions || 0;
    const errorsTotal = payload.metrics?.actions?.errors || 0;
    const suggestionsNewCount = payload.metrics?.badges?.suggestions_new || 0;
    const errorsNewCount = payload.metrics?.badges?.error_reports_new || 0;

    return {
      pendingApprovals: canViewApprovals ? buildPendingApprovalsSummary(timesheetsCount, absencesCount) : [],
      actionsSummary: canViewActions
        ? buildActionsSummary({
            workshopTotal,
            maintenanceTotal,
            suggestionsTotal,
            errorsTotal,
          })
        : [],
      newSuggestionsCount: suggestionsNewCount,
      newErrorReportsCount: errorsNewCount,
      pendingQuotesCount: payload.metrics?.badges?.quotes_pending_internal_approval || 0,
      errorLogsCount: payload.metrics?.badges?.error_logs || 0,
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
        console.error('Error loading dashboard metrics:', error, {
          errorContextId: 'dashboard-load-metrics-error',
        });
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
    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoading, canViewApprovals, canViewActions, canViewWorkshopTasks, canViewMaintenance, canViewSuggestions, canViewErrorReports, profile?.id]);

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
      
      {!tabletModeEnabled && (
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
                {headerSubtitle}
              </p>
            </div>
            <div className="hidden md:flex items-center justify-end">
              <TabletModeToggleActions size="dashboard" />
            </div>
          </div>
        </div>
      )}

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
      {!tabletModeEnabled && canViewApprovals && (
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
      {!tabletModeEnabled && canViewActions && (
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

