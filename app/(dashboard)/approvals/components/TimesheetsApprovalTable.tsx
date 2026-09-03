'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';
import { collectUniqueJobNumbers } from '@/lib/utils/timesheet-job-codes';
import { TimesheetSubmittedActions } from './TimesheetSubmittedActions';
import { TimesheetStatusChips } from '@/components/timesheets/TimesheetStatusChips';

interface TimesheetEntry {
  day_of_week: number;
  daily_total: number | null;
  job_number: string | null;
  job_numbers?: string[];
  timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }>;
  working_in_yard: boolean;
  did_not_work: boolean;
}

interface TimesheetWithProfile extends Timesheet {
  user: {
    full_name: string;
    employee_id: string;
  };
  timesheet_entries?: TimesheetEntry[];
  leave_total_display?: string;
  leave_worked_hours?: number;
  leave_days?: number;
}

export interface ColumnVisibility {
  employeeId: boolean;
  totalHours: boolean;
  jobNumber: boolean;
  status: boolean;
  submittedAt: boolean;
}

export const COLUMN_VISIBILITY_STORAGE_KEY = 'timesheets-approval-table-column-visibility';

export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  employeeId: false,
  totalHours: true,
  jobNumber: true,
  status: true,
  submittedAt: true,
};

interface TimesheetsApprovalTableProps {
  timesheets: TimesheetWithProfile[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onProcess: (id: string) => void;
  columnVisibility: ColumnVisibility;
  visibleCount?: number;
  busyTimesheetIds?: ReadonlySet<string>;
  showPayrollReceived?: boolean;
  showPayrollEdit?: boolean;
}

type SortField = 'name' | 'date' | 'totalHours' | 'status' | 'submittedAt';
type SortDirection = 'asc' | 'desc';

function computeTotalHours(entries?: TimesheetEntry[]): number {
  if (!entries || entries.length === 0) return 0;
  return entries.reduce((sum, e) => sum + (e.daily_total || 0), 0);
}

function computeJobNumbers(entries?: TimesheetEntry[]): string {
  if (!entries || entries.length === 0) return '-';
  const unique = collectUniqueJobNumbers(entries, {
    excludeDidNotWork: true,
    excludeWorkingInYard: true,
  });
  return unique.length > 0 ? unique.join(', ') : '-';
}

export function TimesheetsApprovalTable({
  timesheets,
  onApprove,
  onReject,
  onProcess,
  columnVisibility,
  visibleCount,
  busyTimesheetIds,
  showPayrollReceived = true,
  showPayrollEdit = false,
}: TimesheetsApprovalTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedTimesheets = useMemo(() => {
    return [...timesheets].sort((a, b) => {
      const m = sortDirection === 'asc' ? 1 : -1;

      switch (sortField) {
        case 'name':
          return m * (a.user?.full_name || '').localeCompare(b.user?.full_name || '');
        case 'date':
          return m * (new Date(a.week_ending).getTime() - new Date(b.week_ending).getTime());
        case 'totalHours':
          return m * ((a.leave_worked_hours ?? computeTotalHours(a.timesheet_entries)) - (b.leave_worked_hours ?? computeTotalHours(b.timesheet_entries)));
        case 'status':
          return m * (a.status || '').localeCompare(b.status || '');
        case 'submittedAt':
          return m * ((a.submitted_at || '').localeCompare(b.submitted_at || ''));
        default:
          return 0;
      }
    });
  }, [timesheets, sortField, sortDirection]);
  const visibleTimesheets = useMemo(
    () => sortedTimesheets.slice(0, visibleCount ?? sortedTimesheets.length),
    [sortedTimesheets, visibleCount]
  );

  const getStatusBadge = (status: string) => <TimesheetStatusChips status={status} />;

  if (timesheets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No timesheets to display.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Table */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow className="border-border">
              <TableHead
                className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-2">
                  Name
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>

              {columnVisibility.employeeId && (
                <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                  Employee ID
                </TableHead>
              )}

              <TableHead
                className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                onClick={() => handleSort('date')}
              >
                <div className="flex items-center gap-2">
                  Week Ending
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>

              {columnVisibility.totalHours && (
                <TableHead
                  className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                  onClick={() => handleSort('totalHours')}
                >
                  <div className="flex items-center gap-2">
                    Total Hours
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
              )}

              {columnVisibility.jobNumber && (
                <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border">
                  Job Number
                </TableHead>
              )}

              {columnVisibility.status && (
                <TableHead
                  className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-2">
                    Status
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
              )}

              {columnVisibility.submittedAt && (
                <TableHead
                  className="bg-slate-900 text-muted-foreground cursor-pointer hover:bg-slate-800 border-b-2 border-border"
                  onClick={() => handleSort('submittedAt')}
                >
                  <div className="flex items-center gap-2">
                    Submitted
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
              )}

              <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTimesheets.map((ts) => {
              const totalHours = ts.leave_worked_hours ?? computeTotalHours(ts.timesheet_entries);
              const totalDisplay = ts.leave_days !== undefined
                ? formatLeaveAwareWeeklyDisplayMultiline(totalHours, ts.leave_days)
                : (ts.leave_total_display || (totalHours > 0 ? `${totalHours.toFixed(1)}h` : '-'));
              const jobNumbers = computeJobNumbers(ts.timesheet_entries);

              return (
                <TableRow
                  key={ts.id}
                  className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => router.push(`/timesheets/${ts.id}`)}
                >
                  <TableCell className="font-medium text-white">
                    {ts.user?.full_name || 'Unknown'}
                  </TableCell>

                  {columnVisibility.employeeId && (
                    <TableCell className="text-muted-foreground">
                      {ts.user?.employee_id || '-'}
                    </TableCell>
                  )}

                  <TableCell className="text-muted-foreground">
                    {formatDate(ts.week_ending)}
                  </TableCell>

                  {columnVisibility.totalHours && (
                    <TableCell className="text-muted-foreground font-mono whitespace-pre-line">
                      {totalDisplay}
                    </TableCell>
                  )}

                  {columnVisibility.jobNumber && (
                    <TableCell className="text-muted-foreground font-mono max-w-[200px] truncate" title={jobNumbers}>
                      {jobNumbers}
                    </TableCell>
                  )}

                  {columnVisibility.status && (
                    <TableCell>
                      {getStatusBadge(ts.status)}
                    </TableCell>
                  )}

                  {columnVisibility.submittedAt && (
                    <TableCell className="text-muted-foreground text-sm">
                      {ts.submitted_at ? formatDate(ts.submitted_at) : '-'}
                    </TableCell>
                  )}

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <TimesheetSubmittedActions
                        timesheetId={ts.id}
                        status={ts.status}
                        busy={Boolean(busyTimesheetIds?.has(ts.id))}
                        showPayrollReceived={showPayrollReceived}
                        showPayrollEdit={showPayrollEdit}
                        onApprove={onApprove}
                        onReject={onReject}
                        onProcess={onProcess}
                        onEdit={() => router.push(`/timesheets/${ts.id}`)}
                        rejectClassName="border-red-300 text-red-600 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-600 active:scale-95 transition-all h-8 px-2"
                        approveClassName="border-green-300 text-green-600 hover:bg-green-500 hover:text-white hover:border-green-500 active:bg-green-600 active:scale-95 transition-all h-8 px-2"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
