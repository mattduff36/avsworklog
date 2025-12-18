'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertTriangle, Calendar, Wrench, AlertCircle } from 'lucide-react';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { formatDaysUntil, formatMilesUntil } from '@/lib/utils/maintenanceCalculations';

interface MaintenanceOverviewProps {
  vehicles: VehicleMaintenanceWithStatus[];
  summary: {
    total: number;
    overdue: number;
    due_soon: number;
  };
  onVehicleClick?: (vehicle: VehicleMaintenanceWithStatus) => void;
}

interface Alert {
  vehicle: VehicleMaintenanceWithStatus;
  vehicle_reg: string;
  type: string;
  detail: string;
  severity: 'overdue' | 'due_soon';
}

export function MaintenanceOverview({ vehicles, summary, onVehicleClick }: MaintenanceOverviewProps) {
  // Extract all alerts from vehicles
  const alerts: Alert[] = [];
  
  vehicles.forEach(vehicle => {
    const reg = vehicle.vehicle?.reg_number || 'Unknown';
    
    // Check Tax
    if (vehicle.tax_status?.status === 'overdue') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'Tax',
        detail: formatDaysUntil(vehicle.tax_status.days_until),
        severity: 'overdue'
      });
    } else if (vehicle.tax_status?.status === 'due_soon') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'Tax',
        detail: formatDaysUntil(vehicle.tax_status.days_until),
        severity: 'due_soon'
      });
    }
    
    // Check MOT
    if (vehicle.mot_status?.status === 'overdue') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'MOT',
        detail: formatDaysUntil(vehicle.mot_status.days_until),
        severity: 'overdue'
      });
    } else if (vehicle.mot_status?.status === 'due_soon') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'MOT',
        detail: formatDaysUntil(vehicle.mot_status.days_until),
        severity: 'due_soon'
      });
    }
    
    // Check Service
    if (vehicle.service_status?.status === 'overdue') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'Service',
        detail: formatMilesUntil(vehicle.service_status.miles_until),
        severity: 'overdue'
      });
    } else if (vehicle.service_status?.status === 'due_soon') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'Service',
        detail: formatMilesUntil(vehicle.service_status.miles_until),
        severity: 'due_soon'
      });
    }
    
    // Check Cambelt
    if (vehicle.cambelt_status?.status === 'overdue') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'Cambelt',
        detail: formatMilesUntil(vehicle.cambelt_status.miles_until),
        severity: 'overdue'
      });
    } else if (vehicle.cambelt_status?.status === 'due_soon') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'Cambelt',
        detail: formatMilesUntil(vehicle.cambelt_status.miles_until),
        severity: 'due_soon'
      });
    }
    
    // Check First Aid
    if (vehicle.first_aid_status?.status === 'overdue') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'First Aid Kit',
        detail: formatDaysUntil(vehicle.first_aid_status.days_until),
        severity: 'overdue'
      });
    } else if (vehicle.first_aid_status?.status === 'due_soon') {
      alerts.push({
        vehicle,
        vehicle_reg: reg,
        type: 'First Aid Kit',
        detail: formatDaysUntil(vehicle.first_aid_status.days_until),
        severity: 'due_soon'
      });
    }
  });
  
  const overdueAlerts = alerts.filter(a => a.severity === 'overdue');
  const dueSoonAlerts = alerts.filter(a => a.severity === 'due_soon');
  
  // Don't show panels if no alerts
  if (overdueAlerts.length === 0 && dueSoonAlerts.length === 0) {
    return (
      <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/40">
              <Wrench className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-green-900 dark:text-green-100">
                All Caught Up!
              </h3>
              <p className="text-sm text-green-700 dark:text-green-300">
                No maintenance items are overdue or due soon. {summary.total} vehicle{summary.total !== 1 ? 's' : ''} being monitored.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Overdue Tasks */}
      {overdueAlerts.length > 0 && (
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <CardTitle className="text-lg text-red-900 dark:text-red-100">
                Overdue Tasks
              </CardTitle>
            </div>
            <CardDescription className="text-red-700 dark:text-red-300">
              {overdueAlerts.length} task{overdueAlerts.length !== 1 ? 's' : ''} requiring immediate attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-red-300 [&::-webkit-scrollbar-thumb]:dark:bg-red-700 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent">
              {overdueAlerts.map((alert, idx) => (
                <div 
                  key={idx} 
                  onClick={() => onVehicleClick?.(alert.vehicle)}
                  className="flex items-start gap-3 text-sm bg-white dark:bg-slate-900 p-3 rounded-md border border-red-200 dark:border-red-800 cursor-pointer hover:bg-red-50 dark:hover:bg-slate-800 transition-colors"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onVehicleClick?.(alert.vehicle);
                    }
                  }}
                >
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-red-900 dark:text-red-100">
                      {alert.vehicle_reg} - {alert.type}
                    </div>
                    <div className="text-red-700 dark:text-red-300">
                      {alert.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Due Soon Tasks */}
      {dueSoonAlerts.length > 0 && (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-lg text-amber-900 dark:text-amber-100">
                Due Soon
              </CardTitle>
            </div>
            <CardDescription className="text-amber-700 dark:text-amber-300">
              {dueSoonAlerts.length} task{dueSoonAlerts.length !== 1 ? 's' : ''} coming up
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-300 [&::-webkit-scrollbar-thumb]:dark:bg-amber-700 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent">
              {dueSoonAlerts.map((alert, idx) => (
                <div 
                  key={idx} 
                  onClick={() => onVehicleClick?.(alert.vehicle)}
                  className="flex items-start gap-3 text-sm bg-white dark:bg-slate-900 p-3 rounded-md border border-amber-200 dark:border-amber-800 cursor-pointer hover:bg-amber-50 dark:hover:bg-slate-800 transition-colors"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onVehicleClick?.(alert.vehicle);
                    }
                  }}
                >
                  <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-amber-900 dark:text-amber-100">
                      {alert.vehicle_reg} - {alert.type}
                    </div>
                    <div className="text-amber-700 dark:text-amber-300">
                      {alert.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
