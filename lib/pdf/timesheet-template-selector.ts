import type { Timesheet } from '@/types/timesheet';

export function shouldUsePlantTimesheetV2Template(
  timesheet: Pick<Timesheet, 'timesheet_type' | 'template_version'>
): boolean {
  return timesheet.timesheet_type === 'plant' && timesheet.template_version === 2;
}
