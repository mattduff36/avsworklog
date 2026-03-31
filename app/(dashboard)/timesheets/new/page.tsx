'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { TimesheetRouter } from '../components/TimesheetRouter';
import { WeekSelector } from '../components/WeekSelector';
import { createClient } from '@/lib/supabase/client';
import { PageLoader } from '@/components/ui/page-loader';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { Employee } from '@/types/common';

/**
 * New Timesheet Page
 * 
 * Phase 5: Dynamic Routing System
 * - Shows WeekSelector first (validates date, checks duplicates)
 * - Routes to correct timesheet type based on user's role
 * - Falls back to the standard timesheet with warning if type not implemented
 * - Editing existing timesheets goes straight to form (Q6: Answer A)
 */

function NewTimesheetContent() {
  const { user, isManager, isAdmin, isSuperAdmin } = useAuth();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const existingId = searchParams.get('id');
  const hasElevatedPermissions = isSuperAdmin || isManager || isAdmin;
  
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [timesheetId, setTimesheetId] = useState<string | null>(existingId);
  const [showForm, setShowForm] = useState(false);
  const [loadedWeek, setLoadedWeek] = useState<string>('');
  const [existingTimesheetType, setExistingTimesheetType] = useState<string | null>(null);
  const [existingTemplateVersion, setExistingTemplateVersion] = useState<number | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [employeeOptions, setEmployeeOptions] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    setSelectedEmployeeId((current) => current || user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!user || !hasElevatedPermissions || existingId) return;
    let cancelled = false;

    const loadEmployeeOptions = async () => {
      setLoadingEmployees(true);
      try {
        const directory = await fetchUserDirectory({ module: 'timesheets' });
        if (cancelled) return;

        const options = directory.map((employee) => ({
          id: employee.id,
          full_name: employee.full_name || 'Unknown User',
          employee_id: employee.employee_id,
          has_module_access: employee.has_module_access,
        }));
        setEmployeeOptions(options);
      } catch (error) {
        if (!cancelled) console.error('Error loading employee options for week selector:', error);
      } finally {
        if (!cancelled) setLoadingEmployees(false);
      }
    };

    void loadEmployeeOptions();
    return () => {
      cancelled = true;
    };
  }, [existingId, hasElevatedPermissions, user]);

  const handleSelectedEmployeeChange = (nextEmployeeId: string) => {
    if (!nextEmployeeId) return;
    setSelectedEmployeeId(nextEmployeeId);

    // Employee context switched for a new-sheet flow; reset any prior row metadata.
    if (!existingId) {
      setTimesheetId(null);
      setExistingTimesheetType(null);
      setExistingTemplateVersion(null);
    }
  };

  // If editing existing timesheet, load its week ending and skip selector (Q6: Answer A)
  useEffect(() => {
    async function loadExistingWeek() {
      if (existingId && user) {
        try {
          const { data, error } = await supabase
            .from('timesheets')
            .select('week_ending, timesheet_type, template_version, user_id')
            .eq('id', existingId)
            .single();
          
          if (error) throw error;
          
          setLoadedWeek(data.week_ending);
          setExistingTimesheetType(data.timesheet_type || null);
          setExistingTemplateVersion(data.template_version ?? null);
          setSelectedEmployeeId(data.user_id || user.id);
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
        .select('timesheet_type, template_version, week_ending, user_id')
        .eq('id', existingTimesheetId)
        .single();

      if (error) throw error;

      setExistingTimesheetType(data.timesheet_type || null);
      setExistingTemplateVersion(data.template_version ?? null);
      setLoadedWeek(data.week_ending || weekEnding);
      setSelectedEmployeeId(data.user_id || user?.id || '');
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
    if (hasElevatedPermissions && loadingEmployees) {
      return <PageLoader message="Loading employees..." />;
    }

    return (
      <WeekSelector
        targetUserId={selectedEmployeeId}
        onWeekSelected={handleWeekSelected}
        initialWeek={null}
        canSelectEmployee={hasElevatedPermissions}
        employees={employeeOptions}
        selectedEmployeeId={selectedEmployeeId}
        onSelectedEmployeeChange={handleSelectedEmployeeChange}
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

    if (!selectedEmployeeId) {
      return <PageLoader message="Loading selected employee..." />;
    }
    
    return (
      <TimesheetRouter
        key={`${timesheetId || 'new'}:${selectedEmployeeId}:${weekToUse}`}
        weekEnding={weekToUse}
        existingId={timesheetId}
        userId={selectedEmployeeId}
        onSelectedEmployeeChange={handleSelectedEmployeeChange}
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
