'use client';

import { useState, useEffect, useRef, useCallback, useId, useMemo, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { SearchInput } from '@/components/ui/search-input';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { reportAccessDeniedReason, type ReportAccessSnapshot, type ReportId } from '@/lib/reports/report-access';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useQueryState } from 'nuqs';
import { NuqsClientAdapter } from '@/components/providers/NuqsClientAdapter';
import { JobLabourReport } from '@/components/reports/JobLabourReport';
import { ArrowDown, ArrowRight, Calendar, CalendarDays, ClipboardCheck, Download, FileText, Loader2, SlidersHorizontal, X, type LucideIcon } from 'lucide-react';
import s from './reports.module.css';

interface BulkDownloadProgress {
  isDownloading: boolean;
  current: number;
  total: number;
  currentPart: number;
  totalParts: number;
  status: string;
}

type ReportModule = 'timesheets' | 'daily-allocation' | 'daily-checks' | 'absence-leave';
type ReportModuleFilter = 'all' | ReportModule;
type ReportKind = 'excel' | 'pdf' | 'bulk-pdf' | 'job-labour';

interface CatalogueReport {
  id: ReportId;
  module: ReportModule;
  title: string;
  description: string;
  formatLabel: 'Excel' | 'PDF';
  kind: ReportKind;
  endpoint?: string;
  filenamePrefix?: string;
  extension?: 'xlsx' | 'pdf';
  constraint?: string;
  maxDays?: number;
  usesStartDateOnly?: boolean;
}

const MODULES: Array<{ id: ReportModule; label: string; icon: LucideIcon; colour: string }> = [
  { id: 'timesheets', label: 'Timesheets', icon: FileText, colour: 'hsl(var(--timesheet-primary))' },
  { id: 'daily-allocation', label: 'Daily Allocation', icon: CalendarDays, colour: 'hsl(var(--daily-allocation-primary))' },
  { id: 'daily-checks', label: 'Daily Checks', icon: ClipboardCheck, colour: 'hsl(var(--inspection-primary))' },
  { id: 'absence-leave', label: 'Absence & Leave', icon: Calendar, colour: 'hsl(var(--absence-primary))' },
];

