import { z } from 'zod';
import { normalizeCatalogJobCode } from '@/lib/utils/timesheet-job-codes';
import type { JobLabourReportFilters } from '@/types/job-labour-report';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Choose a valid date.');

export const JobLabourFiltersSchema = z.object({
  dateFrom: date,
  dateTo: date,
  hoursPerDay: z.coerce.number().finite().min(0.25).max(24).default(8),
  jobCodes: z.preprocess(
    (value) => typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : value,
    z.array(z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/)
      .transform(normalizeCatalogJobCode)).max(20).default([])
  ).transform((codes) => [...new Set(codes)]),
}).refine((value) => value.dateFrom <= value.dateTo, { message: 'Date From must not be after Date To.' })
  .refine((value) => (Date.parse(value.dateTo) - Date.parse(value.dateFrom)) / 86400000 < 366,
    { message: 'Choose a date range of 366 days or fewer.' });

export function parseJobLabourFilters(params: URLSearchParams): JobLabourReportFilters {
  return JobLabourFiltersSchema.parse({
    dateFrom: params.get('dateFrom') || '', dateTo: params.get('dateTo') || '',
    hoursPerDay: params.get('hoursPerDay') ?? undefined, jobCodes: params.get('jobCodes') || '',
  });
}
