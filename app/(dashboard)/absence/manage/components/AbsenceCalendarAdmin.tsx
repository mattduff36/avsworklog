'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAllAbsenceReasons, useAllAbsences } from '@/lib/hooks/useAbsence';
import { getCurrentFinancialYear, getFinancialYearMonths } from '@/lib/utils/date';
import { createClient } from '@/lib/supabase/client';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isThisMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Filter, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

type Employee = {
  id: string;
  full_name: string;
  employee_id: string | null;
  annual_holiday_allowance_days: number | null;
  role_name: string | null;
};

type GenerationStatus = {
  latestGeneratedFinancialYearStartYear: number;
  latestGeneratedFinancialYearLabel: string;
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
  start: Date;
  end: Date;
};

type WeekSegment = {
  event: CalendarEvent;
  startCol: number;
  endCol: number;
  lane: number;
};

type RoleOption = {
  id: string;
  name: string;
  display_name: string | null;
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

export function AbsenceCalendarAdmin() {
  const supabase = createClient();
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
  const [selectedRole, setSelectedRole] = useState('all');
  const [selectedReasonId, setSelectedReasonId] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [detailVisibility, setDetailVisibility] = useState<DetailVisibility>(DEFAULT_DETAIL_VISIBILITY);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const currentFinancialYear = getCurrentFinancialYear();
  const displayFinancialYear = useMemo(() => {
    if (!generationStatus?.latestGeneratedFinancialYearStartYear) {
      return currentFinancialYear;
    }
    const startYear = generationStatus.latestGeneratedFinancialYearStartYear;
    return {
      start: new Date(startYear, 3, 1),
      end: new Date(startYear + 1, 2, 31),
      label: generationStatus.latestGeneratedFinancialYearLabel,
    };
  }, [currentFinancialYear, generationStatus]);

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
  const { data: reasons } = useAllAbsenceReasons();

  useEffect(() => {
    void loadGenerationStatus();
    void fetchEmployees();
    void fetchRoles();
    try {
      const stored = localStorage.getItem(DETAIL_VISIBILITY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DetailVisibility>;
        setDetailVisibility((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // Ignore parsing failures
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id, annual_holiday_allowance_days, roles(name)')
        .order('full_name');

      if (error) throw error;
      const list = ((data || []) as Array<Record<string, unknown>>).map((row) => {
        const roleRef = row.roles as { name?: string } | null;
        return {
          id: String(row.id || ''),
          full_name: String(row.full_name || ''),
          employee_id: (row.employee_id as string | null) || null,
          annual_holiday_allowance_days: (row.annual_holiday_allowance_days as number | null) ?? null,
          role_name: roleRef?.name || null,
        };
      });
      setEmployees(list);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employee filters');
    }
  }

  async function fetchRoles() {
    try {
      const { data, error } = await supabase
        .from('roles')
        .select('id, name, display_name')
        .order('display_name', { ascending: true });

      if (error) throw error;
      setRoles((data || []) as RoleOption[]);
    } catch (error) {
      console.error('Error fetching roles:', error);
      toast.error('Failed to load job roles');
    }
  }

  function toggleDetail(key: keyof DetailVisibility) {
    setDetailVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(DETAIL_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const monthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const monthEnd = useMemo(() => endOfMonth(currentMonth), [currentMonth]);
  const gridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 1 }), [monthStart]);
  const gridEnd = useMemo(() => endOfWeek(monthEnd, { weekStartsOn: 1 }), [monthEnd]);

  const calendarEvents = useMemo(() => {
    const filteredAbsences = (absences || []).filter((absence) => {
      if (absence.status === 'cancelled') return false;
      if (selectedEmployeeId !== 'all' && absence.profile_id !== selectedEmployeeId) return false;
      if (selectedReasonId !== 'all' && absence.reason_id !== selectedReasonId) return false;
      if (selectedStatus !== 'all' && absence.status !== selectedStatus) return false;
      if (selectedRole !== 'all') {
        const employee = employees.find((emp) => emp.id === absence.profile_id);
        const role = (employee?.role_name || '').trim().toLowerCase();
        if (role !== selectedRole) return false;
      }
      return true;
    });

    return filteredAbsences.map((absence) => {
      const start = parseIsoDateAsLocalMidnight(absence.date);
      const end = absence.end_date ? parseIsoDateAsLocalMidnight(absence.end_date) : start;
      const employee = employees.find((emp) => emp.id === absence.profile_id);

      return {
        id: absence.id,
        profileId: absence.profile_id,
        employeeName: absence.profiles?.full_name || 'Unknown',
        employeeId: absence.profiles?.employee_id || null,
        roleName: employee?.role_name || null,
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
        start,
        end,
      } as CalendarEvent;
    });
  }, [absences, employees, selectedEmployeeId, selectedReasonId, selectedRole, selectedStatus]);

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
      const allowance = employee.annual_holiday_allowance_days ?? 28;
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
  }, [employees, annualLeaveReasonIds, displayFinancialYear, absences]);

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

  const roleOptions = useMemo(
    () =>
      roles
        .map((role) => {
          const value = role.name.trim().toLowerCase();
          const label = (role.display_name || role.name).trim();
          return { value, label };
        })
        .filter((role) => role.value.length > 0 && role.label.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [roles]
  );

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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading calendar...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
          {(selectedEmployeeId !== 'all' || selectedRole !== 'all' || selectedReasonId !== 'all' || selectedStatus !== 'all') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedEmployeeId('all');
                setSelectedRole('all');
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
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name} {employee.employee_id ? `(${employee.employee_id})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Job Role</p>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger className="bg-background border-border text-foreground">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {roleOptions.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
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
            </div>
            <div className="flex gap-2">
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
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => handleDayClick(day)}
                        className={`h-10 rounded-sm px-2 text-left text-xs transition-colors ${
                          inMonth
                            ? 'bg-slate-800/40 text-foreground hover:bg-slate-700/40'
                            : 'bg-slate-900/40 text-muted-foreground/60 hover:bg-slate-800/40'
                        }`}
                      >
                        {format(day, 'd')}
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
                              className={`h-10 rounded-sm border px-2 py-1 text-left ${statusClass}`}
                              style={{
                                gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`,
                                backgroundColor: `${segment.event.reasonColor}33`,
                                borderLeft: `3px solid ${leftIndicatorColor}`,
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
        <DialogContent className="border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Detailed absences for this day
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
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
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-foreground flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: event.reasonColor }} />
                            {event.reasonName}
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
                              Remaining allowance: {formatAllowance(remainingAllowanceByProfile.get(event.profileId) ?? null)}
                            </p>
                          )}

                          {event.notes && <p className="text-xs text-muted-foreground mt-1">{event.notes}</p>}
                        </div>
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
    </>
  );
}
