'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTimesheetType } from '../hooks/useTimesheetType';
import { TimesheetRegistry, isTimesheetTypeImplemented, getTimesheetTypeLabel } from '../types/registry';

/**
 * TimesheetRouter Component
 * 
 * Phase 5: Dynamic Routing
 * Routes users to the correct timesheet component based on their role.
 * Falls back to Civils timesheet if type not implemented (Q11: Answer B).
 */

interface TimesheetRouterProps {
  weekEnding: string;
  existingId: string | null;
  userId: string;
}

export function TimesheetRouter({ weekEnding, existingId, userId }: TimesheetRouterProps) {
  const { timesheetType, loading, error } = useTimesheetType(userId);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-timesheet mx-auto"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading timesheet...</p>
        </div>
      </div>
    );
  }

  // Error state (should rarely happen - falls back to default)
  if (error) {
    console.error('Timesheet routing error:', error);
    // Still show default timesheet despite error
  }

  // Get the timesheet component from registry
  const TimesheetComponent = timesheetType ? TimesheetRegistry[timesheetType] : null;

  // Timesheet type not implemented (Q11: Fallback to civils with warning)
  if (!TimesheetComponent || !isTimesheetTypeImplemented(timesheetType || '')) {
    const attemptedType = timesheetType || 'unknown';
    const attemptedLabel = getTimesheetTypeLabel(attemptedType);
    
    // Fall back to civils timesheet (Q11: Answer B)
    const CivilsTimesheet = TimesheetRegistry['civils'];
    
    return (
      <div className="space-y-4 max-w-5xl">
        {/* Warning Banner */}
        <Alert className="bg-amber-500/10 border-amber-500/50">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <AlertDescription className="text-amber-600 dark:text-amber-400">
            <p className="font-semibold mb-2">Timesheet Type Not Available</p>
            <p className="text-sm mb-3">
              Your role is configured to use <span className="font-semibold">{attemptedLabel}</span>, 
              but this timesheet type is not yet available. You&apos;ve been given the standard Civils timesheet instead.
            </p>
            <p className="text-sm">
              Please contact your administrator if you believe this is incorrect.
            </p>
          </AlertDescription>
        </Alert>

        {/* Show civils timesheet as fallback */}
        {CivilsTimesheet ? (
          <CivilsTimesheet weekEnding={weekEnding} existingId={existingId} userId={userId} />
        ) : (
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-red-500">System Error</CardTitle>
              <CardDescription>
                No timesheet components are available. Please contact your administrator.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/timesheets">
                <Button variant="outline">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Timesheets
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Success: Render the correct timesheet component
  return <TimesheetComponent weekEnding={weekEnding} existingId={existingId} userId={userId} />;
}
