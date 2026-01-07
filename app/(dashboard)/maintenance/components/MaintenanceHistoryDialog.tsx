'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, History as HistoryIcon, User, Calendar, Edit, ChevronDown, ChevronUp, Clock, FileText, RefreshCw } from 'lucide-react';
import { useMaintenanceHistory } from '@/lib/hooks/useMaintenance';
import { formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';
import { MotHistoryDialog } from './MotHistoryDialog';

interface MaintenanceHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string | null;
  vehicleReg?: string;
  onEditClick?: () => void;
}

export function MaintenanceHistoryDialog({
  open,
  onOpenChange,
  vehicleId,
  vehicleReg,
  onEditClick
}: MaintenanceHistoryDialogProps) {
  const { data: historyData, isLoading } = useMaintenanceHistory(vehicleId);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
  const [showVehicleData, setShowVehicleData] = useState(false);
  const [motHistoryOpen, setMotHistoryOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const history = historyData?.history || [];
  const workshopTasks = historyData?.workshopTasks || [];
  const vesData = historyData?.vesData || null;
  
  // Combine maintenance history and workshop tasks, sorted by date
  type CombinedItem = 
    | { type: 'maintenance'; data: typeof history[0]; created_at: string }
    | { type: 'workshop'; data: typeof workshopTasks[0]; created_at: string };
  
  const combinedItems: CombinedItem[] = [
    ...history.map(h => ({ type: 'maintenance' as const, data: h, created_at: h.created_at })),
    ...workshopTasks.map(w => ({ type: 'workshop' as const, data: w, created_at: w.created_at }))
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  
  // Auto-sync on modal open if last sync was >24h ago
  useEffect(() => {
    if (open && vehicleId && vesData) {
      const shouldSync = checkIfSyncNeeded(vesData);
      if (shouldSync) {
        performAutoSync();
      }
    }
  }, [open, vehicleId]);
  
  // Check if sync is needed (>24 hours since last sync)
  const checkIfSyncNeeded = (data: any): boolean => {
    const lastDvlaSync = data.last_dvla_sync ? new Date(data.last_dvla_sync).getTime() : 0;
    const lastMotSync = data.last_mot_api_sync ? new Date(data.last_mot_api_sync).getTime() : 0;
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    // Sync if either TAX or MOT hasn't been synced in 24h
    const dvlaStale = (now - lastDvlaSync) > twentyFourHours;
    const motStale = (now - lastMotSync) > twentyFourHours;
    
    return dvlaStale || motStale;
  };
  
  // Perform auto-sync in background
  const performAutoSync = async () => {
    if (!vehicleId || isSyncing) return;
    
    setIsSyncing(true);
    try {
      const response = await fetch('/api/maintenance/sync-dvla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleIds: [vehicleId] }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Silently refresh data without full page reload
        window.location.reload();
      }
    } catch (error) {
      console.error('Auto-sync error:', error);
      // Fail silently - don't interrupt user experience
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Group combined items by date (show all changes made together)
  const groupedHistory: Record<string, typeof combinedItems> = {};
  combinedItems.forEach(item => {
    const dateKey = new Date(item.created_at).toISOString().split('T')[0];
    if (!groupedHistory[dateKey]) {
      groupedHistory[dateKey] = [];
    }
    groupedHistory[dateKey].push(item);
  });
  
  const formatFieldName = (fieldName: string): string => {
    const fieldMap: Record<string, string> = {
      'tax_due_date': 'Tax Due Date',
      'mot_due_date': 'MOT Due Date',
      'first_aid_kit_expiry': 'First Aid Kit Expiry',
      'next_service_mileage': 'Next Service',
      'last_service_mileage': 'Last Service',
      'cambelt_due_mileage': 'Cambelt Due',
      'cambelt_done': 'Cambelt Done',
      'notes': 'Notes',
      'all_fields': 'All Fields',
      'no_changes': 'Comment Only',
    };
    return fieldMap[fieldName] || fieldName;
  };
  
  const formatValue = (value: string | null, type: string): string => {
    if (!value || value === 'null') return 'Not Set';
    
    if (type === 'date') {
      return formatMaintenanceDate(value);
    }
    if (type === 'mileage') {
      return parseInt(value).toLocaleString() + ' miles';
    }
    if (type === 'boolean') {
      return value === 'true' ? 'Yes' : 'No';
    }
    return value;
  };
  
  // Get latest 3 entries for summary
  const latestEntries = combinedItems.slice(0, 3);
  
  // Get entries to display in full history
  const fullHistoryEntries = showFullHistory 
    ? combinedItems.slice(0, visibleHistoryCount)
    : [];
  
  const hasMoreHistory = combinedItems.length > visibleHistoryCount;
  
  // Format relative time
  const getRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-3xl max-h-[90vh] md:max-h-[90vh] h-full md:h-auto w-full md:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 md:gap-4 md:pr-8">
            <div className="flex-1">
              <DialogTitle className="text-xl md:text-2xl flex items-center gap-2">
                <HistoryIcon className="h-5 w-5 md:h-6 md:w-6" />
                <span className="truncate">Maintenance History - {vehicleReg || 'Vehicle'}</span>
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-sm">
                Complete audit trail of all maintenance changes
              </DialogDescription>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                onClick={() => setMotHistoryOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white flex-1 md:flex-initial"
                size="sm"
              >
                <FileText className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">MOT History</span>
              </Button>
              {onEditClick && (
                <Button
                  onClick={onEditClick}
                  className="bg-red-600 hover:bg-red-700 text-white flex-1 md:flex-initial"
                  size="sm"
                >
                  <Edit className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">Edit</span>
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* VES Vehicle Data Section - Show even if no history */}
            {vesData && (vesData.ves_make || vesData.ves_colour || vesData.ves_fuel_type) && (
              <div className="bg-gradient-to-r from-blue-900/20 to-blue-800/10 border border-blue-700/30 rounded-lg p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-medium text-blue-300 uppercase tracking-wide flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Vehicle Data
                  </h3>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {/* Make - prefer VES, fallback to MOT */}
                  {(vesData.ves_make || vesData.mot_make) && (
                    <div>
                      <span className="text-slate-400">Make:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_make || vesData.mot_make}</span>
                    </div>
                  )}
                  
                  {/* Model - from MOT API only */}
                  {vesData.mot_model && (
                    <div>
                      <span className="text-slate-400">Model:</span>
                      <span className="ml-2 text-white font-medium">{vesData.mot_model}</span>
                    </div>
                  )}
                  
                  {/* Colour - prefer VES, fallback to MOT */}
                  {(vesData.ves_colour || vesData.mot_primary_colour) && (
                    <div>
                      <span className="text-slate-400">Colour:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_colour || vesData.mot_primary_colour}</span>
                    </div>
                  )}
                  
                  {/* Year - prefer VES, fallback to MOT */}
                  {(vesData.ves_year_of_manufacture || vesData.mot_year_of_manufacture) && (
                    <div>
                      <span className="text-slate-400">Year:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_year_of_manufacture || vesData.mot_year_of_manufacture}</span>
                    </div>
                  )}
                  
                  {/* Fuel - prefer VES, fallback to MOT */}
                  {(vesData.ves_fuel_type || vesData.mot_fuel_type) && (
                    <div>
                      <span className="text-slate-400">Fuel:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_fuel_type || vesData.mot_fuel_type}</span>
                    </div>
                  )}
                  
                  {/* First Registration - from MOT API */}
                  {vesData.mot_first_used_date && (
                    <div>
                      <span className="text-slate-400">First Reg:</span>
                      <span className="ml-2 text-white font-medium">{formatMaintenanceDate(vesData.mot_first_used_date)}</span>
                    </div>
                  )}
                  
                  {/* Engine - from VES only */}
                  {vesData.ves_engine_capacity && (
                    <div>
                      <span className="text-slate-400">Engine:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_engine_capacity}cc</span>
                    </div>
                  )}
                  
                  {/* Tax Status - from VES */}
                  {vesData.ves_tax_status && (
                    <div>
                      <span className="text-slate-400">Tax Status:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_tax_status}</span>
                    </div>
                  )}
                  
                  {/* Tax Due Date */}
                  {vesData.tax_due_date && (
                    <div>
                      <span className="text-slate-400">Tax Due:</span>
                      <span className="ml-2 text-white font-medium">{formatMaintenanceDate(vesData.tax_due_date)}</span>
                    </div>
                  )}
                  
                  {/* MOT Status - from VES */}
                  {vesData.ves_mot_status && (
                    <div>
                      <span className="text-slate-400">MOT Status:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_mot_status}</span>
                    </div>
                  )}
                  
                  {/* MOT Due Date */}
                  {vesData.mot_due_date && (
                    <div>
                      <span className="text-slate-400">MOT Due:</span>
                      <span className="ml-2 text-white font-medium">{formatMaintenanceDate(vesData.mot_due_date)}</span>
                    </div>
                  )}
                  
                  {/* CO2 Emissions - from VES */}
                  {vesData.ves_co2_emissions && (
                    <div>
                      <span className="text-slate-400">CO2:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_co2_emissions}g/km</span>
                    </div>
                  )}
                  
                  {/* Euro Status - from VES */}
                  {vesData.ves_euro_status && (
                    <div>
                      <span className="text-slate-400">Euro Status:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_euro_status}</span>
                    </div>
                  )}
                  
                  {/* Wheelplan - from VES */}
                  {vesData.ves_wheelplan && (
                    <div className="col-span-2">
                      <span className="text-slate-400">Wheelplan:</span>
                      <span className="ml-2 text-white font-medium">{vesData.ves_wheelplan}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Show "No history" message if no history, but still show DVLA data above */}
            {combinedItems.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <HistoryIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>No maintenance history yet</p>
                <p className="text-sm mt-1">Changes will appear here when maintenance records or workshop tasks are recorded</p>
              </div>
            ) : (
              <>
                {/* Recent Updates Summary */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Recent Updates</h3>
              {latestEntries.map((item) => {
                if (item.type === 'workshop') {
                  // Workshop task item
                  const task = item.data;
                  return (
                    <div 
                      key={task.id}
                      className="bg-gradient-to-r from-[#8B4513]/20 to-[#8B4513]/10 border border-[#8B4513]/30 rounded-lg p-4 hover:border-[#8B4513]/50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-[#D2691E]" />
                          <span className="font-medium text-white">
                            {task.profiles?.full_name || 'Unknown User'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock className="h-3 w-3" />
                          {getRelativeTime(task.created_at)}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs bg-[#8B4513]/20 border-[#8B4513]/40 text-[#D2691E]">
                            Workshop Task
                          </Badge>
                          {task.workshop_task_categories && (
                            <Badge variant="outline" className="text-xs">
                              {task.workshop_task_categories.name}
                            </Badge>
                          )}
                          <Badge variant="outline" className={`text-xs ${
                            task.status === 'completed' ? 'bg-green-500/20 border-green-500/40 text-green-400' :
                            task.status === 'logged' ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' :
                            'bg-amber-500/20 border-amber-500/40 text-amber-400'
                          }`}>
                            {task.status === 'completed' ? 'Completed' :
                             task.status === 'logged' ? 'In Progress' : 'Pending'}
                          </Badge>
                        </div>
                        
                        {task.workshop_comments && (
                          <div className="bg-slate-900/50 rounded p-2 border-l-2 border-[#D2691E]">
                            <p className="text-sm text-slate-300 italic">"{task.workshop_comments}"</p>
                          </div>
                        )}
                        
                        {task.status === 'completed' && task.actioned_at && (
                          <div className="text-xs text-green-400">
                            Completed: {getRelativeTime(task.actioned_at)}
                          </div>
                        )}
                        {task.status === 'logged' && task.logged_at && (
                          <div className="text-xs text-blue-400">
                            Started: {getRelativeTime(task.logged_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                } else {
                  // Maintenance history item
                  const entry = item.data;
                  return (
                    <div 
                      key={entry.id}
                      className="bg-gradient-to-r from-slate-800/50 to-slate-800/30 border border-slate-700/50 rounded-lg p-4 hover:border-slate-600 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-blue-400" />
                          <span className="font-medium text-white">
                            {entry.updated_by_name || 'Unknown User'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock className="h-3 w-3" />
                          {getRelativeTime(entry.created_at)}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-slate-300">Updated</span>
                          <Badge variant="outline" className="text-xs">
                            {formatFieldName(entry.field_name)}
                          </Badge>
                        </div>
                        
                        {entry.field_name !== 'all_fields' && entry.field_name !== 'no_changes' && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-slate-500 line-through">
                              {formatValue(entry.old_value, entry.value_type)}
                            </span>
                            <span className="text-slate-500">→</span>
                            <span className="text-green-400 font-semibold">
                              {formatValue(entry.new_value, entry.value_type)}
                            </span>
                          </div>
                        )}
                        
                        <div className="bg-slate-900/50 rounded p-2 border-l-2 border-blue-500">
                          <p className="text-sm text-slate-300 italic">"{entry.comment}"</p>
                        </div>
                      </div>
                    </div>
                  );
                }
              })}
            </div>

            {/* Expandable Complete History Section */}
            {combinedItems.length > 3 && (
              <div className="border-t border-slate-700 pt-4">
                <button
                  onClick={() => setShowFullHistory(!showFullHistory)}
                  className="w-full flex items-center justify-between p-3 bg-slate-800/30 hover:bg-slate-800/50 rounded-lg border border-slate-700/50 transition-colors"
                >
                  <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">
                    Complete History ({combinedItems.length} total updates)
                  </h3>
                  {showFullHistory ? (
                    <ChevronUp className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )}
                </button>
                
                {showFullHistory && (
                  <div className="space-y-4 mt-4">
                
                <div className="space-y-6">
                  {Object.entries(groupedHistory)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .slice(0, visibleHistoryCount)
                    .map(([dateKey, entries]) => (
                      <div key={dateKey} className="space-y-3">
                        <div className="flex items-center gap-2 text-slate-400 text-sm">
                          <Calendar className="h-4 w-4" />
                          {new Date(dateKey).toLocaleDateString('en-GB', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric'
                          })}
                        </div>
                        
                        {entries.map((item) => {
                          if (item.type === 'workshop') {
                            // Workshop task in full history
                            const task = item.data;
                            return (
                              <div 
                                key={task.id}
                                className="bg-[#8B4513]/10 border border-[#8B4513]/30 rounded-lg p-4 space-y-3"
                              >
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2 text-slate-300">
                                    <User className="h-4 w-4 text-[#D2691E]" />
                                    <span className="font-medium">
                                      {task.profiles?.full_name || 'Unknown User'}
                                    </span>
                                  </div>
                                  <span className="text-slate-500">
                                    {new Date(task.created_at).toLocaleTimeString('en-GB', {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                </div>
                                
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant="outline" className="text-xs bg-[#8B4513]/20 border-[#8B4513]/40 text-[#D2691E]">
                                      Workshop Task
                                    </Badge>
                                    {task.workshop_task_categories && (
                                      <Badge variant="outline" className="text-xs">
                                        {task.workshop_task_categories.name}
                                      </Badge>
                                    )}
                                    <Badge variant="outline" className={`text-xs ${
                                      task.status === 'completed' ? 'bg-green-500/20 border-green-500/40 text-green-400' :
                                      task.status === 'logged' ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' :
                                      'bg-amber-500/20 border-amber-500/40 text-amber-400'
                                    }`}>
                                      {task.status === 'completed' ? 'Completed' :
                                       task.status === 'logged' ? 'In Progress' : 'Pending'}
                                    </Badge>
                                  </div>
                                </div>
                                
                                {task.workshop_comments && (
                                  <div className="bg-slate-900/50 rounded p-3 border border-[#D2691E]">
                                    <p className="text-xs text-slate-500 mb-1">Work Description:</p>
                                    <p className="text-slate-200 text-sm">{task.workshop_comments}</p>
                                  </div>
                                )}
                                
                                <div className="flex gap-4 text-xs">
                                  {task.status === 'completed' && task.actioned_at && (
                                    <div className="text-green-400">
                                      ✓ Completed: {new Date(task.actioned_at).toLocaleString('en-GB')}
                                    </div>
                                  )}
                                  {task.status === 'logged' && task.logged_at && (
                                    <div className="text-blue-400">
                                      ⚙ Started: {new Date(task.logged_at).toLocaleString('en-GB')}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          } else {
                            // Maintenance history in full history
                            const entry = item.data;
                            return (
                              <div 
                                key={entry.id}
                                className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4 space-y-3"
                              >
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2 text-slate-300">
                                    <User className="h-4 w-4" />
                                    <span className="font-medium">
                                      {entry.updated_by_name || 'Unknown User'}
                                    </span>
                                  </div>
                                  <span className="text-slate-500">
                                    {new Date(entry.created_at).toLocaleTimeString('en-GB', {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                </div>
                                
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">
                                      {formatFieldName(entry.field_name)}
                                    </Badge>
                                    {entry.value_type && (
                                      <Badge variant="secondary" className="text-xs capitalize">
                                        {entry.value_type}
                                      </Badge>
                                    )}
                                  </div>
                                  
                                  {entry.field_name !== 'all_fields' && entry.field_name !== 'no_changes' && (
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                      <div>
                                        <span className="text-slate-500">Old Value:</span>
                                        <p className="text-slate-300 font-mono">
                                          {formatValue(entry.old_value, entry.value_type)}
                                        </p>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">New Value:</span>
                                        <p className="text-white font-mono font-semibold">
                                          {formatValue(entry.new_value, entry.value_type)}
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                
                                <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
                                  <p className="text-xs text-slate-500 mb-1">Comment:</p>
                                  <p className="text-slate-200 text-sm">{entry.comment}</p>
                                </div>
                              </div>
                            );
                          }
                        })}
                      </div>
                    ))}
                </div>

                {/* Show More Button */}
                {hasMoreHistory && (
                  <Button
                    onClick={() => setVisibleHistoryCount(prev => prev + 10)}
                    variant="outline"
                    className="w-full border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    <ChevronDown className="h-4 w-4 mr-2" />
                    Show More ({combinedItems.length - visibleHistoryCount} remaining)
                  </Button>
                )}
                  </div>
                )}
              </div>
            )}
              </>
            )}
          </div>
        )}
      </DialogContent>
      
      {/* MOT History Modal */}
      <MotHistoryDialog
        open={motHistoryOpen}
        onOpenChange={setMotHistoryOpen}
        vehicleReg={vehicleReg || 'Unknown'}
        vehicleId={vehicleId || ''}
        existingMotDueDate={vesData?.mot_due_date || null}
      />
    </Dialog>
  );
}