const CATALOGUE: CatalogueReport[] = [
  {
    id: 'timesheet-summary',
    module: 'timesheets',
    title: 'Weekly Timesheet Summary',
    description: 'Daily hours, leave-aware totals, and did-not-work details.',
    formatLabel: 'Excel',
    kind: 'excel',
    endpoint: '/api/reports/timesheets/summary',
    filenamePrefix: 'Timesheet_Summary',
    extension: 'xlsx',
    constraint: 'Uses the selected date range.',
  },
  {
    id: 'payroll-export',
    module: 'timesheets',
    title: 'Payroll Export',
    description: 'Approved worked hours with overtime and leave breakdown for payroll.',
    formatLabel: 'Excel',
    kind: 'excel',
    endpoint: '/api/reports/timesheets/payroll',
    filenamePrefix: 'Payroll_Export',
    extension: 'xlsx',
    constraint: 'Approved worked hours only.',
  },
  {
    id: 'plant-usage',
    module: 'daily-allocation',
    title: 'Plant Usage',
    description: 'Published Daily Allocation plant bookings with daily-check validation, for manual Sage entry.',
    formatLabel: 'Excel',
    kind: 'excel',
    endpoint: '/api/reports/daily-allocation/plant-usage',
    filenamePrefix: 'Plant_Usage',
    extension: 'xlsx',
    constraint: 'Limited to 62 days.',
    maxDays: 62,
  },
  {
    id: 'job-labour',
    module: 'daily-allocation',
    title: 'Job Labour',
    description: 'Timesheet-derived labour by job. Uses approved timesheet hours, not the live Daily Allocation board.',
    formatLabel: 'Excel',
    kind: 'job-labour',
    constraint: 'Up to 366 days. Timesheet-derived, not the live Daily Allocation board.',
  },
  {
    id: 'daily-checks-compliance',
    module: 'daily-checks',
    title: 'Daily Checks Compliance Summary',
    description: 'Daily check completion and compliance across van, plant, and HGV checks.',
    formatLabel: 'Excel',
    kind: 'excel',
    endpoint: '/api/reports/inspections/compliance',
    filenamePrefix: 'Daily_Checks_Compliance',
    extension: 'xlsx',
    constraint: 'Covers van, plant, and HGV daily checks.',
  },
  {
    id: 'daily-checks-defects',
    module: 'daily-checks',
    title: 'Daily Checks Defects Log',
    description: 'Reported daily check defects that need review and follow-up.',
    formatLabel: 'Excel',
    kind: 'excel',
    endpoint: '/api/reports/inspections/defects',
    filenamePrefix: 'Daily_Checks_Defects_Log',
    extension: 'xlsx',
    constraint: 'Defects reported in the selected period.',
  },
  {
    id: 'bulk-daily-check-pdfs',
    module: 'daily-checks',
    title: 'Bulk Daily Check PDFs',
    description: 'All van, plant, and HGV daily checks in range as one PDF or a ZIP split by size.',
    formatLabel: 'PDF',
    kind: 'bulk-pdf',
    endpoint: '/api/reports/inspections/bulk-pdf',
    constraint: 'Large downloads may arrive as more than one file.',
  },
  {
    id: 'absence-bookings',
    module: 'absence-leave',
    title: 'Absence & Leave Bookings',
    description: 'Approved active and archived bookings that overlap the selected date range.',
    formatLabel: 'Excel',
    kind: 'excel',
    endpoint: '/api/reports/absence-leave/bookings',
    filenamePrefix: 'Absence_Leave_Bookings',
    extension: 'xlsx',
    constraint: 'Includes active and archived approved bookings.',
  },
  {
    id: 'allowance-snapshot',
    module: 'absence-leave',
    title: 'Absence Allowance Snapshot',
    description: 'Annual leave allowance and booking totals for each employee.',
    formatLabel: 'Excel',
    kind: 'excel',
    endpoint: '/api/reports/absence-leave/allowance-totals',
    filenamePrefix: 'Absence_Allowance_Snapshot',
    extension: 'xlsx',
    constraint: 'Uses the start date only.',
    usesStartDateOnly: true,
  },
  {
    id: 'absence-weekly-print',
    module: 'absence-leave',
    title: 'Absence Weekly Print Sheet',
    description: 'Printable day-by-day sheet with national holiday flags and who is off.',
    formatLabel: 'PDF',
    kind: 'pdf',
    endpoint: '/api/reports/absence-leave/weekly-print-pdf',
    filenamePrefix: 'Absence_Weekly_Print',
    extension: 'pdf',
    constraint: 'Uses the selected date range and splits into weekly pages.',
  },
];

const ACTION_CLASS = 'h-11 w-full bg-avs-yellow text-slate-950 hover:bg-avs-yellow/90 md:h-8 md:w-auto';
const LIVE_MODULES = new Set<string>(MODULES.map((module) => module.id));
const RETIRED_TABS = new Set(['settings', 'overview', 'suggestions', 'future', 'quotes']);

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonday(date: Date): Date {
  const nextDate = new Date(date);
  const day = nextDate.getDay();
  const diff = nextDate.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(nextDate.setDate(diff));
}

