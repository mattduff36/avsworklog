'use client';

import { CivilsTimesheet } from '../civils/CivilsTimesheet';

interface PlantTimesheetProps {
  weekEnding: string;
  existingId: string | null;
  userId?: string;
  onSelectedEmployeeChange?: (employeeId: string) => void;
}

export function PlantTimesheet(props: PlantTimesheetProps) {
  return <CivilsTimesheet {...props} timesheetType="plant" />;
}
