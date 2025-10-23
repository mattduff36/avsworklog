'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Save, Check, AlertCircle, CheckCircle2, XCircle, Home, User } from 'lucide-react';
import Link from 'next/link';
import { getWeekEnding, formatDateISO } from '@/lib/utils/date';
import { calculateHours, formatHours } from '@/lib/utils/time-calculations';
import { DAY_NAMES } from '@/types/timesheet';
import { Database } from '@/types/database';
import { SignaturePad } from '@/components/forms/SignaturePad';

type Employee = {
  id: string;
  full_name: string;
  employee_id: string | null;
};

export default function NewTimesheetPage() {
  const router = useRouter();
  const { user, profile, isManager } = useAuth();
  const supabase = createClient();
  
  const [regNumber, setRegNumber] = useState('');
  const [weekEnding, setWeekEnding] = useState(formatDateISO(getWeekEnding()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeDay, setActiveDay] = useState('0');
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [existingWeeks, setExistingWeeks] = useState<string[]>([]);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  
  // Manager-specific states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  // Initialize entries for all 7 days
  const [entries, setEntries] = useState(
    Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i + 1,
      time_started: '',
      time_finished: '',
      job_number: '',
      working_in_yard: false,
      did_not_work: false,
      daily_total: null as number | null,
      remarks: '',
    }))
  );

  // Fetch employees if manager, and set initial selected employee
  useEffect(() => {
    if (user && isManager) {
      fetchEmployees();
    } else if (user) {
      // If not a manager, set selected employee to current user
      setSelectedEmployeeId(user.id);
    }
  }, [user, isManager]);

  // Fetch existing timesheets when selected employee changes
  useEffect(() => {
    if (selectedEmployeeId) {
      fetchExistingTimesheets();
    }
  }, [selectedEmployeeId]);

  // Handle job number input with auto-dash formatting (NNNN-LL format)
  const handleJobNumberChange = (index: number, value: string) => {
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
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .order('full_name');
      
      if (error) throw error;
      
      setEmployees(data || []);
      
      // Set default to current user
      if (user) {
        setSelectedEmployeeId(user.id);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  };

  const fetchExistingTimesheets = async () => {
    if (!selectedEmployeeId) return;
    
    try {
      const { data, error } = await supabase
        .from('timesheets')
        .select('week_ending')
        .eq('user_id', selectedEmployeeId);
      
      if (error) throw error;
      
      // Store existing week ending dates
      const weeks = data?.map(t => t.week_ending) || [];
      setExistingWeeks(weeks);
    } catch (err) {
      console.error('Error fetching existing timesheets:', err);
    }
  };

  // Check if a date is a Sunday
  const isSunday = (dateString: string): boolean => {
    const date = new Date(dateString + 'T00:00:00');
    return date.getDay() === 0;
  };

  // Check if week already has a timesheet
  const weekExists = (dateString: string): boolean => {
    return existingWeeks.includes(dateString);
  };

  // Handle week ending date change with validation
  const handleWeekEndingChange = (newDate: string) => {
    setError(''); // Clear any previous errors
    
    if (!newDate) {
      setWeekEnding(newDate);
      return;
    }

    // Check if it's a Sunday
    if (!isSunday(newDate)) {
      setError('Week Ending must be a Sunday. Please select a Sunday date.');
      setShowErrorDialog(true);
      return;
    }

    // Check if week already exists
    if (weekExists(newDate)) {
      setError('You already have a timesheet for this week. Please select a different week.');
      setShowErrorDialog(true);
      return;
    }

    setWeekEnding(newDate);
  };

  // Validate and round time to nearest 15-minute interval
  const roundToQuarterHour = (timeString: string): string => {
    if (!timeString) return timeString;
    
    const [hours, minutes] = timeString.split(':').map(Number);
    const roundedMinutes = Math.round(minutes / 15) * 15;
    
    // Handle 60 minutes (round to next hour)
    if (roundedMinutes === 60) {
      const newHours = (hours + 1) % 24;
      return `${String(newHours).padStart(2, '0')}:00`;
    }
    
    return `${String(hours).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
  };

  // Calculate hours when times change
  const updateEntry = (dayIndex: number, field: string, value: string | boolean) => {
    const newEntries = [...entries];
    
    // Special handling for "did_not_work" toggle
    if (field === 'did_not_work' && value === true) {
      newEntries[dayIndex] = {
        ...newEntries[dayIndex],
        did_not_work: true,
        time_started: '',
        time_finished: '',
        working_in_yard: false,
        daily_total: 0,
      };
    } else {
      // Round time inputs to 15-minute intervals
      if ((field === 'time_started' || field === 'time_finished') && typeof value === 'string') {
        value = roundToQuarterHour(value);
      }
      
      newEntries[dayIndex] = {
        ...newEntries[dayIndex],
        [field]: value,
      };

      // Auto-calculate daily total if both times are present
      if (field === 'time_started' || field === 'time_finished') {
        const entry = newEntries[dayIndex];
        let hours = calculateHours(entry.time_started, entry.time_finished);
        
        // Auto-deduct 30 mins (0.5 hours) for lunch break if daily total > 5 hours
        if (hours !== null && hours > 5) {
          hours = hours - 0.5;
        }
        
        newEntries[dayIndex].daily_total = hours;
      }
    }

    setEntries(newEntries);
  };

  // Calculate weekly total
  const weeklyTotal = entries.reduce((sum, entry) => {
    return sum + (entry.daily_total || 0);
  }, 0);

  const handleSaveDraft = async () => {
    await saveTimesheet('draft');
  };

  const handleSubmit = async () => {
    // Validate that ALL days have either hours OR "did not work" marked
    const allDaysComplete = entries.every(entry => {
      const hasHours = entry.time_started && entry.time_finished;
      const markedDidNotWork = entry.did_not_work;
      return hasHours || markedDidNotWork;
    });
    
    if (!allDaysComplete) {
      setError('Please enter hours OR mark "Did Not Work" for ALL 7 days of the week');
      setShowErrorDialog(true);
      return;
    }

    // Validate job numbers for all working days (unless working in yard)
    const jobNumberRegex = /^\d{4}-[A-Z]{2}$/;
    const allJobNumbersValid = entries.every(entry => {
      if (entry.did_not_work) return true; // Skip validation for non-working days
      if (entry.working_in_yard) return true; // Skip validation for yard work
      return entry.job_number && jobNumberRegex.test(entry.job_number);
    });
    
    if (!allJobNumbersValid) {
      setError('Please enter a valid Job Number (format: 1234-AB) for all working days (not required when working in yard)');
      setShowErrorDialog(true);
      return;
    }
    
    // Show signature dialog
    setShowSignatureDialog(true);
  };

  const handleSignatureComplete = async (sig: string) => {
    setSignature(sig);
    setShowSignatureDialog(false);
    await saveTimesheet('submitted', sig);
  };

  const saveTimesheet = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId) return;

    setError('');
    setSaving(true);

    try {
      // Insert timesheet
      type TimesheetInsert = Database['public']['Tables']['timesheets']['Insert'];
      const timesheetData: TimesheetInsert = {
        user_id: selectedEmployeeId, // Use selected employee ID (can be manager's own ID or another employee's)
        reg_number: regNumber || null,
        week_ending: weekEnding,
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        signature_data: signatureData || null,
        signed_at: signatureData ? new Date().toISOString() : null,
      };

      console.log('Attempting to insert timesheet:', timesheetData);

      const { data: timesheet, error: timesheetError } = await supabase
        .from('timesheets')
        .insert(timesheetData)
        .select()
        .single();

      console.log('Timesheet insert result:', { timesheet, timesheetError });

      if (timesheetError) throw timesheetError;
      if (!timesheet) throw new Error('Failed to create timesheet');

      // Insert entries (only those with data or marked as did_not_work)
      type TimesheetEntryInsert = Database['public']['Tables']['timesheet_entries']['Insert'];
      const entriesToInsert: TimesheetEntryInsert[] = entries
        .filter(entry => entry.time_started || entry.time_finished || entry.remarks || entry.did_not_work)
        .map(entry => ({
          timesheet_id: timesheet.id,
          day_of_week: entry.day_of_week,
          time_started: entry.time_started || null,
          time_finished: entry.time_finished || null,
          job_number: entry.job_number || null,
          working_in_yard: entry.working_in_yard,
          did_not_work: entry.did_not_work,
          daily_total: entry.daily_total,
          remarks: entry.remarks || null,
        }));

      console.log('Entries to insert:', entriesToInsert);

      if (entriesToInsert.length > 0) {
        const { error: entriesError } = await supabase
          .from('timesheet_entries')
          .insert(entriesToInsert);

        console.log('Entries insert result:', { entriesError });

        if (entriesError) throw entriesError;
      }

      router.push('/timesheets');
    } catch (err: unknown) {
      console.error('Error saving timesheet:', err);
      console.error('Error details:', JSON.stringify(err, null, 2));
      
      // Handle errors
      const error = err as { code?: string; message?: string; details?: string; hint?: string };
      
      if (error?.code === '23505' || error?.message?.includes('duplicate key') || error?.message?.includes('timesheets_user_id_week_ending_key')) {
        setError('A timesheet already exists for this week. Please go back to the timesheets list to view or edit the existing timesheet, or select a different week ending date.');
      } else if (error?.code === '42501' || error?.message?.includes('row-level security')) {
        setError('Permission denied. You may not have permission to create this timesheet. Please contact your administrator.');
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

  return (
    <div className="space-y-4 pb-32 md:pb-6 max-w-5xl">
      {/* Header - Sticky on mobile */}
      <div className="sticky top-0 z-10 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 pb-4 -mx-4 px-4 md:static md:bg-transparent md:mx-0 md:px-0">
        <div className="flex items-center justify-between pt-4 md:pt-0">
          <div className="flex items-center space-x-3">
            <Link href="/timesheets">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 md:w-auto md:px-3">
                <ArrowLeft className="h-5 w-5 md:mr-2" />
                <span className="hidden md:inline">Back</span>
              </Button>
            </Link>
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-white">New Timesheet</h1>
              <p className="text-sm text-slate-400 hidden md:block">
                {profile?.full_name}
              </p>
            </div>
          </div>
          {/* Weekly Total Badge - Mobile */}
          <div className="md:hidden bg-timesheet/20 border border-timesheet/30 rounded-lg px-3 py-2">
            <div className="text-xs text-slate-400">Total</div>
            <div className="text-lg font-bold text-white">{formatHours(weeklyTotal)}h</div>
          </div>
        </div>
      </div>


      {/* Basic Info Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-white">Timesheet Details</CardTitle>
          <CardDescription className="text-slate-400">
            Week ending {new Date(weekEnding).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Manager: Employee Selector */}
          {isManager && (
            <div className="space-y-2 pb-4 border-b border-slate-700">
              <Label htmlFor="employee" className="text-white text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating timesheet for
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                      {employee.id === user?.id && ' (You)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                Select which employee this timesheet is for
              </p>
            </div>
          )}
          
          <div className="space-y-2 max-w-full">
            <Label htmlFor="week_ending" className="text-white text-base">Week Ending (Sunday)</Label>
            <div className="max-w-full overflow-hidden">
              <Input
                id="week_ending"
                type="date"
                value={weekEnding}
                onChange={(e) => handleWeekEndingChange(e.target.value)}
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white w-full"
              />
            </div>
            <p className="text-xs text-slate-400">Please select a Sunday that you haven&apos;t already submitted</p>
          </div>
        </CardContent>
      </Card>

      {/* Daily Hours - Tabbed Interface (Mobile) / Table (Desktop) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-white">Daily Hours</CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-6">

          {/* Mobile Tabbed View */}
          <div className="md:hidden">
            <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
              <TabsList className="grid w-full grid-cols-7 bg-slate-900/50 p-1 rounded-lg mb-4">
                {DAY_NAMES.map((day, index) => {
                  const isComplete = entries[index].did_not_work || (entries[index].daily_total && entries[index].daily_total! > 0);
                  return (
                    <TabsTrigger 
                      key={index} 
                      value={String(index)}
                      className={`text-xs py-3 data-[state=active]:bg-timesheet data-[state=active]:text-slate-900 text-slate-400 ${
                        isComplete 
                          ? 'data-[state=active]:border-2 data-[state=active]:border-green-500 border-2 border-green-500/50' 
                          : 'data-[state=active]:border-2 data-[state=active]:border-white'
                      }`}
                    >
                      {day.substring(0, 3)}
                      {!entries[index].did_not_work && entries[index].daily_total && entries[index].daily_total! > 0 && (
                        <Check className="h-3 w-3 ml-1" />
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {entries.map((entry, index) => (
                <TabsContent key={index} value={String(index)} className="space-y-4 px-4 pb-4 overflow-hidden">
                  <div className="text-center mb-4">
                    <h3 className="text-2xl font-bold text-white">{DAY_NAMES[index]}</h3>
                    <p className="text-lg font-semibold text-timesheet">
                      {entry.daily_total !== null ? formatHours(entry.daily_total) : '0.00'}h
                    </p>
                  </div>

                  <div className="space-y-4 max-w-full">
                    <div className="space-y-2 max-w-full">
                      <Label className="text-white text-lg">Start Time</Label>
                      <div className="max-w-full overflow-hidden">
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_started}
                          onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                          disabled={entry.did_not_work}
                          className="h-14 text-lg bg-slate-900/50 border-slate-600 text-white w-full disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 max-w-full">
                      <Label className="text-white text-lg">Finish Time</Label>
                      <div className="max-w-full overflow-hidden">
                        <Input
                          type="time"
                          step="900"
                          value={entry.time_finished}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          disabled={entry.did_not_work}
                          className="h-14 text-lg bg-slate-900/50 border-slate-600 text-white w-full disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-white text-lg flex items-center gap-2">
                        Job Number
                        {!entry.working_in_yard && <span className="text-red-400 text-base">*</span>}
                        {entry.working_in_yard && <span className="text-slate-500 text-sm">(Not required - working in yard)</span>}
                      </Label>
                      <Input
                        value={entry.job_number}
                        onChange={(e) => handleJobNumberChange(index, e.target.value)}
                        placeholder="1234-AB"
                        maxLength={7}
                        disabled={entry.did_not_work || entry.working_in_yard}
                        className="h-14 text-lg bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 uppercase disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </div>

                    {/* Status Buttons */}
                    <div className="space-y-3">
                      <Label className="text-white text-lg">Day Status</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {/* Working in Yard Button */}
                        <button
                          type="button"
                          onClick={() => updateEntry(index, 'working_in_yard', !entry.working_in_yard)}
                          disabled={entry.did_not_work}
                          className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all ${
                            entry.working_in_yard
                              ? 'bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20'
                              : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          <Home className={`h-8 w-8 mb-2 ${entry.working_in_yard ? 'text-blue-400' : 'text-slate-500'}`} />
                          <span className={`text-sm font-medium ${entry.working_in_yard ? 'text-blue-400' : 'text-slate-400'}`}>
                            In Yard
                          </span>
                        </button>

                        {/* Did Not Work Button */}
                        <button
                          type="button"
                          onClick={() => updateEntry(index, 'did_not_work', !entry.did_not_work)}
                          className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all ${
                            entry.did_not_work
                              ? 'bg-amber-500/20 border-amber-500 shadow-lg shadow-amber-500/20'
                              : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                          }`}
                        >
                          <XCircle className={`h-8 w-8 mb-2 ${entry.did_not_work ? 'text-amber-400' : 'text-slate-500'}`} />
                          <span className={`text-sm font-medium ${entry.did_not_work ? 'text-amber-400' : 'text-slate-400'}`}>
                            Did Not Work
                          </span>
                        </button>
                      </div>
                      {entry.did_not_work && (
                        <p className="text-xs text-amber-400 text-center">Time entries disabled for this day</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label className="text-white text-lg">Notes / Remarks</Label>
                      <Input
                        value={entry.remarks}
                        onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                        placeholder="Add any notes for this day..."
                        className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 w-full"
                      />
                    </div>

                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-700">
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
                {entries.map((entry, index) => (
                  <tr key={entry.day_of_week} className="border-b border-slate-700/50">
                    <td className="p-3 font-medium text-white">{DAY_NAMES[index]}</td>
                    <td className="p-3">
                      <Input
                        type="time"
                        step="900"
                        value={entry.time_started}
                        onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                        disabled={entry.did_not_work}
                        className="w-32 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        type="time"
                        step="900"
                        value={entry.time_finished}
                        onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                        disabled={entry.did_not_work}
                        className="w-32 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        value={entry.job_number}
                        onChange={(e) => handleJobNumberChange(index, e.target.value)}
                        placeholder={entry.working_in_yard ? "N/A (Yard)" : "1234-AB"}
                        maxLength={7}
                        disabled={entry.did_not_work || entry.working_in_yard}
                        className="w-28 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 uppercase disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-2">
                        {/* In Yard Button */}
                        <button
                          type="button"
                          onClick={() => updateEntry(index, 'working_in_yard', !entry.working_in_yard)}
                          disabled={entry.did_not_work}
                          className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all ${
                            entry.working_in_yard
                              ? 'bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20'
                              : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                          title="Working in Yard"
                        >
                          <Home className={`h-5 w-5 ${entry.working_in_yard ? 'text-blue-400' : 'text-slate-500'}`} />
                        </button>

                        {/* Did Not Work Button */}
                        <button
                          type="button"
                          onClick={() => updateEntry(index, 'did_not_work', !entry.did_not_work)}
                          className={`flex items-center justify-center w-10 h-10 rounded-lg border-2 transition-all ${
                            entry.did_not_work
                              ? 'bg-amber-500/20 border-amber-500 shadow-lg shadow-amber-500/20'
                              : 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50'
                          }`}
                          title="Did Not Work"
                        >
                          <XCircle className={`h-5 w-5 ${entry.did_not_work ? 'text-amber-400' : 'text-slate-500'}`} />
                        </button>
                      </div>
                    </td>
                    <td className="p-3 text-right font-semibold text-timesheet">
                      {entry.daily_total !== null ? formatHours(entry.daily_total) : '0.00'}
                    </td>
                    <td className="p-3">
                      <Input
                        value={entry.remarks}
                        onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                        placeholder="Notes"
                        className="bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                      />
                    </td>
                  </tr>
                ))}
                <tr className="bg-timesheet/10 font-bold">
                  <td colSpan={5} className="p-3 text-right text-white">
                    Weekly Total:
                  </td>
                  <td className="p-3 text-right text-lg text-timesheet">
                    {formatHours(weeklyTotal)}h
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

        </CardContent>
      </Card>

      {/* Confirmation Text - Desktop Only */}
      <div className="hidden md:block p-4 bg-slate-800/40 border border-slate-700/50 rounded-lg backdrop-blur-xl">
        <p className="text-sm text-slate-300 italic">
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
          Save as Draft
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
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-700/50 p-4 z-20">
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
              // Check if all days are complete
              const allDaysComplete = entries.every(entry => {
                return entry.did_not_work || (entry.daily_total && entry.daily_total > 0);
              });

              if (allDaysComplete) {
                handleSubmit();
              } else {
                // Find next incomplete day
                const currentIndex = parseInt(activeDay);
                const nextIncompleteIndex = entries.findIndex((entry, idx) => {
                  return idx > currentIndex && !entry.did_not_work && (!entry.daily_total || entry.daily_total === 0);
                });
                
                // If no incomplete days after current, wrap to first incomplete
                const finalIndex = nextIncompleteIndex !== -1 
                  ? nextIncompleteIndex 
                  : entries.findIndex(entry => !entry.did_not_work && (!entry.daily_total || entry.daily_total === 0));
                
                if (finalIndex !== -1) {
                  setActiveDay(String(finalIndex));
                }
              }
            }}
            disabled={saving}
            className="flex-1 h-14 bg-timesheet hover:bg-timesheet/90 text-slate-900 font-semibold text-base"
          >
            {saving ? 'Submitting...' : (() => {
              const allDaysComplete = entries.every(entry => {
                return entry.did_not_work || (entry.daily_total && entry.daily_total > 0);
              });
              return allDaysComplete ? 'Submit' : 'Next';
            })()}
          </Button>
        </div>
      </div>

      {/* Signature Dialog */}
      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Timesheet</DialogTitle>
            <DialogDescription className="text-slate-400">
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
            <DialogDescription className="text-slate-300 text-base pt-2">
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
    </div>
  );
}

