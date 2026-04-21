import { describe, expect, it } from 'vitest';
import {
  collectUniqueJobNumbers,
  formatEntryJobNumbers,
  getEntryJobNumbers,
  hasDuplicateJobNumbers,
  normalizeJobNumberInput,
} from '@/lib/utils/timesheet-job-codes';

describe('timesheet job code helpers', () => {
  it('normalizes manual input into the expected job format', () => {
    expect(normalizeJobNumberInput('1234ab')).toBe('1234-AB');
    expect(normalizeJobNumberInput('12 34-ab-99')).toBe('1234-AB');
  });

  it('prefers ordered child job-code rows over the legacy scalar field', () => {
    expect(
      getEntryJobNumbers({
        job_number: '9999-ZZ',
        timesheet_entry_job_codes: [
          { job_number: '5678-CD', display_order: 1 },
          { job_number: '1234-AB', display_order: 0 },
        ],
      })
    ).toEqual(['1234-AB', '5678-CD']);
  });

  it('collects unique job codes across entries while skipping yard and did-not-work rows', () => {
    expect(
      collectUniqueJobNumbers(
        [
          {
            day_of_week: 1,
            did_not_work: false,
            working_in_yard: false,
            job_numbers: ['1234-AB', '5678-CD'],
          },
          {
            day_of_week: 2,
            did_not_work: false,
            working_in_yard: true,
            job_numbers: ['9999-ZZ'],
          },
          {
            day_of_week: 3,
            did_not_work: true,
            working_in_yard: false,
            job_numbers: ['7777-AA'],
          },
          {
            day_of_week: 4,
            did_not_work: false,
            working_in_yard: false,
            timesheet_entry_job_codes: [
              { job_number: '5678-CD', display_order: 0 },
              { job_number: '2468-EF', display_order: 1 },
            ],
          },
        ],
        { excludeDidNotWork: true, excludeWorkingInYard: true }
      )
    ).toEqual(['1234-AB', '5678-CD', '2468-EF']);
  });

  it('formats multiple job codes for display and detects duplicates', () => {
    expect(formatEntryJobNumbers({ job_numbers: ['1234-AB', '5678-CD'] })).toBe('1234-AB, 5678-CD');
    expect(hasDuplicateJobNumbers(['1234-AB', '1234ab'])).toBe(true);
  });
});
