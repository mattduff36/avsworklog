'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Calendar, 
  Briefcase, 
  Home, 
  XCircle
} from 'lucide-react';
import { DAY_NAMES } from '@/types/timesheet';
import { formatHours } from '@/lib/utils/time-calculations';

interface TimesheetEntry {
  day_of_week: number;
  time_started: string;
  time_finished: string;
  job_number: string;
  working_in_yard: boolean;
  did_not_work: boolean;
  daily_total: number | null;
  remarks: string;
}

interface ConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  weekEnding: string;
  entries: TimesheetEntry[];
  regNumber: string;
  submitting: boolean;
}

export function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  weekEnding,
  entries,
  regNumber,
  submitting,
}: ConfirmationModalProps) {
  
  // Calculate summary data
  const totalHours = entries.reduce((sum, entry) => sum + (entry.daily_total || 0), 0);
  const daysWorked = entries.filter(entry => !entry.did_not_work && entry.daily_total && entry.daily_total > 0).length;
  const uniqueJobNumbers = new Set(
    entries
      .filter(entry => entry.job_number && !entry.working_in_yard)
      .map(entry => entry.job_number)
  );
  const daysWithMissingJobs = entries.filter(
    entry => !entry.did_not_work && !entry.working_in_yard && !entry.job_number
  ).length;

  // Generate warnings (Q9 requirements)
  const warnings: string[] = [];
  if (totalHours > 60) warnings.push('Total hours exceed 60 hours - please verify all entries');
  if (totalHours < 10) warnings.push('Total hours are less than 10 - please ensure this is correct');
  if (daysWorked === 0) warnings.push('No working days recorded - is this correct?');
  if (daysWithMissingJobs > 0) warnings.push(`${daysWithMissingJobs} day(s) missing job numbers`);

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !submitting && !isOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-2xl text-slate-900 dark:text-white">Confirm Timesheet Submission</DialogTitle>
          <DialogDescription className="text-slate-600 dark:text-slate-400">
            Please review your timesheet carefully before submitting
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Date Confirmation (Q9 requirement) */}
          <Alert className="bg-blue-500/10 border-blue-500/50">
            <Calendar className="h-4 w-4 text-blue-400" />
            <AlertDescription className="text-blue-600 dark:text-blue-400">
              <span className="font-semibold">Week Ending:</span> {formatDate(weekEnding)}
              <br />
              <span className="text-sm">Please confirm this is the correct week before submitting.</span>
            </AlertDescription>
          </Alert>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Total Hours */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-slate-500" />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Total Hours</p>
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatHours(totalHours)}</p>
            </div>

            {/* Days Worked */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Days Worked</p>
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{daysWorked} / 7</p>
            </div>

            {/* Job Numbers */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="h-4 w-4 text-slate-500" />
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Job Numbers</p>
              </div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{uniqueJobNumbers.size}</p>
            </div>

            {/* Vehicle */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Vehicle Reg</p>
              </div>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{regNumber || 'N/A'}</p>
            </div>
          </div>

          {/* Warnings (Q9 requirements) */}
          {warnings.length > 0 && (
            <Alert variant="warning" className="bg-amber-500/10 border-amber-500/50">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-amber-600 dark:text-amber-400">
                <p className="font-semibold mb-2">Please Review:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Day-by-Day Breakdown */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-800 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">Daily Breakdown</h3>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {entries.map((entry, index) => {
                const hasWork = entry.daily_total && entry.daily_total > 0;
                return (
                  <div 
                    key={index} 
                    className={`p-4 ${!hasWork && !entry.did_not_work ? 'bg-amber-50/50 dark:bg-amber-900/5' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-slate-900 dark:text-white w-24">{DAY_NAMES[index]}</span>
                          
                          {entry.did_not_work ? (
                            <Badge variant="secondary" className="bg-slate-200 dark:bg-slate-700">
                              <XCircle className="h-3 w-3 mr-1" />
                              Did Not Work
                            </Badge>
                          ) : (
                            <>
                              <span className="text-sm text-slate-600 dark:text-slate-400">
                                {entry.time_started && entry.time_finished
                                  ? `${entry.time_started} - ${entry.time_finished}`
                                  : 'No times'}
                              </span>
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {entry.daily_total ? `${formatHours(entry.daily_total)}h` : '0h'}
                              </span>
                            </>
                          )}
                        </div>
                        
                        {/* Additional Info */}
                        <div className="flex flex-wrap gap-2 mt-2">
                          {entry.job_number && (
                            <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-1 rounded">
                              Job: {entry.job_number}
                            </span>
                          )}
                          {entry.working_in_yard && (
                            <Badge variant="secondary" className="text-xs">
                              <Home className="h-3 w-3 mr-1" />
                              Yard Work
                            </Badge>
                          )}
                          {entry.night_shift && (
                            <Badge className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                              Night Shift
                            </Badge>
                          )}
                          {entry.bank_holiday && (
                            <Badge className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                              Bank Holiday
                            </Badge>
                          )}
                          {entry.remarks && (
                            <span className="text-xs text-slate-500 dark:text-slate-400 italic">
                              Note: {entry.remarks}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              By confirming, you certify that all times and details are correct and should be used for payroll purposes.
              Once submitted, this timesheet will be sent to your manager for approval.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
            className="border-slate-300 dark:border-slate-600"
          >
            Go Back to Edit
          </Button>
          <Button
            onClick={onConfirm}
            disabled={submitting}
            className="bg-timesheet hover:bg-timesheet-dark text-white font-semibold"
          >
            {submitting ? 'Submitting...' : 'Confirm Submission'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
