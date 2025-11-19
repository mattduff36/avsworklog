import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { 
  Absence, 
  AbsenceInsert, 
  AbsenceUpdate, 
  AbsenceReason,
  AbsenceWithRelations,
  AbsenceSummary
} from '@/types/absence';
import { getCurrentFinancialYear } from '@/lib/utils/date';

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
  const supabase = createClient();
  const { start, end } = getCurrentFinancialYear();
  
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
  const supabase = createClient();
  const { start, end } = getCurrentFinancialYear();
  
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
        .eq('name', 'Annual leave')
        .single();
      
      if (reasonError) throw reasonError;
      
      // Get absences within financial year
      const { data: absences, error: absencesError } = await supabase
        .from('absences')
        .select('status, duration_days, reason_id')
        .eq('profile_id', user.id)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0]);
      
      if (absencesError) throw absencesError;
      
      // Calculate approved and pending for Annual Leave only
      const approved_taken = absences
        ?.filter(a => a.status === 'approved' && a.reason_id === annualLeaveReason.id)
        .reduce((sum, a) => sum + (a.duration_days || 0), 0) || 0;
      
      const pending_total = absences
        ?.filter(a => a.status === 'pending' && a.reason_id === annualLeaveReason.id)
        .reduce((sum, a) => sum + (a.duration_days || 0), 0) || 0;
      
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
}) {
  const supabase = createClient();
  
  return useQuery({
    queryKey: ['absences', 'all', filters],
    queryFn: async () => {
      let query = supabase
        .from('absences')
        .select(`
          *,
          absence_reasons (*),
          profiles!absences_profile_id_fkey (full_name, employee_id),
          created_by_profile:profiles!absences_created_by_fkey (full_name),
          approved_by_profile:profiles!absences_approved_by_fkey (full_name)
        `);
      
      if (filters?.profileId) {
        query = query.eq('profile_id', filters.profileId);
      }
      if (filters?.dateFrom) {
        query = query.gte('date', filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte('date', filters.dateTo);
      }
      if (filters?.reasonId) {
        query = query.eq('reason_id', filters.reasonId);
      }
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      
      const { data, error } = await query.order('date', { ascending: false });
      
      if (error) throw error;
      return data as AbsenceWithRelations[];
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
      return data as AbsenceWithRelations[];
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
        .eq('name', 'Annual leave')
        .single();
      
      if (reasonError) throw reasonError;
      
      // Get absences within financial year
      const { data: absences, error: absencesError } = await supabase
        .from('absences')
        .select('status, duration_days, reason_id')
        .eq('profile_id', profileId)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0]);
      
      if (absencesError) throw absencesError;
      
      // Calculate approved and pending for Annual Leave only
      const approved_taken = absences
        ?.filter(a => a.status === 'approved' && a.reason_id === annualLeaveReason.id)
        .reduce((sum, a) => sum + (a.duration_days || 0), 0) || 0;
      
      const pending_total = absences
        ?.filter(a => a.status === 'pending' && a.reason_id === annualLeaveReason.id)
        .reduce((sum, a) => sum + (a.duration_days || 0), 0) || 0;
      
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
    mutationFn: async (reason: { name: string; is_paid: boolean }) => {
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

