'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';
import { createClient } from '@/lib/supabase/client';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Clock, CheckCircle2, XCircle, User, Filter, Calendar, Package } from 'lucide-react';
import { ColumnVisibilityMenu, DataViewToggle } from '@/components/ui/data-view-controls';
import Link from 'next/link';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { AbsenceWithRelations } from '@/types/absence';
import { AbsenceStatusFilter, TimesheetStatusFilter, StatusFilter } from '@/types/common';
import {
  useAllAbsences,
  useApproveAbsence,
  useProcessAbsence,
  useRejectAbsence,
  useAbsenceSummaryForEmployee,
  useAbsenceRealtimeQueryInvalidation,
} from '@/lib/hooks/useAbsence';
import {
  canUseScopedAbsencePermission,
  useAbsenceSecondaryPermissions,
} from '@/lib/hooks/useAbsenceSecondaryPermissions';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { filterEmployeesBySelectedTeam } from '@/lib/utils/absence-admin';
import {
  canActorAuthoriseTimesheetTarget,
  hasAccountsTimesheetFullVisibilityOverride,
  resolveClientApprovalsAccessLevel,
} from '@/lib/utils/timesheet-visibility';
import { toast } from 'sonner';
import { TimesheetsApprovalTable, COLUMN_VISIBILITY_STORAGE_KEY, DEFAULT_COLUMN_VISIBILITY } from './components/TimesheetsApprovalTable';
import type { ColumnVisibility } from './components/TimesheetsApprovalTable';
import { AbsencesApprovalTable, ABSENCE_COLUMN_VISIBILITY_STORAGE_KEY, DEFAULT_ABSENCE_COLUMN_VISIBILITY } from './components/AbsencesApprovalTable';
import type { AbsenceColumnVisibility } from './components/AbsencesApprovalTable';
import { ProcessTimesheetModal } from './components/ProcessTimesheetModal';
import { ApprovalsRejectDialog } from './components/ApprovalsRejectDialog';
import { AbsenceApprovalActions } from './components/AbsenceApprovalActions';
import { TimesheetApprovalPreview } from './components/TimesheetApprovalPreview';
import { TimesheetSubmittedActions } from './components/TimesheetSubmittedActions';
import { TimesheetStatusChips } from '@/components/timesheets/TimesheetStatusChips';
import { SectionLoader } from '@/components/ui/section-loader';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import {
  type ApprovedAbsenceForTimesheet,
  getTimesheetWeekIsoBounds,
  resolveTimesheetOffDayStates,
} from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';
import {
  getErrorMessage,
  shouldLogAbsenceManageError,
} from '@/lib/utils/absence-error-handling';
import { isClientSessionPausedError } from '@/lib/app-auth/session-error';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import {
  canLoadApprovalsFilterDirectory,
  getApprovalsTimesheetStatuses,
  getApprovalsDefaultStatusFilters,
  shouldIncludeTimesheetInAllSubmittedFilter,
} from '@/lib/utils/approvals-filters';
import { timesheetMatchesStatusFilter } from '@/lib/utils/timesheet-status-display';
import {
  createApprovalInFlightGuard,
  isAlreadyApprovedConflict,
  runWithConcurrency,
} from './approvals-quick-approve';
import {
  getAbsenceApprovalActionVisibility,
  getApprovalsAbsenceFilterOptions,
  getApprovalsTimesheetFilterOptions,
  getTimesheetApprovalActionVisibility,
  getTimesheetBulkToolbarVisibility,
  resolveTimesheetPrimaryGate,
  partitionTimesheetBulkSelection,
  resolveApprovalsActorKind,
} from '@/lib/utils/approvals-action-visibility';
import {
  TIMESHEET_PROCESS_STATUS_CONFLICT_CODE,
  isTimesheetProcessConflict,
} from '@/lib/utils/timesheet-process';

const APPROVALS_PAGE_SIZE = 50;
const approvalsTabTriggerClassName = 'gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900';

function isAnnualLeaveReason(name: string): boolean {
  return name.trim().toLowerCase() === 'annual leave';
}

interface TimesheetEntry {
  day_of_week: number;
  daily_total: number | null;
  job_number: string | null;
  job_numbers?: string[];
  timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }>;
  working_in_yard: boolean;
  did_not_work: boolean;
}

interface TimesheetEntryWithTimesheetId extends TimesheetEntry {
  timesheet_id: string;
}

interface TimesheetWithProfile extends Timesheet {
  user: {
    full_name: string;
    employee_id: string;
  };
  timesheet_entries?: TimesheetEntry[];
  leave_total_display?: string;
  leave_worked_hours?: number;
  leave_days?: number;
}

interface ApprovedAbsenceForApprovals extends ApprovedAbsenceForTimesheet {
  profile_id: string;
}

interface FilterEmployee {
  id: string;
  full_name: string;
  employee_id: string | null;
  team_id: string | null;
  team_name: string | null;
}

type ApprovalsTab = 'timesheets' | 'absences';

