'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { TimesheetRouter } from '../components/TimesheetRouter';
import { WeekSelector } from '../components/WeekSelector';
import { createClient } from '@/lib/supabase/client';

/**
 * New Timesheet Page
 * 
 * Phase 5: Dynamic Routing System
 * - Shows WeekSelector first (validates date, checks duplicates)
 * - Routes to correct timesheet type based on user's role
 * - Falls back to civils with warning if type not implemented
 * - Editing existing timesheets goes straight to form (Q6: Answer A)
 */

function NewTimesheetContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const existingId = searchParams.get('id');
  
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [timesheetId, setTimesheetId] = useState<string | null>(existingId);
  const [showForm, setShowForm] = useState(false);
  const [loadedWeek, setLoadedWeek] = useState<string>('');

  // If editing existing timesheet, load its week ending and skip selector (Q6: Answer A)
  useEffect(() => {
    async function loadExistingWeek() {
      if (existingId && user) {
        try {
          const { data, error } = await supabase
            .from('timesheets')
            .select('week_ending')
            .eq('id', existingId)
            .single();
          
          if (error) throw error;
          
          setLoadedWeek(data.week_ending);
          setShowForm(true);
          setTimesheetId(existingId);
        } catch (err) {
          console.error('Error loading existing timesheet:', err);
          // Fall back to showing week selector
          setShowForm(false);
        }
      }
    }

    loadExistingWeek();
  }, [existingId, user, supabase]);

  // Handle week selection from WeekSelector
  const handleWeekSelected = (weekEnding: string, existingTimesheetId: string | null) => {
    setSelectedWeek(weekEnding);
    setTimesheetId(existingTimesheetId);
    setShowForm(true);
  };

  // Show WeekSelector for new timesheets
  if (!showForm && !existingId && user) {
    return (
      <WeekSelector
        userId={user.id}
        onWeekSelected={handleWeekSelected}
        initialWeek={null}
      />
    );
  }

  // Show router/form after week is selected or when editing
  if (showForm && user) {
    const weekToUse = existingId ? loadedWeek : (selectedWeek || '');
    
    return (
      <TimesheetRouter
        weekEnding={weekToUse}
        existingId={timesheetId}
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
