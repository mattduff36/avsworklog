'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowUpDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Timesheet } from '@/types/timesheet';
import { formatLeaveAwareWeeklyDisplayMultiline } from '@/lib/utils/timesheet-leave-totals';
import { collectUniqueJobNumbers } from '@/lib/utils/timesheet-job-codes';
import { TimesheetSubmittedActions } from './TimesheetSubmittedActions';
import { TimesheetApprovalPreview } from './TimesheetApprovalPreview';
import { TimesheetStatusChips } from '@/components/timesheets/TimesheetStatusChips';
import {
  type ApprovalsActorKind,
  getTimesheetApprovalActionVisibility,
  resolveTimesheetPrimaryGate,
} from '@/lib/utils/approvals-action-visibility';
import type { TimesheetStatusFilter } from '@/types/common';

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
  onApprove: (id: string) => Promise<void> | void;
  onReject: (id: string) => Promise<void> | void;
  onProcess: (id: string) => void;
  columnVisibility: ColumnVisibility;
  visibleCount?: number;
  busyTimesheetIds?: ReadonlySet<string>;
  actorKind?: ApprovalsActorKind;
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (id: string, selected: boolean) => void;
  onToggleVisibleSelected?: (ids: string[], selected: boolean) => void;
  statusFilter?: TimesheetStatusFilter;
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
  actorKind = 'admin',
  selectedIds,
  onToggleSelected,
  onToggleVisibleSelected,
  statusFilter,
}: TimesheetsApprovalTableProps) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const selectionEnabled = Boolean(onToggleSelected && selectedIds);

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
  const visibleIds = visibleTimesheets.map((row) => row.id);
  const allVisibleSelected =
    selectionEnabled &&
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedIds?.has(id));

  if (timesheets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No timesheets to display.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow className="border-border">
              {selectionEnabled ? (
                <TableHead className="bg-slate-900 w-10 border-b-2 border-border">
                  <Checkbox
                    checked={allVisibleSelected}
                    aria-label="Select visible timesheets"
                    onCheckedChange={(checked) => {
                      onToggleVisibleSelected?.(visibleIds, checked === true);
                    }}
                  />
                </TableHead>
              ) : null}
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

              <TableHead className="bg-slate-900 text-muted-foreground border-b-2 border-border text-right min-w-[14rem]">
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
              const visibility = getTimesheetApprovalActionVisibility({
                actorKind,
                status: ts.status,
              });
              const rowBusy = Boolean(busyTimesheetIds?.has(ts.id));

              return (
                <TableRow
                  key={ts.id}
                  className="border-slate-700 hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => router.push(`/timesheets/${ts.id}`)}
                >
                  {selectionEnabled ? (
                    <TableCell
                      onClick={(event) => event.stopPropagation()}
                      className="w-10"
                    >
                      <Checkbox
                        checked={selectedIds?.has(ts.id) ?? false}
                        disabled={rowBusy}
                        aria-label={`Select ${ts.user?.full_name || 'timesheet'}`}
                        onCheckedChange={(checked) => {
                          onToggleSelected?.(ts.id, checked === true);
                        }}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell
                    className="font-medium text-white"
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('button, a, [role="dialog"]')) {
                        event.stopPropagation();
                      }
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span>{ts.user?.full_name || 'Unknown'}</span>
                      <TimesheetApprovalPreview
                        timesheetId={ts.id}
                        entries={ts.timesheet_entries}
                      />
                    </div>
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
                      <TimesheetStatusChips status={ts.status} density="compact" />
                    </TableCell>
                  )}

                  {columnVisibility.submittedAt && (
                    <TableCell className="text-muted-foreground text-sm">
                      {ts.submitted_at ? formatDate(ts.submitted_at) : '-'}
                    </TableCell>
                  )}

                  <TableCell className="text-right">
                    <TimesheetSubmittedActions
                      timesheetId={ts.id}
                      status={ts.status}
                      busy={rowBusy}
                      compactLabels
                      showPayrollReceived={visibility.showPayrollReceived}
                      showManagerApproved={visibility.showManagerApproved}
                      showReject={visibility.showReject}
                      showPayrollEdit={visibility.showEdit}
                      primaryGate={resolveTimesheetPrimaryGate({
                        showPayrollReceived: visibility.showPayrollReceived,
                        showManagerApproved: visibility.showManagerApproved,
                        filter: statusFilter,
                      })}
                      onApprove={onApprove}
                      onReject={onReject}
                      onProcess={onProcess}
                      onEdit={() => router.push(`/timesheets/${ts.id}`)}
                    />
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
