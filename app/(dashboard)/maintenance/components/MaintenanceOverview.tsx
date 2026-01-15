'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Calendar, Wrench, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { formatDaysUntil, formatMilesUntil, formatMileage, formatMaintenanceDate, getStatusColorClass } from '@/lib/utils/maintenanceCalculations';

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
  type: string;
  detail: string;
  severity: 'overdue' | 'due_soon';
}

interface VehicleWithAlerts extends VehicleMaintenanceWithStatus {
  alerts: Alert[];
}

export function MaintenanceOverview({ vehicles, summary, onVehicleClick }: MaintenanceOverviewProps) {
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());
  
  const toggleVehicle = (vehicleId: string) => {
    const newExpanded = new Set(expandedVehicles);
    if (newExpanded.has(vehicleId)) {
      newExpanded.delete(vehicleId);
    } else {
      newExpanded.add(vehicleId);
    }
    setExpandedVehicles(newExpanded);
  };
  
  // Group vehicles by their most severe alert status
  const vehiclesWithAlerts: VehicleWithAlerts[] = vehicles.map(vehicle => {
    const alerts: Alert[] = [];
    
    // Check Tax
    if (vehicle.tax_status?.status === 'overdue') {
      alerts.push({
        type: 'Tax',
        detail: formatDaysUntil(vehicle.tax_status.days_until),
        severity: 'overdue'
      });
    } else if (vehicle.tax_status?.status === 'due_soon') {
      alerts.push({
        type: 'Tax',
        detail: formatDaysUntil(vehicle.tax_status.days_until),
        severity: 'due_soon'
      });
    }
    
    // Check MOT
    if (vehicle.mot_status?.status === 'overdue') {
      alerts.push({
        type: 'MOT',
        detail: formatDaysUntil(vehicle.mot_status.days_until),
        severity: 'overdue'
      });
    } else if (vehicle.mot_status?.status === 'due_soon') {
      alerts.push({
        type: 'MOT',
        detail: formatDaysUntil(vehicle.mot_status.days_until),
        severity: 'due_soon'
      });
    }
    
    // Check Service
    if (vehicle.service_status?.status === 'overdue') {
      alerts.push({
        type: 'Service',
        detail: formatMilesUntil(vehicle.service_status.miles_until),
        severity: 'overdue'
      });
    } else if (vehicle.service_status?.status === 'due_soon') {
      alerts.push({
        type: 'Service',
        detail: formatMilesUntil(vehicle.service_status.miles_until),
        severity: 'due_soon'
      });
    }
    
    // Check Cambelt
    if (vehicle.cambelt_status?.status === 'overdue') {
      alerts.push({
        type: 'Cambelt',
        detail: formatMilesUntil(vehicle.cambelt_status.miles_until),
        severity: 'overdue'
      });
    } else if (vehicle.cambelt_status?.status === 'due_soon') {
      alerts.push({
        type: 'Cambelt',
        detail: formatMilesUntil(vehicle.cambelt_status.miles_until),
        severity: 'due_soon'
      });
    }
    
    // Check First Aid
    if (vehicle.first_aid_status?.status === 'overdue') {
      alerts.push({
        type: 'First Aid Kit',
        detail: formatDaysUntil(vehicle.first_aid_status.days_until),
        severity: 'overdue'
      });
    } else if (vehicle.first_aid_status?.status === 'due_soon') {
      alerts.push({
        type: 'First Aid Kit',
        detail: formatDaysUntil(vehicle.first_aid_status.days_until),
        severity: 'due_soon'
      });
    }
    
    return {
      ...vehicle,
      alerts
    };
  });
  
  const overdueVehicles = vehiclesWithAlerts.filter(v => v.alerts.some(a => a.severity === 'overdue'));
  const dueSoonVehicles = vehiclesWithAlerts.filter(v => 
    v.alerts.some(a => a.severity === 'due_soon') && !v.alerts.some(a => a.severity === 'overdue')
  );
  
  // Don't show panels if no alerts
  if (overdueVehicles.length === 0 && dueSoonVehicles.length === 0) {
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

  const renderVehicleCard = (vehicle: VehicleWithAlerts, isOverdue: boolean) => {
    const vehicleId = vehicle.vehicle_id || vehicle.id;
    const isExpanded = expandedVehicles.has(vehicleId);
    const overdueAlerts = vehicle.alerts.filter(a => a.severity === 'overdue');
    const dueSoonAlerts = vehicle.alerts.filter(a => a.severity === 'due_soon');
    
    return (
      <Card 
        key={vehicleId}
        className={`cursor-pointer transition-all ${
          isOverdue 
            ? 'bg-white dark:bg-slate-900 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-slate-800/50' 
            : 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-slate-800/50'
        }`}
        onClick={() => toggleVehicle(vehicleId)}
      >
        <CardContent className="p-4">
          {/* Collapsed View */}
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="font-semibold text-lg text-white">
                  {vehicle.vehicle?.reg_number || 'Unknown'}
                </h3>
                {vehicle.vehicle?.nickname && (
                  <span className="text-sm text-slate-400">({vehicle.vehicle.nickname})</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {vehicle.alerts.map((alert, idx) => (
                  <Badge 
                    key={idx}
                    className={`${
                      alert.severity === 'overdue' 
                        ? 'bg-red-500/10 text-red-400 border-red-500/30' 
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                    variant="outline"
                  >
                    {alert.type}: {alert.detail}
                  </Badge>
                ))}
              </div>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-400 flex-shrink-0" />
            )}
          </div>

          {/* Expanded View - Full Service Information */}
          {isExpanded && (
            <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* Current Mileage */}
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Current Mileage</span>
                <p className="text-lg font-semibold text-white">
                  {formatMileage(vehicle.current_mileage)}
                </p>
              </div>

              {/* Tax Due */}
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Tax Due</span>
                <p className={`text-lg font-semibold ${vehicle.tax_status?.status === 'overdue' || vehicle.tax_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                  {formatMaintenanceDate(vehicle.tax_due_date)}
                </p>
              </div>

              {/* MOT Due */}
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">MOT Due</span>
                <p className={`text-lg font-semibold ${vehicle.mot_status?.status === 'overdue' || vehicle.mot_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                  {formatMaintenanceDate(vehicle.mot_due_date)}
                </p>
              </div>

              {/* Service Due */}
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Service Due</span>
                <p className={`text-lg font-semibold ${vehicle.service_status?.status === 'overdue' || vehicle.service_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                  {vehicle.next_service_mileage 
                    ? `${formatMileage(vehicle.next_service_mileage)} miles` 
                    : 'Not Set'}
                </p>
              </div>

              {/* Cambelt Due */}
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Cambelt Due</span>
                <p className={`text-lg font-semibold ${vehicle.cambelt_status?.status === 'overdue' || vehicle.cambelt_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                  {vehicle.cambelt_due_mileage 
                    ? `${formatMileage(vehicle.cambelt_due_mileage)} miles` 
                    : 'Not Set'}
                </p>
              </div>

              {/* First Aid Kit */}
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">First Aid Kit</span>
                <p className={`text-lg font-semibold ${vehicle.first_aid_status?.status === 'overdue' || vehicle.first_aid_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                  {formatMaintenanceDate(vehicle.first_aid_kit_expiry)}
                </p>
              </div>

              {/* Last Service */}
              <div className="space-y-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Last Service</span>
                <p className="text-lg font-semibold text-white">
                  {vehicle.last_service_mileage 
                    ? `${formatMileage(vehicle.last_service_mileage)} miles` 
                    : 'Not Set'}
                </p>
              </div>

              {/* Tracker ID */}
              {vehicle.tracker_id && (
                <div className="space-y-1">
                  <span className="text-xs text-slate-400 uppercase tracking-wide">GPS Tracker</span>
                  <p className="text-lg font-semibold text-white">
                    {vehicle.tracker_id}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };
  
  return (
    <div className="space-y-6">
      {/* Overdue Tasks */}
      {overdueVehicles.length > 0 && (
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <CardTitle className="text-lg text-red-900 dark:text-red-100">
                Overdue Tasks
              </CardTitle>
            </div>
            <CardDescription className="text-red-700 dark:text-red-300">
              {overdueVehicles.length} vehicle{overdueVehicles.length !== 1 ? 's' : ''} requiring immediate attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {overdueVehicles.map(vehicle => renderVehicleCard(vehicle, true))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Due Soon Tasks */}
      {dueSoonVehicles.length > 0 && (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-lg text-amber-900 dark:text-amber-100">
                Due Soon
              </CardTitle>
            </div>
            <CardDescription className="text-amber-700 dark:text-amber-300">
              {dueSoonVehicles.length} vehicle{dueSoonVehicles.length !== 1 ? 's' : ''} coming up
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dueSoonVehicles.map(vehicle => renderVehicleCard(vehicle, false))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
