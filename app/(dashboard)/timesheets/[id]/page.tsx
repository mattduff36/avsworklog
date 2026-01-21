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
import { Save, Send, Edit2, CheckCircle2, XCircle, Download, Package, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { BackButton } from '@/components/ui/back-button';
import { formatDate } from '@/lib/utils/date';
import { calculateHours, formatHours } from '@/lib/utils/time-calculations';
import { DAY_NAMES, Timesheet, TimesheetEntry } from '@/types/timesheet';
import SignaturePad from '@/components/forms/SignaturePad';
import { Database } from '@/types/database';
import { TimesheetAdjustmentModal } from '@/components/timesheets/TimesheetAdjustmentModal';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function ViewTimesheetPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isManager, loading: authLoading } = useAuth();
  const supabase = createClient();
  
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [showProcessedDialog, setShowProcessedDialog] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionComments, setRejectionComments] = useState('');
  const [originalData, setOriginalData] = useState<{entries: TimesheetEntry[], regNumber: string | null} | null>(null);
  const [dataChanged, setDataChanged] = useState(false);
  const [manuallyEditedDays, setManuallyEditedDays] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (params.id && !authLoading) {
      fetchTimesheet(params.id as string);
    }
  }, [params.id, user, authLoading]);

  const fetchTimesheet = async (id: string) => {
    try {
      setError(''); // Clear any previous errors
      
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
        setLoading(false);
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
      
      // Store original data if this is an approved timesheet (for change tracking)
      if (timesheetData.status === 'approved') {
        setOriginalData({
          entries: JSON.parse(JSON.stringify(fullWeek)),
          regNumber: timesheetData.reg_number
        });
      }
      
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

  const updateEntry = (dayIndex: number, field: string, value: string | boolean | number) => {
    const newEntries = [...entries];
    newEntries[dayIndex] = {
      ...newEntries[dayIndex],
      [field]: value,
    };

    // Auto-calculate daily total if both times are present
    if (field === 'time_started' || field === 'time_finished') {
      const entry = newEntries[dayIndex];
      let hours = calculateHours(entry.time_started, entry.time_finished);
      
      // Auto-deduct 30 mins (0.5 hours) for lunch break if daily total > 6.5 hours
      if (hours !== null && hours > 6.5) {
        hours = hours - 0.5;
      }
      
      newEntries[dayIndex].daily_total = hours;
      
      // Clear manual edit flag for this day when times change (recalculation)
      setManuallyEditedDays(prev => {
        const newSet = new Set(prev);
        newSet.delete(dayIndex);
        return newSet;
      });
    }

    // Handle manual daily_total edits
    if (field === 'daily_total') {
      // Mark this day as manually edited
      setManuallyEditedDays(prev => new Set(prev).add(dayIndex));
    }

    setEntries(newEntries);
    
    // Track if data has changed (for approved timesheets)
    if (timesheet?.status === 'approved' && originalData) {
      setDataChanged(true);
    }
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

  const handleReject = async () => {
    if (!timesheet || !isManager) return;
    if (rejectionComments.trim().length === 0) {
      toast.error('Please provide a reason for rejection');
      return;
    }

    setSaving(true);
    setShowRejectDialog(false);
    
    try {
      // Call API endpoint to handle rejection with notifications
      const response = await fetch(`/api/timesheets/${timesheet.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comments: rejectionComments.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reject timesheet');
      }

      toast.success('Timesheet rejected and employee notified');
      setRejectionComments('');
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      console.error('Rejection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to reject timesheet');
      toast.error(err instanceof Error ? err.message : 'Failed to reject timesheet');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAsProcessed = async () => {
    if (!timesheet || !isManager) return;

    setSaving(true);
    setShowProcessedDialog(false);
    try {
      const { error } = await supabase
        .from('timesheets')
        .update({
          status: 'processed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', timesheet.id);

      if (error) throw error;
      
      toast.success('Timesheet marked as processed');
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as processed');
      toast.error(err instanceof Error ? err.message : 'Failed to mark as processed');
    } finally {
      setSaving(false);
    }
  };

  const handleAdjust = async (selectedManagerIds: string[], comments: string) => {
    if (!timesheet || !isManager || !user) return;

    try {
      // Save the entries first
      await handleSave();

      // Call API endpoint to handle adjustment with notifications
      const response = await fetch(`/api/timesheets/${timesheet.id}/adjust`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comments,
          notifyManagerIds: selectedManagerIds,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to mark as adjusted');
      }

      toast.success('Timesheet marked as adjusted and notifications sent');
      setShowAdjustmentModal(false);
      setEditing(false);
      setDataChanged(false);
      await fetchTimesheet(timesheet.id);
    } catch (err) {
      console.error('Adjustment error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to mark as adjusted');
      throw err; // Re-throw to let modal handle it
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      submitted: { variant: 'warning' as const, label: 'Pending Approval' },
      approved: { variant: 'success' as const, label: 'Approved' },
      rejected: { variant: 'destructive' as const, label: 'Rejected' },
      processed: { variant: 'default' as const, label: 'Processed' },
      adjusted: { variant: 'default' as const, label: 'Adjusted' },
    };
    const config = variants[status as keyof typeof variants] || variants.draft;
    
    // Apply blue styling for final states (processed and adjusted)
    const isFinalState = status === 'processed' || status === 'adjusted';
    const blueClasses = isFinalState ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' : '';
    
    return <Badge variant={config.variant} className={blueClasses}>{config.label}</Badge>;
  };

  if (authLoading || loading) {
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
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!timesheet) return null;

  const canEdit = editing && (timesheet.status === 'draft' || timesheet.status === 'rejected' || (isManager && timesheet.status === 'approved'));
  const canSubmit = timesheet.user_id === user?.id && (timesheet.status === 'draft' || timesheet.status === 'rejected');
  const canApprove = isManager && timesheet.status === 'submitted';
  const canMarkAsProcessed = isManager && timesheet.status === 'approved';
  const canEditApproved = isManager && timesheet.status === 'approved';
  const isEndState = timesheet.status === 'processed' || timesheet.status === 'adjusted';

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3 md:space-x-4">
            <BackButton />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-slate-900 dark:text-white">Timesheet</h1>
              <p className="text-sm md:text-base text-slate-600 dark:text-slate-400">
                Week Ending {formatDate(timesheet.week_ending)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isManager && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
                  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                  const pdfUrl = `/api/timesheets/${timesheet.id}/pdf`;
                  
                  if (isStandalone || isMobile) {
                    // Use in-app PDF viewer for PWA/mobile
                    router.push(`/pdf-viewer?url=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(`Timesheet-${timesheet.week_ending}`)}&return=${encodeURIComponent(`/timesheets/${timesheet.id}`)}`);
                  } else {
                    // Desktop: Open in new tab
                    window.open(pdfUrl, '_blank');
                  }
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Download PDF</span>
                <span className="sm:hidden">PDF</span>
              </Button>
            )}
            {getStatusBadge(timesheet.status)}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      {timesheet.manager_comments && (
        <Card className="bg-white dark:bg-slate-900 border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-400">Manager Comments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-amber-800 dark:text-amber-300">{timesheet.manager_comments}</p>
          </CardContent>
        </Card>
      )}

      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Time Entries</CardTitle>
              <CardDescription>
                {timesheet.reg_number && `Registration: ${timesheet.reg_number}`}
              </CardDescription>
            </div>
            {!editing && ((timesheet.status === 'draft' || timesheet.status === 'rejected') || canEditApproved) && !isEndState && (
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
                  <th className="text-left p-2 font-medium">Time Finished</th>
                  <th className="text-left p-2 font-medium">Job Number</th>
                  <th className="text-center p-2 font-medium">In Yard</th>
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
                          className="w-32 text-slate-900"
                        />
                      ) : (
                        <span>{entry.time_started || '-'}</span>
                      )}
                    </td>
                    <td className="p-2">
                      {canEdit ? (
                        <Input
                          type="time"
                          value={entry.time_finished || ''}
                          onChange={(e) => updateEntry(index, 'time_finished', e.target.value)}
                          className="w-32 text-slate-900"
                        />
                      ) : (
                        <span>{entry.time_finished || '-'}</span>
                      )}
                    </td>
                    <td className="p-2">
                      <span className="text-sm font-mono">{(entry as TimesheetEntry & { job_number?: string }).job_number || (entry.working_in_yard ? 'YARD' : '-')}</span>
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
                    <td className="p-2 text-right font-semibold">
                      {canEdit && isManager ? (
                        <Input
                          type="number"
                          step="0.25"
                          value={entry.daily_total ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseFloat(e.target.value);
                            updateEntry(index, 'daily_total', val);
                          }}
                          className={`w-24 text-right font-semibold ${
                            manuallyEditedDays.has(index) 
                              ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700' 
                              : ''
                          }`}
                        />
                      ) : (
                        <span className={manuallyEditedDays.has(index) ? 'text-blue-600 dark:text-blue-400' : ''}>
                          {entry.daily_total !== null ? formatHours(entry.daily_total) : '0.00'}
                        </span>
                      )}
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
                  <td colSpan={5} className="p-2 text-right">
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
                  <div className="space-y-1">
                    <Label className="text-xs">Job Number</Label>
                    <p className="text-sm font-mono">{(entry as TimesheetEntry & { job_number?: string }).job_number || (entry.working_in_yard ? 'YARD' : '-')}</p>
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
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-sm font-medium">Daily Total:</span>
                      {canEdit && isManager ? (
                        <Input
                          type="number"
                          step="0.25"
                          value={entry.daily_total ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseFloat(e.target.value);
                            updateEntry(index, 'daily_total', val);
                          }}
                          className={`w-24 text-right text-lg font-bold ${
                            manuallyEditedDays.has(index) 
                              ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700' 
                              : ''
                          }`}
                        />
                      ) : (
                        <span className={`text-lg font-bold ${manuallyEditedDays.has(index) ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                          {entry.daily_total !== null ? formatHours(entry.daily_total) : '0.00'} hrs
                        </span>
                      )}
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
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

          {/* Warning for Approved Timesheet Editing */}
          {editing && timesheet.status === 'approved' && dataChanged && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    Editing Approved Timesheet
                  </p>
                  <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                    You are editing an approved timesheet. When you finish, you must add a comment and mark it as &ldquo;Adjusted&rdquo; to notify the employee and selected managers.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            {/* Save button for draft/rejected/approved editing */}
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

            {/* Mark as Adjusted button (for managers editing approved timesheets) */}
            {editing && timesheet.status === 'approved' && dataChanged && isManager && (
              <Button
                variant="outline"
                onClick={() => setShowAdjustmentModal(true)}
                disabled={saving}
                className="border-amber-500 text-amber-600 hover:bg-amber-500 hover:text-white active:scale-95 transition-all"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Mark as Adjusted
              </Button>
            )}
            
            {/* Submit button for employees */}
            {canSubmit && (
              <Button
                onClick={handleSubmit}
                disabled={saving}
              >
                <Send className="h-4 w-4 mr-2" />
                {saving ? 'Submitting...' : 'Submit for Approval'}
              </Button>
            )}

            {/* Approve/Reject buttons for pending timesheets */}
            {canApprove && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={saving}
                  className="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
                <Button
                  variant="outline"
                  onClick={handleApprove}
                  disabled={saving}
                  className="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
              </>
            )}

            {/* Mark as Processed button (only if NOT editing) */}
            {canMarkAsProcessed && !editing && (
              <Button
                variant="outline"
                onClick={() => setShowProcessedDialog(true)}
                disabled={saving}
                className="border-blue-300 text-blue-600 hover:bg-blue-500 hover:text-white hover:border-blue-500 active:bg-blue-600 active:scale-95 transition-all"
              >
                <Package className="h-4 w-4 mr-2" />
                Mark as Processed
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Mark as Processed Confirmation Dialog */}
      <AlertDialog open={showProcessedDialog} onOpenChange={setShowProcessedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Timesheet as Processed</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark this timesheet as processed?
              <br />
              <br />
              <strong>Warning:</strong> Once marked as processed, this action cannot be undone. This indicates that the timesheet has been sent to payroll for payment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMarkAsProcessed}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 focus:ring-blue-600"
            >
              {saving ? 'Processing...' : 'Mark as Processed'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rejection Dialog */}
      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Timesheet</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejecting this timesheet. The employee will be notified via email and in-app notification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Label htmlFor="rejection-comments" className="text-sm font-medium">
              Rejection Reason <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="rejection-comments"
              placeholder="Explain why this timesheet is being rejected..."
              value={rejectionComments}
              onChange={(e) => setRejectionComments(e.target.value)}
              disabled={saving}
              rows={4}
              className="resize-none bg-slate-800 border-slate-700 focus:border-slate-500 dark:text-slate-100 text-slate-900"
              required
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving} onClick={() => setRejectionComments('')} className="border-slate-700 hover:bg-slate-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={saving || rejectionComments.trim().length === 0}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600 border-0"
            >
              {saving ? 'Rejecting...' : 'Reject Timesheet'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Adjustment Modal */}
      {timesheet && (
        <TimesheetAdjustmentModal
          open={showAdjustmentModal}
          onClose={() => setShowAdjustmentModal(false)}
          onConfirm={handleAdjust}
          employeeName={timesheet.profile?.full_name || 'Employee'}
          weekEnding={formatDate(timesheet.week_ending)}
        />
      )}
    </div>
  );
}

