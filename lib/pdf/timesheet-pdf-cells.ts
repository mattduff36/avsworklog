import { formatEntryJobNumbers } from '@/lib/utils/timesheet-job-codes';
import { addSubsistenceRemark } from '@/lib/utils/timesheet-subsistence';

export function formatJobNumberOrYard(entry: {
  job_number?: string | null;
  job_numbers?: string[];
  working_in_yard?: boolean | null;
}): string {
  const formattedJobNumbers = formatEntryJobNumbers(entry);
  if (formattedJobNumbers !== '-') return formattedJobNumbers;
  if (entry.working_in_yard) return 'Yard';
  return '';
}

export function formatGenericPdfRemarks(entry: {
  remarks?: string | null;
  subsistence_payment_required?: boolean | null;
}): string {
  const remarks = entry.subsistence_payment_required
    ? addSubsistenceRemark(entry.remarks)
    : entry.remarks;
  return remarks || '';
}
