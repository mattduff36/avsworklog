'use client';

import { Suspense } from 'react';
import { CivilsTimesheet } from '../types/civils/CivilsTimesheet';
/**
 * New Timesheet Page
 * 
 * This is the entry point for creating/editing timesheets.
 * Currently routes directly to CivilsTimesheet.
 * In Phase 5, this will become a router that selects the correct
 * timesheet type based on the user's role.
 */

export default function NewTimesheetPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><p className="text-muted-foreground">Loading...</p></div>}>
      <CivilsTimesheet />
    </Suspense>
  );
}
