import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Timesheet } from '@/types/timesheet';
import { TimesheetStatusFilter } from '@/types/common';

interface TimesheetWithProfile extends Timesheet {
  profile?: {
    full_name: string;
  };
}

interface UseTimesheetsOptions {
  userId?: string;
  isManager: boolean;
  selectedEmployeeId?: string;
  statusFilter?: TimesheetStatusFilter;
}

export function useTimesheets({ userId, isManager, selectedEmployeeId, statusFilter }: UseTimesheetsOptions) {
  const supabase = createClient();

  return useQuery({
    queryKey: ['timesheets', userId, selectedEmployeeId, statusFilter],
    queryFn: async () => {
      if (!userId) return [];

      let query = supabase
        .from('timesheets')
        .select(`
          *,
          profile:profiles!user_id (full_name)
        `)
        .order('week_ending', { ascending: false });

      // Manager viewing all or specific employee
      if (isManager && selectedEmployeeId && selectedEmployeeId !== 'all') {
        query = query.eq('user_id', selectedEmployeeId);
      } else if (!isManager) {
        // Regular user sees only their own
        query = query.eq('user_id', userId);
      }

      // Apply status filter
      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'pending') {
          query = query.eq('status', 'submitted');
        } else {
          query = query.eq('status', statusFilter);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as TimesheetWithProfile[];
    },
    enabled: !!userId,
  });
}

export function useDeleteTimesheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (timesheetId: string) => {
      const response = await fetch(`/api/timesheets/${timesheetId}/delete`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete timesheet');
      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch timesheets
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    },
  });
}

