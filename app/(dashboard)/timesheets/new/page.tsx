'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { TimesheetRouter } from '../components/TimesheetRouter';
import { WeekSelector } from '../components/WeekSelector';
import { createClient } from '@/lib/supabase/client';
import { PageLoader } from '@/components/ui/page-loader';

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
  const [existingTimesheetType, setExistingTimesheetType] = useState<string | null>(null);
  const [existingTemplateVersion, setExistingTemplateVersion] = useState<number | null>(null);

  // If editing existing timesheet, load its week ending and skip selector (Q6: Answer A)
  useEffect(() => {
    async function loadExistingWeek() {
      if (existingId && user) {
        try {
          const { data, error } = await supabase
            .from('timesheets')
            .select('week_ending, timesheet_type, template_version')
            .eq('id', existingId)
            .single();
          
          if (error) throw error;
          
          setLoadedWeek(data.week_ending);
          setExistingTimesheetType(data.timesheet_type || null);
          setExistingTemplateVersion(data.template_version ?? null);
          setShowForm(true);
          setTimesheetId(existingId);
        } catch (err) {
          console.error('Error loading existing timesheet:', err);
          // Fall back to showing week selector
          setExistingTimesheetType(null);
          setExistingTemplateVersion(null);
          setShowForm(false);
        }
      }
    }

    loadExistingWeek();
  }, [existingId, user, supabase]);

  // Handle week selection from WeekSelector
  const handleWeekSelected = async (weekEnding: string, existingTimesheetId: string | null) => {
    setSelectedWeek(weekEnding);
    setLoadedWeek(weekEnding);
    setTimesheetId(existingTimesheetId);

    if (!existingTimesheetId) {
      setExistingTimesheetType(null);
      setExistingTemplateVersion(null);
      setShowForm(true);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('timesheets')
        .select('timesheet_type, template_version, week_ending')
        .eq('id', existingTimesheetId)
        .single();

      if (error) throw error;

      setExistingTimesheetType(data.timesheet_type || null);
      setExistingTemplateVersion(data.template_version ?? null);
      setLoadedWeek(data.week_ending || weekEnding);
    } catch (err) {
      console.error('Error loading timesheet metadata from week selector:', err);
      // Fallback keeps current behavior but avoids stale metadata.
      setExistingTimesheetType(null);
      setExistingTemplateVersion(null);
    } finally {
      setShowForm(true);
    }
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
    
    // Don't render until we have a week (prevents blank form bug for existing timesheets)
    if (!weekToUse) {
      return <PageLoader message="Loading timesheet..." />;
    }
    
    return (
      <TimesheetRouter
        weekEnding={weekToUse}
        existingId={timesheetId}
        userId={user.id}
        existingTimesheetType={existingTimesheetType}
        existingTemplateVersion={existingTemplateVersion}
      />
    );
  }

  // Loading state
  return <PageLoader message="Loading timesheet form..." />;
}

export default function NewTimesheetPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading timesheet form..." />}>
      <NewTimesheetContent />
    </Suspense>
  );
}
