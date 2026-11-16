import type { JobCatalogueRecord } from '@/types/job-catalogue';
import type { GuestPlantJob } from './guest-plant';
import { numericJobCode } from './guest-plant';
import { normalizeJobNumberInput } from '@/lib/utils/timesheet-job-codes';
import { isPlantDailyCheckCatalogueOptionSelectable } from '@/lib/utils/job-catalogue';

// Same minimum and matching rules as JobCodePicker; never send the full catalogue to a guest.
export function searchGuestPlantJobs(records: JobCatalogueRecord[], search: string): GuestPlantJob[] {
  const query = search.trim().toLowerCase();
  if (query.replace(/\s+/g, '').length < 3) return [];
  const code = normalizeJobNumberInput(search).toLowerCase();
  return records.filter(record => record.is_active && isPlantDailyCheckCatalogueOptionSelectable({
    source: record.source_type, blockReason: record.block_reason,
  }) && ([record.job_code, record.customer_name, record.title].filter(Boolean).join(' ').toLowerCase().includes(query)
    || Boolean(code && record.job_code.toLowerCase().includes(code))))
    .slice(0, 80).map(record => ({ sourceType: record.source_type, sourceId: record.source_id,
      code: record.job_code, title: record.title, customerName: record.customer_name }));
}

export function guestJobCodeMatches(actual: string, submitted: string): boolean {
  // Keep already-open clients and exact-payload retries compatible with the original numeric input.
  return /^\d{1,12}$/.test(submitted) ? numericJobCode(actual) === submitted
    : actual.trim().toUpperCase() === submitted.trim().toUpperCase();
}
