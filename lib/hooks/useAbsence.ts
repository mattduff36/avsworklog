import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAbsenceRealtime } from '@/lib/hooks/useRealtime';
import { 
  AbsenceInsert, 
  AbsenceUpdate, 
  AbsenceReason,
  AbsenceWithRelations,
  AbsenceSummary,
  FinancialYear
} from '@/types/absence';
import { getCurrentFinancialYear, getFinancialYear } from '@/lib/utils/date';
import { isClosedFinancialYearDate } from '@/lib/services/absence-archive';

const ANNUAL_LEAVE_REASON_NAME = 'annual leave';

function hasFilterValue(value?: string): value is string {
  return !!value && value.trim().length > 0;
}

export function useAbsenceRealtimeQueryInvalidation() {
  const queryClient = useQueryClient();

  const invalidateAbsenceQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['absences'] });
    queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
  }, [queryClient]);

  useAbsenceRealtime((payload) => {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
      invalidateAbsenceQueries();
    }
  });
}

async function assertAbsenceFinancialYearOpen(
  supabase: ReturnType<typeof createClient>,
  id: string
): Promise<void> {
  const { data, error } = await supabase
    .from('absences')
    .select('date')
    .eq('id', id)
    .single();

  if (error) throw error;
  if (!data?.date) throw new Error('Absence record not found');
  if (isClosedFinancialYearDate(data.date)) {
    throw new Error('This absence is in a closed financial year and is read-only');
  }
}

async function assertNoAbsenceConflictBeforeInsert(
  supabase: ReturnType<typeof createClient>,
  absence: AbsenceInsert
): Promise<void> {
  const profileId = absence.profile_id;
  const startDate = absence.date;
  const endDate = absence.end_date || absence.date;
  const nextStatus = absence.status || 'pending';
  const isHalfDay = absence.is_half_day === true;
  const halfDaySession = absence.half_day_session || null;

  if (!profileId || !startDate) {
    return;
  }

  if (nextStatus !== 'approved' && nextStatus !== 'pending') {
    return;
  }

  if (isHalfDay && !halfDaySession) {
    throw new Error('Half-day absences require AM or PM session');
  }
  if (isHalfDay && endDate !== startDate) {
    throw new Error('Half-day absences must be a single day');
  }

  const { data, error } = await supabase
    .from('absences')
    .select('date, end_date, is_half_day, half_day_session')
    .eq('profile_id', profileId)
    .in('status', ['approved', 'pending'])
    .lte('date', endDate);

  if (error) throw error;

  const existingRows = (data || []) as Array<{
    date: string;
    end_date: string | null;
    is_half_day: boolean;
    half_day_session: 'AM' | 'PM' | null;
  }>;

  const overlappingRows = existingRows.filter((row) => {
    const rowEnd = row.end_date || row.date;
    return row.date <= endDate && rowEnd >= startDate;
  });

  if (!isHalfDay && overlappingRows.length > 0) {
    throw new Error('This absence conflicts with an existing approved/pending booking');
  }

  if (!isHalfDay) {
    return;
  }

  for (const row of overlappingRows) {
    const rowEnd = row.end_date || row.date;
    const sameSingleDay = row.date === startDate && rowEnd === startDate;
    if (!sameSingleDay) {
      throw new Error('This half-day conflicts with an existing multi-day or different-day booking');
    }
    if (!row.is_half_day) {
      throw new Error('This half-day conflicts with an existing full-day booking');
    }
    if (row.half_day_session === halfDaySession) {
      throw new Error(`This ${halfDaySession} half-day is already booked`);
    }
  }
}

// ============================================================================
// ABSENCE REASONS HOOKS
// ============================================================================

/**
 * Get all active absence reasons (for employees)
 */
export function useAbsenceReasons() {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absence-reasons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .select('*')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data as AbsenceReason[];
    },
  });
}

/**
 * Get all absence reasons (for admins - includes inactive)
 */
export function useAllAbsenceReasons() {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absence-reasons-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return data as AbsenceReason[];
    },
  });
}

// ============================================================================
// ABSENCE HOOKS - USER
// ============================================================================

/**
 * Get absences for current user in the current financial year
 */
export function useAbsencesForCurrentUser() {
  const { start, end } = getCurrentFinancialYear();
  
  return useAbsencesForUserFinancialYear({
    start,
    end,
  });
}

