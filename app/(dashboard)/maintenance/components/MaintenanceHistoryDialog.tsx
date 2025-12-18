'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, History as HistoryIcon, User, Calendar, Edit, ChevronDown, Clock } from 'lucide-react';
import { useMaintenanceHistory } from '@/lib/hooks/useMaintenance';
import { formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';

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
  
  const history = historyData?.history || [];
  
  // Group history by date (show all changes made together)
  const groupedHistory: Record<string, typeof history> = {};
  history.forEach(entry => {
    const dateKey = new Date(entry.created_at).toISOString().split('T')[0];
    if (!groupedHistory[dateKey]) {
      groupedHistory[dateKey] = [];
    }
    groupedHistory[dateKey].push(entry);
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
  const latestEntries = history.slice(0, 3);
  
  // Get entries to display in full history
  const fullHistoryEntries = showFullHistory 
    ? history.slice(0, visibleHistoryCount)
    : [];
  
  const hasMoreHistory = history.length > visibleHistoryCount;
  
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
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="flex-1">
              <DialogTitle className="text-2xl flex items-center gap-2">
                <HistoryIcon className="h-6 w-6" />
                Maintenance History - {vehicleReg || 'Vehicle'}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Complete audit trail of all maintenance changes
              </DialogDescription>
            </div>
            {onEditClick && (
              <Button
                onClick={onEditClick}
                className="bg-red-600 hover:bg-red-700 text-white flex-shrink-0 mt-1"
                size="sm"
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <HistoryIcon className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>No maintenance history yet</p>
            <p className="text-sm mt-1">Changes will appear here when maintenance records are updated</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Recent Updates Summary */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Recent Updates</h3>
              {latestEntries.map((entry) => (
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
              ))}
            </div>

            {/* Show All History Button */}
            {history.length > 3 && !showFullHistory && (
              <Button
                onClick={() => setShowFullHistory(true)}
                variant="outline"
                className="w-full border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <ChevronDown className="h-4 w-4 mr-2" />
                Show All History ({history.length} total updates)
              </Button>
            )}

            {/* Full History Section */}
            {showFullHistory && (
              <div className="space-y-4 border-t border-slate-700 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Complete History</h3>
                  <Button
                    onClick={() => {
                      setShowFullHistory(false);
                      setVisibleHistoryCount(10);
                    }}
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-white"
                  >
                    Hide
                  </Button>
                </div>
                
                <div className="space-y-6">
                  {Object.entries(groupedHistory)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .slice(0, Math.ceil(visibleHistoryCount / 2))
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
                        
                        {entries.map((entry) => (
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
                        ))}
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
                    Show More ({history.length - visibleHistoryCount} remaining)
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
