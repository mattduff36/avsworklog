'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Save, Check, AlertCircle, CheckCircle2, XCircle, Home } from 'lucide-react';
import Link from 'next/link';
import { getWeekEnding, formatDateISO } from '@/lib/utils/date';
import { calculateHours, formatHours } from '@/lib/utils/time-calculations';
import { DAY_NAMES } from '@/types/timesheet';
import { Database } from '@/types/database';
import { SignaturePad } from '@/components/forms/SignaturePad';

export default function NewTimesheetPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const supabase = createClient();
  
  const [regNumber, setRegNumber] = useState('');
  const [weekEnding, setWeekEnding] = useState(formatDateISO(getWeekEnding()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeDay, setActiveDay] = useState('0');
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [existingWeeks, setExistingWeeks] = useState<string[]>([]);

  // Initialize entries for all 7 days
  const [entries, setEntries] = useState(
    Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i + 1,
      time_started: '',
      time_finished: '',
      working_in_yard: false,
      did_not_work: false,
      daily_total: null as number | null,
      remarks: '',
    }))
  );

  // Fetch existing timesheets on mount
  useEffect(() => {
    if (user) {
      fetchExistingTimesheets();
    }
  }, [user]);

  const fetchExistingTimesheets = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('timesheets')
        .select('week_ending')
        .eq('user_id', user.id);
      
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
      return;
    }

    // Check if week already exists
    if (weekExists(newDate)) {
      setError('You already have a timesheet for this week. Please select a different week.');
      return;
    }

    setWeekEnding(newDate);
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
      newEntries[dayIndex] = {
        ...newEntries[dayIndex],
        [field]: value,
      };

      // Auto-calculate daily total if both times are present
      if (field === 'time_started' || field === 'time_finished') {
        const entry = newEntries[dayIndex];
        const hours = calculateHours(entry.time_started, entry.time_finished);
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
    if (!user) return;

    setError('');
    setSaving(true);

    try {
      // Insert timesheet
      type TimesheetInsert = Database['public']['Tables']['timesheets']['Insert'];
      const timesheetData: TimesheetInsert = {
        user_id: user.id,
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

      // Insert entries (only those with data)
      type TimesheetEntryInsert = Database['public']['Tables']['timesheet_entries']['Insert'];
      const entriesToInsert: TimesheetEntryInsert[] = entries
        .filter(entry => entry.time_started || entry.time_finished || entry.remarks)
        .map(entry => ({
          timesheet_id: timesheet.id,
          day_of_week: entry.day_of_week,
          time_started: entry.time_started || null,
          time_finished: entry.time_finished || null,
          working_in_yard: entry.working_in_yard,
          daily_total: entry.daily_total,
          remarks: entry.remarks || null,
        }));

      if (entriesToInsert.length > 0) {
        const { error: entriesError } = await supabase
          .from('timesheet_entries')
          .insert(entriesToInsert);

        if (entriesError) throw entriesError;
      }

      router.push('/timesheets');
    } catch (err: any) {
      console.error('Error saving timesheet:', err);
      
      // Handle duplicate key constraint error
      if (err?.code === '23505' || err?.message?.includes('duplicate key')) {
        setError('You already have a timesheet for this week. Please select a different week ending date.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save timesheet');
      }
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

      {error && (
        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg backdrop-blur-xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {/* Basic Info Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-white">Timesheet Details</CardTitle>
          <CardDescription className="text-slate-400">
            Week ending {new Date(weekEnding).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reg_number" className="text-white text-base">Vehicle Registration</Label>
              <Input
                id="reg_number"
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value)}
                placeholder="e.g., YX65ABC"
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
              />
            </div>
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
              <p className="text-xs text-slate-400">Please select a Sunday that you haven't already submitted</p>
            </div>
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
                {DAY_NAMES.map((day, index) => (
                  <TabsTrigger 
                    key={index} 
                    value={String(index)}
                    className="text-xs py-3 data-[state=active]:bg-timesheet data-[state=active]:text-slate-900 text-slate-400"
                  >
                    {day.substring(0, 3)}
                    {entries[index].daily_total && entries[index].daily_total! > 0 && (
                      <Check className="h-3 w-3 ml-1" />
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              {entries.map((entry, index) => (
                <TabsContent key={index} value={String(index)} className="space-y-4 px-4 pb-4 overflow-hidden">
                  <div className="text-center mb-4">
                    <h3 className="text-2xl font-bold text-white">{DAY_NAMES[index]}</h3>
                    <p className="text-sm text-slate-400">Tap to enter your hours</p>
                  </div>

                  <div className="space-y-4 max-w-full">
                    <div className="space-y-2 max-w-full">
                      <Label className="text-white text-lg">Start Time</Label>
                      <div className="max-w-full overflow-hidden">
                        <Input
                          type="time"
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
                          value={entry.time_finished}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          disabled={entry.did_not_work}
                          className="h-14 text-lg bg-slate-900/50 border-slate-600 text-white w-full disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    <div className="bg-timesheet/10 border border-timesheet/30 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-medium">Total Hours</span>
                        <span className="text-3xl font-bold text-timesheet">
                          {entry.daily_total !== null ? formatHours(entry.daily_total) : '0.00'}h
                        </span>
                      </div>
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

                    {/* Quick Navigation */}
                    <div className="flex justify-between pt-4">
                      <Button
                        variant="outline"
                        onClick={() => setActiveDay(String(Math.max(0, index - 1)))}
                        disabled={index === 0}
                        className="border-slate-600 text-white hover:bg-slate-800"
                      >
                        ← Previous
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setActiveDay(String(Math.min(6, index + 1)))}
                        disabled={index === 6}
                        className="border-slate-600 text-white hover:bg-slate-800"
                      >
                        Next →
                      </Button>
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
                        value={entry.time_started}
                        onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                        disabled={entry.did_not_work}
                        className="w-32 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        type="time"
                        value={entry.time_finished}
                        onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                        disabled={entry.did_not_work}
                        className="w-32 bg-slate-900/50 border-slate-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
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
                  <td colSpan={4} className="p-3 text-right text-white">
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
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 h-14 bg-timesheet hover:bg-timesheet/90 text-slate-900 font-semibold text-base"
          >
            {saving ? 'Submitting...' : 'Submit'}
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
    </div>
  );
}

