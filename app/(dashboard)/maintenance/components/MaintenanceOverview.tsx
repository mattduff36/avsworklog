'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Calendar, Wrench, AlertCircle, ChevronDown, ChevronUp, Loader2, Clock, ExternalLink } from 'lucide-react';
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { formatDaysUntil, formatMilesUntil, formatMileage, formatMaintenanceDate, getStatusColorClass } from '@/lib/utils/maintenanceCalculations';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';

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

interface HistoryEntry {
  id: string;
  created_at: string;
  field_name: string;
  old_value: string;
  new_value: string;
  updated_by_name?: string;
}

interface WorkshopTask {
  id: string;
  created_at: string;
  status: string;
  description: string;
  workshop_task_categories?: { name: string } | null;
  profiles?: { full_name: string | null } | null;
}

export function MaintenanceOverview({ vehicles, summary, onVehicleClick }: MaintenanceOverviewProps) {
  const router = useRouter();
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());
  const [vehicleHistory, setVehicleHistory] = useState<Record<string, { history: HistoryEntry[], workshopTasks: WorkshopTask[], loading: boolean }>>({})
  
  const fetchVehicleHistory = async (vehicleId: string) => {
    if (vehicleHistory[vehicleId]) return; // Already fetched
    
    setVehicleHistory(prev => ({ ...prev, [vehicleId]: { history: [], workshopTasks: [], loading: true } }));
    
    try {
      const response = await fetch(`/api/maintenance/history/${vehicleId}`);
      if (!response.ok) throw new Error('Failed to fetch history');
      
      const data = await response.json();
      setVehicleHistory(prev => ({
        ...prev,
        [vehicleId]: {
          history: data.history || [],
          workshopTasks: data.workshopTasks || [],
          loading: false
        }
      }));
    } catch (error) {
      console.error('Error fetching vehicle history:', error);
      setVehicleHistory(prev => ({
        ...prev,
        [vehicleId]: { history: [], workshopTasks: [], loading: false }
      }));
    }
  };

  const toggleVehicle = (vehicleId: string) => {
    const newExpanded = new Set(expandedVehicles);
    if (newExpanded.has(vehicleId)) {
      newExpanded.delete(vehicleId);
    } else {
      newExpanded.add(vehicleId);
      fetchVehicleHistory(vehicleId);
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
    const historyData = vehicleHistory[vehicleId];
    
    // Combine and sort history entries (maintenance history + workshop tasks)
    const getRecentEntries = () => {
      if (!historyData) return [];
      
      const combined: Array<{ type: 'history' | 'workshop', date: string, data: any }> = [
        ...historyData.history.map(h => ({ type: 'history' as const, date: h.created_at, data: h })),
        ...historyData.workshopTasks.map(w => ({ type: 'workshop' as const, date: w.created_at, data: w }))
      ];
      
      return combined
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3);
    };
    
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
          {/* Collapsed View - Now includes ALL service information */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Vehicle Info and Alerts */}
                <div>
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
              </div>
              
              {/* More Details Button - Top Right */}
              <Button
                size="sm"
                variant="outline"
                className="flex-shrink-0 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white hover:border-slate-500"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/fleet/vehicles/${vehicleId}/history`);
                }}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                More Details
              </Button>
            </div>
            
            {/* Service Information - Horizontal Row with Chevron */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 flex-1">
                {/* Current Mileage */}
                <div className="space-y-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Mileage</div>
                  <div className="text-sm font-medium text-white">
                    {formatMileage(vehicle.current_mileage)}
                  </div>
                </div>

                {/* Cambelt Due */}
                <div className="space-y-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Cambelt</div>
                  <div className={`text-sm font-medium ${vehicle.cambelt_status?.status === 'overdue' || vehicle.cambelt_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {vehicle.cambelt_due_mileage 
                      ? formatMileage(vehicle.cambelt_due_mileage)
                      : 'Not Set'}
                  </div>
                </div>

                {/* Tax Due */}
                <div className="space-y-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Tax Due</div>
                  <div className={`text-sm font-medium ${vehicle.tax_status?.status === 'overdue' || vehicle.tax_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {formatMaintenanceDate(vehicle.tax_due_date)}
                  </div>
                </div>

                {/* First Aid Kit */}
                <div className="space-y-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">First Aid</div>
                  <div className={`text-sm font-medium ${vehicle.first_aid_status?.status === 'overdue' || vehicle.first_aid_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {formatMaintenanceDate(vehicle.first_aid_kit_expiry)}
                  </div>
                </div>

                {/* MOT Due */}
                <div className="space-y-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">MOT Due</div>
                  <div className={`text-sm font-medium ${vehicle.mot_status?.status === 'overdue' || vehicle.mot_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {formatMaintenanceDate(vehicle.mot_due_date)}
                  </div>
                </div>

                {/* Service Due */}
                <div className="space-y-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Service Due</div>
                  <div className={`text-sm font-medium ${vehicle.service_status?.status === 'overdue' || vehicle.service_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {vehicle.next_service_mileage 
                      ? formatMileage(vehicle.next_service_mileage)
                      : 'Not Set'}
                  </div>
                </div>

                {/* Last Service */}
                <div className="space-y-0">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Last Service</div>
                  <div className="text-sm font-medium text-white">
                    {vehicle.last_service_mileage 
                      ? formatMileage(vehicle.last_service_mileage)
                      : 'Not Set'}
                  </div>
                </div>

                {/* Tracker ID */}
                {vehicle.tracker_id && (
                  <div className="space-y-0">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">GPS Tracker</div>
                    <div className="text-sm font-medium text-white">
                      {vehicle.tracker_id}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Chevron Icon - Right side of service info */}
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-slate-400 flex-shrink-0" />
              ) : (
                <ChevronDown className="h-5 w-5 text-slate-400 flex-shrink-0" />
              )}
            </div>
          </div>

          {/* Expanded View - Recent Maintenance & Workshop History */}
          {isExpanded && (
            <div className="mt-4 pt-4 border-t border-slate-700" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-slate-400" />
                <h4 className="text-sm font-semibold text-slate-300">Recent History</h4>
              </div>
              
              {historyData?.loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : getRecentEntries().length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No recent history</p>
              ) : (
                <div className="space-y-2">
                  {getRecentEntries().map((entry, idx) => (
                    <div 
                      key={idx}
                      className="bg-slate-800/50 rounded-lg p-3 border border-slate-700"
                    >
                      {entry.type === 'history' ? (
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="text-xs font-medium text-blue-400">Maintenance Update</span>
                            <span className="text-xs text-slate-500">
                              {formatDistanceToNow(new Date(entry.data.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300">
                            <span className="font-medium">{entry.data.field_name}</span>
                            {' changed from '}
                            <span className="text-slate-400">{entry.data.old_value || 'empty'}</span>
                            {' to '}
                            <span className="text-white">{entry.data.new_value}</span>
                          </p>
                          {entry.data.updated_by_name && (
                            <p className="text-xs text-slate-500 mt-1">
                              by {entry.data.updated_by_name}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-purple-400">Workshop Task</span>
                              {entry.data.workshop_task_categories && (
                                <Badge variant="outline" className="text-xs bg-slate-700/50 text-slate-300 border-slate-600">
                                  {entry.data.workshop_task_categories.name}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-slate-500">
                              {formatDistanceToNow(new Date(entry.data.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300">{entry.data.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${
                                entry.data.status === 'completed' 
                                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                                  : entry.data.status === 'logged'
                                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                  : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                              }`}
                            >
                              {entry.data.status}
                            </Badge>
                            {entry.data.profiles?.full_name && (
                              <span className="text-xs text-slate-500">
                                by {entry.data.profiles.full_name}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
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
