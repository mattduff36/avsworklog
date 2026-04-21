export interface TimesheetEntryJobCodeLike {
  job_number?: string | null;
  display_order?: number | null;
}

export interface TimesheetJobCodeSource {
  job_number?: string | null;
  job_numbers?: string[] | null;
  timesheet_entry_job_codes?: TimesheetEntryJobCodeLike[] | null;
}

export const JOB_NUMBER_REGEX = /^\d{4}-[A-Z]{2}$/;

export function normalizeJobNumberInput(value: string): string {
  let cleaned = value.replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
  cleaned = cleaned.replace(/-/g, '');

  if (cleaned.length > 4) {
    cleaned = `${cleaned.substring(0, 4)}-${cleaned.substring(4, 6)}`;
  }

  return cleaned.substring(0, 7);
}

export function isValidJobNumber(value: string | null | undefined): boolean {
  return JOB_NUMBER_REGEX.test(normalizeJobNumberInput(value || ''));
}

export function getNormalizedJobNumbers(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values || values.length === 0) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const next = normalizeJobNumberInput(value || '');
    if (!next) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
  }

  return normalized;
}

export function getEntryJobNumbers(source: TimesheetJobCodeSource | null | undefined): string[] {
  if (!source) return [];

  if (source.timesheet_entry_job_codes && source.timesheet_entry_job_codes.length > 0) {
    return getNormalizedJobNumbers(
      [...source.timesheet_entry_job_codes]
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .map((row) => row.job_number)
    );
  }

  if (source.job_numbers && source.job_numbers.length > 0) {
    return getNormalizedJobNumbers(source.job_numbers);
  }

  return getNormalizedJobNumbers([source.job_number]);
}

export function getPrimaryJobNumber(
  source: TimesheetJobCodeSource | Array<string | null | undefined> | null | undefined
): string | null {
  const jobNumbers = Array.isArray(source) ? getNormalizedJobNumbers(source) : getEntryJobNumbers(source);
  return jobNumbers[0] || null;
}

export function hasDuplicateJobNumbers(values: Array<string | null | undefined> | null | undefined): boolean {
  if (!values || values.length === 0) return false;
  const seen = new Set<string>();

  for (const value of values) {
    const next = normalizeJobNumberInput(value || '');
    if (!next) continue;
    if (seen.has(next)) return true;
    seen.add(next);
  }

  return false;
}

export function formatJobNumbers(jobNumbers: Array<string | null | undefined> | null | undefined): string {
  const normalized = getNormalizedJobNumbers(jobNumbers);
  return normalized.length > 0 ? normalized.join(', ') : '-';
}

export function formatEntryJobNumbers(source: TimesheetJobCodeSource | null | undefined): string {
  return formatJobNumbers(getEntryJobNumbers(source));
}

export function collectUniqueJobNumbers<T extends TimesheetJobCodeSource>(
  entries: T[] | null | undefined,
  options?: {
    excludeDidNotWork?: boolean;
    excludeWorkingInYard?: boolean;
  }
): string[] {
  if (!entries || entries.length === 0) return [];

  const collected: string[] = [];

  for (const entry of entries) {
    const shouldSkipDidNotWork =
      options?.excludeDidNotWork &&
      'did_not_work' in entry &&
      Boolean((entry as T & { did_not_work?: boolean | null }).did_not_work);
    if (shouldSkipDidNotWork) continue;

    const shouldSkipWorkingInYard =
      options?.excludeWorkingInYard &&
      'working_in_yard' in entry &&
      Boolean((entry as T & { working_in_yard?: boolean | null }).working_in_yard);
    if (shouldSkipWorkingInYard) continue;

    collected.push(...getEntryJobNumbers(entry));
  }

  return getNormalizedJobNumbers(collected);
}
