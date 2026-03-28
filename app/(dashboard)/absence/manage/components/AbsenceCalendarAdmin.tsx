'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  canUseScopedAbsencePermission,
  useAbsenceSecondaryPermissions,
} from '@/lib/hooks/useAbsenceSecondaryPermissions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAllAbsenceReasons, useAllAbsences, useDeleteAbsence } from '@/lib/hooks/useAbsence';
import { fetchCarryoverMapForFinancialYear, getEffectiveAllowance } from '@/lib/utils/absence-carryover';
import { filterEmployeesBySelectedTeam } from '@/lib/utils/absence-admin';
import { getCurrentFinancialYear, getFinancialYearMonths } from '@/lib/utils/date';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isThisMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { AlertTriangle, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Filter, Settings2, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { AbsenceWithRelations } from '@/types/absence';
import { AbsenceEditDialog } from '@/app/(dashboard)/absence/manage/components/AbsenceEditDialog';

type Employee = {
  id: string;
  full_name: string;
  employee_id: string | null;
  annual_holiday_allowance_days: number | null;
  team_id: string | null;
  team_name: string | null;
};

type GenerationStatus = {
  currentFinancialYearStartYear: number;
  latestGeneratedFinancialYearStartYear: number;
  latestGeneratedFinancialYearLabel: string;
  closedFinancialYearStartYears: number[];
};

type DetailVisibility = {
  requestedDate: boolean;
  approvedDate: boolean;
  remainingAllowance: boolean;
};

type CalendarEvent = {
  id: string;
  profileId: string;
  employeeName: string;
  employeeId: string | null;
  roleName: string | null;
  reasonId: string;
  reasonName: string;
  reasonColor: string;
  status: string;
  notes: string | null;
  date: string;
  endDate: string | null;
  isHalfDay: boolean;
  halfDaySession: 'AM' | 'PM' | null;
  createdAt: string;
  approvedAt: string | null;
  isBankHoliday: boolean;
  start: Date;
  end: Date;
};

type WeekSegment = {
  event: CalendarEvent;
  startCol: number;
  endCol: number;
  lane: number;
};

const DETAIL_VISIBILITY_STORAGE_KEY = 'absence-manage-calendar-detail-visibility';
const DEFAULT_DETAIL_VISIBILITY: DetailVisibility = {
  requestedDate: true,
  approvedDate: true,
  remainingAllowance: true,
};

function getReasonColor(name: string, color?: string | null): string {
  if (color && color.trim().length > 0) {
    return color;
  }

  const reasonName = name.trim().toLowerCase();
  const fallbackByReason: Record<string, string> = {
    'annual leave': '#8b5cf6',
    'unpaid leave': '#64748b',
    sickness: '#ef4444',
    'maternity leave': '#ec4899',
    'paternity leave': '#3b82f6',
    'public duties': '#14b8a6',
    'dependant emergency': '#f97316',
    'medical appointment': '#06b6d4',
    'parental leave': '#10b981',
    bereavement: '#6366f1',
    sabbatical: '#a855f7',
  };

  return fallbackByReason[reasonName] || '#6366f1';
}

function formatShortDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd MMM yyyy');
}

function formatAllowance(days: number | null): string {
  if (days === null || Number.isNaN(days)) return '—';
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}

function RemainingAllowanceBadge({ days }: { days: number | null }) {
  if (days === null || Number.isNaN(days)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const formatted = formatAllowance(days);
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        {formatted}
      </span>
    );
  }

  return <span className="text-xs text-muted-foreground">{formatted}</span>;
}

function parseIsoDateAsLocalMidnight(isoDate: string): Date {
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(isoDate);
  }

  return new Date(year, month - 1, day);
}

function getOldestOpenFinancialYearStartYear(
  currentFinancialYearStartYear: number,
  latestGeneratedFinancialYearStartYear: number,
  closedFinancialYearStartYears: number[]
): number {
  const closedYears = new Set(closedFinancialYearStartYears);
  for (let year = currentFinancialYearStartYear; year <= latestGeneratedFinancialYearStartYear; year += 1) {
    if (!closedYears.has(year)) {
      return year;
    }
  }
  return latestGeneratedFinancialYearStartYear;
}