/**
 * Get absences for current user in a selected financial year
 */
export function useAbsencesForUserFinancialYear(financialYear?: Pick<FinancialYear, 'start' | 'end'>) {
  const supabase = createClient();
  const fallback = getCurrentFinancialYear();
  const start = financialYear?.start || fallback.start;
  const end = financialYear?.end || fallback.end;
  
  return useQuery({
    queryKey: ['absences', 'current-user', start.toISOString(), end.toISOString()],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('absences')
        .select(`
          *,
          absence_reasons (*),
          profiles!absences_profile_id_fkey (full_name, employee_id)
        `)
        .eq('profile_id', user.id)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0])
        .order('date', { ascending: false });
      
      if (error) throw error;
      return data as AbsenceWithRelations[];
    },
  });
}

/**
 * Get absence summary for current user in the current financial year
 */
export function useAbsenceSummaryForCurrentUser() {
  const { start, end } = getCurrentFinancialYear();
  
  return useAbsenceSummaryForUserFinancialYear({
    start,
    end,
  });
}

/**
 * Get absence summary for current user in a selected financial year
 */
export function useAbsenceSummaryForUserFinancialYear(financialYear?: Pick<FinancialYear, 'start' | 'end'>) {
  const supabase = createClient();
  const fallback = getCurrentFinancialYear();
  const start = financialYear?.start || fallback.start;
  const end = financialYear?.end || fallback.end;
  
  return useQuery({
    queryKey: ['absence-summary', 'current-user', start.toISOString(), end.toISOString()],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      // Get user's allowance
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('annual_holiday_allowance_days')
        .eq('id', user.id)
        .single();
      
      if (profileError) throw profileError;
      
      const allowance = profile?.annual_holiday_allowance_days || 28;
      
      // Get Annual Leave reason ID
      const { data: annualLeaveReason, error: reasonError } = await supabase
        .from('absence_reasons')
        .select('id')
        .ilike('name', ANNUAL_LEAVE_REASON_NAME)
        .single();
      
      if (reasonError || !annualLeaveReason) {
        return {
          allowance,
          approved_taken: 0,
          pending_total: 0,
          remaining: allowance,
        } as AbsenceSummary;
      }
      
      // Get absences within financial year
      const { data: absences, error: absencesError } = await supabase
        .from('absences')
        .select('status, duration_days, reason_id')
        .eq('profile_id', user.id)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0]);
      
      if (absencesError) throw absencesError;
      const typedAbsences = (absences || []) as Array<{
        status: string;
        duration_days: number | null;
        reason_id: string | null;
      }>;
      
      // Calculate approved and pending for Annual Leave only
      const approved_taken = typedAbsences
        .filter((a) => a.status === 'approved' && a.reason_id === annualLeaveReason.id)
        .reduce((sum: number, a) => sum + (a.duration_days || 0), 0);
      
      const pending_total = typedAbsences
        .filter((a) => a.status === 'pending' && a.reason_id === annualLeaveReason.id)
        .reduce((sum: number, a) => sum + (a.duration_days || 0), 0);
      
      const remaining = allowance - approved_taken - pending_total;
      
      return {
        allowance,
        approved_taken,
        pending_total,
        remaining,
      } as AbsenceSummary;
    },
  });
}

/**
 * Create a new absence request
 */
