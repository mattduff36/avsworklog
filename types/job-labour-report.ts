export const JOB_LABOUR_MAX_JOB_CODES = 20;
export const JOB_LABOUR_MAX_RANGE_DAYS = 366;
export const JOB_LABOUR_DEFAULT_HOURS_PER_DAY = 8;
export const JOB_LABOUR_MIN_HOURS_PER_DAY = 0.25;
export const JOB_LABOUR_MAX_HOURS_PER_DAY = 24;
export const JOB_LABOUR_INCLUDED_STATUSES = ['approved', 'processed'] as const;

export type JobLabourIncludedStatus = (typeof JOB_LABOUR_INCLUDED_STATUSES)[number];
export type JobLabourReportFormat = 'json' | 'xlsx';

export interface JobLabourReportFilters {
  dateFrom: string;
  dateTo: string;
  hoursPerDay: number;
  jobCodes: string[];
}

export interface JobLabourDetailRow {
  date: string;
  employeeLabel: string;
  jobCode: string;
  allocatedHours: number;
  manDays: number;
  dailyHours: number;
  jobCodes: string[];
  split: boolean;
  status: JobLabourIncludedStatus;
}

export interface JobLabourJobSummary {
  jobCode: string;
  allocatedHours: number;
  manDays: number;
  entryCount: number;
}

export interface JobLabourTotals {
  allocatedHours: number;
  manDays: number;
  entryCount: number;
}

export interface JobLabourMethodology {
  dateFrom: string;
  dateTo: string;
  hoursPerDay: number;
  includedStatuses: typeof JOB_LABOUR_INCLUDED_STATUSES;
  splitRule: string;
  plantHoursRule: string;
  exclusions: string;
  weekSelection: string;
  rounding: string;
}

export interface JobLabourReport {
  filters: JobLabourReportFilters;
  summary: JobLabourJobSummary[];
  detail: JobLabourDetailRow[];
  totals: JobLabourTotals;
  unmatchedJobCodes: string[];
  methodology: JobLabourMethodology;
}
