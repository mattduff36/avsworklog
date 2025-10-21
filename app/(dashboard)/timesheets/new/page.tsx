'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { getWeekEnding, formatDateISO } from '@/lib/utils/date';
import { calculateHours, formatHours } from '@/lib/utils/time-calculations';
import { DAY_NAMES } from '@/types/timesheet';

export default function NewTimesheetPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const supabase = createClient();
  
  const [regNumber, setRegNumber] = useState('');
  const [weekEnding, setWeekEnding] = useState(formatDateISO(getWeekEnding()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Initialize entries for all 7 days
  const [entries, setEntries] = useState(
    Array.from({ length: 7 }, (_, i) => ({
      day_of_week: i + 1,
      time_started: '',
      time_finished: '',
      working_in_yard: false,
      daily_total: null as number | null,
      remarks: '',
    }))
  );

  // Calculate hours when times change
  const updateEntry = (dayIndex: number, field: string, value: string | boolean) => {
    const newEntries = [...entries];
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
    await saveTimesheet('submitted');
  };

  const saveTimesheet = async (status: 'draft' | 'submitted') => {
    if (!user) return;

    setError('');
    setSaving(true);

    try {
      // Insert timesheet
      const { data: timesheet, error: timesheetError } = await supabase
        .from('timesheets')
        .insert({
          user_id: user.id,
          reg_number: regNumber || null,
          week_ending: weekEnding,
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        } as never)
        .select()
        .single();

      if (timesheetError) throw timesheetError;
      if (!timesheet) throw new Error('Failed to create timesheet');

      // Insert entries (only those with data)
      const entriesToInsert = entries
        .filter(entry => entry.time_started || entry.time_finished || entry.remarks)
        .map(entry => ({
          timesheet_id: (timesheet as {id: string}).id,
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
          .insert(entriesToInsert as never);

        if (entriesError) throw entriesError;
      }

      router.push('/timesheets');
    } catch (err) {
      console.error('Error saving timesheet:', err);
      setError(err instanceof Error ? err.message : 'Failed to save timesheet');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center space-x-4">
        <Link href="/timesheets">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">New Timesheet</h1>
          <p className="text-muted-foreground">
            {profile?.full_name}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Timesheet Details</CardTitle>
          <CardDescription>
            Fill in your hours for the week ending on Sunday
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Header Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reg_number">Registration Number</Label>
              <Input
                id="reg_number"
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value)}
                placeholder="e.g., YX65ABC"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="week_ending">Week Ending (Sunday)</Label>
              <Input
                id="week_ending"
                type="date"
                value={weekEnding}
                onChange={(e) => setWeekEnding(e.target.value)}
              />
            </div>
          </div>

          {/* Daily Entries */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Daily Hours</h3>
            
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium">Day</th>
                    <th className="text-left p-2 font-medium">Time Started</th>
                    <th className="text-center p-2 font-medium">In Yard</th>
                    <th className="text-left p-2 font-medium">Time Finished</th>
                    <th className="text-right p-2 font-medium">Total Hours</th>
                    <th className="text-left p-2 font-medium">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr key={entry.day_of_week} className="border-b">
                      <td className="p-2 font-medium">{DAY_NAMES[index]}</td>
                      <td className="p-2">
                        <Input
                          type="time"
                          value={entry.time_started}
                          onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                          className="w-32"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={entry.working_in_yard}
                          onChange={(e) => updateEntry(index, 'working_in_yard', e.target.checked)}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="time"
                          value={entry.time_finished}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          className="w-32"
                        />
                      </td>
                      <td className="p-2 text-right font-semibold">
                        {entry.daily_total !== null ? formatHours(entry.daily_total) : '0.00'}
                      </td>
                      <td className="p-2">
                        <Input
                          value={entry.remarks}
                          onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                          placeholder="Notes"
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-secondary/50 font-bold">
                    <td colSpan={4} className="p-2 text-right">
                      Weekly Total:
                    </td>
                    <td className="p-2 text-right text-lg">
                      {formatHours(weeklyTotal)}
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-4">
              {entries.map((entry, index) => (
                <Card key={entry.day_of_week}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{DAY_NAMES[index]}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Time Started</Label>
                        <Input
                          type="time"
                          value={entry.time_started}
                          onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Time Finished</Label>
                        <Input
                          type="time"
                          value={entry.time_finished}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`yard-${index}`}
                        checked={entry.working_in_yard}
                        onChange={(e) => updateEntry(index, 'working_in_yard', e.target.checked)}
                        className="w-4 h-4"
                      />
                      <Label htmlFor={`yard-${index}`} className="text-sm">
                        Working in Yard
                      </Label>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Remarks</Label>
                      <Input
                        value={entry.remarks}
                        onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                        placeholder="Any notes..."
                      />
                    </div>
                    <div className="pt-2 border-t">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Daily Total:</span>
                        <span className="text-lg font-bold">
                          {entry.daily_total !== null ? formatHours(entry.daily_total) : '0.00'} hrs
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Weekly Total for Mobile */}
              <Card className="bg-primary text-primary-foreground">
                <CardContent className="pt-6">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">Weekly Total:</span>
                    <span className="text-2xl font-bold">
                      {formatHours(weeklyTotal)} hrs
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Confirmation Text */}
          <div className="p-4 bg-secondary/50 rounded-md text-sm">
            <p className="italic">
              All time and other details are correct and should be used as a basis for wages etc.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            <Button
              variant="outline"
              onClick={handleSaveDraft}
              disabled={saving}
            >
              <Save className="h-4 w-4 mr-2" />
              Save as Draft
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving ? 'Submitting...' : 'Submit Timesheet'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

