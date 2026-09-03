import { createHash } from 'crypto';
import {
  canonicalPayDayFromEntry,
  classifyTimesheetPayImpact as classifyCanonicalPayImpact,
  serializeCanonicalPayDays,
  canonicalPayWeekFromEntries,
  padCanonicalPayWeek,
  type CanonicalTimesheetPayDay,
  type ProposedTimesheetPayEntry,
} from '@/lib/utils/timesheet-pay-impact';

export type { CanonicalTimesheetPayDay, ProposedTimesheetPayEntry };
export { canonicalPayDayFromEntry, canonicalPayWeekFromEntries, padCanonicalPayWeek };

export function hashCanonicalPayDays(days: CanonicalTimesheetPayDay[]): string {
  return createHash('sha256').update(serializeCanonicalPayDays(days)).digest('hex');
}

export function classifyTimesheetPayImpact(input: {
  currentDays: CanonicalTimesheetPayDay[];
  proposedDays: CanonicalTimesheetPayDay[];
  proposedEntries?: ProposedTimesheetPayEntry[] | null;
}): { payImpact: boolean; beforeHash: string; afterHash: string } {
  const classified = classifyCanonicalPayImpact(input);
  return {
    payImpact: classified.payImpact,
    beforeHash: hashCanonicalPayDays(input.currentDays),
    afterHash: hashCanonicalPayDays(input.proposedDays),
  };
}