export function AbsenceCalendarAdmin() {
  const { profile, isAdmin, isSuperAdmin } = useAuth();
  const {
    data: absenceSecondarySnapshot,
    isLoading: absenceSecondaryLoading,
    isFetchedAfterMount: absenceSecondaryFetchedAfterMount,
  } = useAbsenceSecondaryPermissions(true);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [carryoverByProfile, setCarryoverByProfile] = useState<Map<string, number>>(new Map());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [selectedReasonId, setSelectedReasonId] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [detailVisibility, setDetailVisibility] = useState<DetailVisibility>(DEFAULT_DETAIL_VISIBILITY);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const currentFinancialYear = getCurrentFinancialYear();
  const currentFinancialYearStartYear = currentFinancialYear.start.getFullYear();
  const generationCurrentFinancialYearStartYear =
    generationStatus?.currentFinancialYearStartYear ?? currentFinancialYearStartYear;
  const latestGeneratedFinancialYearStartYear =
    generationStatus?.latestGeneratedFinancialYearStartYear || currentFinancialYearStartYear;
  const availableFinancialYearStartYears = useMemo(() => {
    const fromYear = Math.min(generationCurrentFinancialYearStartYear, latestGeneratedFinancialYearStartYear);
    const toYear = Math.max(generationCurrentFinancialYearStartYear, latestGeneratedFinancialYearStartYear);
    const years: number[] = [];
    for (let year = fromYear; year <= toYear; year += 1) {
      years.push(year);
    }
    return years.reverse();
  }, [generationCurrentFinancialYearStartYear, latestGeneratedFinancialYearStartYear]);
  const oldestOpenFinancialYearStartYear = useMemo(
    () =>
      getOldestOpenFinancialYearStartYear(
        generationCurrentFinancialYearStartYear,
        latestGeneratedFinancialYearStartYear,
        generationStatus?.closedFinancialYearStartYears || []
      ),
    [generationCurrentFinancialYearStartYear, latestGeneratedFinancialYearStartYear, generationStatus?.closedFinancialYearStartYears]
  );
  const [selectedFinancialYearStartYear, setSelectedFinancialYearStartYear] = useState(currentFinancialYearStartYear);

  useEffect(() => {
    if (!generationStatus) return;
    setSelectedFinancialYearStartYear(oldestOpenFinancialYearStartYear);
  }, [generationStatus, oldestOpenFinancialYearStartYear]);

  useEffect(() => {
    if (!availableFinancialYearStartYears.includes(selectedFinancialYearStartYear)) {
      setSelectedFinancialYearStartYear(oldestOpenFinancialYearStartYear);
    }
  }, [availableFinancialYearStartYears, selectedFinancialYearStartYear, oldestOpenFinancialYearStartYear]);
  const closedFinancialYearStartYears = useMemo(
    () => new Set(generationStatus?.closedFinancialYearStartYears || []),
    [generationStatus?.closedFinancialYearStartYears]
  );
  const isSelectedFinancialYearClosed = closedFinancialYearStartYears.has(selectedFinancialYearStartYear);

  const displayFinancialYear = useMemo(() => {
    const startYear = selectedFinancialYearStartYear;
    const label =
      startYear === generationStatus?.latestGeneratedFinancialYearStartYear && generationStatus?.latestGeneratedFinancialYearLabel
        ? generationStatus.latestGeneratedFinancialYearLabel
        : `${startYear}/${(startYear + 1).toString().slice(-2)}`;
    return {
      start: new Date(startYear, 3, 1),
      end: new Date(startYear + 1, 2, 31),
      label,
    };
  }, [selectedFinancialYearStartYear, generationStatus]);

  const months = useMemo(() => getFinancialYearMonths(displayFinancialYear), [displayFinancialYear]);
  const initialMonthIndex = useMemo(() => {
    const index = months.findIndex((m) => isThisMonth(m));
    return index >= 0 ? index : 0;
  }, [months]);
  const [currentMonthIndex, setCurrentMonthIndex] = useState(initialMonthIndex);
  const currentMonth = months[currentMonthIndex];

  useEffect(() => {
    setCurrentMonthIndex(initialMonthIndex);
  }, [initialMonthIndex]);

  const { data: absences, isLoading } = useAllAbsences({});
  const { data: reasons, isLoading: reasonsLoading } = useAllAbsenceReasons();
  const deleteAbsence = useDeleteAbsence();
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState<AbsenceWithRelations | null>(null);
  const actorProfileId = profile?.id || '';
  const isAdminTier = Boolean(isAdmin || isSuperAdmin);
  const canViewBookings = Boolean(absenceSecondarySnapshot?.flags.can_view_bookings || isAdminTier);
  const canAddEditBookings = Boolean(absenceSecondarySnapshot?.flags.can_add_edit_bookings || isAdminTier);
  const actorTeamId = absenceSecondarySnapshot?.team_id || null;
  const actorTeamName = absenceSecondarySnapshot?.team_name || null;
  const scopeTeamOnly = Boolean(
    !isAdminTier &&
      canViewBookings &&
      absenceSecondarySnapshot &&
      !absenceSecondarySnapshot.permissions.see_bookings_all &&
      absenceSecondarySnapshot.permissions.see_bookings_team
  );
  const isTeamFilterLocked = scopeTeamOnly;
  const effectiveTeamFilter = scopeTeamOnly ? (actorTeamId || '__no_team_scope__') : selectedTeamId;
  const isAbsenceSecondaryContextLoading = absenceSecondaryLoading || !absenceSecondaryFetchedAfterMount;

  useEffect(() => {
    void loadGenerationStatus();
    void fetchEmployees();
    try {
      const stored = localStorage.getItem(DETAIL_VISIBILITY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DetailVisibility>;
        setDetailVisibility((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore parsing failures
    }
  }, []);

  async function loadGenerationStatus() {
    try {
      const response = await fetch('/api/absence/generation/status');
      const payload = (await response.json()) as GenerationStatus & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load booking window');
      }
      setGenerationStatus(payload);
    } catch (error) {
      console.error('Error loading absence generation status:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load booking window');
    }
  }

  async function fetchEmployees() {
    setLoadingEmployees(true);
    try {
      const data = await fetchUserDirectory({ includeAllowance: true });
      const list = data.map((row) => {
        return {
          id: String(row.id || ''),
          full_name: String(row.full_name || ''),
          employee_id: row.employee_id || null,
          annual_holiday_allowance_days: row.annual_holiday_allowance_days ?? null,
          team_id: row.team?.id || null,
          team_name: row.team?.name || null,
        };
      });
      setEmployees(list);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employee filters');
    } finally {
      setLoadingEmployees(false);
    }
  }

  function toggleDetail(key: keyof DetailVisibility) {
    setDetailVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(DETAIL_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function confirmDeleteAbsence() {
    if (!deleteTargetId) return;
    setDeleteSubmitting(true);
    try {
      await deleteAbsence.mutateAsync(deleteTargetId);
      toast.success('Absence deleted');
      setDeleteTargetId(null);
    } catch (error) {
      console.error('Error deleting absence:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete absence');
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const monthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const monthEnd = useMemo(() => endOfMonth(currentMonth), [currentMonth]);
  const gridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 1 }), [monthStart]);
  const gridEnd = useMemo(() => endOfWeek(monthEnd, { weekStartsOn: 1 }), [monthEnd]);
  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((employee) => {
      map.set(employee.id, employee);
    });
    return map;
  }, [employees]);

  const calendarEvents = useMemo(() => {
    const filteredAbsences = (absences || []).filter((absence) => {
      if (!canViewBookings) return false;
      if (absence.status === 'cancelled') return false;
      const employee = employeeById.get(absence.profile_id);
      const targetTeamId = absence.profiles.team_id || employee?.team_id || null;
      const canViewTarget =
        isAdminTier ||
        (actorProfileId &&
          absenceSecondarySnapshot &&
          canUseScopedAbsencePermission(
            {
              permissions: absenceSecondarySnapshot.permissions,
              team_id: absenceSecondarySnapshot.team_id,
            },
            actorProfileId,
            {
              profile_id: absence.profile_id,
              team_id: targetTeamId,
            },
            {
              all: 'see_bookings_all',
              team: 'see_bookings_team',
              own: 'see_bookings_own',
            }
          ));
      if (!canViewTarget) return false;
      if (selectedEmployeeId !== 'all' && absence.profile_id !== selectedEmployeeId) return false;
      if (selectedReasonId !== 'all' && absence.reason_id !== selectedReasonId) return false;
      if (selectedStatus !== 'all' && absence.status !== selectedStatus) return false;
      if (effectiveTeamFilter !== 'all') {
        if (effectiveTeamFilter === 'unassigned') {
          if (employee?.team_id) return false;
        } else if (!employee?.team_id || employee.team_id !== effectiveTeamFilter) {
          return false;
        }
      }
      return true;
    });

    return filteredAbsences.map((absence) => {
      const start = parseIsoDateAsLocalMidnight(absence.date);
      const end = absence.end_date ? parseIsoDateAsLocalMidnight(absence.end_date) : start;
      const employee = employeeById.get(absence.profile_id);

      return {
        id: absence.id,
        profileId: absence.profile_id,
        employeeName: absence.profiles?.full_name || 'Unknown',
        employeeId: absence.profiles?.employee_id || null,
        roleName: employee?.team_name || null,
        reasonId: absence.reason_id,
        reasonName: absence.absence_reasons.name,
        reasonColor: getReasonColor(absence.absence_reasons.name, absence.absence_reasons.color),
        status: absence.status,
        notes: absence.notes,
        date: absence.date,
        endDate: absence.end_date,
        isHalfDay: absence.is_half_day,
        halfDaySession: absence.half_day_session,
        createdAt: absence.created_at,
        approvedAt: absence.approved_at,
        isBankHoliday: Boolean(absence.is_bank_holiday),
        start,
        end,
      } as CalendarEvent;
    });
  }, [
    absences,
    canViewBookings,
    employeeById,
    selectedEmployeeId,
    selectedReasonId,
    effectiveTeamFilter,
    selectedStatus,
    actorProfileId,
    absenceSecondarySnapshot,
    isAdminTier,
  ]);

  const teamOptions = useMemo(() => {
    const teamMap = new Map<string, string>();
    employees.forEach((employee) => {
      if (employee.team_id) {
        teamMap.set(employee.team_id, employee.team_name || employee.team_id);
      }
    });

    return Array.from(teamMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);

  const filteredEmployeeOptions = useMemo(() => {
    return filterEmployeesBySelectedTeam(employees, effectiveTeamFilter);
  }, [employees, effectiveTeamFilter]);

  const lockedTeamLabel =
    actorTeamName ||
    teamOptions.find((team) => team.value === actorTeamId)?.label ||
    (actorTeamId ? 'My Team' : 'No team assigned');

  useEffect(() => {
    if (!scopeTeamOnly) {
      setSelectedTeamId((current) => (current === '__no_team_scope__' ? 'all' : current));
      return;
    }
    setSelectedTeamId(actorTeamId || '__no_team_scope__');
  }, [scopeTeamOnly, actorTeamId]);

  const hasActiveFilters =
    selectedEmployeeId !== 'all' ||
    selectedReasonId !== 'all' ||
    selectedStatus !== 'all' ||
    (!isTeamFilterLocked && selectedTeamId !== 'all');

  useEffect(() => {
    if (selectedEmployeeId === 'all') {
      return;
    }

    const employeeStillVisible = filteredEmployeeOptions.some((employee) => employee.id === selectedEmployeeId);
    if (!employeeStillVisible) {
      setSelectedEmployeeId('all');
    }
  }, [filteredEmployeeOptions, selectedEmployeeId]);

  useEffect(() => {
    let cancelled = false;

    async function loadCarryovers() {
      try {
        const nextCarryovers = await fetchCarryoverMapForFinancialYear(
          createClient(),
          selectedFinancialYearStartYear,
          employees.map((employee) => employee.id)
        );
        if (!cancelled) {
          setCarryoverByProfile(nextCarryovers);
        }
      } catch (error) {
        console.error('Error loading absence carryovers:', error);
        if (!cancelled) {
          setCarryoverByProfile(new Map());
          toast.error('Failed to load carryover allowances');
        }
      }
    }

    if (employees.length === 0) {
      setCarryoverByProfile(new Map());
      return () => {
        cancelled = true;
      };
    }

    void loadCarryovers();
    return () => {
      cancelled = true;
    };
  }, [employees, selectedFinancialYearStartYear]);

  const annualLeaveReasonIds = useMemo(() => {
    return new Set(
      (reasons || [])
        .filter((reason) => reason.name.trim().toLowerCase() === 'annual leave')
        .map((reason) => reason.id)
    );
  }, [reasons]);

  const remainingAllowanceByProfile = useMemo(() => {
    const map = new Map<string, number>();
    const fyStart = displayFinancialYear.start;
    const fyEnd = displayFinancialYear.end;

    for (const employee of employees) {
      const allowance = getEffectiveAllowance(
        employee.annual_holiday_allowance_days,
        carryoverByProfile.get(employee.id) || 0
      );
      map.set(employee.id, allowance);
    }

    // Use unfiltered absence records so allowance totals remain correct even when UI filters are active.
    for (const absence of absences || []) {
      if (!annualLeaveReasonIds.has(absence.reason_id)) continue;
      if (absence.status !== 'approved' && absence.status !== 'pending') continue;

      const absenceDate = parseIsoDateAsLocalMidnight(absence.date);
      if (absenceDate < fyStart || absenceDate > fyEnd) continue;

      const current = map.get(absence.profile_id) ?? 28;
      const duration = absence.duration_days || 0;
      map.set(absence.profile_id, current - duration);
    }

    return map;
  }, [employees, annualLeaveReasonIds, displayFinancialYear, absences, carryoverByProfile]);

  const reasonLegend = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    (reasons || [])
      .filter((reason) => reason.is_active)
      .forEach((reason) => {
        map.set(reason.id, { name: reason.name, color: getReasonColor(reason.name, reason.color) });
      });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [reasons]);

  const weeks = useMemo(() => {
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const grouped: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      grouped.push(days.slice(i, i + 7));
    }
    return grouped;
  }, [gridStart, gridEnd]);

  function buildWeekSegments(week: Date[]): WeekSegment[] {
    const weekStart = week[0];
    const weekEnd = week[6];
    const weekEvents = calendarEvents
      .filter((event) => event.end >= weekStart && event.start <= weekEnd)
      .sort((a, b) => {
        if (a.start.getTime() !== b.start.getTime()) return a.start.getTime() - b.start.getTime();
        return a.employeeName.localeCompare(b.employeeName);
      });

    const laneEndByIndex: number[] = [];
    const segments: WeekSegment[] = [];

    for (const event of weekEvents) {
      const visibleStart = event.start > weekStart ? event.start : weekStart;
      const visibleEnd = event.end < weekEnd ? event.end : weekEnd;
      const startCol = Math.max(0, Math.floor((visibleStart.getTime() - weekStart.getTime()) / 86400000));
      const endCol = Math.min(6, Math.floor((visibleEnd.getTime() - weekStart.getTime()) / 86400000));

      let lane = laneEndByIndex.findIndex((laneEnd) => startCol > laneEnd);
      if (lane === -1) {
        lane = laneEndByIndex.length;
        laneEndByIndex.push(endCol);
      } else {
        laneEndByIndex[lane] = endCol;
      }

      segments.push({ event, startCol, endCol, lane });
    }

    return segments;
  }

  function handleDayClick(day: Date) {
    setSelectedDate(day);
    setShowDayModal(true);
  }

  function canEditAbsence(absence: AbsenceWithRelations): boolean {
    if (!canAddEditBookings) return false;
    if (!isAdminTier) {
      if (!actorProfileId || !absenceSecondarySnapshot) return false;
      const employee = employeeById.get(absence.profile_id);
      const targetTeamId = absence.profiles.team_id || employee?.team_id || null;
      const canEditTarget = canUseScopedAbsencePermission(
        {
          permissions: absenceSecondarySnapshot.permissions,
          team_id: absenceSecondarySnapshot.team_id,
        },
        actorProfileId,
        {
          profile_id: absence.profile_id,
          team_id: targetTeamId,
        },
        {
          all: 'add_edit_bookings_all',
          team: 'add_edit_bookings_team',
          own: 'add_edit_bookings_own',
        }
      );
      if (!canEditTarget) return false;
    }
    return absence.record_source !== 'archived' && !absence.is_bank_holiday && !absence.auto_generated;
  }

  if (isLoading || reasonsLoading || loadingEmployees || isAbsenceSecondaryContextLoading) {
    return <PageLoader message="Loading calendar..." />;
  }

  return (
    <>
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedEmployeeId('all');
                setSelectedTeamId(isTeamFilterLocked ? (actorTeamId || '__no_team_scope__') : 'all');
                setSelectedReasonId('all');
                setSelectedStatus('all');
              }}
              className="border-border text-muted-foreground"
            >
              Clear Filters
            </Button>
          )}
        </CardHeader>
        <CardContent>
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
                      {employee.full_name} {employee.employee_id ? `(${employee.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Team Name</p>
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
              <p className="text-sm text-muted-foreground mb-2">Reason</p>
              <Select value={selectedReasonId} onValueChange={setSelectedReasonId}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="All reasons" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  {(reasons || [])
                    .filter((reason) => reason.is_active)
                    .map((reason) => (
                      <SelectItem key={reason.id} value={reason.id}>
                        {reason.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Status</p>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Additional Details</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full border-border text-muted-foreground justify-start">
                    <Settings2 className="h-4 w-4 mr-2" />
                    Fields
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-border">
                  <DropdownMenuLabel>Show on events</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={detailVisibility.requestedDate} onCheckedChange={() => toggleDetail('requestedDate')}>
                    Date requested
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={detailVisibility.approvedDate} onCheckedChange={() => toggleDetail('approvedDate')}>
                    Date approved
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={detailVisibility.remainingAllowance} onCheckedChange={() => toggleDetail('remainingAllowance')}>
                    Remaining allowance
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between mb-4">
            <div>
              <CardTitle className="text-foreground">{format(currentMonth, 'MMMM yyyy')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                Detailed team calendar ({displayFinancialYear.label})
              </CardDescription>
              {isSelectedFinancialYearClosed ? (
                <p className="mt-2 text-xs text-amber-300">
                  This financial year is closed and read-only.
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Select
                value={String(selectedFinancialYearStartYear)}
                onValueChange={(value) => setSelectedFinancialYearStartYear(Number(value))}
              >
                <SelectTrigger className="w-[190px] border-border text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span>{displayFinancialYear.label}</span>
                    {isSelectedFinancialYearClosed ? (
                      <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-300 text-[10px] uppercase">
                        Closed
                      </Badge>
                    ) : null}
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {availableFinancialYearStartYears.map((startYear) => {
                    const label = `${startYear}/${(startYear + 1).toString().slice(-2)}`;
                    const isClosedYearOption = closedFinancialYearStartYears.has(startYear);
                    return (
                      <SelectItem key={startYear} value={String(startYear)}>
                        <div className="flex items-center gap-2">
                          <span>{label}</span>
                          {isClosedYearOption ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/50 bg-amber-500/10 text-amber-300 text-[10px] uppercase"
                            >
                              Closed
                            </Badge>
                          ) : null}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentMonthIndex(Math.max(0, currentMonthIndex - 1))}
                disabled={currentMonthIndex === 0}
                className="border-border text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentMonthIndex(Math.min(months.length - 1, currentMonthIndex + 1))}
                disabled={currentMonthIndex === months.length - 1}
                className="border-border text-muted-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-4 text-sm border-t border-border">
            {reasonLegend.map((reason) => (
              <div className="flex items-center gap-2" key={reason.name}>
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: reason.color }} />
                <span className="text-muted-foreground">{reason.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="text-amber-300">Amber name</span>
              <span className="text-muted-foreground">= pending request</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-400">Red name</span>
              <span className="text-muted-foreground">= rejected request</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-7 gap-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="text-center text-xs font-medium text-muted-foreground pb-1">
                {day}
              </div>
            ))}
          </div>

          {weeks.map((week) => {
            const segments = buildWeekSegments(week);
            const laneCount = Math.max(1, ...segments.map((segment) => segment.lane + 1));

            return (
              <div key={week[0].toISOString()} className="rounded-md border border-border/60 bg-slate-900/30 p-2">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {week.map((day) => {
                    const inMonth = day.getMonth() === currentMonth.getMonth();
                    const hasBankHoliday = calendarEvents.some(
                      (event) => event.isBankHoliday && day >= event.start && day <= event.end
                    );
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => handleDayClick(day)}
                        className={`h-10 rounded-sm px-2 text-left text-xs transition-colors ${
                          inMonth
                            ? 'bg-slate-800/40 text-foreground hover:bg-slate-700/40'
                            : 'bg-slate-900/40 text-muted-foreground/60 hover:bg-slate-800/40'
                        } ${hasBankHoliday ? 'ring-1 ring-amber-400/70 border border-amber-500/40' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{format(day, 'd')}</span>
                          {hasBankHoliday && <span className="text-[9px] font-semibold text-amber-300">BH</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1">
                  {Array.from({ length: laneCount }).map((_, laneIndex) => (
                    <div key={laneIndex} className="grid grid-cols-7 gap-1 min-h-[26px]">
                      {segments
                        .filter((segment) => segment.lane === laneIndex)
                        .map((segment) => {
                          const isSingleDayHalfBooking =
                            segment.event.isHalfDay && segment.startCol === segment.endCol;
                          const isAmHalfDay = isSingleDayHalfBooking && segment.event.halfDaySession === 'AM';
                          const isPmHalfDay = isSingleDayHalfBooking && segment.event.halfDaySession === 'PM';
                          const statusClass =
                            segment.event.status === 'pending'
                              ? 'border-amber-500/50 text-amber-300'
                              : segment.event.status === 'rejected'
                              ? 'border-red-500/50 text-red-300'
                              : 'border-slate-500/40 text-slate-100';
                          const employeeNameClass =
                            segment.event.status === 'pending'
                              ? 'text-[11px] font-bold text-amber-300 truncate'
                              : segment.event.status === 'rejected'
                              ? 'text-[11px] font-bold text-red-300 truncate'
                              : 'text-[11px] font-bold text-slate-100 truncate';
                          const leftIndicatorColor = segment.event.reasonColor;

                          const extraDetails: string[] = [];
                          if (detailVisibility.requestedDate) {
                            extraDetails.push(`Req ${formatShortDate(segment.event.createdAt)}`);
                          }
                          if (detailVisibility.approvedDate) {
                            extraDetails.push(`App ${formatShortDate(segment.event.approvedAt)}`);
                          }
                          if (detailVisibility.remainingAllowance) {
                            extraDetails.push(`Rem ${formatAllowance(remainingAllowanceByProfile.get(segment.event.profileId) ?? null)}`);
                          }

                          return (
                            <button
                              key={`${segment.event.id}-${segment.startCol}-${segment.endCol}`}
                              type="button"
                              onClick={() => handleDayClick(segment.event.start)}
                              className={`h-10 rounded-sm border px-2 py-1 text-left ${statusClass} ${
                                isAmHalfDay ? 'justify-self-start' : isPmHalfDay ? 'justify-self-end' : ''
                              }`}
                              style={{
                                gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`,
                                backgroundColor: `${segment.event.reasonColor}33`,
                                borderLeft: `3px solid ${leftIndicatorColor}`,
                                width: isSingleDayHalfBooking ? 'calc(50% - 2px)' : undefined,
                              }}
                              title={`${segment.event.employeeName} - ${segment.event.reasonName}${extraDetails.length ? ` (${extraDetails.join(' • ')})` : ''}`}
                            >
                              <div className="flex flex-col leading-tight">
                                <span className={employeeNameClass}>{segment.event.employeeName}</span>
                                {extraDetails.length > 0 && (
                                  <span className="text-[9px] text-slate-400 truncate">
                                    {extraDetails.join(' · ')}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={showDayModal} onOpenChange={setShowDayModal}>
        <DialogContent className="border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Detailed absences for this day
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {selectedDate && (() => {
              const dayAbsences = calendarEvents
                .filter((event) => selectedDate >= event.start && selectedDate <= event.end)
                .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

              if (dayAbsences.length === 0) {
                return (
                  <div className="py-6 text-center">
                    <CalendarIcon className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No absences on this day</p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Absences on this day:</h4>
                  {dayAbsences.map((event) => (
                    <div
                      key={event.id}
                      className="p-3 rounded bg-slate-800/50 border border-border"
                      style={{ borderLeftWidth: '3px', borderLeftColor: event.reasonColor }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: event.reasonColor }} />
                            {event.reasonName}
                            {event.isBankHoliday && (
                              <Badge variant="outline" className="border-amber-500/40 text-amber-300 bg-amber-500/10">
                                Bank Holiday
                              </Badge>
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {event.employeeName}
                            {event.employeeId ? ` (${event.employeeId})` : ''}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Date: {event.endDate && event.date !== event.endDate ? `${event.date} - ${event.endDate}` : event.date}
                            {event.isHalfDay && ` (${event.halfDaySession})`}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Status: <span className="capitalize">{event.status}</span>
                          </p>

                          {detailVisibility.requestedDate && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Requested: {formatShortDate(event.createdAt)}
                            </p>
                          )}
                          {detailVisibility.approvedDate && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Approved: {formatShortDate(event.approvedAt)}
                            </p>
                          )}
                          {detailVisibility.remainingAllowance && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Remaining allowance:{' '}
                              <RemainingAllowanceBadge days={remainingAllowanceByProfile.get(event.profileId) ?? null} />
                            </p>
                          )}

                          {event.notes && <p className="text-xs text-muted-foreground mt-1">{event.notes}</p>}
                        </div>
                        <div className="flex min-h-[132px] w-24 flex-col items-end justify-between">
                          <Badge
                            variant="outline"
                            className={
                              event.status === 'approved'
                                ? 'border-green-500/30 text-green-400 bg-green-500/10'
                                : event.status === 'pending'
                                ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                                : event.status === 'rejected'
                                ? 'border-red-500/30 text-red-400 bg-red-500/10'
                                : 'border-slate-600 text-muted-foreground'
                            }
                          >
                            {event.status}
                          </Badge>
                          <div className="flex w-full flex-col items-stretch gap-2">
                            {(() => {
                              const target = (absences || []).find((absence) => absence.id === event.id) || null;
                            const canEditTarget = Boolean(target && canEditAbsence(target) && !isSelectedFinancialYearClosed);

                              return (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (target && canEditTarget) {
                                      setEditTarget(target);
                                    }
                                  }}
                                  disabled={!canEditTarget}
                                  className="w-full border-absence/30 text-absence hover:bg-absence/10 hover:text-absence h-7 px-2 text-xs"
                                >
                                  <Pencil className="h-3 w-3 mr-1" />
                                  Edit
                                </Button>
                              );
                            })()}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTargetId(event.id);
                              }}
                            disabled={isSelectedFinancialYearClosed}
                              className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 h-7 px-2 text-xs"
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDayModal(false)}
              className="border-border text-muted-foreground"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AbsenceEditDialog
        absence={editTarget}
        reasons={reasons || []}
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
          }
        }}
      />

      <Dialog open={!!deleteTargetId} onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}>
        <DialogContent className="border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Absence</DialogTitle>
            <DialogDescription className="text-slate-400/90">
              Are you sure you want to delete this absence record? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-300">This will permanently remove the absence record.</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTargetId(null)}
              className="border-border text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteAbsence}
              disabled={deleteSubmitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteSubmitting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