export function useCreateAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (absence: AbsenceInsert) => {
      await assertNoAbsenceConflictBeforeInsert(supabase, absence);

      // Enforce annual leave allowance at mutation time to prevent stale UI bypasses.
      if (absence.status === 'pending' && absence.reason_id && absence.profile_id && (absence.duration_days || 0) > 0) {
        const { data: reason, error: reasonError } = await supabase
          .from('absence_reasons')
          .select('id, name')
          .eq('id', absence.reason_id)
          .single();

        if (reasonError) throw reasonError;

        const isAnnualLeave = reason?.name?.trim().toLowerCase() === ANNUAL_LEAVE_REASON_NAME;
        if (isAnnualLeave) {
          const requestDate = absence.date ? new Date(`${absence.date}T00:00:00`) : new Date();
          const { start, end } = getFinancialYear(requestDate);

          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('annual_holiday_allowance_days')
            .eq('id', absence.profile_id)
            .single();

          if (profileError) throw profileError;

          const allowance = profile?.annual_holiday_allowance_days || 28;

          const { data: annualAbsences, error: annualAbsencesError } = await supabase
            .from('absences')
            .select('duration_days')
            .eq('profile_id', absence.profile_id)
            .eq('reason_id', reason.id)
            .in('status', ['approved', 'pending'])
            .gte('date', start.toISOString().split('T')[0])
            .lte('date', end.toISOString().split('T')[0]);

          if (annualAbsencesError) throw annualAbsencesError;

          const usedOrPending = (annualAbsences || []).reduce(
            (sum: number, entry: { duration_days: number | null }) => sum + (entry.duration_days || 0),
            0
          );
          const requested = absence.duration_days || 0;

          if (usedOrPending + requested > allowance) {
            throw new Error('Annual leave request exceeds available allowance');
          }
        }
      }

      const { data, error } = await supabase
        .from('absences')
        .insert(absence)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Update an absence
 */
export function useUpdateAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: AbsenceUpdate }) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { data, error } = await supabase
        .from('absences')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Cancel an absence (user or admin)
 */
export function useCancelAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { data, error } = await supabase
        .from('absences')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Delete an absence (pending only)
 */
export function useDeleteAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { error } = await supabase
        .from('absences')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

// ============================================================================
// ABSENCE HOOKS - ADMIN
// ============================================================================

/**
 * Get all absences (admin view with filters)
 */
export function useAllAbsences(filters?: {
  profileId?: string;
  dateFrom?: string;
  dateTo?: string;
  reasonId?: string;
  status?: string;
  includeArchived?: boolean;
  archivedOnly?: boolean;
}) {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absences', 'all', filters],
    enabled: filters !== undefined,
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      const includeArchived = filters?.includeArchived === true;
      const archivedOnly = filters?.archivedOnly === true;

      const fetchRows = async (
        source: 'active' | 'archived'
      ): Promise<AbsenceWithRelations[]> => {
        const allRows: AbsenceWithRelations[] = [];
        let from = 0;

        while (true) {
          const tableName = source === 'archived' ? 'absences_archive' : 'absences';
          const profileJoin =
            source === 'archived'
              ? 'profiles!absences_archive_profile_id_fkey (full_name, employee_id)'
              : 'profiles!absences_profile_id_fkey (full_name, employee_id)';
          const createdByJoin =
            source === 'archived'
              ? 'created_by_profile:profiles!absences_archive_created_by_fkey (full_name)'
              : 'created_by_profile:profiles!absences_created_by_fkey (full_name)';
          const approvedByJoin =
            source === 'archived'
              ? 'approved_by_profile:profiles!absences_archive_approved_by_fkey (full_name)'
              : 'approved_by_profile:profiles!absences_approved_by_fkey (full_name)';

          let query = supabase.from(tableName).select(`
            *,
            absence_reasons (*),
            ${profileJoin},
            ${createdByJoin},
            ${approvedByJoin}
          `);

          if (hasFilterValue(filters?.profileId)) {
            query = query.eq('profile_id', filters.profileId);
          }
          if (filters?.dateFrom) {
            query = query.gte('date', filters.dateFrom);
          }
          if (filters?.dateTo) {
            query = query.lte('date', filters.dateTo);
          }
          if (hasFilterValue(filters?.reasonId)) {
            query = query.eq('reason_id', filters.reasonId);
          }
          if (hasFilterValue(filters?.status)) {
            query = query.eq('status', filters.status);
          }

          const { data, error } = await query
            .order('date', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);

          if (error) throw error;

          const pageRows = ((data || []) as AbsenceWithRelations[]).map((row) => ({
            ...row,
            record_source: source,
          }));
          allRows.push(...pageRows);

          if (pageRows.length < PAGE_SIZE) {
            break;
          }
          from += PAGE_SIZE;
        }

        return allRows;
      };

      if (archivedOnly) {
        return fetchRows('archived');
      }

      const activeRows = await fetchRows('active');
      if (!includeArchived) {
        return activeRows;
      }

      const archivedRows = await fetchRows('archived');
      return [...activeRows, ...archivedRows].sort((a, b) => b.date.localeCompare(a.date));
    },
  });
}

/**
 * Get pending absences for approval (admin/manager)
 */
