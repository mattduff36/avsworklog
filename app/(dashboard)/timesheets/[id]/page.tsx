'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Save, Send, Edit2, CheckCircle2, XCircle, Download } from 'lucide-react';
import Link from 'next/link';
import { formatDate, formatDateISO } from '@/lib/utils/date';
import { calculateHours, formatHours } from '@/lib/utils/time-calculations';
import { DAY_NAMES, Timesheet, TimesheetEntry } from '@/types/timesheet';
import SignaturePad from '@/components/forms/SignaturePad';
import { Database } from '@/types/database';

export default function ViewTimesheetPage() {
  const router = useRouter();
  const params = useParams();
  const { user, profile, isManager } = useAuth();
  const supabase = createClient();
  
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);

  useEffect(() => {
    if (params.id) {
      fetchTimesheet(params.id as string);
    }
  }, [params.id, user]);

  const fetchTimesheet = async (id: string) => {
    try {
      // Fetch timesheet
      const { data: timesheetData, error: timesheetError } = await supabase
        .from('timesheets')
        .select('*')
        .eq('id', id)
        .single();

      if (timesheetError) throw timesheetError;
      
      // Check if user has access
      if (!isManager && timesheetData.user_id !== user?.id) {
        setError('You do not have permission to view this timesheet');
        return;
      }

      setTimesheet(timesheetData);
      setSignature(timesheetData.signature_data);

      // Fetch entries
      const { data: entriesData, error: entriesError } = await supabase
        .from('timesheet_entries')
        .select('*')
        .eq('timesheet_id', id)
        .order('day_of_week');

      if (entriesError) throw entriesError;

      // Create full week array (all 7 days)
      const fullWeek = Array.from({ length: 7 }, (_, i) => {
        const existingEntry = entriesData?.find(e => e.day_of_week === i + 1);
        return existingEntry || {
          day_of_week: i + 1,
          timesheet_id: id,
          time_started: null,
          time_finished: null,
          working_in_yard: false,
          daily_total: null,
          remarks: null,
        };
      });

      setEntries(fullWeek);
      
      // Enable editing for draft or rejected timesheets
      if (timesheetData.status === 'draft' || timesheetData.status === 'rejected') {
        setEditing(true);
      }
    } catch (err) {
      console.error('Error fetching timesheet:', err);
      setError(err instanceof Error ? err.message : 'Failed to load timesheet');
    } finally {
      setLoading(false);
    }
  };

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

  const weeklyTotal = entries.reduce((sum, entry) => {
    return sum + (entry.daily_total || 0);
  }, 0);

  const handleSave = async () => {
    if (!timesheet || !user) return;

    setSaving(true);
    setError('');

    try {
      // Update timesheet
      const { error: timesheetError } = await supabase
        .from('timesheets')
        .update({
          updated_at: new Date().toISOString(),
        })
        .eq('id', timesheet.id);

      if (timesheetError) throw timesheetError;

      // Delete existing entries
      await supabase
        .from('timesheet_entries')
        .delete()
        .eq('timesheet_id', timesheet.id);

      // Insert updated entries (only those with data)
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

      // Refresh data
      await fetchTimesheet(timesheet.id);
      setEditing(false);
    } catch (err) {
      console.error('Error saving timesheet:', err);
      setError(err instanceof Error ? err.message : 'Failed to save timesheet');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!timesheet || !user) return;
    
    if (!signature) {
      setShowSignaturePad(true);
      return;
    }

    setSaving(true);
    setError('');

    try {
      // Save entries first
      await handleSave();

      // Update timesheet status
      const { error: updateError } = await supabase
        .from('timesheets')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          signature_data: signature,
          signed_at: new Date().toISOString(),
        })
        .eq('id', timesheet.id);

      if (updateError) throw updateError;

      router.push('/timesheets');
    } catch (err) {
      console.error('Error submitting timesheet:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit timesheet');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!timesheet || !isManager) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'approved',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', timesheet.id);

      if (error) throw error;
      
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (comments: string) => {
    if (!timesheet || !isManager) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'rejected',
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          manager_comments: comments,
        })
        .eq('id', timesheet.id);

      if (error) throw error;
      
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending Approval' },
      approved: { variant: 'success' as const, label: 'Approved' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
    };
    const config = variants[status as keyof typeof variants] || variants.draft;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading timesheet...</p>
      </div>
    );
  }

  if (error && !timesheet) {
    return (
      <div className="space-y-6">
        <Link href="/timesheets">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Timesheets
          </Button>
        </Link>
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!timesheet) return null;

  const canEdit = editing && (timesheet.status === 'draft' || timesheet.status === 'rejected');
  const canSubmit = timesheet.user_id === user?.id && (timesheet.status === 'draft' || timesheet.status === 'rejected');
  const canApprove = isManager && timesheet.status === 'submitted';

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/timesheets">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Timesheet</h1>
            <p className="text-muted-foreground">
              Week Ending {formatDate(timesheet.week_ending)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/api/timesheets/${timesheet.id}/pdf`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </a>
          {getStatusBadge(timesheet.status)}
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      {timesheet.manager_comments && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">Manager Comments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-amber-800">{timesheet.manager_comments}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Time Entries</CardTitle>
              <CardDescription>
                {timesheet.reg_number && `Registration: ${timesheet.reg_number}`}
              </CardDescription>
            </div>
            {canEdit && !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
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
                      {canEdit ? (
                        <Input
                          type="time"
                          value={entry.time_started || ''}
                          onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                          className="w-32"
                        />
                      ) : (
                        <span>{entry.time_started || '-'}</span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {canEdit ? (
                        <input
                          type="checkbox"
                          checked={entry.working_in_yard}
                          onChange={(e) => updateEntry(index, 'working_in_yard', e.target.checked)}
                          className="w-4 h-4"
                        />
                      ) : (
                        entry.working_in_yard && <CheckCircle2 className="h-4 w-4 inline text-green-600" />
                      )}
                    </td>
                    <td className="p-2">
                      {canEdit ? (
                        <Input
                          type="time"
                          value={entry.time_finished || ''}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          className="w-32"
                        />
                      ) : (
                        <span>{entry.time_finished || '-'}</span>
                      )}
                    </td>
                    <td className="p-2 text-right font-semibold">
                      {entry.daily_total !== null ? formatHours(entry.daily_total) : '0.00'}
                    </td>
                    <td className="p-2">
                      {canEdit ? (
                        <Input
                          value={entry.remarks || ''}
                          onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                          placeholder="Notes"
                        />
                      ) : (
                        <span className="text-sm">{entry.remarks || '-'}</span>
                      )}
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
                      {canEdit ? (
                        <Input
                          type="time"
                          value={entry.time_started || ''}
                          onChange={(e) => updateEntry(index, 'time_started', e.target.value)}
                        />
                      ) : (
                        <p className="text-sm">{entry.time_started || '-'}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Time Finished</Label>
                      {canEdit ? (
                        <Input
                          type="time"
                          value={entry.time_finished || ''}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                        />
                      ) : (
                        <p className="text-sm">{entry.time_finished || '-'}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {canEdit ? (
                      <>
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
                      </>
                    ) : (
                      entry.working_in_yard && <span className="text-sm text-green-600">✓ Working in Yard</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Remarks</Label>
                    {canEdit ? (
                      <Input
                        value={entry.remarks || ''}
                        onChange={(e) => updateEntry(index, 'remarks', e.target.value)}
                        placeholder="Any notes..."
                      />
                    ) : (
                      <p className="text-sm">{entry.remarks || '-'}</p>
                    )}
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

          {/* Signature Section */}
          {(signature || showSignaturePad) && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Employee Signature</h3>
              {signature && !showSignaturePad ? (
                <div className="space-y-2">
                  <img src={signature} alt="Signature" className="border rounded p-2 bg-white max-w-md" />
                  <p className="text-xs text-muted-foreground">
                    Signed on {timesheet.signed_at ? formatDate(timesheet.signed_at) : 'Unknown'}
                  </p>
                  {canEdit && (
                    <Button variant="outline" size="sm" onClick={() => setShowSignaturePad(true)}>
                      Update Signature
                    </Button>
                  )}
                </div>
              ) : showSignaturePad && (
                <SignaturePad
                  onSave={(sig) => {
                    setSignature(sig);
                    setShowSignaturePad(false);
                  }}
                  onCancel={() => setShowSignaturePad(false)}
                />
              )}
            </div>
          )}

          {/* Confirmation Text */}
          <div className="p-4 bg-secondary/50 rounded-md text-sm">
            <p className="italic">
              All time and other details are correct and should be used as a basis for wages etc.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            {canEdit && (
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
            
            {canSubmit && (
              <Button
                onClick={handleSubmit}
                disabled={saving}
              >
                <Send className="h-4 w-4 mr-2" />
                {saving ? 'Submitting...' : 'Submit for Approval'}
              </Button>
            )}

            {canApprove && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const comments = prompt('Enter rejection reason (optional):');
                    if (comments !== null) {
                      handleReject(comments);
                    }
                  }}
                  disabled={saving}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button
                  onClick={handleApprove}
                  disabled={saving}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

