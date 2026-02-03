'use client';

import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { MaintenanceOverview } from './MaintenanceOverview';

interface PlantOverviewProps {
  vehicles: VehicleMaintenanceWithStatus[];
  onVehicleClick?: (vehicle: VehicleMaintenanceWithStatus) => void;
}

export function PlantOverview({ vehicles, onVehicleClick }: PlantOverviewProps) {
  const plantVehicles = vehicles.filter(
    vehicle => vehicle.vehicle?.asset_type === 'plant'
  );

  const summary = {
    total: plantVehicles.length,
    overdue: plantVehicles.filter(v => v.overdue_count > 0).length,
    due_soon: plantVehicles.filter(v => v.due_soon_count > 0 && v.overdue_count === 0).length,
  };

  return (
    <MaintenanceOverview
      vehicles={plantVehicles}
      summary={summary}
      onVehicleClick={onVehicleClick}
    />
  );
}
