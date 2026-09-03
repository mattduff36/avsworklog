'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { collectUniqueJobNumbers } from '@/lib/utils/timesheet-job-codes';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface TimesheetPreviewEntry {
  day_of_week: number;
  daily_total: number | null;
  job_number: string | null;
  job_numbers?: string[];
  timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }>;
  working_in_yard: boolean;
  did_not_work: boolean;
}

interface TimesheetApprovalPreviewProps {
  timesheetId: string;
  entries?: TimesheetPreviewEntry[];
}

function formatDayHours(entry: TimesheetPreviewEntry | undefined): string {
  if (!entry) return '-';
  if (entry.did_not_work) return 'Off';
  if (entry.working_in_yard) return 'Yard';
  if (typeof entry.daily_total === 'number' && entry.daily_total > 0) {
    return `${entry.daily_total.toFixed(1)}h`;
  }
  return '-';
}

export function TimesheetApprovalPreview({ timesheetId, entries }: TimesheetApprovalPreviewProps) {
  const byDay = new Map((entries || []).map((entry) => [entry.day_of_week, entry]));
  const jobs = collectUniqueJobNumbers(entries || [], {
    excludeDidNotWork: true,
    excludeWorkingInYard: true,
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground"
          aria-label="Preview timesheet"
          onClick={(event) => {
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="sr-only">Preview</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 bg-slate-900 border-border"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Week preview</p>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
            {DAY_LABELS.map((label, index) => {
              const entry = byDay.get(index + 1);
              return (
                <div key={label} className="rounded-md border border-border/70 px-1 py-1.5">
                  <p className="text-muted-foreground">{label}</p>
                  <p className="font-mono text-foreground">{formatDayHours(entry)}</p>
                </div>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            Jobs: {jobs.length > 0 ? jobs.join(', ') : '-'}
          </p>
          <Button asChild variant="outline" size="sm" className="w-full border-border">
            <Link href={`/timesheets/${timesheetId}`}>Open timesheet</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
