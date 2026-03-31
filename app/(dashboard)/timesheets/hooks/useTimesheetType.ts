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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

function isMissingTeamTimesheetTypeError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /org_teams.*timesheet_type.*does not exist|timesheet_type.*does not exist/i.test(message);
}

function isMissingTimesheetOverrideSchemaError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /timesheet_type_exceptions.*does not exist|relation.*timesheet_type_exceptions|schema cache/i.test(message);
}

export function normalizeTimesheetType(value: unknown): TimesheetType | null {
  if (value === 'civils' || value === 'plant') return value;
  return null;
}

export function resolveTimesheetTypeWithOverride(params: {
  overrideType?: unknown;
  teamType?: unknown;
  roleType?: unknown;
}): TimesheetType {
  const overrideType = normalizeTimesheetType(params.overrideType);
  const teamType = normalizeTimesheetType(params.teamType);
  const roleType = normalizeTimesheetType(params.roleType);
  return overrideType || teamType || roleType || DEFAULT_TIMESHEET_TYPE;
}

async function fetchRoleTimesheetType(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select(`
      role:roles (
        timesheet_type
      )
    `)
    .eq('id', userId)
    .single();

  if (error) throw error;

  const roleData = data?.role as { timesheet_type?: string | null } | null;
  return (roleData?.timesheet_type || DEFAULT_TIMESHEET_TYPE) as TimesheetType;
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
        // Precedence for new sheets:
        // user override -> team default -> role fallback -> civils.
        const [
          { data, error: fetchError },
          { data: overrideData, error: overrideError },
        ] = await Promise.all([
          supabase
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
            .single(),
          supabase
            .from('timesheet_type_exceptions')
            .select('timesheet_type')
            .eq('profile_id', userId)
            .maybeSingle(),
        ]);

        if (overrideError && !isMissingTimesheetOverrideSchemaError(overrideError)) {
          throw overrideError;
        }

        const overrideType = normalizeTimesheetType(overrideData?.timesheet_type);

        if (fetchError) {
          if (isMissingTeamTimesheetTypeError(fetchError)) {
            const fallbackType = await fetchRoleTimesheetType(supabase, userId);
            setTimesheetType((overrideType || fallbackType) as TimesheetType);
            setError(null);
            return;
          }
          throw fetchError;
        }

        const teamData = data?.team as { timesheet_type?: string | null } | null;
        const roleData = data?.role as { timesheet_type?: string | null } | null;
        const type = resolveTimesheetTypeWithOverride({
          overrideType,
          teamType: teamData?.timesheet_type,
          roleType: roleData?.timesheet_type,
        });

        setTimesheetType(type);
        setError(null);
      } catch (err) {
        console.error('Error fetching timesheet type:', err);
        setError(getErrorMessage(err) || 'Failed to fetch timesheet type');
        
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
