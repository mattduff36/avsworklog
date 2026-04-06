'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient, getLastDataTokenFailureStatus } from '@/lib/supabase/client';
import { createStatusError, getErrorStatus, isAuthErrorStatus } from '@/lib/utils/http-error';

interface RamsAssignmentSummary {
  hasAssignments: boolean;
  pendingCount: number;
}

async function fetchRamsAssignmentSummary(profileId: string): Promise<RamsAssignmentSummary> {
  const supabase = createClient();

  const [{ count: totalCount, error: totalError }, { count: pendingCount, error: pendingError }] =
    await Promise.all([
      supabase
        .from('rams_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('employee_id', profileId),
      supabase
        .from('rams_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('employee_id', profileId)
        .in('status', ['pending', 'read']),
    ]);

  const authFailureStatus = getLastDataTokenFailureStatus();
  if (authFailureStatus && isAuthErrorStatus(authFailureStatus)) {
    throw createStatusError('Failed to load RAMS assignments', authFailureStatus);
  }

  if (totalError) throw totalError;
  if (pendingError) throw pendingError;

  return {
    hasAssignments: (totalCount || 0) > 0,
    pendingCount: pendingCount || 0,
  };
}

export function useRamsAssignmentSummary(profileId?: string | null) {
  const query = useQuery({
    queryKey: ['rams-assignment-summary', profileId || null],
    enabled: Boolean(profileId),
    queryFn: () => fetchRamsAssignmentSummary(profileId!),
    staleTime: 60_000,
  });

  const errorStatus = getErrorStatus(query.error) ?? getLastDataTokenFailureStatus();
  const holdForRecovery = isAuthErrorStatus(errorStatus) && !query.data;

  return {
    ...query,
    isLoading: query.isLoading || holdForRecovery,
    errorStatus,
  };
}

async function fetchPendingAbsenceCount(): Promise<number> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from('absences')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) throw error;
  return count || 0;
}

export function usePendingAbsenceCount(enabled: boolean, userId?: string | null) {
  const query = useQuery({
    queryKey: ['pending-absence-count', userId || null],
    enabled: enabled && Boolean(userId),
    queryFn: fetchPendingAbsenceCount,
    staleTime: 60_000,
  });

  return useMemo(
    () => ({
      count: enabled ? query.data || 0 : 0,
      isLoading: enabled ? query.isLoading : false,
      error: query.error,
    }),
    [enabled, query.data, query.error, query.isLoading]
  );
}
