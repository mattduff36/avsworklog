'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, History as HistoryIcon, User, Calendar, Edit } from 'lucide-react';
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
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
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
                className="bg-red-600 hover:bg-red-700 text-white flex-shrink-0"
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
          <div className="space-y-6">
            {Object.entries(groupedHistory)
              .sort(([a], [b]) => b.localeCompare(a)) // Most recent first
              .map(([dateKey, entries]) => (
                <div key={dateKey} className="space-y-3">
                  {/* Date Header */}
                  <div className="flex items-center gap-2 text-slate-400 text-sm">
                    <Calendar className="h-4 w-4" />
                    {new Date(dateKey).toLocaleDateString('en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </div>
                  
                  {/* Changes on that date */}
                  {entries.map((entry) => (
                    <div 
                      key={entry.id}
                      className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3"
                    >
                      {/* Header with user and time */}
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
                      
                      {/* Field Change */}
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
                      
                      {/* Comment */}
                      <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
                        <p className="text-xs text-slate-500 mb-1">Comment:</p>
                        <p className="text-slate-200 text-sm">{entry.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
