'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getWeekEnding, formatDateISO } from '@/lib/utils/date';

interface WeekSelectorProps {
  userId: string;
  onWeekSelected: (weekEnding: string, existingTimesheetId: string | null) => void;
  initialWeek?: string | null;
}

export function WeekSelector({ userId, onWeekSelected, initialWeek }: WeekSelectorProps) {
  const supabase = createClient();
  const [selectedDate, setSelectedDate] = useState(initialWeek || '');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [existingTimesheet, setExistingTimesheet] = useState<{ id: string; status: string } | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Auto-suggest next Sunday as default
  useEffect(() => {
    if (!initialWeek && !selectedDate) {
      const defaultWeek = formatDateISO(getWeekEnding());
      setSelectedDate(defaultWeek);
    }
  }, [initialWeek, selectedDate]);

  // Check if a date is a Sunday
  const isSunday = (dateString: string): boolean => {
    if (!dateString) return false;
    const date = new Date(dateString + 'T00:00:00');
    return date.getDay() === 0;
  };

  // Handle date change
  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setError('');
    setExistingTimesheet(null);
    setShowSuccess(false);
  };

  // Check for existing timesheet and proceed
  const handleProceed = async () => {
    setError('');
    setExistingTimesheet(null);
    setShowSuccess(false);

    // Validate date is selected
    if (!selectedDate) {
      setError('Please select a week ending date');
      return;
    }

    // Validate date is a Sunday
    if (!isSunday(selectedDate)) {
      setError('Week ending must be a Sunday. Please select a Sunday date.');
      return;
    }

    setChecking(true);

    try {
      // Check for existing timesheet for this week
      const { data: existing, error: queryError } = await supabase
        .from('timesheets')
        .select('id, status')
        .eq('user_id', userId)
        .eq('week_ending', selectedDate)
        .maybeSingle();

      if (queryError) throw queryError;

      if (existing) {
        // Timesheet exists for this week
        if (existing.status === 'draft' || existing.status === 'rejected') {
          // Can edit this timesheet
          setExistingTimesheet(existing);
          setError('');
          setShowSuccess(true);
          
          // Auto-proceed to edit after showing message
          setTimeout(() => {
            onWeekSelected(selectedDate, existing.id);
          }, 1000);
        } else {
          // Timesheet is submitted/approved - cannot edit
          setExistingTimesheet(existing);
          setError(`You already have a ${existing.status} timesheet for this week. You cannot create another timesheet for the same week.`);
        }
      } else {
        // No existing timesheet - can create new
        setShowSuccess(true);
        setTimeout(() => {
          onWeekSelected(selectedDate, null);
        }, 500);
      }
    } catch (err) {
      console.error('Error checking for existing timesheet:', err);
      setError(err instanceof Error ? err.message : 'Failed to check for existing timesheets');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-timesheet/10 flex items-center justify-center">
              <Calendar className="h-6 w-6 text-timesheet" />
            </div>
            <div>
              <CardTitle className="text-2xl text-slate-900 dark:text-white">Select Week Ending Date</CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400">
                Choose the Sunday for the week you want to record
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Date Picker */}
          <div className="space-y-2">
            <Label htmlFor="week-ending" className="text-slate-900 dark:text-white text-base">
              Week Ending Date (Must be Sunday)
            </Label>
            <Input
              id="week-ending"
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="h-14 text-lg bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
            />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Timesheets must end on Sunday. The selected date should be the last day of your work week.
            </p>
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/50">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-400">
                {error}
                {existingTimesheet && existingTimesheet.status !== 'draft' && existingTimesheet.status !== 'rejected' && (
                  <div className="mt-2">
                    <Link href="/timesheets">
                      <Button variant="outline" size="sm" className="text-xs">
                        View Existing Timesheets
                      </Button>
                    </Link>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert (editing existing) */}
          {showSuccess && existingTimesheet && (
            <Alert className="bg-blue-500/10 border-blue-500/50">
              <CheckCircle2 className="h-4 w-4 text-blue-400" />
              <AlertDescription className="text-blue-400">
                Found existing draft timesheet. Loading it for editing...
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert (new timesheet) */}
          {showSuccess && !existingTimesheet && (
            <Alert className="bg-green-500/10 border-green-500/50">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-green-400">
                Week validated! Loading timesheet form...
              </AlertDescription>
            </Alert>
          )}

          {/* Continue Button */}
          <Button
            onClick={handleProceed}
            disabled={!selectedDate || checking || showSuccess}
            className="w-full h-14 text-lg bg-timesheet hover:bg-timesheet-dark text-white font-semibold"
          >
            {checking ? (
              'Checking...'
            ) : showSuccess ? (
              'Loading...'
            ) : (
              'Continue to Timesheet'
            )}
          </Button>

          {/* Info Box */}
          <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <h4 className="font-semibold text-slate-900 dark:text-white mb-2 text-sm">Quick Tips:</h4>
            <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
              <li>• Week ending date must always be a Sunday</li>
              <li>• You can only have one timesheet per week</li>
              <li>• Draft and rejected timesheets can be edited</li>
              <li>• Submitted and approved timesheets cannot be changed</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
