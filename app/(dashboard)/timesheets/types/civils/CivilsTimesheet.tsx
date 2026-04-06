'use client';

import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Save, Check, AlertCircle, XCircle, Home, User, Loader2 } from 'lucide-react';
import Link from 'next/link';
// Removed: getWeekEnding, formatDateISO - no longer needed (week comes from props)
import { calculateHours, formatHours, roundTimeToNearestQuarterHour } from '@/lib/utils/time-calculations';
import { DAY_NAMES } from '@/types/timesheet';
import { Database } from '@/types/database';
import { isAdminRole } from '@/lib/utils/role-access';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { fetchUKBankHolidays } from '@/lib/utils/bank-holidays';
import { Employee } from '@/types/common';
import { toast } from 'sonner';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { fetchCurrentWorkShift, fetchEmployeeWorkShift } from '@/lib/client/work-shifts';
import type { WorkShiftPattern } from '@/types/work-shifts';
import {
  type ApprovedAbsenceForTimesheet,
  isWorkWindowOvernight,
  type TimesheetEntryLike,
  type TimesheetOffDayState,
  getTimesheetEntryDateFromWeekEnding,
  getTimesheetWeekIsoBounds,
  isTimeWithinWorkWindow,
  normalizeTimesheetEntriesForOffDays,
  resolveTimesheetOffDayStates,
} from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';

/**
 * Civils Timesheet Component
 * 
 * This is the standard weekly timesheet for civil engineering work.
 * Supports bank holiday detection and automatic time calculations.
 * 
 * @param weekEnding - The Sunday date for this timesheet (YYYY-MM-DD format)
 * @param existingId - ID of existing timesheet to edit (null for new)
 * @param userId - User ID for whom this timesheet is being created (for managers)
 */

interface CivilsTimesheetProps {
  weekEnding: string;
  existingId: string | null;
  userId?: string;
  timesheetType?: 'civils' | 'plant';
  onSelectedEmployeeChange?: (employeeId: string) => void;
}

type TimesheetEntryDraft = TimesheetEntryLike & {
  night_shift: boolean;
  bank_holiday: boolean;
  bankHolidayWarningShown: boolean;
};

const createBlankEntry = (dayOfWeek: number): TimesheetEntryDraft => ({
  day_of_week: dayOfWeek,
  time_started: '',
  time_finished: '',
  job_number: '',
  working_in_yard: false,
  did_not_work: false,
  didNotWorkReason: null,
  night_shift: false,
  bank_holiday: false,
  daily_total: null,
  remarks: '',
  bankHolidayWarningShown: false,
});

const createBlankWeekEntries = (): TimesheetEntryDraft[] =>
  Array.from({ length: 7 }, (_, i) => createBlankEntry(i + 1));

