'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { JobLabourFiltersSchema } from '@/lib/validation/job-labour-report';
import type { JobLabourReport as Report } from '@/types/job-labour-report';

const endpoint = '/api/reports/timesheets/job-labour';
const number = (value: number) => value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function DeniedLabourActions({ reason, children }: { reason: string; children: ReactNode }) {
  const reasonId = useId();
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex flex-wrap gap-2 outline-none" aria-describedby={reasonId}>
              {children}
            </span>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <p id={reasonId} className="text-sm text-muted-foreground">{reason}</p>
    </>
  );
}

export function JobLabourReport({
  dateFrom,
  dateTo,
  embedded = false,
  accessDeniedReason = null,
}: {
  dateFrom: string;
  dateTo: string;
  embedded?: boolean;
  accessDeniedReason?: string | null;
}) {
  const [jobCodes, setJobCodes] = useState('');
  const [hoursPerDay, setHoursPerDay] = useState('8');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);
  useEffect(() => {
    invalidate();
    setReport(null); setError(''); setBusy(null);
    return invalidate;
  }, [accessDeniedReason, dateFrom, dateTo, jobCodes, hoursPerDay, invalidate]);
  const parsed = JobLabourFiltersSchema.safeParse({ dateFrom, dateTo, jobCodes, hoursPerDay });

  async function run(format: 'json' | 'xlsx') {
    if (accessDeniedReason || !parsed.success) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++generation.current;
    const params = new URLSearchParams({ dateFrom, dateTo, jobCodes: parsed.data.jobCodes.join(','),
      hoursPerDay: String(parsed.data.hoursPerDay), format });
    setBusy(format === 'json' ? 'preview' : 'download'); setError('');
    if (format === 'json') setReport(null);
    try {
      const response = await fetch(`${endpoint}?${params}`, { signal: abort.signal, cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Unable to generate job labour report.');
      }
      if (format === 'json') {
        const body: Report = await response.json();
        if (id === generation.current) setReport(body);
      } else {
        const blob = await response.blob();
        if (id !== generation.current) return;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `Job_Labour_${dateFrom}_to_${dateTo}.xlsx`;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        URL.revokeObjectURL(url);
      }
    } catch (caught) {
      if (id !== generation.current || abort.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : 'Unable to generate report.';
      setError(message); toast.error(message);
    } finally {
      if (id === generation.current) setBusy(null);
    }
  }

  const form = <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-2">
          <Label htmlFor="job-labour-codes">Job codes</Label>
          <Input id="job-labour-codes" value={jobCodes} onChange={event => setJobCodes(event.target.value)} placeholder="e.g. 40065-GH, 40053-GH" aria-describedby="job-labour-codes-help" />
          <p id="job-labour-codes-help" className="text-xs text-muted-foreground">Separate codes with commas. Leave blank for all jobs. Maximum 20 codes.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="job-labour-hours">Hours per man-day</Label>
          <Input id="job-labour-hours" type="number" min="0.25" max="24" step="0.25" value={hoursPerDay} onChange={event => setHoursPerDay(event.target.value)} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Approved/processed timesheets only, filtered by actual work date. Man-day equivalents = worked hours ÷ hours per man-day. Hours on multi-job entries are split equally and marked as estimates. Hidden, deleted and system accounts, leave and yard entries are excluded.</p>
      {!parsed.success && <p role="status" className="text-sm text-muted-foreground">Choose valid dates (up to 366 days), up to 20 job codes and 0.25–24 hours per man-day.</p>}
      {accessDeniedReason ? (
        <DeniedLabourActions reason={accessDeniedReason}>
          <Button className="pointer-events-none h-11 bg-avs-yellow text-slate-950 hover:bg-avs-yellow/90 md:h-8" disabled onClick={() => run('json')}>Generate report</Button>
          <Button variant="outline" className="pointer-events-none h-11 md:h-8" disabled onClick={() => run('xlsx')}>Download Excel</Button>
        </DeniedLabourActions>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button className="h-11 bg-avs-yellow text-slate-950 hover:bg-avs-yellow/90 md:h-8" disabled={!parsed.success || busy !== null} onClick={() => run('json')}>{busy === 'preview' ? 'Generating…' : 'Generate report'}</Button>
          <Button variant="outline" className="h-11 md:h-8" disabled={!parsed.success || busy !== null} onClick={() => run('xlsx')}>{busy === 'download' ? 'Downloading…' : 'Download Excel'}</Button>
        </div>
      )}
      {busy === 'preview' && <p role="status" className="text-sm text-muted-foreground">Calculating job labour…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {report && !accessDeniedReason && <div className="min-w-0 space-y-4" aria-live="polite">
        <p className="text-sm">{report.filters.dateFrom} to {report.filters.dateTo} · {report.filters.hoursPerDay} hours per man-day</p>
        {report.unmatchedJobCodes.length > 0 && <p className="text-sm text-muted-foreground">No matching approved worked entries for: {report.unmatchedJobCodes.join(', ')}. This does not establish that no work took place.</p>}
        {report.summary.length === 0 ? <p className="text-sm text-muted-foreground">No matching worked entries found within your report permissions.</p> : <>
          <div className="overflow-x-auto">
            <Table aria-label="Job labour summary">
              <TableHeader><TableRow><TableHead>Job</TableHead><TableHead className="text-right">Allocated hours</TableHead><TableHead className="text-right">Man-day equivalents</TableHead></TableRow></TableHeader>
              <TableBody>{report.summary.map(row => <TableRow key={row.jobCode}><TableCell className="font-medium">{row.jobCode}</TableCell><TableCell className="text-right tabular-nums">{number(row.allocatedHours)}</TableCell><TableCell className="text-right tabular-nums">{number(row.manDays)}</TableCell></TableRow>)}
                <TableRow className="font-semibold"><TableCell>Total</TableCell><TableCell className="text-right tabular-nums">{number(report.totals.allocatedHours)}</TableCell><TableCell className="text-right tabular-nums">{number(report.totals.manDays)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
          {report.detail.some(row => row.split) && <p className="text-sm text-muted-foreground">Includes estimated equal splits between jobs. See daily evidence for the original worked hours and job codes.</p>}
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Daily evidence ({report.detail.length} job-day entries)</summary>
            <p className="my-3 text-xs text-muted-foreground">Preview shows up to 200 entries; Excel includes every matching entry and the calculation methodology.</p>
            <div className="max-h-96 overflow-auto">
              <Table aria-label="Job labour daily evidence"><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Employee</TableHead><TableHead>Job</TableHead><TableHead className="text-right">Hours</TableHead><TableHead>Allocation</TableHead></TableRow></TableHeader>
                <TableBody>{report.detail.slice(0, 200).map((row, index) => <TableRow key={index}><TableCell className="whitespace-nowrap">{row.date}</TableCell><TableCell>{row.employeeLabel}</TableCell><TableCell>{row.jobCode}</TableCell><TableCell className="text-right tabular-nums">{number(row.allocatedHours)}</TableCell><TableCell><span className="block">{row.split ? 'Estimated equal split' : 'Single job'}</span><span className="text-xs text-muted-foreground">{number(row.dailyHours)} daily hours · {row.jobCodes.join(', ')} · {row.status}</span></TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
          </details>
        </>}
      </div>}
    </div>;

  if (embedded) return form;

  return <Card className="border-border">
    <CardHeader>
      <CardTitle className="text-xl">Job Labour</CardTitle>
      <CardDescription>Worked hours and man-day equivalents by job, using the report dates above. Hours come from approved timesheets, not the live Daily Allocation board.</CardDescription>
    </CardHeader>
    <CardContent>{form}</CardContent>
  </Card>;
}
