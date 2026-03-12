'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight,
  AlertTriangle,
  Settings,
  Users,
  Plus,
} from 'lucide-react';
import Link from 'next/link';
import { 
  useAbsencesForCurrentUser, 
  useAbsenceSummaryForCurrentUser,
  useAbsenceReasons,
  useCreateAbsence,
  useCancelAbsence,
  useAllAbsences
} from '@/lib/hooks/useAbsence';
import { formatDate, formatDateISO, calculateDurationDays, getFinancialYearMonths, getCurrentFinancialYear } from '@/lib/utils/date';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isThisMonth } from 'date-fns';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

type Employee = {
  id: string;
  full_name: string;
  employee_id: string | null;
};

type GenerationStatus = {
  latestGeneratedFinancialYearStartYear: number;
  latestGeneratedFinancialYearLabel: string;
  latestGeneratedFinancialYearEndDate: string;
  nextFinancialYearStartYear: number;
  nextFinancialYearLabel: string;
};

function isAnnualLeaveReason(name: string): boolean {
  return name.trim().toLowerCase() === 'annual leave';
}

function isUnpaidLeaveReason(name: string): boolean {
  return name.trim().toLowerCase() === 'unpaid leave';
}

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

export default function AbsencePage() {
  const { profile, isManager, isAdmin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('absence');
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<'calendar' | 'bookings'>('calendar');
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  
  // Financial year months - controlled by latest generated financial year
  const currentFinancialYear = getCurrentFinancialYear();
  const displayFinancialYear = useMemo(() => {
    if (!generationStatus?.latestGeneratedFinancialYearStartYear) {
      return currentFinancialYear;
    }
    const startYear = generationStatus.latestGeneratedFinancialYearStartYear;
    return {
      start: new Date(startYear, 3, 6),
      end: new Date(startYear + 1, 3, 5),
      label: generationStatus.latestGeneratedFinancialYearLabel,
    };
  }, [currentFinancialYear, generationStatus]);
  const bookingMaxDate = generationStatus?.latestGeneratedFinancialYearEndDate || formatDateISO(displayFinancialYear.end);
  const months = useMemo(() => getFinancialYearMonths(displayFinancialYear), [displayFinancialYear]);
  
  // Find current month index in financial year
  const initialMonthIndex = useMemo(() => {
    const index = months.findIndex(m => isThisMonth(m));
    return index >= 0 ? index : 0;
  }, [months]);
  
  const [currentMonthIndex, setCurrentMonthIndex] = useState(initialMonthIndex);
  const currentMonth = months[currentMonthIndex];

  useEffect(() => {
    setCurrentMonthIndex(initialMonthIndex);
  }, [initialMonthIndex]);
  
  // Employee filter for managers/admins
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [bookingsPage, setBookingsPage] = useState(1);
  const BOOKINGS_PAGE_SIZE = 15;
  
  // Fetch data - use all absences for managers/admins
  const { data: userAbsences, isLoading: loadingUserAbsences } = useAbsencesForCurrentUser();
  const { data: allAbsencesData, isLoading: loadingAllAbsences } = useAllAbsences(
    isManager || isAdmin ? {} : undefined
  );
  const { data: summary, isLoading: loadingSummary } = useAbsenceSummaryForCurrentUser();
  const { data: reasons } = useAbsenceReasons();
  const createAbsence = useCreateAbsence();
  const cancelAbsence = useCancelAbsence();
  
  // Determine which absences to show on calendar
  const calendarAbsences = useMemo(() => {
    if (!(isManager || isAdmin)) {
      // Regular users only see their own absences
      return userAbsences?.filter(a => a.status !== 'cancelled') || [];
    }
    
    // Managers/admins see filtered employees' absences (exclude cancelled)
    const allAbsences = allAbsencesData?.filter(a => a.status !== 'cancelled') || [];
    
    if (selectedEmployeeIds.length === 0) {
      // Show all employees if none selected
      return allAbsences;
    }
    
    // Filter by selected employees
    return allAbsences.filter(a => selectedEmployeeIds.includes(a.profile_id));
  }, [isManager, isAdmin, userAbsences, allAbsencesData, selectedEmployeeIds]);
  
  const loadingAbsences = isManager || isAdmin ? loadingAllAbsences : loadingUserAbsences;
  // Form state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Fetch employees for managers/admins
  useEffect(() => {
    if (permissionLoading || !hasPermission) {
      return;
    }
    void loadGenerationStatus();
    if (isManager || isAdmin) {
      fetchEmployees();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, isAdmin, permissionLoading, hasPermission]);

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
        .select('id, full_name, employee_id')
        .order('full_name');
      
      if (error) throw error;
      const employees = (data || []) as Employee[];
      setEmployees(employees);
      setSelectedEmployeeIds(employees.map(e => e.id));
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  }
  
  // Toggle employee selection
  function toggleEmployee(employeeId: string) {
    setSelectedEmployeeIds(prev => 
      prev.includes(employeeId)
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId]
    );
  }
  
  function toggleAllEmployees() {
    if (selectedEmployeeIds.length === employees.length) {
      setSelectedEmployeeIds([]);
    } else {
      setSelectedEmployeeIds(employees.map(e => e.id));
    }
  }

  const availableRequestReasons = useMemo(() => {
    const allActive = reasons || [];
    if (isManager || isAdmin) {
      return allActive;
    }
    return allActive.filter((reason) => isAnnualLeaveReason(reason.name) || isUnpaidLeaveReason(reason.name));
  }, [reasons, isManager, isAdmin]);
  
  useEffect(() => {
    if (!selectedReasonId && availableRequestReasons.length > 0) {
      const defaultReason =
        availableRequestReasons.find((reason) => isAnnualLeaveReason(reason.name)) || availableRequestReasons[0];
      if (defaultReason) {
        setSelectedReasonId(defaultReason.id);
      }
    }
  }, [availableRequestReasons, selectedReasonId]);

  useEffect(() => {
    if (selectedReasonId && !availableRequestReasons.some((reason) => reason.id === selectedReasonId)) {
      setSelectedReasonId('');
    }
  }, [availableRequestReasons, selectedReasonId]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab') || 'calendar';
    if (requestedTab === 'calendar' || requestedTab === 'bookings') {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab('calendar');
    router.replace('/absence?tab=calendar', { scroll: false });
  }, [searchParams, router]);

  function handleTabChange(value: 'calendar' | 'bookings') {
    setActiveTab(value);
    router.replace(`/absence?tab=${value}`, { scroll: false });
  }

  const selectedReason = availableRequestReasons.find((reason) => reason.id === selectedReasonId);
  const deductsAllowance = selectedReason ? isAnnualLeaveReason(selectedReason.name) : false;
  
  // Calculate requested days
  const requestedDays = useMemo(() => {
    if (!startDate) return 0;
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    return calculateDurationDays(start, end, isHalfDay);
  }, [startDate, endDate, isHalfDay]);
  
  // Projected remaining after this request (annual leave only)
  const projectedRemaining = deductsAllowance
    ? (summary?.remaining || 0) - requestedDays
    : (summary?.remaining || 0);
  
  // Handle form submission
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!selectedReasonId || !selectedReason) {
      toast.error('Please select an absence reason');
      return;
    }
    
    if (!startDate) {
      toast.error('Please select a start date');
      return;
    }

    if (startDate > bookingMaxDate || (endDate && endDate > bookingMaxDate)) {
      toast.error(`Leave can only be booked up to ${formatDate(bookingMaxDate)}.`);
      return;
    }
    
    if (requestedDays <= 0) {
      toast.error('Selected dates do not include a working day');
      return;
    }

    if (deductsAllowance && projectedRemaining < 0) {
      toast.error('Insufficient annual leave allowance');
      return;
    }
    
    setSubmitting(true);
    
    try {
      await createAbsence.mutateAsync({
        profile_id: profile!.id,
        date: startDate,
        end_date: endDate || null,
        reason_id: selectedReasonId,
        duration_days: requestedDays,
        is_half_day: isHalfDay,
        half_day_session: isHalfDay ? halfDaySession : null,
        notes: notes || null,
        status: 'pending',
        created_by: profile!.id,
      });
      
      toast.success(`${selectedReason.name} request submitted`);
      
      // Reset form
      setStartDate('');
      setEndDate('');
      setIsHalfDay(false);
      setHalfDaySession('AM');
      setNotes('');
      setShowRequestDialog(false);
      setShowDayModal(false);
    } catch (error) {
      console.error('Error submitting request:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  }
  
  // Handle day click
  function handleDayClick(day: Date) {
    setSelectedDate(day);
    setShowDayModal(true);
  }
  
  // Handle request from day modal
  function handleRequestFromDay() {
    if (selectedDate) {
      if (formatDateISO(selectedDate) > bookingMaxDate) {
        toast.error(`Leave can only be booked up to ${formatDate(bookingMaxDate)}.`);
        return;
      }
      setStartDate(formatDateISO(selectedDate));
      setEndDate('');
      setIsHalfDay(false);
      setShowDayModal(false);
      setShowRequestDialog(true);
    }
  }
  
  // Handle cancel
  async function handleCancel(id: string, status: string) {
    const confirmed = await import('@/lib/services/notification.service').then(m => 
      m.notify.confirm({
        title: 'Cancel Absence',
        description: `Are you sure you want to cancel this ${status === 'approved' ? 'approved' : 'pending'} absence?`,
        confirmText: 'Cancel Absence',
        destructive: true,
      })
    );
    if (!confirmed) {
      return;
    }
    
    try {
      await cancelAbsence.mutateAsync(id);
      toast.success('Absence cancelled');
    } catch (error) {
      console.error('Error cancelling:', error);
      toast.error('Failed to cancel absence');
    }
  }
  
  const activeBookings = useMemo(
    () => (userAbsences || []).filter(a => a.status !== 'cancelled'),
    [userAbsences]
  );
  const bookingsTotalPages = Math.max(1, Math.ceil(activeBookings.length / BOOKINGS_PAGE_SIZE));
  const paginatedBookings = useMemo(
    () => activeBookings.slice((bookingsPage - 1) * BOOKINGS_PAGE_SIZE, bookingsPage * BOOKINGS_PAGE_SIZE),
    [activeBookings, bookingsPage]
  );

  const reasonLegend = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    (reasons || [])
      .filter((reason) => reason.is_active)
      .forEach((reason) => {
        map.set(reason.id, { name: reason.name, color: getReasonColor(reason.name, reason.color) });
      });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [reasons]);

  // Render calendar
  function renderCalendar() {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    // Add padding for first week
    const startDay = getDay(monthStart);
    const paddingDays = startDay === 0 ? 6 : startDay - 1; // Monday = 0 padding
    
    return (
      <div className="grid grid-cols-7 gap-2">
        {/* Day headers */}
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
          <div key={day} className="text-center text-sm font-medium text-muted-foreground pb-2">
            {day}
          </div>
        ))}
        
        {/* Padding cells */}
        {Array.from({ length: paddingDays }).map((_, i) => (
          <div key={`padding-${i}`} />
        ))}
        
        {/* Day cells */}
        {days.map(day => {
          const dayAbsences = calendarAbsences.filter(a => {
            const absenceStart = new Date(a.date);
            const absenceEnd = a.end_date ? new Date(a.end_date) : absenceStart;
            return day >= absenceStart && day <= absenceEnd;
          });
          
          return (
            <div
              key={day.toISOString()}
              onClick={() => handleDayClick(day)}
              className={`
                relative min-h-[80px] p-2 rounded-lg border cursor-pointer
                ${dayAbsences.length > 0
                  ? 'border-border bg-slate-800/40'
                  : 'border-slate-700 bg-slate-800/30'
                }
                hover:bg-slate-700/30 hover:border-purple-500/50 transition-colors
              `}
            >
              <div className="text-xs text-muted-foreground font-medium mb-1">
                {format(day, 'd')}
              </div>
              
              {/* Employee list with bullet points */}
              {(isManager || isAdmin) && dayAbsences.length > 0 && (
                <div className="space-y-0.5 text-[10px]">
                  {dayAbsences.map(absence => (
                    <div key={absence.id} className="flex items-start gap-1">
                      <div
                        className="h-1.5 w-1.5 rounded-full mt-1 flex-shrink-0 border"
                        style={{
                          backgroundColor: getReasonColor(absence.absence_reasons.name, absence.absence_reasons.color),
                          borderColor: 'transparent',
                        }}
                        title={absence.absence_reasons.name}
                      />
                      <span
                        className={`leading-tight truncate ${
                          absence.status === 'pending'
                            ? 'text-amber-300'
                            : absence.status === 'rejected'
                            ? 'text-red-400'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {absence.profiles?.full_name || 'Unknown'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Regular user - just indicators */}
              {!(isManager || isAdmin) && (
                <div className="absolute bottom-2 left-2 right-2 flex gap-0.5 justify-center">
                  {Array.from(
                    dayAbsences.reduce(
                      (map, absence) => {
                        const key = absence.reason_id;
                        if (!map.has(key)) {
                          map.set(key, absence);
                        }
                        return map;
                      },
                      new Map<string, typeof dayAbsences[number]>()
                    ).values()
                  )
                    .slice(0, 5)
                    .map((absence) => (
                      <div
                        key={absence.reason_id}
                        className="h-1.5 w-1.5 rounded-full border"
                        style={{
                          backgroundColor: getReasonColor(absence.absence_reasons.name, absence.absence_reasons.color),
                          borderColor: dayAbsences.some(
                            (entry) => entry.reason_id === absence.reason_id && entry.status === 'pending'
                          )
                            ? '#f59e0b'
                            : 'transparent',
                        }}
                        title={absence.absence_reasons.name}
                      />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  
  // Show loading while checking permissions
  if (permissionLoading || loadingAbsences || loadingSummary) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Card className="">
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              {permissionLoading ? 'Checking access...' : 'Loading absences...'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If permission check failed, the hook will redirect to dashboard
  // This is just a safety check in case redirect fails
  if (!hasPermission) {
    return null;
  }
  
  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Absence & Leave
            </h1>
            <p className="text-muted-foreground">
              {isManager || isAdmin
                ? 'Manage annual leave and view absence records'
                : 'Request annual leave and view your absence records'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {(isManager || isAdmin) && (
              <Link href="/absence/manage">
                <Button variant="outline" className="border-border text-muted-foreground">
                  <Settings className="h-4 w-4 mr-2" />
                  Manage Absence
                </Button>
              </Link>
            )}
            <Button
              className="bg-absence hover:bg-absence-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
              onClick={() => setShowRequestDialog(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Request Leave
            </Button>
          </div>
        </div>
      </div>
      
      {/* Summary Card */}
      <Card className="bg-gradient-to-br from-[hsl(var(--absence-primary))] to-[hsl(var(--absence-dark))] border-0 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <CalendarIcon className="h-5 w-5" />
            Annual Leave Summary ({displayFinancialYear.label})
          </CardTitle>
          <CardDescription className="text-purple-100">
            UK Financial Year: {formatDate(displayFinancialYear.start)} - {formatDate(displayFinancialYear.end)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-purple-100 mb-1">Total Allowance</p>
              <p className="text-3xl font-bold">{summary?.allowance || 28}</p>
              <p className="text-xs text-purple-100">days</p>
            </div>
            <div>
              <p className="text-sm text-purple-100 mb-1">Approved Taken</p>
              <p className="text-3xl font-bold">{summary?.approved_taken || 0}</p>
              <p className="text-xs text-purple-100">days</p>
            </div>
            <div>
              <p className="text-sm text-purple-100 mb-1">Pending</p>
              <p className="text-3xl font-bold">{summary?.pending_total || 0}</p>
              <p className="text-xs text-purple-100">days</p>
            </div>
            <div>
              <p className="text-sm text-purple-100 mb-1">Remaining</p>
              <p className="text-3xl font-bold">{summary?.remaining || 0}</p>
              <p className="text-xs text-purple-100">days</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
        <DialogContent className="border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Request Leave</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Submit a leave request for the current financial year.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="reason">Absence Reason</Label>
                <Select value={selectedReasonId} onValueChange={setSelectedReasonId}>
                  <SelectTrigger id="reason" className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRequestReasons.map((reason) => (
                      <SelectItem key={reason.id} value={reason.id}>
                        {reason.name} ({reason.is_paid ? 'Paid' : 'Unpaid'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (endDate && endDate < e.target.value) {
                      setEndDate('');
                    }
                  }}
                  min={formatDateISO(new Date())}
                  max={bookingMaxDate}
                  required
                  className="bg-background border-border text-foreground"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Booking window currently ends on {formatDate(bookingMaxDate)}.
                </p>
              </div>
              <div>
                <Label htmlFor="endDate">End Date (optional for multi-day)</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || formatDateISO(new Date())}
                  max={bookingMaxDate}
                  disabled={!startDate || isHalfDay}
                  className="bg-background border-border text-foreground"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isHalfDay}
                  onChange={(e) => {
                    setIsHalfDay(e.target.checked);
                    if (e.target.checked) {
                      setEndDate('');
                    }
                  }}
                  className="rounded border-border"
                />
                <span className="text-sm text-muted-foreground">Half Day</span>
              </label>
              {isHalfDay && (
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value="AM"
                      checked={halfDaySession === 'AM'}
                      onChange={() => setHalfDaySession('AM')}
                      className="text-purple-500"
                    />
                    <span className="text-sm text-muted-foreground">AM</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="session"
                      value="PM"
                      checked={halfDaySession === 'PM'}
                      onChange={() => setHalfDaySession('PM')}
                      className="text-purple-500"
                    />
                    <span className="text-sm text-muted-foreground">PM</span>
                  </label>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any additional information..."
                className="bg-background border-border text-foreground"
              />
            </div>

            {startDate && (
              <div className="bg-slate-800/30 p-4 rounded-lg space-y-2">
                <h4 className="font-semibold text-foreground">Request Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Requested Days:</span>
                    <span className="ml-2 text-foreground font-medium">{requestedDays}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Approved Taken:</span>
                    <span className="ml-2 text-foreground font-medium">{summary?.approved_taken || 0}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Pending:</span>
                    <span className="ml-2 text-foreground font-medium">{summary?.pending_total || 0}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Projected Remaining:</span>
                    <span className={`ml-2 font-medium ${projectedRemaining < 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {projectedRemaining}
                    </span>
                  </div>
                </div>
                {deductsAllowance && projectedRemaining < 0 && (
                  <div className="flex items-start gap-2 bg-red-500/20 p-3 rounded border border-red-500/30">
                    <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-300">
                      This request exceeds your available allowance. Please adjust the dates or contact your manager.
                    </p>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowRequestDialog(false)} className="border-border text-muted-foreground">
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setIsHalfDay(false);
                  setHalfDaySession('AM');
                  setNotes('');
                }}
                className="border-border text-muted-foreground"
              >
                Clear
              </Button>
              <Button
                type="submit"
                disabled={submitting || (deductsAllowance && projectedRemaining < 0) || !startDate || !selectedReasonId}
                className="bg-absence hover:bg-absence-dark text-white"
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as 'calendar' | 'bookings')} className="w-full">
        <TabsList className="inline-flex w-auto bg-slate-800/50">
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="bookings">My Bookings</TabsTrigger>
        </TabsList>
        
        {/* Calendar Tab */}
        <TabsContent value="calendar" className="space-y-6">
          {/* Calendar */}
          <Card className="">
            <CardHeader>
              <div className="flex items-center justify-between mb-4">
                <CardTitle className="text-foreground">
                  {format(currentMonth, 'MMMM yyyy')}
                </CardTitle>
                <div className="flex gap-2">
                  {/* Employee Filter for Managers/Admins */}
                  {(isManager || isAdmin) && employees.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="border-border text-muted-foreground">
                          <Users className="h-4 w-4 mr-2" />
                          Filter ({selectedEmployeeIds.length}/{employees.length})
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 border-border" align="end">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-border">
                            <h4 className="font-semibold text-foreground text-sm">Filter Employees</h4>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={toggleAllEmployees}
                              className="h-7 text-xs text-purple-400 hover:text-purple-300"
                            >
                              {selectedEmployeeIds.length === employees.length ? 'Deselect All' : 'Select All'}
                            </Button>
                          </div>
                          <div className="max-h-60 overflow-y-auto space-y-2">
                            {employees.map(emp => (
                              <div key={emp.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`emp-${emp.id}`}
                                  checked={selectedEmployeeIds.includes(emp.id)}
                                  onCheckedChange={() => toggleEmployee(emp.id)}
                                  className="border-border"
                                />
                                <label
                                  htmlFor={`emp-${emp.id}`}
                                  className="text-sm text-muted-foreground cursor-pointer flex-1"
                                >
                                  {emp.full_name}
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  
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
              
              {/* Legend */}
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
            <CardContent>
              {renderCalendar()}
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Bookings List Tab */}
        <TabsContent value="bookings">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                My Absence Records ({displayFinancialYear.label})
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                All absences in the current financial year
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeBookings.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarIcon className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No absences recorded</h3>
                  <p className="text-muted-foreground">Your absence records will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {paginatedBookings.map(absence => {
                    const canCancel = 
                      (absence.status === 'pending' && new Date(absence.date) >= new Date()) ||
                      (absence.status === 'approved' && new Date(absence.date) >= new Date());
                    
                    return (
                      <div
                        key={absence.id}
                        className="p-4 rounded-lg bg-slate-800/30 border border-border/50 hover:border-slate-600 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-white">
                                {absence.absence_reasons.name}
                              </h3>
                              <Badge
                                variant="outline"
                                className={
                                  absence.status === 'approved'
                                    ? 'border-green-500/30 text-green-400 bg-green-500/10'
                                    : absence.status === 'pending'
                                    ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                                    : absence.status === 'rejected'
                                    ? 'border-red-500/30 text-red-400 bg-red-500/10'
                                    : 'border-slate-600 text-muted-foreground'
                                }
                              >
                                {absence.status}
                              </Badge>
                              {absence.absence_reasons.is_paid ? (
                                <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
                                  Paid
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-slate-600 text-muted-foreground">
                                  Unpaid
                                </Badge>
                              )}
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-muted-foreground">
                              <div>
                                <span className="text-muted-foreground">Date:</span>{' '}
                                {absence.end_date && absence.date !== absence.end_date
                                  ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                                  : formatDate(absence.date)
                                }
                                {absence.is_half_day && ` (${absence.half_day_session})`}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Duration:</span> {absence.duration_days} {absence.duration_days === 1 ? 'day' : 'days'}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Submitted:</span> {formatDate(absence.created_at)}
                              </div>
                            </div>
                            
                            {absence.notes && (
                              <p className="text-sm text-muted-foreground mt-2">
                                <span className="text-muted-foreground">Notes:</span> {absence.notes}
                              </p>
                            )}
                          </div>
                          
                          {canCancel && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancel(absence.id, absence.status)}
                              className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {bookingsTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-4">
                      <p className="text-sm text-muted-foreground">
                        Showing {(bookingsPage - 1) * BOOKINGS_PAGE_SIZE + 1}–{Math.min(bookingsPage * BOOKINGS_PAGE_SIZE, activeBookings.length)} of {activeBookings.length}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={bookingsPage <= 1}
                          onClick={() => setBookingsPage((p) => p - 1)}
                          className="border-slate-600"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {bookingsPage} of {bookingsTotalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={bookingsPage >= bookingsTotalPages}
                          onClick={() => setBookingsPage((p) => p + 1)}
                          className="border-slate-600"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      {/* Day Click Modal */}
      <Dialog open={showDayModal} onOpenChange={setShowDayModal}>
        <DialogContent className="border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              What would you like to do?
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {selectedDate && (() => {
              const dayAbsences = (isManager || isAdmin ? calendarAbsences : userAbsences || []).filter(a => {
                const absenceStart = new Date(a.date);
                const absenceEnd = a.end_date ? new Date(a.end_date) : absenceStart;
                return selectedDate >= absenceStart && selectedDate <= absenceEnd && a.status !== 'cancelled';
              });
              
              if (dayAbsences.length > 0) {
                return (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-foreground">Absences on this day:</h4>
                    {dayAbsences.map(absence => {
                      const reasonColor = getReasonColor(absence.absence_reasons.name, absence.absence_reasons.color);
                      return (
                      <div key={absence.id} className="p-3 rounded bg-slate-800/50 border border-border" style={{ borderLeftWidth: '3px', borderLeftColor: reasonColor }}>
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-foreground flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10" style={{ backgroundColor: reasonColor }} />
                              {absence.absence_reasons.name}
                            </p>
                            {(isManager || isAdmin) && absence.profiles && (
                              <p className="text-sm text-muted-foreground">{absence.profiles.full_name}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              Status: <span className="capitalize">{absence.status}</span>
                            </p>
                            {absence.notes && (
                              <p className="text-xs text-muted-foreground mt-1">{absence.notes}</p>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              absence.status === 'approved'
                                ? 'border-green-500/30 text-green-400 bg-green-500/10'
                                : absence.status === 'pending'
                                ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                                : 'border-slate-600 text-muted-foreground'
                            }
                          >
                            {absence.status}
                          </Badge>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                );
              } else {
                return (
                  <div className="py-6 text-center">
                    <CalendarIcon className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground mb-4">No absences on this day</p>
                    {selectedDate && formatDateISO(selectedDate) > bookingMaxDate && (
                      <p className="text-xs text-amber-400 mb-3">
                        This date is outside the current booking window ({formatDate(bookingMaxDate)}).
                      </p>
                    )}
                    <Button
                      onClick={handleRequestFromDay}
                      disabled={Boolean(selectedDate && formatDateISO(selectedDate) > bookingMaxDate)}
                      className="bg-absence hover:bg-absence-dark text-white"
                    >
                      Request Leave
                    </Button>
                  </div>
                );
              }
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
    </div>
  );
}

