'use client';

import { useState, useMemo } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight,
  AlertTriangle,
  Settings
} from 'lucide-react';
import Link from 'next/link';
import { 
  useAbsencesForCurrentUser, 
  useAbsenceSummaryForCurrentUser,
  useAbsenceReasons,
  useCreateAbsence,
  useCancelAbsence
} from '@/lib/hooks/useAbsence';
import { formatDate, formatDateISO, calculateDurationDays, getFinancialYearMonths, getCurrentFinancialYear } from '@/lib/utils/date';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns';
import { toast } from 'sonner';

export default function AbsencePage() {
  const { profile, isManager, isAdmin } = useAuth();
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [currentMonthIndex, setCurrentMonthIndex] = useState(0);
  
  // Fetch data
  const { data: absences, isLoading: loadingAbsences } = useAbsencesForCurrentUser();
  const { data: summary, isLoading: loadingSummary } = useAbsenceSummaryForCurrentUser();
  const { data: reasons } = useAbsenceReasons();
  const createAbsence = useCreateAbsence();
  const cancelAbsence = useCancelAbsence();
  
  // Financial year months
  const financialYear = getCurrentFinancialYear();
  const months = useMemo(() => getFinancialYearMonths(), []);
  const currentMonth = months[currentMonthIndex];
  
  // Form state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<'AM' | 'PM'>('AM');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Get Annual Leave reason
  const annualLeaveReason = reasons?.find(r => r.name === 'Annual leave');
  
  // Calculate requested days
  const requestedDays = useMemo(() => {
    if (!startDate) return 0;
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    return calculateDurationDays(start, end, isHalfDay);
  }, [startDate, endDate, isHalfDay]);
  
  // Projected remaining after this request
  const projectedRemaining = (summary?.remaining || 0) - requestedDays;
  
  // Handle form submission
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!annualLeaveReason) {
      toast.error('Annual leave reason not found');
      return;
    }
    
    if (!startDate) {
      toast.error('Please select a start date');
      return;
    }
    
    if (projectedRemaining < 0) {
      toast.error('Insufficient annual leave allowance');
      return;
    }
    
    setSubmitting(true);
    
    try {
      await createAbsence.mutateAsync({
        profile_id: profile!.id,
        date: startDate,
        end_date: endDate || null,
        reason_id: annualLeaveReason.id,
        duration_days: requestedDays,
        is_half_day: isHalfDay,
        half_day_session: isHalfDay ? halfDaySession : null,
        notes: notes || null,
        status: 'pending',
        created_by: profile!.id,
      });
      
      toast.success('Annual leave request submitted');
      
      // Reset form
      setStartDate('');
      setEndDate('');
      setIsHalfDay(false);
      setNotes('');
      setShowRequestForm(false);
    } catch (error) {
      console.error('Error submitting request:', error);
      toast.error('Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  }
  
  // Handle cancel
  async function handleCancel(id: string, status: string) {
    if (!confirm(`Are you sure you want to cancel this ${status === 'approved' ? 'approved' : 'pending'} absence?`)) {
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
          <div key={day} className="text-center text-sm font-medium text-slate-400 pb-2">
            {day}
          </div>
        ))}
        
        {/* Padding cells */}
        {Array.from({ length: paddingDays }).map((_, i) => (
          <div key={`padding-${i}`} />
        ))}
        
        {/* Day cells */}
        {days.map(day => {
          const dayAbsences = absences?.filter(a => {
            const absenceStart = new Date(a.date);
            const absenceEnd = a.end_date ? new Date(a.end_date) : absenceStart;
            return day >= absenceStart && day <= absenceEnd;
          }) || [];
          
          const approved = dayAbsences.filter(a => a.status === 'approved');
          const pending = dayAbsences.filter(a => a.status === 'pending');
          const annualLeave = approved.filter(a => a.absence_reasons.name === 'Annual leave');
          const otherAbsences = approved.filter(a => a.absence_reasons.name !== 'Annual leave');
          
          return (
            <div
              key={day.toISOString()}
              className={`
                relative aspect-square p-1 rounded-lg border
                ${dayAbsences.length > 0 
                  ? 'border-purple-500/30 bg-purple-500/5' 
                  : 'border-slate-700 bg-slate-800/30'
                }
                hover:bg-slate-700/30 transition-colors
              `}
            >
              <div className="text-xs text-slate-300 font-medium">
                {format(day, 'd')}
              </div>
              
              {/* Indicators */}
              <div className="absolute bottom-1 left-1 right-1 flex gap-0.5 justify-center">
                {annualLeave.length > 0 && (
                  <div className="h-1.5 w-1.5 rounded-full bg-purple-500" title="Annual Leave" />
                )}
                {pending.length > 0 && (
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Pending" />
                )}
                {otherAbsences.length > 0 && (
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-500" title="Other Absence" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  
  if (loadingAbsences || loadingSummary) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-slate-400">Loading absences...</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
              Absence & Leave
            </h1>
            <p className="text-slate-600 dark:text-slate-400">
              {isManager || isAdmin 
                ? 'Manage annual leave and view absence records'
                : 'Request annual leave and view your absence records'
              }
            </p>
          </div>
          
          {/* Manage Absence link for managers/admins */}
          {(isManager || isAdmin) && (
            <Link href="/absence/manage">
              <Button className="bg-purple-500 hover:bg-purple-600 text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg">
                <Settings className="h-4 w-4 mr-2" />
                Manage Absence
              </Button>
            </Link>
          )}
        </div>
      </div>
      
      {/* Summary Card */}
      <Card className="bg-gradient-to-br from-purple-500 to-purple-600 border-0 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <CalendarIcon className="h-5 w-5" />
            Annual Leave Summary ({financialYear.label})
          </CardTitle>
          <CardDescription className="text-purple-100">
            UK Financial Year: {formatDate(financialYear.start)} - {formatDate(financialYear.end)}
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
      
      <Tabs defaultValue="calendar" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-slate-800/50">
          <TabsTrigger value="calendar">Calendar & Request</TabsTrigger>
          <TabsTrigger value="bookings">My Bookings</TabsTrigger>
        </TabsList>
        
        {/* Calendar & Request Form Tab */}
        <TabsContent value="calendar" className="space-y-6">
          {/* Calendar */}
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-slate-900 dark:text-white">
                  {format(currentMonth, 'MMMM yyyy')}
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentMonthIndex(Math.max(0, currentMonthIndex - 1))}
                    disabled={currentMonthIndex === 0}
                    className="border-slate-600 text-slate-300"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentMonthIndex(Math.min(months.length - 1, currentMonthIndex + 1))}
                    disabled={currentMonthIndex === months.length - 1}
                    className="border-slate-600 text-slate-300"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {/* Legend */}
              <div className="flex flex-wrap gap-4 pt-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-purple-500" />
                  <span className="text-slate-400">Annual Leave (Approved)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-amber-500" />
                  <span className="text-slate-400">Pending Request</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-blue-500" />
                  <span className="text-slate-400">Other Absence</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {renderCalendar()}
            </CardContent>
          </Card>
          
          {/* Request Form */}
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-slate-900 dark:text-white">
                  Request Annual Leave
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRequestForm(!showRequestForm)}
                  className="border-slate-600 text-slate-300"
                >
                  {showRequestForm ? 'Hide Form' : 'Show Form'}
                </Button>
              </div>
            </CardHeader>
            
            {showRequestForm && (
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="startDate">Start Date</Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          // Reset end date if before start
                          if (endDate && endDate < e.target.value) {
                            setEndDate('');
                          }
                        }}
                        min={formatDateISO(new Date())}
                        required
                        className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="endDate">End Date (optional for multi-day)</Label>
                      <Input
                        id="endDate"
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        min={startDate || formatDateISO(new Date())}
                        disabled={!startDate || isHalfDay}
                        className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
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
                            setEndDate(''); // Clear end date for half-day
                          }
                        }}
                        className="rounded border-slate-600"
                      />
                      <span className="text-sm text-slate-300">Half Day</span>
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
                            className="text-red-500"
                          />
                          <span className="text-sm text-slate-300">AM</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="session"
                            value="PM"
                            checked={halfDaySession === 'PM'}
                            onChange={() => setHalfDaySession('PM')}
                            className="text-red-500"
                          />
                          <span className="text-sm text-slate-300">PM</span>
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
                      className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                    />
                  </div>
                  
                  {/* Summary */}
                  {startDate && (
                    <div className="bg-slate-800/30 p-4 rounded-lg space-y-2">
                      <h4 className="font-semibold text-white">Request Summary</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-slate-400">Requested Days:</span>
                          <span className="ml-2 text-white font-medium">{requestedDays}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Approved Taken:</span>
                          <span className="ml-2 text-white font-medium">{summary?.approved_taken || 0}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Pending:</span>
                          <span className="ml-2 text-white font-medium">{summary?.pending_total || 0}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Projected Remaining:</span>
                          <span className={`ml-2 font-medium ${projectedRemaining < 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {projectedRemaining}
                          </span>
                        </div>
                      </div>
                      
                      {projectedRemaining < 0 && (
                        <div className="flex items-start gap-2 bg-red-500/20 p-3 rounded border border-red-500/30">
                          <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-red-300">
                            This request exceeds your available allowance. Please adjust the dates or contact your manager.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="flex gap-3">
                    <Button
                      type="submit"
                      disabled={submitting || projectedRemaining < 0 || !startDate}
                      className="bg-purple-500 hover:bg-purple-600 text-white"
                    >
                      {submitting ? 'Submitting...' : 'Submit Request'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setStartDate('');
                        setEndDate('');
                        setIsHalfDay(false);
                        setNotes('');
                      }}
                      className="border-slate-600 text-slate-300"
                    >
                      Clear
                    </Button>
                  </div>
                </form>
              </CardContent>
            )}
          </Card>
        </TabsContent>
        
        {/* Bookings List Tab */}
        <TabsContent value="bookings">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-white">
                My Absence Records ({financialYear.label})
              </CardTitle>
              <CardDescription className="text-slate-400">
                All absences in the current financial year
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!absences || absences.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarIcon className="h-16 w-16 text-slate-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">No absences recorded</h3>
                  <p className="text-slate-400">Your absence records will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {absences.map(absence => {
                    const canCancel = 
                      (absence.status === 'pending' && new Date(absence.date) >= new Date()) ||
                      (absence.status === 'approved' && new Date(absence.date) >= new Date());
                    
                    return (
                      <div
                        key={absence.id}
                        className="p-4 rounded-lg bg-slate-800/30 border border-slate-700/50 hover:border-slate-600 transition-colors"
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
                                    ? 'border-purple-500/30 text-purple-400 bg-purple-500/10'
                                    : 'border-slate-600 text-slate-400'
                                }
                              >
                                {absence.status}
                              </Badge>
                              {absence.absence_reasons.is_paid ? (
                                <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/10">
                                  Paid
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-slate-600 text-slate-400">
                                  Unpaid
                                </Badge>
                              )}
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-slate-400">
                              <div>
                                <span className="text-slate-500">Date:</span>{' '}
                                {absence.end_date && absence.date !== absence.end_date
                                  ? `${formatDate(absence.date)} - ${formatDate(absence.end_date)}`
                                  : formatDate(absence.date)
                                }
                                {absence.is_half_day && ` (${absence.half_day_session})`}
                              </div>
                              <div>
                                <span className="text-slate-500">Duration:</span> {absence.duration_days} days
                              </div>
                              <div>
                                <span className="text-slate-500">Submitted:</span> {formatDate(absence.created_at)}
                              </div>
                            </div>
                            
                            {absence.notes && (
                              <p className="text-sm text-slate-400 mt-2">
                                <span className="text-slate-500">Notes:</span> {absence.notes}
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
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

