'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { CivilsTimesheet } from '../types/civils/CivilsTimesheet';
import { WeekSelector } from '../components/WeekSelector';

/**
 * New Timesheet Page
 * 
 * Phase 3: Week Selection Flow
 * - Shows WeekSelector first (validates date, checks duplicates)
 * - After valid week selected, shows CivilsTimesheet component
 * - Editing existing timesheets goes straight to form (per Q6 answer)
 * 
 * Future (Phase 5): Will route to correct timesheet type based on role
 */

function NewTimesheetContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const existingId = searchParams.get('id');
  
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [timesheetId, setTimesheetId] = useState<string | null>(existingId);
  const [showForm, setShowForm] = useState(false);

  // If editing existing timesheet, skip week selector (Q6: Answer A)
  useEffect(() => {
    if (existingId) {
      setShowForm(true);
      setTimesheetId(existingId);
    }
  }, [existingId]);

  // Handle week selection from WeekSelector
  const handleWeekSelected = (weekEnding: string, existingTimesheetId: string | null) => {
    setSelectedWeek(weekEnding);
    setTimesheetId(existingTimesheetId);
    setShowForm(true);
  };

  // Show WeekSelector for new timesheets, form for editing/after selection
  if (!showForm && user) {
    return (
      <WeekSelector
        userId={user.id}
        onWeekSelected={handleWeekSelected}
        initialWeek={null}
      />
    );
  }

  // Show form after week is selected or when editing
  if (showForm && selectedWeek && user) {
    return (
      <CivilsTimesheet
        weekEnding={selectedWeek}
        existingId={timesheetId}
        userId={user.id}
      />
    );
  }

  // Editing existing timesheet - week will be loaded from database
  if (showForm && existingId && user) {
    return (
      <CivilsTimesheet
        weekEnding="" // Will be loaded from database
        existingId={existingId}
        userId={user.id}
      />
    );
  }

  // Loading state
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}

export default function NewTimesheetPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><p className="text-muted-foreground">Loading...</p></div>}>
      <NewTimesheetContent />
    </Suspense>
  );
}