export function CivilsTimesheet({
  weekEnding: initialWeekEnding,
  existingId: initialExistingId,
  userId: managerSelectedUserId,
  timesheetType = 'civils',
  onSelectedEmployeeChange,
}: CivilsTimesheetProps) {
  const router = useRouter();
  const { user, profile, isManager, isAdmin, isSuperAdmin } = useAuth();
  
  const supabase = useMemo(() => createClient(), []);
  
  // SuperAdmins, admins, and managers all have elevated permissions
  const hasElevatedPermissions = isSuperAdmin || isManager || isAdmin;
  
  const [existingTimesheetId, setExistingTimesheetId] = useState<string | null>(initialExistingId);
  const [regNumber, setRegNumber] = useState('');
  const [weekEnding, setWeekEnding] = useState(initialWeekEnding || ''); // Comes from props or loaded from DB
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeDay, setActiveDay] = useState('0');
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingTimesheetLoaded, setExistingTimesheetLoaded] = useState(!initialExistingId);
  const [managerComments, setManagerComments] = useState<string>(''); // For rejected timesheets
  
  // Manager-specific states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(managerSelectedUserId || user?.id || '');
  
  // Bank holidays cache (fetched from GOV.UK API)
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set());
  
  // Bank holiday warning modal
  const [showBankHolidayWarning, setShowBankHolidayWarning] = useState(false);
  const [bankHolidayDayIndex, setBankHolidayDayIndex] = useState<number | null>(null);
  const [bankHolidayDate, setBankHolidayDate] = useState<string>('');
  
  // Track time validation errors per day
  const [timeErrors, setTimeErrors] = useState<Record<number, string>>({});

  // Vehicle suggestion states
  const [suggestedRegNumber, setSuggestedRegNumber] = useState<string | null>(null);
  const [showSuggestedVehiclePrompt, setShowSuggestedVehiclePrompt] = useState(false);
  const [vehiclePromptDismissed, setVehiclePromptDismissed] = useState(false);
  const timesheetTypeLabel = timesheetType === 'plant' ? 'Plant' : 'Standard';
  const timesheetHeaderTitle = existingTimesheetId
    ? `Edit ${timesheetTypeLabel} Timesheet`
    : `New ${timesheetTypeLabel} Timesheet`;
  const detailsTitle = `${timesheetTypeLabel} Timesheet Details`;
  const registrationLabel =
    timesheetType === 'plant' ? 'Plant / Vehicle Registration (Optional)' : 'Vehicle Registration (Optional)';

  // Initialize entries for all 7 days (with didNotWorkReason tracking)
  const [entries, setEntries] = useState<TimesheetEntryDraft[]>(
    createBlankWeekEntries()
  );
  const [offDayStates, setOffDayStates] = useState<TimesheetOffDayState[]>([]);
  const [offDayKey, setOffDayKey] = useState<string>('');
  const [loadingOffDays, setLoadingOffDays] = useState(true);
  const currentOffDayKey = useMemo(
    () => (selectedEmployeeId && weekEnding ? `${selectedEmployeeId}:${weekEnding}` : ''),
    [selectedEmployeeId, weekEnding]
  );

  const offDayMap = useMemo(() => {
    if (offDayKey !== currentOffDayKey) return new Map<number, TimesheetOffDayState>();
    return new Map(offDayStates.map((state) => [state.day_of_week, state] as const));
  }, [offDayKey, currentOffDayKey, offDayStates]);

  // Fetch bank holidays from GOV.UK API on mount
  useEffect(() => {
    const loadBankHolidays = async () => {
      try {
        const holidays = await fetchUKBankHolidays('england-and-wales');
        setBankHolidays(holidays);
      } catch (error) {
        console.error('Failed to load bank holidays:', error);
        // Continue without bank holidays - system will still work
      }
    };
    
    loadBankHolidays();
  }, []);

  // Fetch employees if manager/admin
  useEffect(() => {
    if (user && hasElevatedPermissions) {
      fetchEmployees();
    } else if (user && !selectedEmployeeId) {
      // If not a manager/admin and no employee selected, set to current user
      setSelectedEmployeeId(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hasElevatedPermissions]);

  // Keep local selected employee aligned when parent context changes.
  useEffect(() => {
    if (!managerSelectedUserId) return;
    setSelectedEmployeeId((current) =>
      current === managerSelectedUserId ? current : managerSelectedUserId
    );
  }, [managerSelectedUserId]);

  // Load existing timesheet if ID is provided via props
  useEffect(() => {
    // Wait for ID, authenticated user, AND profile before loading
    // (profile needed for permission checks)
    if (initialExistingId && user && profile && !loadingExisting) {
      loadExistingTimesheet(initialExistingId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialExistingId, user, profile]);

  // Fetch last used vehicle when selectedEmployeeId changes (for new timesheets only)
  useEffect(() => {
    if (selectedEmployeeId && !existingTimesheetId) {
      // Clear previous employee's vehicle when switching employees
      setRegNumber('');
      setVehiclePromptDismissed(false); // Reset dismissal state for new employee
      fetchLastUsedVehicle(selectedEmployeeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId]);

  // Resolve leave + shift expectations for the selected employee/week.
  useEffect(() => {
    if (!user || !selectedEmployeeId || !weekEnding) {
      setLoadingOffDays(true);
      return;
    }

    const requestKey = `${selectedEmployeeId}:${weekEnding}`;
    let cancelled = false;

    const loadOffDays = async () => {
      setLoadingOffDays(true);
      try {
        const { startIso, endIso } = getTimesheetWeekIsoBounds(weekEnding);
        const absenceResult = await supabase
          .from('absences')
          .select('date, end_date, is_half_day, half_day_session, allow_timesheet_work_on_leave, absence_reasons(name,color,is_paid)')
          .eq('profile_id', selectedEmployeeId)
          .in('status', ['approved', 'processed'])
          .lte('date', endIso);

        if (absenceResult.error) throw absenceResult.error;
        if (cancelled) return;

        const filteredAbsences = ((absenceResult.data || []) as ApprovedAbsenceForTimesheet[]).filter((row) => {
          const rowEnd = row.end_date || row.date;
          return row.date <= endIso && rowEnd >= startIso;
        });

        let resolvedPattern: WorkShiftPattern | null = null;
        try {
          const workShiftData =
            selectedEmployeeId === user.id
              ? await fetchCurrentWorkShift()
              : await fetchEmployeeWorkShift(selectedEmployeeId);
          resolvedPattern = (workShiftData?.pattern as WorkShiftPattern | null) || null;
        } catch (workShiftError) {
          // Leave lock must still apply even if shift API is unavailable.
          console.warn('Failed to load work shift pattern for timesheet off-day defaults:', workShiftError);
        }

        if (cancelled) return;

        const resolvedStates = resolveTimesheetOffDayStates(
          weekEnding,
          filteredAbsences,
          resolvedPattern
        );

        if (cancelled) return;
        setOffDayStates(resolvedStates);
        setOffDayKey(requestKey);
      } catch (offDayError) {
        console.error('Failed to resolve timesheet off-day states:', offDayError);
        if (!cancelled) {
          setOffDayStates(resolveTimesheetOffDayStates(weekEnding, [], null));
          setOffDayKey(requestKey);
        }
      } finally {
        if (!cancelled) {
          setLoadingOffDays(false);
        }
      }
    };

    loadOffDays();

    return () => {
      cancelled = true;
    };
  }, [selectedEmployeeId, supabase, user, weekEnding]);

  useEffect(() => {
    if (!existingTimesheetLoaded) return;
    if (offDayKey !== currentOffDayKey || offDayStates.length === 0) return;

    setEntries((prev) =>
      normalizeTimesheetEntriesForOffDays(prev, offDayStates, {
        enforceLeaveOverwrite: true,
        applyNonShiftDefaults: true,
      }) as TimesheetEntryDraft[]
    );
  }, [currentOffDayKey, existingTimesheetLoaded, offDayKey, offDayStates]);

  // Removed: Fetch existing timesheets effect - no longer needed
  // Duplicate checking now happens in WeekSelector

  const getDayDate = (dayIndex: number): Date =>
    getTimesheetEntryDateFromWeekEnding(weekEnding, dayIndex + 1);

  const getOffDayForIndex = (dayIndex: number): TimesheetOffDayState | undefined =>
    offDayMap.get(dayIndex + 1);

  const isLeaveLockedDay = (dayIndex: number): boolean => Boolean(getOffDayForIndex(dayIndex)?.isLeaveLocked);
  const isLeaveDay = (dayIndex: number): boolean => Boolean(getOffDayForIndex(dayIndex)?.isOnApprovedLeave);
  const getWorkWindowForDay = (dayIndex: number) => getOffDayForIndex(dayIndex)?.workWindow ?? null;

  const toMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const getTimeWindowError = (dayIndex: number, time: string): string | null => {
    const workWindow = getWorkWindowForDay(dayIndex);
    if (!workWindow || !time) return null;

    if (!isTimeWithinWorkWindow(time, workWindow)) {
      return `Time must be between ${workWindow.start} and ${workWindow.end} for this leave booking`;
    }

    return null;
  };

  const getDidNotWorkAutoLabel = (dayOffState: TimesheetOffDayState | undefined): string => {
    if (dayOffState?.isOnApprovedLeave) {
      return dayOffState.leaveLabels[0]?.label || dayOffState.leaveReasonName || 'Approved Leave';
    }

    if (dayOffState && !dayOffState.isExpectedShiftDay) {
      return 'Not on Shift';
    }

    return 'Did Not Work';
  };

  const getDidNotWorkAutoStyle = (dayOffState: TimesheetOffDayState | undefined): CSSProperties | undefined => {
    if (!dayOffState?.isOnApprovedLeave || !dayOffState.leaveReasonColor) return undefined;

    return {
      color: dayOffState.leaveReasonColor,
    };
  };

  const getLeaveLabelStyle = (color: string | null | undefined): CSSProperties | undefined => {
    if (!color) return undefined;
    return { color };
  };

  // Check if a specific day is a bank holiday
  const isDayBankHoliday = (dayIndex: number): boolean => {
    const entryDate = getDayDate(dayIndex);
    const year = entryDate.getFullYear();
    const month = String(entryDate.getMonth() + 1).padStart(2, '0');
    const day = String(entryDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    return bankHolidays.has(dateString);
  };

  // Get formatted date for display
  const getFormattedDate = (dayIndex: number): string =>
    getDayDate(dayIndex).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  // Show bank holiday warning if needed
  const checkAndShowBankHolidayWarning = (dayIndex: number, value: string) => {
    // Only show if:
    // 1. It's a bank holiday
    // 2. Warning hasn't been shown for this day yet
    // 3. User has entered any value (works with mobile time pickers and manual entry)
    // 4. Day is not already marked as "did not work"
    const entry = entries[dayIndex];

    if (
      isDayBankHoliday(dayIndex) &&
      !isLeaveLockedDay(dayIndex) &&
      !entry.bankHolidayWarningShown &&
      !entry.did_not_work &&
      value && value.trim().length > 0
    ) {
      setBankHolidayDayIndex(dayIndex);
      setBankHolidayDate(getFormattedDate(dayIndex));
      setShowBankHolidayWarning(true);
    }
  };

  // Handle "Yes" on bank holiday warning - mark as shown and continue
  const handleBankHolidayYes = () => {
    if (bankHolidayDayIndex !== null) {
      const newEntries = [...entries];
      newEntries[bankHolidayDayIndex] = {
        ...newEntries[bankHolidayDayIndex],
        bankHolidayWarningShown: true,
      };
      setEntries(newEntries);
    }
    setShowBankHolidayWarning(false);
    setBankHolidayDayIndex(null);
  };

  // Handle "No" on bank holiday warning - clear entries and enable "did not work"
  const handleBankHolidayNo = () => {
    if (bankHolidayDayIndex !== null) {
      const newEntries = [...entries];
      newEntries[bankHolidayDayIndex] = {
        ...newEntries[bankHolidayDayIndex],
        time_started: '',
        time_finished: '',
        job_number: '',
        did_not_work: true,
        working_in_yard: false,
        daily_total: 0,
        bankHolidayWarningShown: true, // Mark as shown so it doesn't pop up again
      };
      setEntries(newEntries);
    }
    setShowBankHolidayWarning(false);
    setBankHolidayDayIndex(null);
  };

  // Handle job number input with auto-dash formatting (NNNN-LL format)
  const handleJobNumberChange = (index: number, value: string) => {
    // Check for bank holiday warning when user enters a job number
    if (value && value.trim().length > 0) {
      checkAndShowBankHolidayWarning(index, value);
    }
    
    // Remove all non-alphanumeric characters except dash
    let cleaned = value.replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
    
    // Remove any existing dashes
    cleaned = cleaned.replace(/-/g, '');
    
    // Auto-format: add dash after 4 digits
    if (cleaned.length > 4) {
      cleaned = cleaned.substring(0, 4) + '-' + cleaned.substring(4, 6);
    }
    
    // Limit to 7 characters (4 digits + dash + 2 letters)
    cleaned = cleaned.substring(0, 7);
    
    updateEntry(index, 'job_number', cleaned);
  };

  const fetchEmployees = async () => {
    try {
      // Convert to expected format
      const formattedEmployees: Employee[] = (await fetchUserDirectory({ module: 'timesheets' }))
        .map((emp: { id: string; full_name: string | null; employee_id: string | null }) => ({
          id: emp.id,
          full_name: emp.full_name || 'Unnamed User',
          employee_id: emp.employee_id || null,
          has_module_access: (emp as { has_module_access?: boolean }).has_module_access,
        }));
      
      setEmployees(formattedEmployees);
      
      // Set default to current user only if we're not loading an existing timesheet
      if (user && !initialExistingId && !managerSelectedUserId) {
        setSelectedEmployeeId(user.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const normalizedMessage = message.toLowerCase();
      const isNetworkFailure =
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        normalizedMessage.includes('network');
      const isUnauthorized =
        normalizedMessage.includes('unauthorized') ||
        (normalizedMessage.includes('jwt') && normalizedMessage.includes('expired'));

      if (isNetworkFailure || isUnauthorized) {
        // Non-fatal: transient auth/network issues should not be captured as app errors.
        setEmployees([]);
        console.warn('Unable to load employees (non-fatal):', err);
      } else {
        console.error('Error fetching employees:', err);
      }
    }
  };

  const handleSelectedEmployeeChange = (nextEmployeeId: string) => {
    setSelectedEmployeeId(nextEmployeeId);
    onSelectedEmployeeChange?.(nextEmployeeId);

    // New timesheets should always start from a clean week for the chosen employee.
    // This prevents prior employee leave defaults from leaking into the new selection.
    if (!existingTimesheetId) {
      setEntries(createBlankWeekEntries());
      setTimeErrors({});
      setActiveDay('0');
    }
  };

  // Fetch last used vehicle for the selected user
  const fetchLastUsedVehicle = async (userId: string) => {
    try {
      // Query last timesheet with reg_number
      const { data: lastTimesheet } = await supabase
        .from('timesheets')
        .select('reg_number, week_ending')
        .eq('user_id', userId)
        .not('reg_number', 'is', null)
        .neq('reg_number', '')
        .order('week_ending', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Query last inspection with vehicle reg
      const { data: lastInspection } = await supabase
        .from('van_inspections')
        .select('inspection_date, vans(reg_number)')
        .eq('user_id', userId)
        .order('inspection_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Determine which is most recent
      let mostRecentReg: string | null = null;
      let mostRecentDate: Date | null = null;

      if (lastTimesheet?.reg_number && lastTimesheet?.week_ending) {
        mostRecentReg = lastTimesheet.reg_number;
        mostRecentDate = new Date(lastTimesheet.week_ending);
      }

      if (lastInspection?.vans && 'reg_number' in lastInspection.vans && lastInspection.inspection_date) {
        const inspectionDate = new Date(lastInspection.inspection_date);
        const vehicleReg = (lastInspection.vans as { reg_number: string }).reg_number;
        
        if (!mostRecentDate || inspectionDate > mostRecentDate) {
          mostRecentReg = vehicleReg;
          mostRecentDate = inspectionDate;
        }
      }

      if (mostRecentReg) {
        setSuggestedRegNumber(mostRecentReg);
        setShowSuggestedVehiclePrompt(true);
      }
    } catch (err) {
      console.error('Error fetching last used vehicle:', err);
      // Silently fail - not critical
    }
  };

  // Handle vehicle suggestion "Yes"
  const handleVehicleSuggestionYes = () => {
    if (suggestedRegNumber) {
      setRegNumber(suggestedRegNumber.toUpperCase());
    }
    setShowSuggestedVehiclePrompt(false);
  };

  // Handle vehicle suggestion "No"
  const handleVehicleSuggestionNo = () => {
    setShowSuggestedVehiclePrompt(false);
    setVehiclePromptDismissed(true);
  };

  // Removed: fetchExistingTimesheets logic - no longer needed
  // Duplicate checking now happens in WeekSelector before reaching this component

  const loadExistingTimesheet = async (timesheetId: string) => {
    // This should never be called without user due to useEffect guard
    if (!user) {
      console.error('loadExistingTimesheet called without user');
      return;
    }
    
    // Prevent duplicate loads
    if (loadingExisting) return;
    
    setExistingTimesheetLoaded(false);
    setLoadingExisting(true);
    setError('');
    
    try {
      // For managers/admins, ensure employees are loaded first
      if (hasElevatedPermissions) {
        // If employees haven't been loaded yet, fetch them now
        if (employees.length === 0) {
          const employeesData = await fetchUserDirectory({ module: 'timesheets' });
          setEmployees(
            employeesData.map((employee) => ({
              id: employee.id,
              full_name: employee.full_name || 'Unnamed User',
              employee_id: employee.employee_id,
              has_module_access: employee.has_module_access,
            }))
          );
        }
      }
      
      // Fetch timesheet
      const { data: timesheetData, error: timesheetError } = await supabase
        .from('timesheets')
        .select('*')
        .eq('id', timesheetId)
        .single();
      
      if (timesheetError) throw timesheetError;
      
      // Check if user has access and timesheet is draft or rejected
      // Calculate permissions dynamically from current profile state (not stale closure values)
      const currentIsSuperAdmin = (profile as { super_admin?: boolean; role?: { is_super_admin?: boolean } } | null)?.super_admin || profile?.role?.is_super_admin || false;
      const currentIsManager = profile?.role?.is_manager_admin || false;
      const currentIsAdmin = isAdminRole(profile?.role);
      const currentHasElevatedPermissions = currentIsSuperAdmin || currentIsManager || currentIsAdmin;
      
      if (!currentHasElevatedPermissions && timesheetData.user_id !== user.id) {
        setError('You do not have permission to edit this timesheet');
        setLoadingExisting(false);
        return;
      }
      
      if (timesheetData.status !== 'draft' && timesheetData.status !== 'rejected') {
        setError('This timesheet cannot be edited. Only draft or rejected timesheets can be edited.');
        setLoadingExisting(false);
        router.push(`/timesheets/${timesheetId}`);
        return;
      }
      
      // Set timesheet data
      setExistingTimesheetId(timesheetData.id);
      setRegNumber(timesheetData.reg_number || '');
      setWeekEnding(timesheetData.week_ending);
      setManagerComments(timesheetData.manager_comments || '');
      
      // Set selected employee - employees are now guaranteed to be loaded for managers
      setSelectedEmployeeId(timesheetData.user_id);
      
      // Fetch entries
      const { data: entriesData, error: entriesError } = await supabase
        .from('timesheet_entries')
        .select('*')
        .eq('timesheet_id', timesheetId)
        .order('day_of_week');
      
      if (entriesError) throw entriesError;
      
      // Create full week array with all 7 days, preserving all fields
      const fullWeek = Array.from({ length: 7 }, (_, i) => {
        const existingEntry = entriesData?.find((e: { day_of_week: number }) => e.day_of_week === i + 1);
        if (!existingEntry) {
          return createBlankEntry(i + 1);
        }

        let inferredReason: 'Holiday' | 'Sickness' | 'Off Shift' | 'Other' | null = null;
        if (existingEntry.did_not_work && existingEntry.remarks) {
          const remarks = existingEntry.remarks.trim().toLowerCase();
          if (remarks.startsWith('annual leave') || remarks === 'holiday') inferredReason = 'Holiday';
          else if (remarks.startsWith('sickness') || remarks.startsWith('sick')) inferredReason = 'Sickness';
          else if (remarks === 'not on shift' || remarks === 'off shift' || remarks === 'off') inferredReason = 'Off Shift';
          else if (remarks.length > 0) inferredReason = 'Other';
        }

        return {
          day_of_week: i + 1,
          time_started: existingEntry.time_started || '',
          time_finished: existingEntry.time_finished || '',
          job_number: existingEntry.job_number || '',
          working_in_yard: existingEntry.working_in_yard || false,
          did_not_work: existingEntry.did_not_work || false,
          didNotWorkReason: inferredReason,
          night_shift: existingEntry.night_shift || false,
          bank_holiday: existingEntry.bank_holiday || false,
          daily_total: existingEntry.daily_total,
          remarks: existingEntry.remarks || '',
          bankHolidayWarningShown: false,
        } as TimesheetEntryDraft;
      });
      
      setEntries(fullWeek);
    } catch (err) {
      console.error('Error loading existing timesheet:', err);
      setError(err instanceof Error ? err.message : 'Failed to load timesheet');
      setShowErrorDialog(true);
    } finally {
      setLoadingExisting(false);
      setExistingTimesheetLoaded(true);
    }
  };

  // Week ending is now passed via props and validated in WeekSelector
  // No date validation needed here

  // Validate and round time to nearest 15-minute interval
  const roundToQuarterHour = (timeString: string): string => {
    return roundTimeToNearestQuarterHour(timeString);
  };

  // Calculate hours when times change
  const updateEntry = (dayIndex: number, field: string, value: string | boolean) => {
    if (isLeaveLockedDay(dayIndex)) return;
    const workWindow = getWorkWindowForDay(dayIndex);

    const newEntries = [...entries];
    
    // Special handling for "did_not_work" toggle
    if (field === 'did_not_work') {
      if (isLeaveDay(dayIndex)) return;
      if (value === true) {
        // Setting did_not_work to true
        newEntries[dayIndex] = {
          ...newEntries[dayIndex],
          did_not_work: true,
          didNotWorkReason: null, // Clear any previous reason
          time_started: '',
          time_finished: '',
          working_in_yard: false,
          daily_total: 0,
        };
      } else {
        // Setting did_not_work to false - reset daily_total if times are empty
        newEntries[dayIndex] = {
          ...newEntries[dayIndex],
          did_not_work: false,
          didNotWorkReason: null, // Clear reason when re-enabling work
        };
        // Recalculate daily_total if times are present, otherwise set to null
        const entry = newEntries[dayIndex];
        if (entry.time_started && entry.time_finished) {
          // Check if start and end times are the same
          if (entry.time_started === entry.time_finished) {
            setTimeErrors(prev => ({
              ...prev,
              [dayIndex]: 'Start time and end time cannot be the same'
            }));
            newEntries[dayIndex].daily_total = 0;
          } else {
            // Clear error for this day
            setTimeErrors(prev => {
              const newErrors = { ...prev };
              delete newErrors[dayIndex];
              return newErrors;
            });
            
            let hours = calculateHours(entry.time_started, entry.time_finished);
            if (hours !== null && hours > 6.5) {
              hours = hours - 0.5;
            }
            newEntries[dayIndex].daily_total = hours;
          }
        } else {
          newEntries[dayIndex].daily_total = null;
          // Clear error for this day
          setTimeErrors(prev => {
            const newErrors = { ...prev };
            delete newErrors[dayIndex];
            return newErrors;
          });
        }
      }
    } else {
      // Check for bank holiday warning on time fields (triggers on any value change, including mobile time pickers)
      if ((field === 'time_started' || field === 'time_finished') && typeof value === 'string') {
        if (value && value.trim().length > 0) {
          checkAndShowBankHolidayWarning(dayIndex, value);
        }
        // Round time inputs to 15-minute intervals
        value = roundToQuarterHour(value);
        const rangeError = getTimeWindowError(dayIndex, value);
        if (rangeError) {
          setTimeErrors(prev => ({
            ...prev,
            [dayIndex]: rangeError,
          }));
          return;
        }
      }
      
      newEntries[dayIndex] = {
        ...newEntries[dayIndex],
        [field]: value,
      };

      // Auto-calculate daily total if both times are present
      if (field === 'time_started' || field === 'time_finished') {
        const entry = newEntries[dayIndex];
        // If either time is empty, set daily_total to null and clear error
        if (!entry.time_started || !entry.time_finished) {
          newEntries[dayIndex].daily_total = null;
          // Clear error for this day
          setTimeErrors(prev => {
            const newErrors = { ...prev };
            delete newErrors[dayIndex];
            return newErrors;
          });
        } else {
          // Check if start and end times are the same
          if (entry.time_started === entry.time_finished) {
            // Set error for this day
            setTimeErrors(prev => ({
              ...prev,
              [dayIndex]: 'Start time and end time cannot be the same'
            }));
            newEntries[dayIndex].daily_total = 0;
          } else if (
            workWindow &&
            !isWorkWindowOvernight(workWindow) &&
            (toMinutes(entry.time_finished) < toMinutes(entry.time_started))
          ) {
            setTimeErrors(prev => ({
              ...prev,
              [dayIndex]: 'Finish time must be after start time for half-day leave bookings',
            }));
            newEntries[dayIndex].daily_total = 0;
          } else {
            // Clear error for this day
            setTimeErrors(prev => {
              const newErrors = { ...prev };
              delete newErrors[dayIndex];
              return newErrors;
            });
            
            let hours = calculateHours(entry.time_started, entry.time_finished);
            
            // Auto-deduct 30 mins (0.5 hours) for lunch break if daily total > 6.5 hours
            if (hours !== null && hours > 6.5) {
              hours = hours - 0.5;
            }
            
            newEntries[dayIndex].daily_total = hours;
          }
        }
      }
    }

    const normalizedEntries =
      offDayKey === currentOffDayKey && offDayStates.length > 0
        ? (normalizeTimesheetEntriesForOffDays(newEntries, offDayStates, {
            enforceLeaveOverwrite: true,
            // Keep approved-leave guardrails, but do not re-force "Not on Shift" while the
            // user is actively editing. This allows weekend overtime overrides.
            applyNonShiftDefaults: false,
          }) as TimesheetEntryDraft[])
        : newEntries;

    setEntries(normalizedEntries);
  };

  const leaveAwareTotals = useMemo(
    () => buildLeaveAwareTotals(entries, offDayStates),
    [entries, offDayStates]
  );
  const weeklyTotalMultiline = formatLeaveAwareWeeklyDisplayMultiline(
    leaveAwareTotals.weekly.workedHours,
    leaveAwareTotals.weekly.leaveDays
  );

  const isEntryComplete = (entry: TimesheetEntryDraft, dayIndex: number): boolean => {
    const offDay = getOffDayForIndex(dayIndex);
    if (offDay?.isOnApprovedLeave) return true;
    const hasHours = Boolean(entry.time_started && entry.time_finished);
    return hasHours || entry.did_not_work;
  };

  const handleSaveDraft = async () => {
    await saveTimesheet('draft');
  };

  const handleSubmit = async () => {
    // Check for time validation errors (same start/end time)
    const daysWithTimeErrors = Object.keys(timeErrors).map(Number);
    if (daysWithTimeErrors.length > 0) {
      const dayName = DAY_NAMES[daysWithTimeErrors[0]];
      setError(`Please fix the time entry for ${dayName}: ${timeErrors[daysWithTimeErrors[0]]}`);
      setShowErrorDialog(true);
      // Switch to the day with the error on mobile
      if (daysWithTimeErrors[0] !== undefined) {
        setActiveDay(String(daysWithTimeErrors[0]));
      }
      return;
    }

    const entriesForValidation =
      offDayKey === currentOffDayKey && offDayStates.length > 0
        ? (normalizeTimesheetEntriesForOffDays(entries, offDayStates, {
            enforceLeaveOverwrite: true,
            applyNonShiftDefaults: true,
          }) as TimesheetEntryDraft[])
        : entries;
    const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));
    
    // Validate that ALL days have either hours OR "did not work" marked
    const allDaysComplete = entriesForValidation.every(entry => {
      const offDay = offDayByDay.get(entry.day_of_week);
      if (offDay?.isOnApprovedLeave) return true;
      const hasHours = entry.time_started && entry.time_finished;
      const markedDidNotWork = entry.did_not_work;
      return hasHours || markedDidNotWork;
    });
    
    if (!allDaysComplete) {
      setError('Please enter hours OR mark "Did Not Work" for ALL 7 days of the week');
      setShowErrorDialog(true);
      return;
    }

    const invalidHalfDayWindow = entriesForValidation.find((entry) => {
      const offDay = offDayByDay.get(entry.day_of_week);
      if (!offDay?.workWindow) return false;
      if (!entry.time_started || !entry.time_finished) return false;
      if (!isTimeWithinWorkWindow(entry.time_started, offDay.workWindow)) return true;
      if (!isTimeWithinWorkWindow(entry.time_finished, offDay.workWindow)) return true;
      if (isWorkWindowOvernight(offDay.workWindow)) return false;
      return toMinutes(entry.time_finished) < toMinutes(entry.time_started);
    });

    if (invalidHalfDayWindow) {
      const dayIndex = entriesForValidation.findIndex((entry) => entry.day_of_week === invalidHalfDayWindow.day_of_week);
      if (dayIndex !== -1) {
        const offDay = offDayByDay.get(invalidHalfDayWindow.day_of_week);
        setError(
          `${DAY_NAMES[dayIndex]}: Working time must be within ${offDay?.workWindow?.start} to ${offDay?.workWindow?.end}`
        );
        setShowErrorDialog(true);
        setActiveDay(String(dayIndex));
      }
      return;
    }

    // Validate that days marked "Did Not Work" with reason "Other" have remarks
    const invalidDidNotWorkDays = entriesForValidation.filter(entry => 
      entry.did_not_work && 
      !offDayByDay.get(entry.day_of_week)?.isOnApprovedLeave &&
      entry.didNotWorkReason === 'Other' && 
      (!entry.remarks || entry.remarks.trim().length === 0)
    );
    
    if (invalidDidNotWorkDays.length > 0) {
      const dayIndex = entriesForValidation.findIndex(e => e.day_of_week === invalidDidNotWorkDays[0].day_of_week);
      if (dayIndex !== -1) {
        const dayName = DAY_NAMES[dayIndex];
        setError(`${dayName}: When "Other" is selected for "Did Not Work", you must add a comment in the Notes / Remarks field`);
        setShowErrorDialog(true);
        setActiveDay(String(dayIndex));
      }
      return;
    }

    // Validate job numbers for all working days (unless working in yard)
    const jobNumberRegex = /^\d{4}-[A-Z]{2}$/;
    const allJobNumbersValid = entriesForValidation.every(entry => {
      const offDay = offDayByDay.get(entry.day_of_week);
      const hasHours = Boolean(entry.time_started && entry.time_finished);
      if (offDay?.isOnApprovedLeave && !hasHours) return true;
      if (entry.did_not_work) return true; // Skip validation for non-working days
      if (entry.working_in_yard) return true; // Skip validation for yard work
      if (!hasHours) return true;
      return entry.job_number && jobNumberRegex.test(entry.job_number);
    });
    
    if (!allJobNumbersValid) {
      setError('Please enter a valid Job Number (format: 1234-AB) for all working days (not required when working in yard)');
      setShowErrorDialog(true);
      return;
    }

    setEntries(entriesForValidation);
    
    // Show confirmation modal first (Phase 4)
    setShowConfirmationModal(true);
  };

  // After user confirms in modal, show signature dialog
  const handleConfirmSubmission = () => {
    setShowConfirmationModal(false);
    setShowSignatureDialog(true);
  };

  const handleSignatureComplete = async (sig: string) => {
    setShowSignatureDialog(false);
    await saveTimesheet('submitted', sig);
  };

  // Helper function to detect if a shift is a night shift
  // Night shift: Any shift over 9.5 hours that starts after 15:00
  const isNightShift = (timeStarted: string, dailyTotal: number | null): boolean => {
    if (!timeStarted || !dailyTotal) return false;
    
    const [hours] = timeStarted.split(':').map(Number);
    return dailyTotal > 9.5 && hours >= 15;
  };

  // Helper function to check if a date is a UK bank holiday
  // Uses data from GOV.UK API: https://www.gov.uk/bank-holidays.json
  const isUKBankHoliday = (date: Date): boolean => {
    // Format date as YYYY-MM-DD to match API format
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    return bankHolidays.has(dateString);
  };

  const saveTimesheet = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId) return;

    setError('');
    setSaving(true);

    try {
      const entriesForPersistence =
        offDayKey === currentOffDayKey && offDayStates.length > 0
          ? (normalizeTimesheetEntriesForOffDays(entries, offDayStates, {
              enforceLeaveOverwrite: true,
              applyNonShiftDefaults: true,
            }) as TimesheetEntryDraft[])
          : entries;
      const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));
      const invalidHalfDayWindow = entriesForPersistence.find((entry) => {
        const offDay = offDayByDay.get(entry.day_of_week);
        if (!offDay?.workWindow) return false;
        if (!entry.time_started || !entry.time_finished) return false;
        if (!isTimeWithinWorkWindow(entry.time_started, offDay.workWindow)) return true;
        if (!isTimeWithinWorkWindow(entry.time_finished, offDay.workWindow)) return true;
        if (isWorkWindowOvernight(offDay.workWindow)) return false;
        return toMinutes(entry.time_finished) < toMinutes(entry.time_started);
      });

      if (invalidHalfDayWindow) {
        const offDay = offDayByDay.get(invalidHalfDayWindow.day_of_week);
        throw new Error(`Working time must be within ${offDay?.workWindow?.start} to ${offDay?.workWindow?.end}`);
      }
      setEntries(entriesForPersistence);

      let timesheetId: string;

      // Update existing timesheet or create new one
      if (existingTimesheetId) {
        // Update existing timesheet
        type TimesheetUpdate = Database['public']['Tables']['timesheets']['Update'];
        const timesheetData: TimesheetUpdate = {
          timesheet_type: timesheetType,
          reg_number: regNumber || null,
          week_ending: weekEnding,
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          signature_data: signatureData || null,
          signed_at: signatureData ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        };

        const { data: timesheet, error: timesheetError } = await supabase
          .from('timesheets')
          .update(timesheetData)
          .eq('id', existingTimesheetId)
          .select()
          .single();

        if (timesheetError) throw timesheetError;
        if (!timesheet) throw new Error('Failed to update timesheet');
        
        timesheetId = timesheet.id;
      } else {
        // Insert new timesheet
        type TimesheetInsert = Database['public']['Tables']['timesheets']['Insert'];
        const timesheetData: TimesheetInsert = {
          user_id: selectedEmployeeId,
          timesheet_type: timesheetType,
          reg_number: regNumber || null,
          week_ending: weekEnding,
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          signature_data: signatureData || null,
          signed_at: signatureData ? new Date().toISOString() : null,
        };

        const { data: timesheet, error: timesheetError } = await supabase
          .from('timesheets')
          .insert(timesheetData)
          .select()
          .single();

        if (timesheetError) throw timesheetError;
        if (!timesheet) throw new Error('Failed to create timesheet');
        
        timesheetId = timesheet.id;
      }

      // Delete existing entries if updating
      if (existingTimesheetId) {
        const { error: deleteError } = await supabase
          .from('timesheet_entries')
          .delete()
          .eq('timesheet_id', timesheetId);
        
        if (deleteError) {
          console.error('Error deleting timesheet entries:', deleteError);
          throw new Error(`Failed to delete timesheet entries: ${deleteError.message}`);
        }
      }

      // Prepare entries - save all 7 days (including those marked as did_not_work)
      type TimesheetEntryInsert = Database['public']['Tables']['timesheet_entries']['Insert'];
      const entriesToInsert: TimesheetEntryInsert[] = entriesForPersistence.map((entry) => {
          const entryDate = getTimesheetEntryDateFromWeekEnding(weekEnding, entry.day_of_week);
          const offDay = offDayByDay.get(entry.day_of_week);
          
          // Automatically detect night shift and bank holiday
          const isNight = !entry.did_not_work && isNightShift(entry.time_started, entry.daily_total);
          const isBankHol = !entry.did_not_work && isUKBankHoliday(entryDate);
          const normalizedRemarks =
            entry.remarks?.trim() ||
            (entry.did_not_work
              ? (offDay && !offDay.isExpectedShiftDay ? 'Not on Shift' : 'Did Not Work')
              : '');
          
          return {
            timesheet_id: timesheetId,
            day_of_week: entry.day_of_week,
            time_started: entry.time_started || null,
            time_finished: entry.time_finished || null,
            job_number: entry.job_number || null,
            working_in_yard: entry.working_in_yard,
            did_not_work: entry.did_not_work,
            night_shift: isNight,
            bank_holiday: isBankHol,
            daily_total: entry.daily_total,
            remarks: normalizedRemarks || null,
          };
        });

      // Insert all entries (all 7 days)
      const { error: entriesError } = await supabase
        .from('timesheet_entries')
        .insert(entriesToInsert);

      if (entriesError) {
        console.error('Error inserting timesheet entries:', entriesError);
        throw new Error(`Failed to insert timesheet entries: ${entriesError.message}`);
      }

      // Show success message
      if (status === 'draft') {
        toast.success('Timesheet saved as draft', {
          description: 'Your timesheet has been saved and can be edited later.',
        });
      } else {
        toast.success('Timesheet submitted', {
          description: 'Your timesheet has been submitted for approval.',
        });
      }

      router.push('/timesheets');
    } catch (err: unknown) {
      console.error('Error saving timesheet:', err);
      console.error('Error details:', JSON.stringify(err, null, 2));
      
      // Handle errors
      const error = err as { code?: string; message?: string; details?: string; hint?: string };
      
      if (error?.code === '23505' || error?.message?.includes('duplicate key') || error?.message?.includes('timesheets_user_id_week_ending_key')) {
        // Only handle duplicate error if we're not updating an existing timesheet
        if (!existingTimesheetId) {
          // Find the existing timesheet and redirect user to edit it
          try {
            const { data: existingTimesheet } = await supabase
              .from('timesheets')
              .select('id')
              .eq('user_id', selectedEmployeeId)
              .eq('week_ending', weekEnding)
              .single();
            
            if (existingTimesheet) {
              toast.error('Timesheet already exists for this week', {
                description: 'Redirecting you to the existing timesheet...',
                duration: 3000,
              });
              
              // Redirect to the existing timesheet after a short delay
              setTimeout(() => {
                router.push(`/timesheets/new?id=${existingTimesheet.id}`);
              }, 1500);
              return; // Exit early, don't show error dialog
            }
          } catch (queryError) {
            console.error('Error finding existing timesheet:', queryError);
          }
          
          // Fallback error message if we couldn't find the existing timesheet
          setError('A timesheet already exists for this week. Please go back to the timesheets list to view or edit the existing timesheet, or select a different week ending date.');
        } else {
          setError('Failed to update timesheet. Please try again or contact support if the problem persists.');
        }
      } else if (error?.code === '42501' || error?.message?.includes('row-level security')) {
        const errorMessage = error?.message || 'Unknown permission error';
        setError(`Permission denied: ${errorMessage}. This may be due to missing database permissions. Please contact your administrator to run the RLS policy migration.`);
      } else if (error?.message) {
        setError(`${error.message}${error.details ? ` - ${error.details}` : ''}`);
      } else {
        setError('Failed to save timesheet. Please try again or contact support if the problem persists.');
      }
      setShowErrorDialog(true);
    } finally {
      setSaving(false);
    }
  };

  const waitingForOffDayData =
    !currentOffDayKey ||
    loadingOffDays ||
    offDayKey !== currentOffDayKey;

  if (!existingTimesheetLoaded || waitingForOffDayData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-timesheet mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Loading timesheets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-32 md:pb-6 w-full max-w-[1400px] mx-auto">
      
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link href="/timesheets">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 md:w-auto md:px-3 hover:bg-slate-100 dark:hover:bg-slate-800">
                <ArrowLeft className="h-5 w-5 md:mr-2" />
                <span className="hidden md:inline">Back</span>
              </Button>
            </Link>
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">
                {timesheetHeaderTitle}
              </h1>
              <p className="text-sm text-muted-foreground hidden md:block">
                {profile?.full_name}
              </p>
            </div>
          </div>
          {/* Weekly Total Badge */}
          <div className="bg-timesheet/10 dark:bg-timesheet/20 border border-timesheet/30 rounded-lg px-3 py-2">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-bold text-foreground whitespace-pre-line text-right">{weeklyTotalMultiline}</div>
          </div>
        </div>
      </div>

      {/* Manager Comments (for rejected timesheets) */}
      {managerComments && (
        <Card className="bg-white dark:bg-slate-900 border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-400 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Manager Comments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-amber-800 dark:text-amber-300 whitespace-pre-wrap">{managerComments}</p>
          </CardContent>
        </Card>
      )}

      {timesheetType === 'plant' && (
        <Card className="border-blue-400/40 bg-blue-500/10">
          <CardContent className="pt-4">
            <p className="text-sm text-blue-100">
              Plant timesheet routing is active for this team. This entry will be saved as a plant timesheet.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Basic Info Card */}
      <Card className="">
        <CardHeader className="pb-4">
          <CardTitle className="text-foreground">{detailsTitle}</CardTitle>
          <CardDescription className="text-muted-foreground">
            Week ending {new Date(weekEnding).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Manager/Admin: Employee Selector */}
          {hasElevatedPermissions && (
            <div className="space-y-2 pb-4 border-b border-border">
              <Label htmlFor="employee" className="text-foreground text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating timesheet for
              </Label>
              <Select
                value={selectedEmployeeId}
                onValueChange={handleSelectedEmployeeChange}
                disabled={Boolean(existingTimesheetId)}
              >
                <SelectTrigger className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id} disabled={employee.has_module_access === false}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                      {employee.id === user?.id && ' (You)'}
                      {employee.has_module_access === false && ' - No Timesheets access'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select which employee this timesheet is for
              </p>
            </div>
          )}
          
          {/* Vehicle Registration */}
          <div className="space-y-2 max-w-full">
            <Label htmlFor="reg_number" className="text-foreground text-lg">{registrationLabel}</Label>
            
            {/* Show suggestion prompt if available and not dismissed */}
            {showSuggestedVehiclePrompt && !vehiclePromptDismissed && suggestedRegNumber && !regNumber ? (
              <div className="space-y-3">
                <p className="text-lg text-muted-foreground">
                  Still using this vehicle: <span className="font-semibold text-white">{suggestedRegNumber}</span>?
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleVehicleSuggestionYes}
                    className="flex items-center justify-center h-24 rounded-lg border-2 bg-slate-800/30 border-slate-700 hover:bg-slate-800/50 transition-all"
                  >
                    <span className="text-xl font-medium text-foreground">Yes</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleVehicleSuggestionNo}
                    className="flex items-center justify-center h-24 rounded-lg border-2 bg-slate-800/30 border-slate-700 hover:bg-slate-800/50 transition-all"
                  >
                    <span className="text-xl font-medium text-foreground">No</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="max-w-full overflow-hidden">
                  <Input
                    id="reg_number"
                    type="text"
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value.toUpperCase())}
                    placeholder="e.g., AB12 CDE"
                    className="h-12 text-lg bg-slate-900/50 border-slate-600 text-white w-full uppercase"
                  />
                </div>
                <p className="text-sm text-muted-foreground">Enter the vehicle registration you used this week (if applicable)</p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Daily Hours - Tabbed Interface (Mobile) / Table (Desktop) */}
      <Card className="">
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground">Daily Hours</CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-6">

          {/* Mobile Tabbed View */}
          <div className="md:hidden">
            <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
              <TabsList className="grid w-full grid-cols-7 bg-slate-900/50 p-1 rounded-lg mb-4 h-auto">
                {DAY_NAMES.map((day, index) => {
                  const isComplete = isEntryComplete(entries[index], index);
                  return (
                    <TabsTrigger 
                      key={index} 
                      value={String(index)}
                      className={`text-sm py-3 data-[state=active]:bg-timesheet data-[state=active]:text-slate-900 text-muted-foreground ${
                        isComplete 
                          ? 'data-[state=active]:outline data-[state=active]:outline-2 data-[state=active]:outline-green-500 data-[state=active]:-outline-offset-2 outline outline-2 outline-green-500/50 -outline-offset-2' 
                          : 'data-[state=active]:outline data-[state=active]:outline-2 data-[state=active]:outline-white data-[state=active]:-outline-offset-2'
                      }`}
                    >
                      {day.substring(0, 3)}
                      {isComplete && (
                        <Check className="h-4 w-4 ml-1" />
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {entries.map((entry, index) => {
                const dayOffState = getOffDayForIndex(index);
                const isLeaveLocked = Boolean(dayOffState?.isLeaveLocked);
                const isLeaveDayForRow = Boolean(dayOffState?.isOnApprovedLeave);
                const isPartialLeave = Boolean(dayOffState?.isPartialLeave);
                const workWindow = dayOffState?.workWindow ?? null;
                const disableForDidNotWork = entry.did_not_work && !isPartialLeave;
                const disableWorkingInputs = isLeaveLocked || disableForDidNotWork;

                return (
                <TabsContent key={index} value={String(index)} className="space-y-4 px-4 pb-4 overflow-hidden">
                  <div className="text-center mb-4">
                    <h3 className="text-3xl font-bold text-foreground">{DAY_NAMES[index]}</h3>
                    <p className="text-xl font-semibold text-timesheet">
                      {leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display ?? `${formatHours(entry.daily_total)}h`}
                    </p>
                  </div>

                  <div className="space-y-4 max-w-full">
                    {/* Start and Finish Time - Side by Side on Mobile */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="text-foreground text-xl">Start Time</Label>
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_started}
                          onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                          disabled={disableWorkingInputs}
                          min={workWindow?.start}
                          max={workWindow?.end}
                          className={`h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white w-full disabled:opacity-30 disabled:cursor-not-allowed ${
                            timeErrors[index] ? 'border-red-500' : ''
                          }`}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-foreground text-xl">Finish Time</Label>
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_finished}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          disabled={disableWorkingInputs}
                          min={workWindow?.start}
                          max={workWindow?.end}
                          className={`h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white w-full disabled:opacity-30 disabled:cursor-not-allowed ${
                            timeErrors[index] ? 'border-red-500' : ''
                          }`}
                        />
                      </div>
                    </div>
                    {timeErrors[index] && (
                      <p className="text-base text-red-400 flex items-center gap-1 -mt-2">
                        <AlertCircle className="h-4 w-4" />
                        {timeErrors[index]}
                      </p>
                    )}

                    <div className="space-y-2">
                      <Label className="text-foreground text-xl flex items-center gap-2">
                        Job Number
                        {!entry.working_in_yard && <span className="text-red-400 text-lg">*</span>}
                        {entry.working_in_yard && <span className="text-muted-foreground text-base">(Not required - working in yard)</span>}
                      </Label>
                      <Input
                        value={entry.job_number}
                        onChange={(e) => handleJobNumberChange(index, e.target.value)}
                        placeholder={entry.working_in_yard ? "N/A (Yard)" : "1234-AB"}
                        maxLength={7}
                        disabled={disableWorkingInputs || entry.working_in_yard}
                        className="h-16 text-3xl text-center bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground uppercase disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </div>

                    {/* Status Buttons */}
                    <div className="space-y-3">
                      <Label className="text-foreground text-xl">Status</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {/* Working in Yard Button */}
                        <button
                          type="button"
                          onClick={() => updateEntry(index, 'working_in_yard', !entry.working_in_yard)}
                          disabled={disableWorkingInputs}
                          className={`flex flex-col items-center justify-center h-24 rounded-lg border-2 transition-all ${
                            entry.working_in_yard
                              ? 'bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20'
                              : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          <Home className={`h-8 w-8 mb-2 ${entry.working_in_yard ? 'text-blue-400' : 'text-muted-foreground'}`} />
                          <span className={`text-lg font-medium ${entry.working_in_yard ? 'text-blue-400' : 'text-muted-foreground'}`}>
                            In Yard
                          </span>
                        </button>

                        {/* Did Not Work Button */}
                        <button
                          type="button"
                          onClick={() => updateEntry(index, 'did_not_work', !entry.did_not_work)}
                          disabled={isLeaveDayForRow}
                          className={`flex flex-col items-center justify-center h-24 rounded-lg border-2 transition-all ${
                            entry.did_not_work
                              ? 'bg-amber-500/20 border-amber-500 shadow-lg shadow-amber-500/20'
                              : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          <XCircle className={`h-8 w-8 mb-2 ${entry.did_not_work ? 'text-amber-400' : 'text-muted-foreground'}`} />
                          <span className={`text-lg font-medium ${entry.did_not_work ? 'text-amber-400' : 'text-muted-foreground'}`}>
                            Did Not Work
                          </span>
                        </button>
                      </div>
                      
                      {(dayOffState?.leaveLabels.length || entry.did_not_work) ? (
                        <div className="flex justify-center">
                          {dayOffState?.leaveLabels.length ? (
                            <div className="space-y-1 text-center">
                              {dayOffState.leaveLabels.map((label, labelIndex) => (
                                <p
                                  key={`${label.reasonName}-${label.session}-${labelIndex}`}
                                  className="text-sm font-semibold text-amber-400"
                                  style={getLeaveLabelStyle(label.color)}
                                >
                                  {label.label}
                                </p>
                              ))}
                              {dayOffState.workWindow && (
                                <p className="text-xs text-muted-foreground">
                                  Working hours allowed: {dayOffState.workWindow.start} to {dayOffState.workWindow.end}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p
                              className="text-sm text-center font-semibold text-amber-400"
                              style={getDidNotWorkAutoStyle(dayOffState)}
                            >
                              {getDidNotWorkAutoLabel(dayOffState)}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label className="text-foreground text-xl">Remarks</Label>
                      <Input
                        value={entry.remarks}
                        onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                        placeholder="Notes"
                        disabled={isLeaveDayForRow}
                        className="h-16 text-2xl bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground w-full disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </div>

                  </div>
                </TabsContent>
              )})}
            </Tabs>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-medium text-white">Day</th>
                  <th className="text-left p-3 font-medium text-white">Time Started</th>
                  <th className="text-left p-3 font-medium text-white">Time Finished</th>
                  <th className="text-left p-3 font-medium text-white">Job Number</th>
                  <th className="text-center p-3 font-medium text-white w-32">Status</th>
                  <th className="text-right p-3 font-medium text-white">Total Hours</th>
                  <th className="text-left p-3 font-medium text-white">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const dayOffState = getOffDayForIndex(index);
                  const isLeaveLocked = Boolean(dayOffState?.isLeaveLocked);
                  const isLeaveDayForRow = Boolean(dayOffState?.isOnApprovedLeave);
                  const isPartialLeave = Boolean(dayOffState?.isPartialLeave);
                  const workWindow = dayOffState?.workWindow ?? null;
                  const disableForDidNotWork = entry.did_not_work && !isPartialLeave;
                  const disableWorkingInputs = isLeaveLocked || disableForDidNotWork;

                  return (
                  <tr key={entry.day_of_week} className="border-b border-border/50">
                    <td className="p-3 font-medium text-white">{DAY_NAMES[index]}</td>
                    <td className="p-3">
                      <Input
                        type="time"
                        step="900"
                        value={entry.time_started}
                        onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                        disabled={disableWorkingInputs}
                        min={workWindow?.start}
                        max={workWindow?.end}
                        className={`w-32 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed ${
                          timeErrors[index] ? 'border-red-500' : ''
                        }`}
                      />
                    </td>
                    <td className="p-3">
                      <div className="space-y-1">
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_finished}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          disabled={disableWorkingInputs}
                          min={workWindow?.start}
                          max={workWindow?.end}
                          className={`w-32 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed ${
                            timeErrors[index] ? 'border-red-500' : ''
                          }`}
                        />
                        {timeErrors[index] && (
                          <p className="text-xs text-red-400 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {timeErrors[index]}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <Input
                        value={entry.job_number}
                        onChange={(e) => handleJobNumberChange(index, e.target.value)}
                        placeholder={entry.working_in_yard ? "N/A (Yard)" : "1234-AB"}
                        maxLength={7}
                        disabled={disableWorkingInputs || entry.working_in_yard}
                        className="w-28 bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground uppercase disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="p-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-center gap-2">
                          {/* In Yard Button */}
                          <button
                            type="button"
                            onClick={() => updateEntry(index, 'working_in_yard', !entry.working_in_yard)}
                            disabled={disableWorkingInputs}
                            className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all ${
                              entry.working_in_yard
                                ? 'bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20'
                                : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                            title="Working in Yard"
                          >
                            <Home className={`h-5 w-5 ${entry.working_in_yard ? 'text-blue-400' : 'text-muted-foreground'}`} />
                          </button>

                          {/* Did Not Work Button */}
                          <button
                            type="button"
                            onClick={() => updateEntry(index, 'did_not_work', !entry.did_not_work)}
                            disabled={isLeaveDayForRow}
                            className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all ${
                              entry.did_not_work
                                ? 'bg-amber-500/20 border-amber-500 shadow-lg shadow-amber-500/20'
                                : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                            title="Did Not Work"
                          >
                            <XCircle className={`h-5 w-5 ${entry.did_not_work ? 'text-amber-400' : 'text-muted-foreground'}`} />
                          </button>
                        </div>
                        
                        {(dayOffState?.leaveLabels.length || entry.did_not_work) ? (
                          <div className="flex justify-center">
                            {dayOffState?.leaveLabels.length ? (
                              <div className="space-y-1 text-center">
                                {dayOffState.leaveLabels.map((label, labelIndex) => (
                                  <p
                                    key={`${label.reasonName}-${label.session}-${labelIndex}`}
                                    className="text-[10px] font-semibold text-amber-400"
                                    style={getLeaveLabelStyle(label.color)}
                                  >
                                    {label.label}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p
                                className="text-[10px] text-center font-semibold text-amber-400"
                                style={getDidNotWorkAutoStyle(dayOffState)}
                              >
                                {getDidNotWorkAutoLabel(dayOffState)}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3 text-right font-semibold text-timesheet">
                      {leaveAwareTotals.rowByDay.get(entry.day_of_week)?.display ?? `${formatHours(entry.daily_total)}h`}
                    </td>
                    <td className="p-3">
                      <Input
                        value={entry.remarks}
                        onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                        placeholder="Notes"
                        disabled={isLeaveDayForRow}
                        className="bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>
                  </tr>
                )})}
                <tr className="bg-timesheet/10 font-bold">
                  <td colSpan={5} className="p-3 text-right text-white">
                    Weekly Total:
                  </td>
                  <td className="p-3 text-right text-lg text-timesheet whitespace-pre-line">
                    {weeklyTotalMultiline}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

        </CardContent>
      </Card>

      {/* Confirmation Text - Desktop Only */}
      <div className="hidden md:block p-4 bg-slate-800/40 border border-border/50 rounded-lg backdrop-blur-xl">
        <p className="text-sm text-muted-foreground italic">
          ✓ All time and other details are correct and should be used as a basis for wages etc.
        </p>
      </div>

      {/* Desktop Action Buttons */}
      <div className="hidden md:flex flex-row gap-3 justify-end">
        <Button
          variant="outline"
          onClick={handleSaveDraft}
          disabled={saving}
          className="border-slate-600 text-white hover:bg-slate-800"
        >
          <Save className="h-4 w-4 mr-2" />
          Save Draft
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-timesheet hover:bg-timesheet/90 text-slate-900 font-semibold"
        >
          {saving ? 'Submitting...' : 'Submit Timesheet'}
        </Button>
      </div>

      {/* Mobile Sticky Footer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-border/50 p-4 z-20">
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex-1 h-14 border-slate-600 text-white hover:bg-slate-800"
          >
            <Save className="h-5 w-5 mr-2" />
            Save Draft
          </Button>
          <Button
            onClick={() => {
              // Check if all days are complete - use same logic as handleSubmit validation
              const allDaysComplete = entries.every(entry => {
                const idx = entry.day_of_week - 1;
                return isEntryComplete(entry, idx);
              });

              if (allDaysComplete) {
                handleSubmit();
              } else {
                // Find next incomplete day
                const currentIndex = parseInt(activeDay);
                const nextIncompleteIndex = entries.findIndex((entry, idx) => {
                  return idx > currentIndex && !isEntryComplete(entry, idx);
                });
                
                // If no incomplete days after current, wrap to first incomplete
                const finalIndex = nextIncompleteIndex !== -1 
                  ? nextIncompleteIndex 
                  : entries.findIndex(entry => {
                    const idx = entry.day_of_week - 1;
                    return !isEntryComplete(entry, idx);
                  });
                
                if (finalIndex !== -1) {
                  setActiveDay(String(finalIndex));
                }
              }
            }}
            disabled={saving}
            className="flex-1 h-14 bg-timesheet hover:bg-timesheet/90 text-slate-900 font-semibold text-base"
          >
            {saving ? 'Submitting...' : (() => {
              // Use same validation logic as handleSubmit
              const allDaysComplete = entries.every(entry => {
                const idx = entry.day_of_week - 1;
                return isEntryComplete(entry, idx);
              });
              return allDaysComplete ? 'Submit' : 'Next';
            })()}
          </Button>
        </div>
      </div>

      {/* Confirmation Modal (Phase 4) */}
      <ConfirmationModal
        open={showConfirmationModal}
        onClose={() => setShowConfirmationModal(false)}
        onConfirm={handleConfirmSubmission}
        weekEnding={weekEnding}
        entries={entries}
        offDayStates={offDayStates}
        regNumber={regNumber}
        submitting={false}
      />

      {/* Signature Dialog */}
      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="border-border text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Timesheet</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Please sign below to confirm your timesheet is accurate
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SignaturePad
              onSave={handleSignatureComplete}
              onCancel={() => setShowSignatureDialog(false)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSignatureDialog(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error Dialog */}
      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent className="bg-slate-900 border-red-500/50 text-white max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 border border-red-500/50">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <DialogTitle className="text-white text-xl">Error</DialogTitle>
            </div>
            <DialogDescription className="text-muted-foreground text-base pt-2">
              {error}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              onClick={() => {
                setShowErrorDialog(false);
                setError('');
              }}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bank Holiday Warning Dialog */}
      <Dialog open={showBankHolidayWarning} onOpenChange={setShowBankHolidayWarning}>
        <DialogContent className="bg-slate-900 border-yellow-500/50 text-white max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/20 border border-yellow-500/50">
                <AlertCircle className="h-5 w-5 text-yellow-400" />
              </div>
              <DialogTitle className="text-white text-xl">Bank Holiday Warning</DialogTitle>
            </div>
            <DialogDescription className="text-muted-foreground text-base pt-2">
              <span className="font-semibold text-yellow-400">{bankHolidayDate}</span> is a bank holiday.
              <br />
              <br />
              Are you sure you worked on this day?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-3 sm:gap-3">
            <Button
              onClick={handleBankHolidayNo}
              variant="outline"
              className="flex-1 border-slate-600 text-white hover:bg-slate-800"
            >
              No
            </Button>
            <Button
              onClick={handleBankHolidayYes}
              className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold"
            >
              Yes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Default export for the component
export default CivilsTimesheet;
