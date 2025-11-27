import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { VehicleInspection } from '@/types/inspection';
import { InspectionStatusFilter } from '@/types/common';

interface InspectionWithVehicle extends VehicleInspection {
  vehicles: {
    reg_number: string;
    vehicle_type: string;
  };
}

interface UseInspectionsOptions {
  userId?: string;
  isManager: boolean;
  selectedEmployeeId?: string;
  statusFilter?: InspectionStatusFilter;
}

export function useInspections({ userId, isManager, selectedEmployeeId, statusFilter }: UseInspectionsOptions) {
  const supabase = createClient();

  return useQuery({
    queryKey: ['inspections', userId, selectedEmployeeId, statusFilter],
    queryFn: async () => {
      if (!userId) return [];

      let query = supabase
        .from('vehicle_inspections')
        .select(`
          *,
          vehicles (
            reg_number,
            vehicle_type
          ),
          profile:profiles!vehicle_inspections_user_id_fkey(full_name)
        `)
        .order('inspection_date', { ascending: false });

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
      return (data || []) as InspectionWithVehicle[];
    },
    enabled: !!userId,
  });
}

export function useDeleteInspection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inspectionId: string) => {
      const response = await fetch(`/api/inspections/${inspectionId}/delete`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete inspection');
      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch inspections
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
    },
  });
}

