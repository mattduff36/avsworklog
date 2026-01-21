'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';

// Alert type from MaintenanceOverview
interface Alert {
  type: string;
  detail: string;
  severity: 'overdue' | 'due_soon';
  sortValue: number;
}

// Vehicle data needed for current values
interface VehicleData {
  tax_due_date?: string | null;
  mot_due_date?: string | null;
  first_aid_kit_expiry?: string | null;
  next_service_mileage?: number | null;
  cambelt_due_mileage?: number | null;
}

interface QuickEditPopoverProps {
  alert: Alert;
  vehicleId: string;
  vehicle: VehicleData;
  onSuccess?: () => void;
}

// Map alert type to API field name
const ALERT_TO_FIELD: Record<string, string> = {
  'Tax': 'tax_due_date',
  'MOT': 'mot_due_date',
  'First Aid Kit': 'first_aid_kit_expiry',
  'Service': 'next_service_mileage',
  'Cambelt': 'cambelt_due_mileage',
};

// Map alert type to display label
const ALERT_TO_LABEL: Record<string, string> = {
  'Tax': 'Tax Due Date',
  'MOT': 'MOT Due Date',
  'First Aid Kit': 'First Aid Kit Expiry',
  'Service': 'Service Due Mileage',
  'Cambelt': 'Cambelt Due Mileage',
};

// Fields that use date input
const DATE_FIELDS = ['Tax', 'MOT', 'First Aid Kit'];

// Get current value from vehicle based on alert type
function getCurrentValue(alertType: string, vehicle: VehicleData): string {
  switch (alertType) {
    case 'Tax':
      return vehicle.tax_due_date || '';
    case 'MOT':
      return vehicle.mot_due_date || '';
    case 'First Aid Kit':
      return vehicle.first_aid_kit_expiry || '';
    case 'Service':
      return vehicle.next_service_mileage?.toString() || '';
    case 'Cambelt':
      return vehicle.cambelt_due_mileage?.toString() || '';
    default:
      return '';
  }
}

// Format current value for display
function formatCurrentValue(alertType: string, value: string): string {
  if (!value) return 'Not set';
  
  if (DATE_FIELDS.includes(alertType)) {
    try {
      return new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return value;
    }
  }
  
  // Mileage - format with commas
  const num = parseInt(value, 10);
  if (!isNaN(num)) {
    return `${num.toLocaleString()} miles`;
  }
  return value;
}

export function QuickEditPopover({
  alert,
  vehicleId,
  vehicle,
  onSuccess,
}: QuickEditPopoverProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [comment, setComment] = useState('');

  const fieldName = ALERT_TO_FIELD[alert.type];
  const fieldLabel = ALERT_TO_LABEL[alert.type] || alert.type;
  const isDateField = DATE_FIELDS.includes(alert.type);
  const currentValue = getCurrentValue(alert.type, vehicle);

  // Reset form when popover opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      // Pre-fill with current value
      if (isDateField && currentValue) {
        // Format date for input (YYYY-MM-DD)
        try {
          const date = new Date(currentValue);
          setNewValue(date.toISOString().split('T')[0]);
        } catch {
          setNewValue('');
        }
      } else {
        setNewValue(currentValue);
      }
      setComment('');
    }
    setOpen(isOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newValue) {
      toast.error('Please enter a new value');
      return;
    }

    if (!comment || comment.trim().length < 10) {
      toast.error('Comment must be at least 10 characters');
      return;
    }

    if (!fieldName) {
      toast.error('This field cannot be edited');
      return;
    }

    setLoading(true);
    try {
      // Build the payload with the correct field
      const payload: Record<string, string | number> = {
        comment: comment.trim(),
      };

      if (isDateField) {
        payload[fieldName] = newValue;
      } else {
        // Mileage field - convert to number
        const mileageValue = parseInt(newValue.replace(/,/g, ''), 10);
        if (isNaN(mileageValue) || mileageValue < 0) {
          toast.error('Please enter a valid mileage');
          setLoading(false);
          return;
        }
        payload[fieldName] = mileageValue;
      }

      const response = await fetch(`/api/maintenance/by-vehicle/${vehicleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update');
      }

      toast.success(`${fieldLabel} updated`, {
        description: isDateField
          ? `Changed to ${new Date(newValue).toLocaleDateString('en-GB')}`
          : `Changed to ${parseInt(newValue.replace(/,/g, ''), 10).toLocaleString()} miles`,
      });

      setOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error('Quick edit error:', error);
      toast.error('Failed to update', {
        description: error instanceof Error ? error.message : 'Please try again',
      });
    } finally {
      setLoading(false);
    }
  };

  // Stop propagation to prevent card click when interacting with popover
  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Badge
          onClick={handleBadgeClick}
          className={`cursor-pointer transition-all hover:ring-2 hover:ring-offset-1 hover:ring-offset-slate-900 ${
            alert.severity === 'overdue'
              ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:ring-red-500/50'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:ring-amber-500/50'
          }`}
          variant="outline"
        >
          <Pencil className="h-3 w-3 mr-1 opacity-60" />
          {alert.type}: {alert.detail}
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 bg-slate-800 border-slate-700 text-white p-4"
        align="start"
        sideOffset={8}
        onClick={handleBadgeClick}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium text-sm text-white">Quick Edit: {fieldLabel}</h4>
            <p className="text-xs text-muted-foreground">
              Current: {formatCurrentValue(alert.type, currentValue)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="newValue" className="text-muted-foreground text-sm">
              New Value
            </Label>
            {isDateField ? (
              <Input
                id="newValue"
                type="date"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="border-border text-white"
                required
              />
            ) : (
              <Input
                id="newValue"
                type="number"
                min="0"
                step="1"
                placeholder="Enter mileage"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="border-border text-white"
                required
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="comment" className="text-muted-foreground text-sm">
              Reason for change <span className="text-muted-foreground">(min 10 chars)</span>
            </Label>
            <Textarea
              id="comment"
              placeholder="Why is this being changed?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="border-border text-white resize-none h-20"
              required
              minLength={10}
            />
            <p className="text-xs text-muted-foreground">
              {comment.length}/10 characters minimum
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="flex-1 border-border text-muted-foreground hover:bg-slate-700"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              disabled={loading || comment.length < 10}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
