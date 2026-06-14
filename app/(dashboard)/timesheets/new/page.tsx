'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTimesheetType } from '../hooks/useTimesheetType';
import { TimesheetRouter } from '../components/TimesheetRouter';
import { WeekSelector } from '../components/WeekSelector';
import { createClient } from '@/lib/supabase/client';
import { getErrorStatus, isAuthErrorStatus, isNetworkFetchError } from '@/lib/utils/http-error';
import { PageLoader } from '@/components/ui/page-loader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { Employee } from '@/types/common';
import { TimesheetTypeOptions, type TimesheetType } from '../types/registry';

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
  const { user, isManager, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current;
  const existingId = searchParams.get('id');
  const hasElevatedPermissions = isSuperAdmin || isManager || isAdmin;
  
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [timesheetId, setTimesheetId] = useState<string | null>(existingId);
  const [showForm, setShowForm] = useState(false);
  const [loadedWeek, setLoadedWeek] = useState<string>('');
  const [existingTimesheetType, setExistingTimesheetType] = useState<string | null>(null);
  const [existingTemplateVersion, setExistingTemplateVersion] = useState<number | null>(null);
  const [selectedTimesheetType, setSelectedTimesheetType] = useState<TimesheetType | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [employeeOptions, setEmployeeOptions] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const {
    mode: selectedEmployeeTimesheetMode,
    loading: selectedEmployeeTimesheetTypeLoading,
  } = useTimesheetType(selectedEmployeeId || undefined);

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
      setSelectedTimesheetType(null);
    }
  };

  // If editing existing timesheet, load its week ending and skip selector (Q6: Answer A)
  useEffect(() => {
    async function loadExistingWeek() {
      if (existingId && user && supabase && !authLoading) {
        try {
          const { data, error } = await supabase
            .from('timesheets')
            .select('week_ending, timesheet_type, template_version, user_id')
            .eq('id', existingId)
            .maybeSingle();
          
          if (error) throw error;
          if (!data) {
            setExistingTimesheetType(null);
            setExistingTemplateVersion(null);
          setSelectedTimesheetType(null);
            setShowForm(false);
            return;
          }
          
          setLoadedWeek(data.week_ending);
          setExistingTimesheetType(data.timesheet_type || null);
          setExistingTemplateVersion(data.template_version ?? null);
          setSelectedTimesheetType(null);
          setSelectedEmployeeId(data.user_id || user.id);
          setShowForm(true);
          setTimesheetId(existingId);
        } catch (err) {
          if (!isAuthErrorStatus(getErrorStatus(err)) && !isNetworkFetchError(err)) {
            console.error('Error loading existing timesheet:', err);
          }
          // Fall back to showing week selector
          setExistingTimesheetType(null);
          setExistingTemplateVersion(null);
          setSelectedTimesheetType(null);
          setShowForm(false);
        }
      }
    }

    void loadExistingWeek();
  }, [authLoading, existingId, user, supabase]);

  // Handle week selection from WeekSelector
  const handleWeekSelected = async (weekEnding: string, existingTimesheetId: string | null) => {
    setSelectedWeek(weekEnding);
    setLoadedWeek(weekEnding);
    setTimesheetId(existingTimesheetId);

    if (!existingTimesheetId) {
      setExistingTimesheetType(null);
      setExistingTemplateVersion(null);
      setSelectedTimesheetType(null);
      setShowForm(true);
      return;
    }

    if (!supabase) {
      setExistingTimesheetType(null);
      setExistingTemplateVersion(null);
      setSelectedTimesheetType(null);
      setShowForm(true);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('timesheets')
        .select('timesheet_type, template_version, week_ending, user_id')
        .eq('id', existingTimesheetId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setExistingTimesheetType(null);
        setExistingTemplateVersion(null);
        return;
      }

      setExistingTimesheetType(data.timesheet_type || null);
      setExistingTemplateVersion(data.template_version ?? null);
      setSelectedTimesheetType(null);
      setLoadedWeek(data.week_ending || weekEnding);
      setSelectedEmployeeId(data.user_id || user?.id || '');
    } catch (err) {
      if (!isAuthErrorStatus(getErrorStatus(err)) && !isNetworkFetchError(err)) {
        console.error('Error loading timesheet metadata from week selector:', err);
      }
      // Fallback keeps current behavior but avoids stale metadata.
      setExistingTimesheetType(null);
      setExistingTemplateVersion(null);
      setSelectedTimesheetType(null);
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

    if (!existingId && !timesheetId && selectedEmployeeTimesheetTypeLoading) {
      return <PageLoader message="Loading timesheet options..." />;
    }

    if (!existingId && !timesheetId && selectedEmployeeTimesheetMode === 'choice' && !selectedTimesheetType) {
      return (
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <Card className="border-border bg-slate-900/80">
            <CardHeader>
              <CardTitle className="text-white">Choose Timesheet Type</CardTitle>
              <CardDescription>
                Select which timesheet to create for this week. This choice only applies to the new timesheet you are creating.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {TimesheetTypeOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedTimesheetType(option.value)}
                  className="h-auto w-full justify-start border-border bg-slate-950 p-4 text-left hover:bg-slate-900"
                >
                  <span>
                    <span className="block font-semibold text-foreground">{option.label}</span>
                    <span className="mt-1 block text-sm font-normal text-muted-foreground">{option.description}</span>
                  </span>
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  setSelectedWeek(null);
                  setLoadedWeek('');
                  setSelectedTimesheetType(null);
                }}
                className="w-full text-muted-foreground hover:text-foreground"
              >
                Back to week selection
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    
    return (
      <TimesheetRouter
        key={`${timesheetId || 'new'}:${selectedEmployeeId}:${weekToUse}:${selectedTimesheetType || 'resolved'}`}
        weekEnding={weekToUse}
        existingId={timesheetId}
        userId={selectedEmployeeId}
        onSelectedEmployeeChange={handleSelectedEmployeeChange}
        existingTimesheetType={existingTimesheetType}
        existingTemplateVersion={existingTemplateVersion}
        selectedTimesheetType={selectedTimesheetType}
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
