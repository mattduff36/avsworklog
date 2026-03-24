'use client';

import { CivilsTimesheet } from '../civils/CivilsTimesheet';

interface PlantTimesheetProps {
  weekEnding: string;
  existingId: string | null;
  userId?: string;
}

export function PlantTimesheet(props: PlantTimesheetProps) {
  return <CivilsTimesheet {...props} timesheetType="plant" />;
}