export function usePendingAbsences() {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absences', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absences')
        .select(`
          *,
          absence_reasons (*),
          profiles!absences_profile_id_fkey (full_name, employee_id)
        `)
        .eq('status', 'pending')
        .order('date', { ascending: true });
      
      if (error) throw error;
      return (data || []) as AbsenceWithRelations[];
    },
  });
}

/**
 * Approve an absence (admin/manager only)
 */
export function useApproveAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('absences')
        .update({
          status: 'approved',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Reject an absence (admin/manager only)
 */
export function useRejectAbsence() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      await assertAbsenceFinancialYearOpen(supabase, id);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const updates: AbsenceUpdate = {
        status: 'rejected',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      };
      
      if (reason) {
        updates.notes = `REJECTED: ${reason}${updates.notes ? '\n' + updates.notes : ''}`;
      }
      
      const { data, error } = await supabase
        .from('absences')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
    },
  });
}

/**
 * Get absence summary for a specific employee (admin view)
 */
export function useAbsenceSummaryForEmployee(profileId: string) {
  const supabase = createClient();
  const { start, end } = getCurrentFinancialYear();
  
  return useQuery({
    queryKey: ['absence-summary', profileId, start.toISOString(), end.toISOString()],
    queryFn: async () => {
      // Get user's allowance
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('annual_holiday_allowance_days')
        .eq('id', profileId)
        .single();
      
      if (profileError) throw profileError;
      
      const allowance = profile?.annual_holiday_allowance_days || 28;
      
      // Get Annual Leave reason ID
      const { data: annualLeaveReason, error: reasonError } = await supabase
        .from('absence_reasons')
        .select('id')
        .ilike('name', ANNUAL_LEAVE_REASON_NAME)
        .single();
      
      if (reasonError || !annualLeaveReason) {
        return {
          allowance,
          approved_taken: 0,
          pending_total: 0,
          remaining: allowance,
        } as AbsenceSummary;
      }
      
      // Get absences within financial year
      const { data: absences, error: absencesError } = await supabase
        .from('absences')
        .select('status, duration_days, reason_id')
        .eq('profile_id', profileId)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0]);
      
      if (absencesError) throw absencesError;
      const typedAbsences = (absences || []) as Array<{
        status: string;
        duration_days: number | null;
        reason_id: string | null;
      }>;
      
      // Calculate approved and pending for Annual Leave only
      const approved_taken = typedAbsences
        .filter((a) => a.status === 'approved' && a.reason_id === annualLeaveReason.id)
        .reduce((sum: number, a) => sum + (a.duration_days || 0), 0);
      
      const pending_total = typedAbsences
        .filter((a) => a.status === 'pending' && a.reason_id === annualLeaveReason.id)
        .reduce((sum: number, a) => sum + (a.duration_days || 0), 0);
      
      const remaining = allowance - approved_taken - pending_total;
      
      return {
        allowance,
        approved_taken,
        pending_total,
        remaining,
      } as AbsenceSummary;
    },
    enabled: !!profileId,
  });
}

// ============================================================================
// ADMIN - ABSENCE REASONS CRUD
// ============================================================================

/**
 * Create a new absence reason (admin only)
 */
export function useCreateAbsenceReason() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (reason: { name: string; is_paid: boolean; color?: string }) => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .insert(reason)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-reasons'] });
      queryClient.invalidateQueries({ queryKey: ['absence-reasons-all'] });
    },
  });
}

/**
 * Update an absence reason (admin only)
 */
export function useUpdateAbsenceReason() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<AbsenceReason> }) => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-reasons'] });
      queryClient.invalidateQueries({ queryKey: ['absence-reasons-all'] });
    },
  });
}

/**
 * Delete an absence reason (admin only) - soft delete by setting is_active = false
 */
export function useDeleteAbsenceReason() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-reasons'] });
      queryClient.invalidateQueries({ queryKey: ['absence-reasons-all'] });
    },
  });
}

// ============================================================================
// ADMIN - ALLOWANCE MANAGEMENT
// ============================================================================

/**
 * Update employee allowance (admin only)
 */
export function useUpdateEmployeeAllowance() {
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  return useMutation({
    mutationFn: async ({ profileId, allowance }: { profileId: string; allowance: number }) => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ annual_holiday_allowance_days: allowance })
        .eq('id', profileId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-summary'] });
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