function ApprovalsContent() {
  const { profile, isAdmin, isSuperAdmin } = useAuth();
  const { hasPermission: canViewApprovals, loading: permissionLoading } = usePermissionCheck('approvals', false);
  const { permissionLevels } = usePermissionSnapshot();
  const approvalsAccessLevel = resolveClientApprovalsAccessLevel({
    isAdminTier: Boolean(isAdmin || isSuperAdmin),
    permissionLevels,
  });
  const { data: absenceSecondarySnapshot, isLoading: absenceSecondaryLoading } = useAbsenceSecondaryPermissions(
    canViewApprovals
  );
  const router = useRouter();
  const [tabParam, setTabParam] = useQueryState('tab', {
    shallow: true,
  });
  const supabase = createClient();
  const actorProfileId = profile?.id || '';
  const actorTeamId = absenceSecondarySnapshot?.team_id || null;
  const actorTeamName = absenceSecondarySnapshot?.team_name || null;
  const hasAccountsVisibilityOverride = hasAccountsTimesheetFullVisibilityOverride(
    absenceSecondarySnapshot?.role_name,
    absenceSecondarySnapshot?.team_name
  );
  const canLoadFilterDirectory = canLoadApprovalsFilterDirectory(
    canViewApprovals,
    absenceSecondarySnapshot?.role_tier
  );
  const isAdminTier = Boolean(isAdmin || isSuperAdmin);
  const isTimesheetAdminTier = Boolean(isAdminTier || hasAccountsVisibilityOverride);
  const isAccountsActor = hasAccountsVisibilityOverride && !isAdminTier;
  const actorKind = resolveApprovalsActorKind({
    isAdminTier,
    isAccountsActor,
  });
  const activeTab: ApprovalsTab = tabParam === 'absences' ? 'absences' : 'timesheets';
  const defaultStatusFilters = useMemo(
    () => getApprovalsDefaultStatusFilters(actorTeamName),
    [actorTeamName]
  );
  
  const [timesheets, setTimesheets] = useState<TimesheetWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [timesheetFilter, setTimesheetFilter] = useState<TimesheetStatusFilter>(defaultStatusFilters.timesheets);
  const [absenceStatusFilter, setAbsenceStatusFilter] = useState<AbsenceStatusFilter>(defaultStatusFilters.absences);
  const statusFilter: StatusFilter = activeTab === 'timesheets' ? timesheetFilter : absenceStatusFilter;
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [visibleTimesheetCount, setVisibleTimesheetCount] = useState(APPROVALS_PAGE_SIZE);
  const [visibleAbsenceCount, setVisibleAbsenceCount] = useState(APPROVALS_PAGE_SIZE);
  const [employees, setEmployees] = useState<FilterEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const approveInFlightRef = useRef(createApprovalInFlightGuard());
  const processInFlightRef = useRef(createApprovalInFlightGuard());
  const [busyTimesheetIds, setBusyTimesheetIds] = useState<ReadonlySet<string>>(() => new Set());

  // View mode (cards vs table) - persisted to localStorage per tab
  const [timesheetViewMode, setTimesheetViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('approvals-ts-view-mode') as 'cards' | 'table') || 'table';
    }
    return 'table';
  });
  const [selectedTimesheetIds, setSelectedTimesheetIds] = useState<Set<string>>(() => new Set());
  const [rejectTarget, setRejectTarget] = useState<{ type: 'timesheet' | 'absence'; id: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [bulkDialog, setBulkDialog] = useState<{ action: 'payroll' | 'manager' } | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [absenceViewMode, setAbsenceViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('approvals-abs-view-mode') as 'cards' | 'table') || 'table';
    }
    return 'table';
  });

  // Column visibility - timesheets
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  // Column visibility - absences
  const [absenceColumnVisibility, setAbsenceColumnVisibility] = useState<AbsenceColumnVisibility>(DEFAULT_ABSENCE_COLUMN_VISIBILITY);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ColumnVisibility>;
        setColumnVisibility(prev => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
    try {
      const saved = localStorage.getItem(ABSENCE_COLUMN_VISIBILITY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AbsenceColumnVisibility>;
        setAbsenceColumnVisibility(prev => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility(prev => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const toggleAbsenceColumn = (column: keyof AbsenceColumnVisibility) => {
    setAbsenceColumnVisibility(prev => {
      const next = { ...prev, [column]: !prev[column] };
      localStorage.setItem(ABSENCE_COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Process modal state
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [processingTimesheetId, setProcessingTimesheetId] = useState<string | null>(null);
  const [processingInProgress, setProcessingInProgress] = useState(false);
  
  // Absence hooks
  const allAbsenceFilters = useMemo(() => ({
    includeArchived: false,
    status: absenceStatusFilter === 'all' ? undefined : absenceStatusFilter,
  }), [absenceStatusFilter]);
  const { data: absences, isLoading: absencesLoading } = useAllAbsences(allAbsenceFilters);
  const approveAbsence = useApproveAbsence();
  const processAbsence = useProcessAbsence();
  const rejectAbsence = useRejectAbsence();
  useAbsenceRealtimeQueryInvalidation();
  const canAuthoriseAbsences = Boolean(
    absenceSecondarySnapshot?.flags.can_authorise_bookings || isAdminTier
  );
  const canAuthoriseTimesheets = Boolean(
    absenceSecondarySnapshot?.flags.can_authorise_bookings || isTimesheetAdminTier
  );
  const activeCanAuthoriseBookings =
    activeTab === 'timesheets' ? canAuthoriseTimesheets : canAuthoriseAbsences;
  const activeIsAdminTier = activeTab === 'timesheets' ? isTimesheetAdminTier : isAdminTier;
  const scopeTeamOnly = Boolean(
    !activeIsAdminTier &&
      activeCanAuthoriseBookings &&
      absenceSecondarySnapshot &&
      !absenceSecondarySnapshot.permissions.authorise_bookings_all &&
      absenceSecondarySnapshot.permissions.authorise_bookings_team
  );
  const isTeamFilterLocked = scopeTeamOnly;
  const effectiveTeamFilter = scopeTeamOnly ? (actorTeamId || '__no_team_scope__') : selectedTeamId;

  useEffect(() => {
    if (tabParam === 'timesheets' || tabParam === 'absences') return;
    void setTabParam('timesheets');
  }, [tabParam, setTabParam]);

  useEffect(() => {
    if (activeTab === 'timesheets') {
      setTimesheetFilter(defaultStatusFilters.timesheets);
      return;
    }

    setAbsenceStatusFilter(defaultStatusFilters.absences);
  }, [activeTab, defaultStatusFilters.absences, defaultStatusFilters.timesheets]);

  useEffect(() => {
    const timesheetOptions = getApprovalsTimesheetFilterOptions(actorKind);
    if (!timesheetOptions.includes(timesheetFilter)) {
      setTimesheetFilter(defaultStatusFilters.timesheets);
    }
    const absenceOptions = getApprovalsAbsenceFilterOptions(actorKind);
    if (!absenceOptions.includes(absenceStatusFilter)) {
      setAbsenceStatusFilter(defaultStatusFilters.absences);
    }
  }, [actorKind, timesheetFilter, absenceStatusFilter, defaultStatusFilters]);

  useEffect(() => {
    if (!scopeTeamOnly) {
      setSelectedTeamId((current) => (current === '__no_team_scope__' ? 'all' : current));
      return;
    }
    setSelectedTeamId(actorTeamId || '__no_team_scope__');
  }, [scopeTeamOnly, actorTeamId]);

  const employeeById = useMemo(() => {
    const map = new Map<string, FilterEmployee>();
    employees.forEach((employee) => {
      map.set(employee.id, employee);
    });
    return map;
  }, [employees]);

  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((employee) => {
      if (!employee.team_id) return;
      if (!map.has(employee.team_id)) {
        map.set(employee.team_id, employee.team_name || employee.team_id);
      }
    });

    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);

  const filteredEmployeeOptions = useMemo(
    () => filterEmployeesBySelectedTeam(employees, effectiveTeamFilter),
    [employees, effectiveTeamFilter]
  );

  const lockedTeamLabel =
    actorTeamName ||
    teamOptions.find((team) => team.value === actorTeamId)?.label ||
    (actorTeamId ? 'My Team' : 'No team assigned');

  const reportAbsenceActionError = useCallback((
    actionLabel: string,
    error: unknown,
    errorContextId: string,
    fallbackMessage: string
  ) => {
    const message = getErrorMessage(error, fallbackMessage);
    if (shouldLogAbsenceManageError(error)) {
      console.error(`${actionLabel}:`, error, { errorContextId });
    } else {
      console.warn(`${actionLabel}:`, message);
    }
    toast.error(message, { id: errorContextId });
  }, []);

  useEffect(() => {
    if (selectedEmployeeId === 'all') return;
    const employeeStillVisible = filteredEmployeeOptions.some((employee) => employee.id === selectedEmployeeId);
    if (!employeeStillVisible) {
      setSelectedEmployeeId('all');
    }
  }, [filteredEmployeeOptions, selectedEmployeeId]);

  useEffect(() => {
    if (!canLoadFilterDirectory) {
      setEmployees([]);
      setEmployeesLoading(false);
      return;
    }
    let isMounted = true;

    async function loadEmployees() {
      setEmployeesLoading(true);
      try {
        const directory = await fetchUserDirectory({ includeRole: true, limit: 500 });
        if (!isMounted) return;

        setEmployees(
          directory.map((employee) => ({
            id: employee.id,
            full_name: employee.full_name || 'Unknown User',
            employee_id: employee.employee_id || null,
            team_id: employee.team?.id || null,
            team_name: employee.team?.name || null,
          }))
        );
      } catch (error) {
        if (isAuthErrorStatus(getErrorStatus(error))) {
          if (isMounted) setEmployees([]);
          return;
        }
        const errorContextId = 'approvals-load-filters-error';
        console.error('Error loading approvals filters:', error, { errorContextId });
        if (isMounted) {
          toast.error('Failed to load approvals filters', { id: errorContextId });
        }
      } finally {
        if (isMounted) {
          setEmployeesLoading(false);
        }
      }
    }

    void loadEmployees();

    return () => {
      isMounted = false;
    };
  }, [canLoadFilterDirectory]);

  const scopedAbsences = useMemo(() => {
    if (!canAuthoriseAbsences) return [] as AbsenceWithRelations[];
    if (!absences || absences.length === 0) return [] as AbsenceWithRelations[];
    if (isAdminTier) return absences;
    if (!actorProfileId || !absenceSecondarySnapshot) return [] as AbsenceWithRelations[];

    return absences.filter((absence) =>
      canUseScopedAbsencePermission(
        {
          permissions: absenceSecondarySnapshot.permissions,
          team_id: absenceSecondarySnapshot.team_id,
        },
        actorProfileId,
        {
          profile_id: absence.profile_id,
          team_id: absence.profiles.team_id || null,
        },
        {
          all: 'authorise_bookings_all',
          team: 'authorise_bookings_team',
          own: 'authorise_bookings_own',
        }
      )
    );
  }, [absences, canAuthoriseAbsences, isAdminTier, actorProfileId, absenceSecondarySnapshot]);

  const filteredAbsences = useMemo(() => {
    return scopedAbsences.filter((absence) => {
      if (absence.status === 'cancelled') return false;
      if (selectedEmployeeId !== 'all' && absence.profile_id !== selectedEmployeeId) return false;

      if (effectiveTeamFilter !== 'all') {
        const targetTeamId = absence.profiles.team_id || null;
        if (effectiveTeamFilter === 'unassigned') {
          if (targetTeamId) return false;
        } else if (targetTeamId !== effectiveTeamFilter) {
          return false;
        }
      }

      if (absenceStatusFilter !== 'all' && absence.status !== absenceStatusFilter) return false;
      const absenceEnd = absence.end_date || absence.date;
      if (dateFrom && absenceEnd < dateFrom) return false;
      if (dateTo && absence.date > dateTo) return false;
      return true;
    });
  }, [scopedAbsences, selectedEmployeeId, effectiveTeamFilter, absenceStatusFilter, dateFrom, dateTo]);

  const getScopedTimesheetsForCurrentActor = useCallback((rows: TimesheetWithProfile[]) => {
    if (rows.length === 0) return [] as TimesheetWithProfile[];
    if (!canAuthoriseTimesheets || !actorProfileId || !absenceSecondarySnapshot) {
      return [] as TimesheetWithProfile[];
    }

    return rows.filter((timesheet) =>
      canActorAuthoriseTimesheetTarget({
        actor: {
          actorProfileId,
          actorTeamId: absenceSecondarySnapshot.team_id,
          approvalsAccessLevel,
          // Admin tier keeps global visibility; Accounts Supervisor override remains explicit.
          // Self-approval is still blocked inside canActorAuthoriseTimesheetTarget.
          hasAccountsOverride: hasAccountsVisibilityOverride || isAdminTier,
          permissions: absenceSecondarySnapshot.permissions,
        },
        target: {
          profileId: timesheet.user_id,
          teamId: employeeById.get(timesheet.user_id)?.team_id || null,
        },
      })
    );
  }, [
    canAuthoriseTimesheets,
    actorProfileId,
    absenceSecondarySnapshot,
    employeeById,
    canViewApprovals,
    hasAccountsVisibilityOverride,
    isAdminTier,
    approvalsAccessLevel,
  ]);

  const getCurrentFilteredTimesheets = useCallback((rows: TimesheetWithProfile[]) => {
    return getScopedTimesheetsForCurrentActor(rows).filter((timesheet) => {
      if (selectedEmployeeId !== 'all' && timesheet.user_id !== selectedEmployeeId) return false;

      const targetTeamId = employeeById.get(timesheet.user_id)?.team_id || null;
      if (effectiveTeamFilter !== 'all') {
        if (effectiveTeamFilter === 'unassigned') {
          if (targetTeamId) return false;
        } else if (targetTeamId !== effectiveTeamFilter) {
          return false;
        }
      }

      if (timesheetFilter === 'all') {
        if (!shouldIncludeTimesheetInAllSubmittedFilter(timesheet.status)) return false;
      } else if (!timesheetMatchesStatusFilter(timesheet.status, timesheetFilter)) {
        return false;
      }
      if (dateFrom && timesheet.week_ending < dateFrom) return false;
      if (dateTo && timesheet.week_ending > dateTo) return false;
      return true;
    });
  }, [
    getScopedTimesheetsForCurrentActor,
    selectedEmployeeId,
    employeeById,
    effectiveTeamFilter,
    timesheetFilter,
    dateFrom,
    dateTo,
  ]);

  const filteredTimesheets = useMemo(
    () => getCurrentFilteredTimesheets(timesheets),
    [timesheets, getCurrentFilteredTimesheets]
  );

  const visibleTimesheetCards = useMemo(
    () => filteredTimesheets.slice(0, visibleTimesheetCount),
    [filteredTimesheets, visibleTimesheetCount]
  );
  const visibleAbsenceCards = useMemo(
    () => filteredAbsences.slice(0, visibleAbsenceCount),
    [filteredAbsences, visibleAbsenceCount]
  );

  useEffect(() => {
    setVisibleTimesheetCount(APPROVALS_PAGE_SIZE);
    setSelectedTimesheetIds(new Set());
  }, [selectedEmployeeId, effectiveTeamFilter, timesheetFilter, dateFrom, dateTo]);

  useEffect(() => {
    setVisibleAbsenceCount(APPROVALS_PAGE_SIZE);
  }, [selectedEmployeeId, effectiveTeamFilter, absenceStatusFilter, dateFrom, dateTo]);

  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const timesheetStatuses = getApprovalsTimesheetStatuses(timesheetFilter);
      
      // Headers first; entry details cover the filtered set so table sort cannot orphan previews.
      let timesheetQuery = supabase
        .from('timesheets')
        .select(`
          id,
          user_id,
          reg_number,
          week_ending,
          status,
          submitted_at,
          user:profiles!timesheets_user_id_fkey (
            full_name,
            employee_id
          )
        `);

      if (timesheetStatuses.length === 1) {
        timesheetQuery = timesheetQuery.eq('status', timesheetStatuses[0]);
      } else {
        timesheetQuery = timesheetQuery.in('status', [...timesheetStatuses]);
      }

      if (selectedEmployeeId !== 'all') {
        timesheetQuery = timesheetQuery.eq('user_id', selectedEmployeeId);
      }

      if (dateFrom) {
        timesheetQuery = timesheetQuery.gte('week_ending', dateFrom);
      }

      if (dateTo) {
        timesheetQuery = timesheetQuery.lte('week_ending', dateTo);
      }

      const { data: timesheetData, error: timesheetError } = await timesheetQuery
        .order('submitted_at', { ascending: false });

      if (timesheetError) throw timesheetError;
      const typedTimesheets = (timesheetData || []) as TimesheetWithProfile[];
      const timesheetsWithLeaveTotals = typedTimesheets.map((timesheet) => ({
        ...timesheet,
        timesheet_entries: undefined,
        leave_total_display: undefined,
        leave_worked_hours: undefined,
        leave_days: undefined,
      }));

      const visibleTimesheets = getCurrentFilteredTimesheets(timesheetsWithLeaveTotals);
      const visibleTimesheetIds = visibleTimesheets.map((timesheet) => timesheet.id);
      const userIds = [...new Set(visibleTimesheets.map((timesheet) => timesheet.user_id).filter(Boolean))];
      if (visibleTimesheetIds.length === 0 || userIds.length === 0) {
        setTimesheets(timesheetsWithLeaveTotals);
        return;
      }

      const weekBounds = visibleTimesheets.map((timesheet) => {
        const { startIso, endIso } = getTimesheetWeekIsoBounds(timesheet.week_ending);
        return {
          timesheetId: timesheet.id,
          profileId: timesheet.user_id,
          weekEnding: timesheet.week_ending,
          startIso,
          endIso,
        };
      });

      const minStartIso = weekBounds.reduce((min, row) => (row.startIso < min ? row.startIso : min), weekBounds[0].startIso);
      const maxEndIso = weekBounds.reduce((max, row) => (row.endIso > max ? row.endIso : max), weekBounds[0].endIso);

      const [entriesResult, absencesResult] = await Promise.all([
        supabase
          .from('timesheet_entries')
          .select(`
            timesheet_id,
            day_of_week,
            daily_total,
            job_number,
            timesheet_entry_job_codes (
              job_number,
              display_order
            ),
            working_in_yard,
            did_not_work
          `)
          .in('timesheet_id', visibleTimesheetIds),
        supabase
          .from('absences')
          .select('profile_id, date, end_date, status, is_half_day, half_day_session, allow_timesheet_work_on_leave, absence_reasons(name,color,is_paid)')
          .in('profile_id', userIds)
          .in('status', ['pending', 'approved', 'processed'])
          .lte('date', maxEndIso)
          .or(`end_date.gte.${minStartIso},and(end_date.is.null,date.gte.${minStartIso})`),
      ]);

      if (entriesResult.error) throw entriesResult.error;
      if (absencesResult.error) throw absencesResult.error;

      const entriesByTimesheet = new Map<string, TimesheetEntry[]>();
      ((entriesResult.data || []) as TimesheetEntryWithTimesheetId[]).forEach(({ timesheet_id, ...entry }) => {
        const existing = entriesByTimesheet.get(timesheet_id) || [];
        existing.push(entry);
        entriesByTimesheet.set(timesheet_id, existing);
      });

      const { data: absencesData, error: absencesError } = absencesResult;
      if (absencesError) throw absencesError;

      const approvedAbsences = (absencesData || []) as ApprovedAbsenceForApprovals[];
      const absencesByProfile = new Map<string, ApprovedAbsenceForApprovals[]>();
      approvedAbsences.forEach((absence) => {
        const existing = absencesByProfile.get(absence.profile_id) || [];
        existing.push(absence);
        absencesByProfile.set(absence.profile_id, existing);
      });

      const enrichedVisibleTimesheets = visibleTimesheets.map((timesheet) => {
        const { startIso, endIso } = getTimesheetWeekIsoBounds(timesheet.week_ending);
        const employeeAbsences = absencesByProfile.get(timesheet.user_id) || [];
        const weekAbsences = employeeAbsences.filter((absence) => {
          const absenceEnd = absence.end_date || absence.date;
          return absence.date <= endIso && absenceEnd >= startIso && absenceEnd >= minStartIso;
        });
        const offDayStates = resolveTimesheetOffDayStates(timesheet.week_ending, weekAbsences, null);
        const entries = entriesByTimesheet.get(timesheet.id) || [];
        const leaveAwareTotals = buildLeaveAwareTotals(entries, offDayStates);

        return {
          ...timesheet,
          timesheet_entries: entries,
          leave_total_display: leaveAwareTotals.weekly.display,
          leave_worked_hours: leaveAwareTotals.weekly.workedHours,
          leave_days: leaveAwareTotals.weekly.leaveDays,
        };
      });

      const enrichedById = new Map(enrichedVisibleTimesheets.map((timesheet) => [timesheet.id, timesheet]));
      setTimesheets(timesheetsWithLeaveTotals.map((timesheet) => enrichedById.get(timesheet.id) || timesheet));
    } catch (error) {
      const errorContextId = 'approvals-fetch-list-error';
      const shouldLogError =
        !isAuthErrorStatus(getErrorStatus(error)) &&
        !isClientSessionPausedError(error) &&
        !isNetworkFetchError(error);

      if (shouldLogError) {
        console.error('Error fetching approvals:', error, { errorContextId });
      }
      toast.error('Failed to load approvals', { id: errorContextId });
    } finally {
      setLoading(false);
    }
  }, [
    dateFrom,
    dateTo,
    getCurrentFilteredTimesheets,
    selectedEmployeeId,
    supabase,
    timesheetFilter,
    visibleTimesheetCount,
  ]);

  useEffect(() => {
    if (!permissionLoading) {
      if (!canViewApprovals) {
        router.push('/dashboard');
        return;
      }
      fetchApprovals();
    }
  }, [canViewApprovals, permissionLoading, router, fetchApprovals]);

  const handleQuickApprove = async (
    _type: 'timesheet',
    id: string,
    options?: { skipRefresh?: boolean }
  ): Promise<boolean> => {
    if (!approveInFlightRef.current.tryBegin(id)) {
      return false;
    }
    setBusyTimesheetIds((previous) => {
      const next = new Set(previous);
      next.add(id);
      return next;
    });

    try {
      const expectedStatus = timesheets.find((row) => row.id === id)?.status;
      const response = await fetch(`/api/timesheets/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          expected_status: expectedStatus,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          toast.error(payload.error || 'Timesheet status changed. Reloading.');
          if (!options?.skipRefresh) {
            await fetchApprovals();
          }
          return false;
        }
        throw new Error(payload.error || 'Failed to approve timesheet');
      }

      toast.success('Timesheet marked as Payroll Received');
      if (!options?.skipRefresh) {
        await fetchApprovals();
      }
      return true;
    } catch (error) {
      if (isAlreadyApprovedConflict(error)) {
        toast.success('Timesheet already marked as Payroll Received');
        if (!options?.skipRefresh) {
          await fetchApprovals();
        }
        return true;
      }
      const errorContextId = 'approvals-quick-approve-error';
      console.error('Error approving:', error, { errorContextId });
      toast.error(error instanceof Error ? error.message : 'Failed to approve timesheet', {
        id: errorContextId,
      });
      return false;
    } finally {
      approveInFlightRef.current.end(id);
      setBusyTimesheetIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  };

  const requestTimesheetReject = (id: string) => {
    setRejectTarget({ type: 'timesheet', id });
    setRejectionReason('');
  };

  const requestAbsenceReject = (id: string) => {
    setRejectTarget({ type: 'absence', id });
    setRejectionReason('');
  };

  const handleConfirmReject = async () => {
    if (!rejectTarget || !rejectionReason.trim()) {
      toast.error('Rejection reason required', {
        id: 'approvals-rejection-reason-required',
        description: 'Please provide a reason for rejecting this request.',
      });
      return;
    }

    setRejectSubmitting(true);
    try {
      if (rejectTarget.type === 'timesheet') {
        const response = await fetch(`/api/timesheets/${rejectTarget.id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments: rejectionReason.trim() }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          if (response.status === 409) {
            toast.error(payload.error || 'Timesheet status changed. Reloading.');
            await fetchApprovals();
            setRejectTarget(null);
            return;
          }
          throw new Error(payload.error || 'Failed to reject timesheet');
        }
        await fetchApprovals();
      } else {
        await rejectAbsence.mutateAsync({
          id: rejectTarget.id,
          reason: rejectionReason.trim(),
        });
      }
      setRejectTarget(null);
      setRejectionReason('');
    } catch (error) {
      if (rejectTarget.type === 'absence') {
        reportAbsenceActionError(
          'Error rejecting absence',
          error,
          'approvals-absence-reject-error',
          'Failed to reject absence'
        );
        return;
      }
      const errorContextId = 'approvals-quick-reject-error';
      console.error('Error rejecting:', error, { errorContextId });
      toast.error('Failed to reject timesheet', { id: errorContextId });
    } finally {
      setRejectSubmitting(false);
    }
  };

  const handleOpenProcessModal = (id: string) => {
    setProcessingTimesheetId(id);
    setProcessModalOpen(true);
  };

  const handleConfirmProcess = async () => {
    const timesheetId = processingTimesheetId;
    if (!timesheetId || !processInFlightRef.current.tryBegin(timesheetId)) {
      return;
    }

    try {
      setProcessingInProgress(true);
      const expectedStatus = timesheets.find((row) => row.id === timesheetId)?.status;
      const response = await fetch(`/api/timesheets/${timesheetId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_status: expectedStatus }),
      });
      const payload = (await response.json()) as {
        error?: string;
        code?: string;
        alreadyProcessed?: boolean;
      };
      if (!response.ok) {
        const conflict = new Error(payload.error || 'Failed to process timesheet');
        if (
          payload.code === TIMESHEET_PROCESS_STATUS_CONFLICT_CODE ||
          isTimesheetProcessConflict(conflict)
        ) {
          toast.error(conflict.message, { id: 'approvals-process-timesheet-error' });
          await fetchApprovals();
          return;
        }
        throw conflict;
      }

      toast.success(
        payload.alreadyProcessed
          ? 'Timesheet already marked as Manager Approved'
          : 'Timesheet marked as Manager Approved'
      );
      setProcessModalOpen(false);
      setProcessingTimesheetId(null);
      await fetchApprovals();
    } catch (error) {
      const errorContextId = 'approvals-process-timesheet-error';
      if (isTimesheetProcessConflict(error)) {
        toast.error(
          error instanceof Error ? error.message : 'This timesheet can no longer be marked as Manager Approved',
          { id: errorContextId }
        );
        await fetchApprovals();
        return;
      }
      console.error('Error processing timesheet:', error, { errorContextId });
      toast.error(
        error instanceof Error ? error.message : 'Failed to mark timesheet as Manager Approved',
        { id: errorContextId }
      );
    } finally {
      processInFlightRef.current.end(timesheetId);
      setProcessingInProgress(false);
    }
  };

  const selectedTimesheetRows = filteredTimesheets.filter((row) => selectedTimesheetIds.has(row.id));
  const selectedBulkActions = getTimesheetBulkToolbarVisibility({
    actorKind,
    selectedStatuses: selectedTimesheetRows.map((row) => row.status),
    filter: timesheetFilter,
  });

  const handleBulkAction = async (action: 'payroll' | 'manager') => {
    const { eligibleIds, skippedCount } = partitionTimesheetBulkSelection({
      actorKind,
      action,
      rows: selectedTimesheetRows,
    });
    if (eligibleIds.length === 0) {
      toast.error(
        skippedCount > 0
          ? 'None of the selected timesheets can take this action'
          : 'Select at least one timesheet'
      );
      return;
    }

    setBulkRunning(true);
    let succeeded = 0;
    let failed = 0;
    try {
      await runWithConcurrency(eligibleIds, 3, async (id) => {
        if (action === 'payroll') {
          const ok = await handleQuickApprove('timesheet', id, { skipRefresh: true });
          if (ok) succeeded += 1;
          else failed += 1;
          return;
        }
        const expectedStatus = timesheets.find((row) => row.id === id)?.status;
        if (!processInFlightRef.current.tryBegin(id)) {
          failed += 1;
          return;
        }
        setBusyTimesheetIds((previous) => {
          const next = new Set(previous);
          next.add(id);
          return next;
        });
        try {
          const response = await fetch(`/api/timesheets/${id}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expected_status: expectedStatus }),
          });
          const payload = (await response.json()) as { error?: string };
          if (!response.ok) {
            throw new Error(payload.error || 'Failed to process timesheet');
          }
          succeeded += 1;
        } catch {
          failed += 1;
        } finally {
          processInFlightRef.current.end(id);
          setBusyTimesheetIds((previous) => {
            const next = new Set(previous);
            next.delete(id);
            return next;
          });
        }
      });
      await fetchApprovals();
      setSelectedTimesheetIds(new Set());
      setBulkDialog(null);
      toast.success(
        `${succeeded} updated${failed > 0 ? `, ${failed} failed` : ''}${
          skippedCount > 0 ? `, ${skippedCount} skipped` : ''
        }`
      );
    } finally {
      setBulkRunning(false);
    }
  };

  if (permissionLoading || absenceSecondaryLoading || employeesLoading) {
    return (
      <AppPageLoadingShell
        title="Approvals"
        description="Review and manage submissions"
        message="Loading approvals..."
      />
    );
  }

  if (!canViewApprovals) {
    return null;
  }

  const totalCount = activeTab === 'timesheets' ? filteredTimesheets.length : filteredAbsences.length;

  const getFilterLabel = (filter: StatusFilter, tab: ApprovalsTab = activeTab): string => {
    if (tab === 'absences') {
      if (filter === 'approved') return 'Approved';
      if (filter === 'processed') return 'Processed';
      if (filter === 'pending') return 'Pending';
      if (filter === 'rejected') return 'Rejected';
      if (filter === 'all') return 'All';
      return filter;
    }

    switch (filter) {
      case 'pending':
        return 'Pending';
      case 'approved':
        return 'Payroll Received';
      case 'manager_approved':
        return 'Manager Approved';
      case 'awaiting_payroll':
        return 'Awaiting Payroll';
      case 'awaiting_manager':
        return 'Awaiting Manager';
      case 'rejected':
        return 'Rejected';
      case 'processed':
        return 'Complete';
      case 'adjusted':
        return 'Adjusted';
      case 'all':
        return 'All Submitted';
      default:
        return filter;
    }
  };

  const getFilterOptions = (): StatusFilter[] =>
    activeTab === 'timesheets'
      ? getApprovalsTimesheetFilterOptions(actorKind)
      : getApprovalsAbsenceFilterOptions(actorKind);

  const handleFilterChange = (filter: StatusFilter) => {
    if (activeTab === 'timesheets') {
      setTimesheetFilter(filter as TimesheetStatusFilter);
      return;
    }
    setAbsenceStatusFilter(filter as AbsenceStatusFilter);
  };

  const hasActiveFilters =
    selectedEmployeeId !== 'all' ||
    (!isTeamFilterLocked && selectedTeamId !== 'all') ||
    (activeTab === 'timesheets'
      ? timesheetFilter !== defaultStatusFilters.timesheets
      : absenceStatusFilter !== defaultStatusFilters.absences) ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const clearFilters = () => {
    setSelectedEmployeeId('all');
    setSelectedTeamId(isTeamFilterLocked ? (actorTeamId || '__no_team_scope__') : 'all');
    setTimesheetFilter(defaultStatusFilters.timesheets);
    setAbsenceStatusFilter(defaultStatusFilters.absences);
    setDateFrom('');
    setDateTo('');
  };

  const approvalsStatusHelperText =
    actorKind === 'accounts'
      ? 'Showing the Accounts queue. Payroll Received and edits stay on this list.'
      : actorKind === 'manager'
        ? 'Showing the manager queue. Mark Manager Approved or reject a week from here.'
        : null;

  const handleTabChange = (tab: string) => {
    if (tab !== 'timesheets' && tab !== 'absences') return;
    void setTabParam(tab);
  };

  const getStatusBadge = (status: string) => <TimesheetStatusChips status={status} />;

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="Approvals"
        description="Review and manage submissions"
        icon={<FileText className="h-5 w-5" />}
        actions={
          <Badge
            variant={
              statusFilter === 'pending' ? 'warning' :
              statusFilter === 'approved' ? 'success' :
              statusFilter === 'rejected' ? 'destructive' :
              'secondary'
            }
            className={`w-fit text-lg px-4 py-2 ${
              statusFilter === 'approved' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
              statusFilter === 'processed' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
              statusFilter === 'adjusted' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
              ''
            }`}
          >
            {totalCount} {getFilterLabel(statusFilter)}
          </Badge>
        }
      />

      <Card className="bg-white dark:bg-slate-900 border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-foreground flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </CardTitle>
              {approvalsStatusHelperText ? (
                <CardDescription>{approvalsStatusHelperText}</CardDescription>
              ) : null}
            </div>
            {hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters} className="border-border text-muted-foreground">
                Clear Filters
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Employee</p>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="All employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {filteredEmployeeOptions.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.employee_id ? ` (${employee.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Team</p>
              <Select value={effectiveTeamFilter} onValueChange={setSelectedTeamId} disabled={isTeamFilterLocked}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="All teams" />
                </SelectTrigger>
                <SelectContent>
                  {isTeamFilterLocked ? (
                    <SelectItem value={effectiveTeamFilter}>{lockedTeamLabel}</SelectItem>
                  ) : (
                    <>
                      <SelectItem value="all">All teams</SelectItem>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {teamOptions.map((team) => (
                        <SelectItem key={team.value} value={team.value}>
                          {team.label}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Status</p>
              <Select value={statusFilter} onValueChange={(value) => handleFilterChange(value as StatusFilter)}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {getFilterOptions().map((filter) => (
                    <SelectItem key={filter} value={filter}>
                      {getFilterLabel(filter)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="approvals-date-from" className="text-sm text-muted-foreground mb-2 block">Date From</Label>
              <Input
                id="approvals-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setDateFrom(nextValue);
                  if (dateTo && nextValue && dateTo < nextValue) {
                    setDateTo(nextValue);
                  }
                }}
                className="bg-background border-border text-foreground"
              />
            </div>

            <div>
              <Label htmlFor="approvals-date-to" className="text-sm text-muted-foreground mb-2 block">Date To</Label>
              <Input
                id="approvals-date-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(event) => setDateTo(event.target.value)}
                className="bg-background border-border text-foreground"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex justify-start">
            <TabsList className="h-auto flex-wrap justify-start gap-0 p-1.5">
              <TabsTrigger
                value="timesheets"
                className={approvalsTabTriggerClassName}
              >
                <FileText className="h-4 w-4" />
                Timesheets
                {filteredTimesheets.length > 0 ? (
                  <Badge
                    variant="secondary"
                    className={activeTab === 'timesheets'
                      ? 'border-avs-yellow/20 bg-slate-900/10 text-slate-900'
                      : 'border-border bg-background/70 text-muted-foreground'
                    }
                  >
                    {filteredTimesheets.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger
                value="absences"
                className={approvalsTabTriggerClassName}
              >
                <Calendar className="h-4 w-4" />
                Absences
                {filteredAbsences.length > 0 ? (
                  <Badge
                    variant="secondary"
                    className={activeTab === 'absences'
                      ? 'border-avs-yellow/20 bg-slate-900/10 text-slate-900'
                      : 'border-border bg-background/70 text-muted-foreground'
                    }
                  >
                    {filteredAbsences.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="timesheets" className="mt-4 space-y-4">
            {loading ? (
              <SectionLoader message="Loading timesheet approvals..." />
            ) : filteredTimesheets.length === 0 ? (
              <Card className="border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  {statusFilter === 'pending' ? (
                    <CheckCircle2 className="h-12 w-12 text-green-400 mb-3" />
                  ) : (
                    <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  )}
                  <h3 className="text-lg font-semibold text-white mb-1">
                    {statusFilter === 'pending' ? 'All caught up!' : `No ${getFilterLabel(statusFilter).toLowerCase()} timesheets`}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {statusFilter === 'pending'
                      ? 'There are no pending approvals at the moment'
                      : `There are no ${getFilterLabel(statusFilter).toLowerCase()} timesheets to display`}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Toolbar: Columns + View Toggle - Desktop Only */}
                <div className="hidden md:flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedTimesheetIds.size > 0 ? (
                      <>
                        <p className="text-sm text-muted-foreground">
                          {selectedTimesheetIds.size} selected
                        </p>
                        {filteredTimesheets.length > visibleTimesheetCount ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedTimesheetIds(new Set(filteredTimesheets.map((row) => row.id)));
                            }}
                          >
                            Select all {filteredTimesheets.length} matching
                          </Button>
                        ) : null}
                        {selectedBulkActions.showPayrollReceived ? (
                          <Button
                            size="sm"
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={() => setBulkDialog({ action: 'payroll' })}
                          >
                            Mark {selectedTimesheetIds.size} as Payroll Received
                          </Button>
                        ) : null}
                        {selectedBulkActions.showManagerApproved ? (
                          <Button
                            size="sm"
                            className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover"
                            onClick={() => setBulkDialog({ action: 'manager' })}
                          >
                            Mark {selectedTimesheetIds.size} as Manager Approved
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {timesheetViewMode === 'table' ? (
                      <ColumnVisibilityMenu
                        options={[
                          { id: 'employeeId', label: 'Employee ID', checked: columnVisibility.employeeId },
                          { id: 'totalHours', label: 'Total Hours', checked: columnVisibility.totalHours },
                          { id: 'jobNumber', label: 'Job Number', checked: columnVisibility.jobNumber },
                          { id: 'status', label: 'Status', checked: columnVisibility.status },
                          { id: 'submittedAt', label: 'Submitted', checked: columnVisibility.submittedAt },
                        ]}
                        onToggle={toggleColumn}
                      />
                    ) : null}
                    <DataViewToggle
                      value={timesheetViewMode}
                      onValueChange={(nextViewMode) => {
                        setTimesheetViewMode(nextViewMode);
                        localStorage.setItem('approvals-ts-view-mode', nextViewMode);
                      }}
                    />
                  </div>
                </div>

                {timesheetViewMode === 'table' && (
                  <div className="hidden md:block">
                    <TimesheetsApprovalTable
                      timesheets={filteredTimesheets}
                      actorKind={actorKind}
                      onApprove={async (id) => { await handleQuickApprove('timesheet', id); }}
                      onReject={requestTimesheetReject}
                      onProcess={handleOpenProcessModal}
                      columnVisibility={columnVisibility}
                      visibleCount={visibleTimesheetCount}
                      statusFilter={timesheetFilter}
                      busyTimesheetIds={busyTimesheetIds}
                      selectedIds={selectedTimesheetIds}
                      onToggleSelected={(id, selected) => {
                        setSelectedTimesheetIds((current) => {
                          const next = new Set(current);
                          if (selected) next.add(id);
                          else next.delete(id);
                          return next;
                        });
                      }}
                      onToggleVisibleSelected={(ids, selected) => {
                        setSelectedTimesheetIds((current) => {
                          const next = new Set(current);
                          ids.forEach((id) => {
                            if (selected) next.add(id);
                            else next.delete(id);
                          });
                          return next;
                        });
                      }}
                    />
                  </div>
                )}

                {/* Card View - Always on mobile, conditional on desktop */}
                <div className={timesheetViewMode === 'table' ? 'md:hidden space-y-4' : 'space-y-4'}>
                  {visibleTimesheetCards.map((timesheet) => {
                    const cardTotalDisplay = typeof timesheet.leave_worked_hours === 'number' && typeof timesheet.leave_days === 'number'
                      ? formatLeaveAwareWeeklyDisplayMultiline(timesheet.leave_worked_hours, timesheet.leave_days)
                      : timesheet.leave_total_display;
                    const cardVisibility = getTimesheetApprovalActionVisibility({
                      actorKind,
                      status: timesheet.status,
                    });
                    return (
                    <Link key={timesheet.id} href={`/timesheets/${timesheet.id}`} className="block">
                      <Card className="bg-white dark:bg-slate-900 border-border hover:shadow-lg hover:border-avs-yellow/40 transition-all duration-200 cursor-pointer">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-3">
                              <FileText className="h-5 w-5 text-avs-yellow" />
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
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-muted-foreground">
                              {timesheet.submitted_at ? `Submitted ${formatDate(timesheet.submitted_at)}` : 'Not submitted'}
                              {timesheet.reg_number && ` • Reg: ${timesheet.reg_number}`}
                              {cardTotalDisplay && (
                                <p className="mt-1 whitespace-pre-line">{`Total: ${cardTotalDisplay}`}</p>
                              )}
                            </div>
                            <div
                              className="flex items-center gap-1"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                            >
                              <TimesheetApprovalPreview
                                timesheetId={timesheet.id}
                                entries={timesheet.timesheet_entries}
                              />
                              <TimesheetSubmittedActions
                                timesheetId={timesheet.id}
                                status={timesheet.status}
                                busy={busyTimesheetIds.has(timesheet.id)}
                                showPayrollReceived={cardVisibility.showPayrollReceived}
                                showManagerApproved={cardVisibility.showManagerApproved}
                                showReject={cardVisibility.showReject}
                                showPayrollEdit={cardVisibility.showEdit}
                                primaryGate={resolveTimesheetPrimaryGate({
                                  ...cardVisibility,
                                  filter: timesheetFilter,
                                })}
                                onApprove={(id) => { void handleQuickApprove('timesheet', id); }}
                                onReject={requestTimesheetReject}
                                onProcess={handleOpenProcessModal}
                                onEdit={(id) => router.push(`/timesheets/${id}`)}
                                className="flex min-w-0 flex-wrap justify-end gap-1"
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                    );
                  })}
                </div>
                {filteredTimesheets.length > visibleTimesheetCount && (
                  <div className="flex flex-col items-center gap-3 pt-2">
                    <p className="text-sm text-muted-foreground">
                      Showing {visibleTimesheetCount} of {filteredTimesheets.length} timesheets
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setVisibleTimesheetCount((count) => count + APPROVALS_PAGE_SIZE)}
                      className="border-border text-foreground"
                    >
                      Show More
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Inspections tab removed - inspections no longer require approvals */}

          <TabsContent value="absences" className="mt-4 space-y-4">
            {absencesLoading ? (
              <SectionLoader message="Loading absence approvals..." />
            ) : !canAuthoriseAbsences ? (
              <Card className="border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Calendar className="h-12 w-12 text-muted-foreground mb-3" />
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    Absence approvals are not available
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    You do not have permission to authorise absence bookings.
                  </p>
                </CardContent>
              </Card>
            ) : filteredAbsences.length === 0 ? (
              <Card className="border-border">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CheckCircle2 className="h-12 w-12 text-green-400 mb-3" />
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {statusFilter === 'pending' ? 'All caught up!' : `No ${getFilterLabel(statusFilter).toLowerCase()} absences`}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {statusFilter === 'pending'
                      ? 'There are no pending absence approvals at the moment'
                      : `There are no ${getFilterLabel(statusFilter).toLowerCase()} absences to display`}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Toolbar: Columns + View Toggle - Desktop Only */}
                <div className="hidden md:flex items-center justify-end gap-2">
                  {absenceViewMode === 'table' ? (
                    <ColumnVisibilityMenu
                      options={[
                        { id: 'employeeId', label: 'Employee ID', checked: absenceColumnVisibility.employeeId },
                        { id: 'reason', label: 'Reason', checked: absenceColumnVisibility.reason },
                        { id: 'duration', label: 'Duration', checked: absenceColumnVisibility.duration },
                        { id: 'remainingAllowance', label: 'Remaining Allowance', checked: absenceColumnVisibility.remainingAllowance },
                        { id: 'paidStatus', label: 'Paid / Unpaid', checked: absenceColumnVisibility.paidStatus },
                        { id: 'submittedAt', label: 'Submitted', checked: absenceColumnVisibility.submittedAt },
                      ]}
                      onToggle={toggleAbsenceColumn}
                    />
                  ) : null}
                  <DataViewToggle
                    value={absenceViewMode}
                    onValueChange={(nextViewMode) => {
                      setAbsenceViewMode(nextViewMode);
                      localStorage.setItem('approvals-abs-view-mode', nextViewMode);
                    }}
                  />
                </div>

                {/* Table View - Desktop Only */}
                {absenceViewMode === 'table' && (
                  <div className="hidden md:block">
                    <AbsencesApprovalTable
                      absences={filteredAbsences}
                      actorKind={actorKind}
                      onApprove={async (id) => {
                        try { await approveAbsence.mutateAsync(id); }
                        catch (e) {
                          const errorContextId = 'approvals-table-absence-approve-error';
                          reportAbsenceActionError('Error approving absence', e, errorContextId, 'Failed to approve absence');
                        }
                      }}
                      onReject={requestAbsenceReject}
                      onProcess={async (id) => {
                        try { await processAbsence.mutateAsync(id); }
                        catch (e) {
                          const errorContextId = 'approvals-table-absence-process-error';
                          reportAbsenceActionError('Error processing absence', e, errorContextId, 'Failed to process absence');
                        }
                      }}
                      columnVisibility={absenceColumnVisibility}
                      visibleCount={visibleAbsenceCount}
                    />
                  </div>
                )}

                {/* Card View - Always on mobile, conditional on desktop */}
                <div className={absenceViewMode === 'table' ? 'md:hidden space-y-4' : 'space-y-4'}>
                  {visibleAbsenceCards.map((absence) => (
                    <AbsenceApprovalCard
                      key={absence.id}
                      absence={absence}
                      actorKind={actorKind}
                      onApprove={approveAbsence}
                      onProcess={processAbsence}
                      onReject={requestAbsenceReject}
                      reportAbsenceActionError={reportAbsenceActionError}
                    />
                  ))}
                </div>
                {filteredAbsences.length > visibleAbsenceCount && (
                  <div className="flex flex-col items-center gap-3 pt-2">
                    <p className="text-sm text-muted-foreground">
                      Showing {visibleAbsenceCount} of {filteredAbsences.length} absences
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setVisibleAbsenceCount((count) => count + APPROVALS_PAGE_SIZE)}
                      className="border-border text-foreground"
                    >
                      Show More
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

      {/* Process Timesheet Modal */}
      <ProcessTimesheetModal
        open={processModalOpen}
        onOpenChange={(open) => {
          if (!open && processingInProgress) {
            return;
          }
          setProcessModalOpen(open);
          if (!open) setProcessingTimesheetId(null);
        }}
        onConfirm={handleConfirmProcess}
        processing={processingInProgress}
      />
      <ApprovalsRejectDialog
        open={Boolean(rejectTarget)}
        title={rejectTarget?.type === 'absence' ? 'Reject absence' : 'Reject timesheet'}
        description={
          rejectTarget?.type === 'absence'
            ? 'Provide a reason for rejecting this absence request.'
            : 'Provide a reason for rejecting this timesheet. The employee will be notified.'
        }
        reason={rejectionReason}
        submitting={rejectSubmitting}
        onReasonChange={setRejectionReason}
        onOpenChange={(open) => {
          if (!open && !rejectSubmitting) {
            setRejectTarget(null);
            setRejectionReason('');
          }
        }}
        onConfirm={() => {
          void handleConfirmReject();
        }}
      />
      <AlertDialog open={Boolean(bulkDialog)} onOpenChange={(open) => !open && !bulkRunning && setBulkDialog(null)}>
        <AlertDialogContent className="bg-white dark:bg-slate-900 border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              {bulkDialog?.action === 'payroll'
                ? 'Mark selected as Payroll Received'
                : 'Mark selected as Manager Approved'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {(() => {
                if (!bulkDialog) return '';
                const { eligibleIds, skippedCount } = partitionTimesheetBulkSelection({
                  actorKind,
                  action: bulkDialog.action,
                  rows: selectedTimesheetRows,
                });
                return `${eligibleIds.length} timesheet${eligibleIds.length === 1 ? '' : 's'} will be updated${
                  skippedCount > 0 ? `. ${skippedCount} will be skipped.` : '.'
                }`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning} className="border-border text-foreground">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkRunning}
              onClick={(event) => {
                event.preventDefault();
                if (bulkDialog) {
                  void handleBulkAction(bulkDialog.action);
                }
              }}
              className={
                bulkDialog?.action === 'payroll'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover'
              }
            >
              {bulkRunning ? 'Updating...' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPageShell>
  );
}

// Absence Approval Card Component
function AbsenceApprovalCard({ 
  absence, 
  actorKind,
  onApprove, 
  onProcess,
  onReject,
  reportAbsenceActionError,
}: { 
  absence: AbsenceWithRelations;
  actorKind: ReturnType<typeof resolveApprovalsActorKind>;
  onApprove: ReturnType<typeof useApproveAbsence>;
  onProcess: ReturnType<typeof useProcessAbsence>;
  onReject: (id: string) => void;
  reportAbsenceActionError: (actionLabel: string, error: unknown, errorContextId: string, fallbackMessage: string) => void;
}) {
  const { data: summary } = useAbsenceSummaryForEmployee(absence.profile_id);
  const visibility = getAbsenceApprovalActionVisibility({
    actorKind,
    status: absence.status,
  });
  const canApproveOrReject = visibility.showApprove || visibility.showReject;
  const canProcessAbsence = visibility.showProcess;
  
  async function handleApprove() {
    if (!canApproveOrReject) return;

    // Check allowance for Annual Leave
    if (isAnnualLeaveReason(absence.absence_reasons.name)) {
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
      const errorContextId = 'approvals-absence-approve-error';
      reportAbsenceActionError('Error approving absence', error, errorContextId, 'Failed to approve absence');
    }
  }

  async function handleProcess() {
    if (!canProcessAbsence) return;

    try {
      await onProcess.mutateAsync(absence.id);
    } catch (error) {
      const errorContextId = 'approvals-absence-process-error';
      reportAbsenceActionError('Error processing absence', error, errorContextId, 'Failed to process absence');
    }
  }
  
  const projectedRemaining = isAnnualLeaveReason(absence.absence_reasons.name)
    ? (summary?.remaining || 0) - absence.duration_days 
    : null;

  const getAbsenceStatusBadge = () => {
    if (absence.status === 'approved') {
      return (
        <Badge variant="success" className="bg-green-500/10 text-green-600 border-green-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Approved
        </Badge>
      );
    }

    if (absence.status === 'rejected') {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Rejected
        </Badge>
      );
    }

    if (absence.status === 'processed') {
      return (
        <Badge variant="default" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
          <Package className="h-3 w-3 mr-1" />
          Processed
        </Badge>
      );
    }

    return (
      <Badge variant="warning">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };
  
  return (
    <Card className="bg-white dark:bg-slate-900 border-border hover:shadow-lg hover:border-avs-yellow/40 transition-all duration-200">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <Calendar className="h-5 w-5 text-avs-yellow" />
            <div>
              <CardTitle className="text-lg">
                {absence.profiles.full_name}
                {absence.profiles.employee_id && ` (${absence.profiles.employee_id})`}
              </CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1 flex-wrap">
                <span>{absence.absence_reasons.name}</span>
                <span>·</span>
                <span>
                  {absence.end_date && absence.date !== absence.end_date
                    ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                    : formatDate(absence.date)
                  }
                  {absence.is_half_day && ` (${absence.half_day_session})`}
                </span>
                <span>·</span>
                <span>{absence.duration_days} {absence.duration_days === 1 ? 'day' : 'days'}</span>
                {absence.absence_reasons.is_paid ? (
                  <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10 text-[10px] px-1.5 py-0">
                    Paid
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px] px-1.5 py-0">
                    Unpaid
                  </Badge>
                )}
              </CardDescription>
            </div>
          </div>
          {getAbsenceStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {absence.notes && (
            <div className="p-3 bg-slate-800/30 rounded-lg">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">Notes:</span> {absence.notes}
              </p>
            </div>
          )}

          {isAnnualLeaveReason(absence.absence_reasons.name) && summary && (
            <div className="p-3 bg-slate-800/30 rounded-lg">
              <h4 className="text-sm font-medium text-white mb-2">Allowance Summary</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Allowance</p>
                  <p className="text-white font-medium">{summary.allowance} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Approved</p>
                  <p className="text-white font-medium">{summary.approved_taken} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pending</p>
                  <p className="text-amber-400 font-medium">{summary.pending_total} days</p>
                </div>
                <div>
                  <p className="text-muted-foreground">After Approval</p>
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

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Submitted {formatDate(absence.created_at)}
            </div>
            <AbsenceApprovalActions
              visibility={visibility}
              onApprove={() => {
                void handleApprove();
              }}
              onReject={() => onReject(absence.id)}
              onProcess={() => {
                void handleProcess();
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ApprovalsPage() {
  return (
    <NuqsClientAdapter>
      <Suspense
        fallback={(
          <AppPageLoadingShell
            title="Approvals"
            description="Review and manage submissions"
            message="Loading approvals..."
          />
        )}
      >
        <ApprovalsContent />
      </Suspense>
    </NuqsClientAdapter>
  );
}