function getSunday(date: Date): Date {
  const monday = getMonday(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

function lastWeekRange(): { from: string; to: string } {
  const today = new Date();
  const lastWeekEnd = new Date(today);
  lastWeekEnd.setDate(today.getDate() - today.getDay() - (today.getDay() === 0 ? 0 : 1));
  const start = getMonday(lastWeekEnd);
  const end = getSunday(start);
  return { from: formatDateInput(start), to: formatDateInput(end) };
}

function resetBulkProgress(): BulkDownloadProgress {
  return { isDownloading: false, current: 0, total: 0, currentPart: 1, totalParts: 1, status: '' };
}

function inclusiveSpanDays(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || from > to) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function resolveModuleFilter(reportTabParam: string, tabParam: string): ReportModuleFilter {
  if (reportTabParam === 'inspections' || tabParam === 'inspections') return 'daily-checks';
  if (LIVE_MODULES.has(reportTabParam)) return reportTabParam as ReportModule;
  if (LIVE_MODULES.has(tabParam)) return tabParam as ReportModule;
  return 'all';
}

function reportDateError(report: CatalogueReport, from: string, to: string): string | null {
  if (report.usesStartDateOnly) {
    if (!from) return 'Choose a snapshot date.';
    return null;
  }
  if (!from || !to) return 'Choose both a start date and an end date.';
  if (from > to) return 'The end date must be on or after the start date.';
  const span = inclusiveSpanDays(from, to);
  if (report.maxDays && span !== null && span > report.maxDays) {
    return `Choose a range of ${report.maxDays} days or fewer.`;
  }
  return null;
}

function reportFilename(report: CatalogueReport, from: string, to: string): string {
  if (report.usesStartDateOnly) return `${report.filenamePrefix}_${from}.${report.extension}`;
  return `${report.filenamePrefix}_${from}_to_${to}.${report.extension}`;
}

function downloadBase64File(fileName: string, base64Data: string, contentType: string): void {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: contentType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(anchor);
}

function PermissionDeniedControl({ reason, children }: { reason: string; children: ReactNode }) {
  const reasonId = useId();
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex w-full outline-none md:w-auto" aria-describedby={reasonId}>
              {children}
            </span>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <p id={reasonId} className={s.error}>{reason}</p>
    </>
  );
}

function ReportsContent() {
  const { hasPermission: canViewReports, loading: reportsPermissionLoading } = usePermissionCheck('reports');
  const { permissionLevels, moduleMinimumAccessLevels, permissionSnapshotState } = usePermissionSnapshot();
  const accessSnapshot = useMemo<ReportAccessSnapshot>(() => ({
    state: permissionSnapshotState,
    permissionLevels,
    moduleMinimumAccessLevels,
  }), [moduleMinimumAccessLevels, permissionLevels, permissionSnapshotState]);
  const initialRange = useMemo(() => lastWeekRange(), []);
  const [tabParam, setTabParam] = useQueryState('tab', {
    defaultValue: 'reports',
    clearOnDefault: true,
    shallow: true,
  });
  const [reportTabParam, setReportTabParam] = useQueryState('reportTab', {
    defaultValue: 'all',
    clearOnDefault: true,
    shallow: true,
  });
  const [downloadingEndpoint, setDownloadingEndpoint] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkDownloadProgress>(resetBulkProgress());
  const abortControllerRef = useRef<AbortController | null>(null);
  const setupRef = useRef<HTMLDivElement>(null);
  const setLastWeek = useCallback(() => {
    const range = lastWeekRange();
    setDateFrom(range.from);
    setDateTo(range.to);
  }, []);

  const setLastMonth = useCallback(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    setDateFrom(formatDateInput(start));
    setDateTo(formatDateInput(end));
  }, []);

  const setThisMonth = useCallback(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    setDateFrom(formatDateInput(start));
    setDateTo(formatDateInput(today));
  }, []);

  const activeFilter = resolveModuleFilter(reportTabParam, tabParam);
  const downloadLocked = Boolean(downloadingEndpoint) || bulkProgress.isDownloading;

  useEffect(() => {
    if (RETIRED_TABS.has(tabParam)) {
      void setTabParam('reports');
      return;
    }
    if (tabParam === 'inspections') {
      void setTabParam('reports');
      void setReportTabParam('daily-checks');
      return;
    }
    if (LIVE_MODULES.has(tabParam)) {
      void setTabParam('reports');
      void setReportTabParam(tabParam);
    }
  }, [tabParam, setTabParam, setReportTabParam]);

  useEffect(() => {
    if (reportTabParam === 'inspections') {
      void setReportTabParam('daily-checks');
      return;
    }
    if (reportTabParam !== 'all' && !LIVE_MODULES.has(reportTabParam)) {
      void setReportTabParam('all');
      void setTabParam('reports');
    }
  }, [reportTabParam, setReportTabParam, setTabParam]);

  useEffect(() => {
    setupRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [selectedId]);

  async function downloadReport(report: CatalogueReport): Promise<void> {
    if (reportAccessDeniedReason(report.id, accessSnapshot)) return;
    if (!report.endpoint || reportDateError(report, dateFrom, dateTo)) return;
    const endpoint = report.endpoint;
    const effectiveTo = report.usesStartDateOnly ? dateFrom : dateTo;
    const errorContextId = 'reports-download-error';
    setDownloadingEndpoint(endpoint);
    try {
      const queryParams = new URLSearchParams({ dateFrom, dateTo: effectiveTo });
      const response = await fetch(`${endpoint}?${queryParams.toString()}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error('Failed to generate report', {
          id: errorContextId,
          description: payload?.error || 'Please try again or contact support.',
        });
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = reportFilename(report, dateFrom, dateTo);
      document.body.appendChild(anchor);
      anchor.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(anchor);
    } catch (error) {
      console.error('Error downloading report:', error, { errorContextId, endpoint });
      toast.error('Failed to download report', {
        id: errorContextId,
        description: 'Please try again or contact support if the issue persists.',
      });
    } finally {
      setDownloadingEndpoint(null);
    }
  }

  async function downloadBulkInspectionPDFs(): Promise<void> {
    const bulkReport = CATALOGUE.find((report) => report.kind === 'bulk-pdf');
    if (!bulkReport || reportAccessDeniedReason(bulkReport.id, accessSnapshot) || reportDateError(bulkReport, dateFrom, dateTo)) return;
    const errorContextId = 'reports-bulk-inspection-download-error';
    abortControllerRef.current = new AbortController();
    setBulkProgress({
      isDownloading: true,
      current: 0,
      total: 0,
      currentPart: 1,
      totalParts: 1,
      status: 'Generating daily check PDFs...',
    });
    try {
      const response = await fetch('/api/reports/inspections/bulk-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo }),
        signal: abortControllerRef.current.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error('Failed to generate daily check PDFs', {
          id: errorContextId,
          description: payload?.error || 'Please try again or contact support.',
        });
        setBulkProgress(resetBulkProgress());
        return;
      }
      if (!response.body) {
        toast.error('Failed to generate daily check PDFs', {
          id: errorContextId,
          description: 'No stream received from server.',
        });
        setBulkProgress(resetBulkProgress());
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;
      while (!completed) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line) as {
            type?: 'init' | 'progress' | 'complete';
            total?: number;
            numParts?: number;
            current?: number;
            currentPart?: number;
            totalParts?: number;
            fileName?: string;
            contentType?: string;
            data?: string;
            error?: string;
          };
          if (data.error) {
            toast.error('Failed during bulk PDF generation', { id: errorContextId, description: data.error });
            setBulkProgress(resetBulkProgress());
            completed = true;
            break;
          }
          if (data.type === 'init') {
            setBulkProgress((prev) => ({ ...prev, total: data.total || 0, totalParts: data.numParts || 1 }));
          }
          if (data.type === 'progress') {
            setBulkProgress((prev) => ({
              ...prev,
              current: data.current || 0,
              total: data.total || prev.total,
              currentPart: data.currentPart || prev.currentPart,
              totalParts: data.totalParts || prev.totalParts,
            }));
          }
          if (data.type === 'complete' && data.data && data.fileName && data.contentType) {
            downloadBase64File(data.fileName, data.data, data.contentType);
            setBulkProgress(resetBulkProgress());
            completed = true;
            break;
          }
        }
        if (done) break;
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        console.error('Error downloading bulk daily check PDFs:', error, { errorContextId });
        toast.error('Failed to download bulk daily check PDFs', {
          id: errorContextId,
          description: 'Please try again or contact support if the issue persists.',
        });
      }
      setBulkProgress(resetBulkProgress());
    }
  }

  const query = search.trim().toLowerCase();
  const visibleReports = CATALOGUE.filter((report) => {
    const moduleLabel = MODULES.find((module) => module.id === report.module)?.label ?? '';
    const matchesQuery = !query || `${report.title} ${report.description} ${moduleLabel} ${report.formatLabel}`.toLowerCase().includes(query);
    if (query) return matchesQuery;
    return activeFilter === 'all' || report.module === activeFilter;
  });

  function resetFilters() {
    setSearch('');
    void setReportTabParam('all');
  }

  function selectReport(reportId: string) {
    if (downloadLocked) return;
    setSelectedId((current) => current === reportId ? null : reportId);
  }

  if (reportsPermissionLoading) {
    return (
      <AppPageLoadingShell
        title="Reports"
        description="Generate operational reports for the modules you can access."
        message="Preparing reports..."
        accent="brand"
      />
    );
  }

  if (!canViewReports) return null;

  const selectedReport = CATALOGUE.find((report) => report.id === selectedId) ?? null;

  return (
    <AppPageShell>
      <AppPageHeader
        title="Reports"
        description="Generate operational reports for the modules you can access."
      />

      <div className={s.overview}>
        <div className={s.toolbar}>
          <SearchInput
            aria-label="Search reports"
            placeholder="Search all 10 reports"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            containerClassName={s.search}
            disabled={downloadLocked}
          />
          {visibleReports.length > 0 && (query || activeFilter !== 'all') && (
            <Button type="button" variant="ghost" className={s.reset} onClick={resetFilters} disabled={downloadLocked}>
              {query ? 'Clear search' : 'Show all reports'}
            </Button>
          )}
        </div>

        {visibleReports.length === 0 ? (
          <div className={s.empty}>
            <p>No reports match this search.</p>
            <Button type="button" variant="outline" onClick={resetFilters}>Clear search</Button>
          </div>
        ) : (
          <div className={s.bands}>
            {MODULES.filter((module) => visibleReports.some((report) => report.module === module.id)).map((module) => {
              const reports = visibleReports.filter((report) => report.module === module.id);
              const tint = { '--module-colour': module.colour } as CSSProperties;
              const Icon = module.icon;
              const moduleSelection = selectedReport?.module === module.id ? selectedReport : null;
              return (
                <section key={module.id} className={s.moduleSection} style={tint} aria-label={module.label}>
                  <div className={s.moduleIdentity}>
                    <Icon size={30} strokeWidth={1.4} aria-hidden="true" />
                    <h2>{module.label}</h2>
                    <small>{reports.length} {reports.length === 1 ? 'report' : 'reports'}</small>
                  </div>
                  <div className={s.moduleReportList}>
                    {reports.map((report) => (
                      <button
                        type="button"
                        key={report.id}
                        className={selectedId === report.id ? s.chosen : undefined}
                        aria-expanded={selectedId === report.id}
                        aria-controls={selectedId === report.id ? 'report-setup' : undefined}
                        disabled={downloadLocked}
                        onClick={() => selectReport(report.id)}
                      >
                        <span>
                          <strong>{report.title}</strong>
                          <small>{report.description}</small>
                        </span>
                        <em>{report.formatLabel}</em>
                        {selectedId === report.id
                          ? <ArrowDown size={18} aria-hidden="true" />
                          : <ArrowRight size={18} aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                  {moduleSelection && (
                    <ReportSetup
                      report={moduleSelection}
                      moduleLabel={module.label}
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      accessDeniedReason={reportAccessDeniedReason(moduleSelection.id, accessSnapshot)}
                      locked={downloadLocked}
                      busy={moduleSelection.kind === 'bulk-pdf' ? bulkProgress.isDownloading : downloadingEndpoint === moduleSelection.endpoint}
                      bulkProgress={bulkProgress}
                      setupRef={setupRef}
                      onClose={() => { if (!downloadLocked) setSelectedId(null); }}
                      onDateFrom={(value) => { if (!downloadLocked) setDateFrom(value); }}
                      onDateTo={(value) => { if (!downloadLocked) setDateTo(value); }}
                      onLastWeek={setLastWeek}
                      onLastMonth={setLastMonth}
                      onThisMonth={setThisMonth}
                      onDownload={() => {
                        if (reportAccessDeniedReason(moduleSelection.id, accessSnapshot)) return;
                        if (moduleSelection.kind === 'bulk-pdf') void downloadBulkInspectionPDFs();
                        else void downloadReport(moduleSelection);
                      }}
                    />
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </AppPageShell>
  );
}

function ReportSetup({
  report,
  moduleLabel,
  dateFrom,
  dateTo,
  accessDeniedReason,
  locked,
  busy,
  bulkProgress,
  setupRef,
  onClose,
  onDateFrom,
  onDateTo,
  onLastWeek,
  onLastMonth,
  onThisMonth,
  onDownload,
}: {
  report: CatalogueReport;
  moduleLabel: string;
  dateFrom: string;
  dateTo: string;
  accessDeniedReason: string | null;
  locked: boolean;
  busy: boolean;
  bulkProgress: BulkDownloadProgress;
  setupRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onDateFrom: (value: string) => void;
  onDateTo: (value: string) => void;
  onLastWeek: () => void;
  onLastMonth: () => void;
  onThisMonth: () => void;
  onDownload: () => void;
}) {
  const dateError = report.kind === 'job-labour' ? null : reportDateError(report, dateFrom, dateTo);
  const downloadLabel = report.formatLabel === 'PDF' ? 'Download PDF' : 'Download Excel';
  return (
    <div ref={setupRef} className={s.setup} id="report-setup">
      <div className={s.setupBar}>
        <span><SlidersHorizontal size={16} aria-hidden="true" /> Report setup</span>
        <button type="button" aria-label="Close report setup" onClick={onClose} disabled={locked}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className={s.setupBody}>
        <div className={s.setupCopy}>
          <p>{moduleLabel}</p>
          <h3>{report.title}</h3>
          <p>{report.description}</p>
        </div>
        <div>
          <div className={s.controlHeading}>
            <h3>{report.usesStartDateOnly ? 'Snapshot date' : 'Reporting period'}</h3>
            <span>{report.formatLabel}</span>
          </div>
          <div className={`${s.dateFields} ${report.usesStartDateOnly ? s.snapshotDates : ''}`}>
            <div>
              <Label htmlFor="report-date-from">{report.usesStartDateOnly ? 'As at' : 'From'}</Label>
              <Input id="report-date-from" className={s.dateInput} type="date" value={dateFrom} disabled={locked} onChange={(event) => onDateFrom(event.target.value)} />
            </div>
            {!report.usesStartDateOnly && (
              <div>
                <Label htmlFor="report-date-to">To</Label>
                <Input id="report-date-to" className={s.dateInput} type="date" value={dateTo} disabled={locked} onChange={(event) => onDateTo(event.target.value)} />
              </div>
            )}
          </div>
          <div className={s.presets}>
            <Button type="button" variant="outline" size="sm" className="h-11 md:h-8" onClick={onLastWeek} disabled={locked}>Last Week</Button>
            <Button type="button" variant="outline" size="sm" className="h-11 md:h-8" onClick={onLastMonth} disabled={locked}>Last Month</Button>
            <Button type="button" variant="outline" size="sm" className="h-11 md:h-8" onClick={onThisMonth} disabled={locked}>This Month</Button>
          </div>
          {report.constraint ? <p className={s.note}>{report.constraint}</p> : null}
          {dateError ? <p role="alert" className={s.error}>{dateError}</p> : null}
          {report.kind !== 'job-labour' && (
            accessDeniedReason ? (
              <PermissionDeniedControl reason={accessDeniedReason}>
                <Button
                  type="button"
                  onClick={() => { if (!accessDeniedReason) onDownload(); }}
                  disabled
                  aria-label={`${downloadLabel} for ${report.title}`}
                  className={`${ACTION_CLASS} pointer-events-none mt-4`}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {downloadLabel}
                </Button>
              </PermissionDeniedControl>
            ) : (
              <Button
                type="button"
                onClick={onDownload}
                disabled={busy || Boolean(dateError)}
                aria-label={`${downloadLabel} for ${report.title}`}
                className={`${ACTION_CLASS} mt-4`}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {downloadLabel}
              </Button>
            )
          )}
          {report.kind === 'bulk-pdf' && bulkProgress.isDownloading && (
            <div className={s.progress}>
              <Progress value={bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0} aria-label="Bulk PDF progress" />
              <p className="text-xs text-muted-foreground">
                {bulkProgress.total > 0
                  ? `Processing ${bulkProgress.current} of ${bulkProgress.total} daily checks${bulkProgress.totalParts > 1 ? ` (Part ${bulkProgress.currentPart}/${bulkProgress.totalParts})` : ''}`
                  : bulkProgress.status}
              </p>
            </div>
          )}
        </div>
        {report.kind === 'job-labour' && (
          <div className={s.labour}>
            <JobLabourReport dateFrom={dateFrom} dateTo={dateTo} embedded accessDeniedReason={report.kind === 'job-labour' ? accessDeniedReason : null} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <NuqsClientAdapter>
      <ReportsContent />
    </NuqsClientAdapter>
  );
}
