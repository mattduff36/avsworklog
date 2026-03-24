/**
 * useTimesheetType Hook
 * 
 * Fetches the appropriate timesheet type for a user based on their team.
 * Falls back to the legacy role-level setting, then the default type.
 * 
 * Phase 5: Dynamic Routing
 */

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_TIMESHEET_TYPE, TimesheetType } from '../types/registry';

interface UseTimesheetTypeReturn {
  timesheetType: TimesheetType | null;
  loading: boolean;
  error: string | null;
}

export function useTimesheetType(userId?: string): UseTimesheetTypeReturn {
  const [timesheetType, setTimesheetType] = useState<TimesheetType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function fetchTimesheetType() {
      if (!userId) {
        setTimesheetType(DEFAULT_TIMESHEET_TYPE);
        setLoading(false);
        return;
      }

      try {
        // Prefer the team-level setting, but keep the role fallback while
        // existing data is being migrated across.
        const { data, error: fetchError } = await supabase
          .from('profiles')
          .select(`
            team:org_teams!profiles_team_id_fkey (
              timesheet_type
            ),
            role:roles (
              timesheet_type
            )
          `)
          .eq('id', userId)
          .single();

        if (fetchError) throw fetchError;

        const teamData = data?.team as { timesheet_type?: string | null } | null;
        const roleData = data?.role as { timesheet_type?: string | null } | null;
        const type = (
          teamData?.timesheet_type ||
          roleData?.timesheet_type ||
          DEFAULT_TIMESHEET_TYPE
        ) as TimesheetType;

        setTimesheetType(type);
        setError(null);
      } catch (err) {
        console.error('Error fetching timesheet type:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch timesheet type');
        
        // Fallback to default on error
        setTimesheetType(DEFAULT_TIMESHEET_TYPE);
      } finally {
        setLoading(false);
      }
    }

    fetchTimesheetType();
  }, [userId, supabase]);

  return { timesheetType, loading, error };
}
