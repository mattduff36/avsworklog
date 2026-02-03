'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { MaintenanceOverview } from './MaintenanceOverview';
import { getDateBasedStatus, calculateAlertCounts } from '@/lib/utils/maintenanceCalculations';
import type { MaintenanceItemStatus } from '@/types/maintenance';

interface PlantOverviewProps {
  onVehicleClick?: (vehicle: any) => void;
}

type PlantAsset = {
  id: string;
  plant_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  current_hours: number | null;
  loler_due_date: string | null;
  status: string;
};

type PlantMaintenanceWithStatus = {
  vehicle_id: string;
  plant_id: string;
  vehicle?: PlantAsset;
  current_hours: number | null;
  next_service_hours: number | null;
  loler_due_date?: string | null; // LOLER due date for office actions
  loler_status?: MaintenanceItemStatus; // LOLER status for plant machinery
  overdue_count: number;
  due_soon_count: number;
};

export function PlantOverview({ onVehicleClick }: PlantOverviewProps) {
  const supabase = createClient();
  const [plantAssets, setPlantAssets] = useState<PlantMaintenanceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlantAssets();
  }, []);

  const fetchPlantAssets = async () => {
    try {
      setLoading(true);
      
      // Fetch plant assets with maintenance data
      const { data: plantData, error: plantError } = await supabase
        .from('plant')
        .select(`
          *,
          vehicle_categories (
            id,
            name
          )
        `)
        .eq('status', 'active')
        .order('plant_id');

      if (plantError) throw plantError;

      // Fetch maintenance records for plant
      const { data: maintenanceData, error: maintenanceError } = await supabase
        .from('vehicle_maintenance')
        .select('*')
        .not('plant_id', 'is', null);

      if (maintenanceError) throw maintenanceError;

      // Combine plant data with maintenance data and calculate status
      const combined: PlantMaintenanceWithStatus[] = (plantData || []).map((plant) => {
        const maintenance = maintenanceData?.find((m) => m.plant_id === plant.id);
        
        // Calculate LOLER status (30 day threshold)
        const loler_status = getDateBasedStatus(plant.loler_due_date, 30);
        
        // Calculate alert counts based on LOLER status
        const alertCounts = calculateAlertCounts([loler_status]);
        
        return {
          vehicle_id: plant.id,
          plant_id: plant.id,
          vehicle: {
            ...plant,
            id: plant.id
          } as PlantAsset,
          current_hours: maintenance?.current_hours || plant.current_hours || null,
          next_service_hours: maintenance?.next_service_hours || null,
          loler_due_date: plant.loler_due_date, // Add LOLER due date for office actions
          loler_status, // Add LOLER status so MaintenanceOverview can detect it
          overdue_count: alertCounts.overdue,
          due_soon_count: alertCounts.due_soon,
        };
      });

      setPlantAssets(combined);
    } catch (error) {
      console.error('Error fetching plant assets:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const summary = {
    total: plantAssets.length,
    overdue: plantAssets.filter(v => v.overdue_count > 0).length,
    due_soon: plantAssets.filter(v => v.due_soon_count > 0 && v.overdue_count === 0).length,
  };

  return (
    <MaintenanceOverview
      vehicles={plantAssets}
      summary={summary}
      onVehicleClick={onVehicleClick}
    />
  );
}
