'use client';

import { useEffect, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, Archive } from 'lucide-react';
import { formatDateForInput } from '@/lib/utils/maintenanceCalculations';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { createClient } from '@/lib/supabase/client';
import type { MaintenanceHistoryValueType } from '@/lib/utils/maintenance-history';
import { safeMaintenanceHistoryFieldName } from '@/lib/utils/maintenance-history';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

type Plant = {
  id: string;
  plant_id: string;
  nickname: string | null;
  loler_due_date: string | null;
  loler_last_inspection_date: string | null;
  loler_certificate_number: string | null;
  loler_inspection_interval_months: number;
  current_hours: number | null;
};

type MaintenanceRecord = {
  id: string | null;
  plant_id: string;
  current_hours: number | null;
  last_service_hours: number | null;
  next_service_hours: number | null;
  tracker_id: string | null;
  last_hours_update: string | null;
};

// ============================================================================
// Zod Validation Schema
// ============================================================================

const editPlantRecordSchema = z.object({
  // Nickname
  nickname: z.string().max(100, 'Nickname must be less than 100 characters').optional().nullable(),
  // Hours-based fields
  current_hours: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number().int().positive('Current hours must be a positive number').optional().nullable()
  ),
  last_service_hours: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number().int().positive('Last service hours must be a positive number').optional().nullable()
  ),
  next_service_hours: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number().int().positive('Next service hours must be a positive number').optional().nullable()
  ),
  // LOLER fields
  loler_due_date: z.string().optional().nullable(),
  loler_last_inspection_date: z.string().optional().nullable(),
  loler_certificate_number: z.string().max(50, 'Certificate number must be less than 50 characters').optional().nullable(),
  loler_inspection_interval_months: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number().int().positive('Inspection interval must be a positive number').optional().nullable()
  ),
  tracker_id: z.string().max(50, 'Tracker ID must be less than 50 characters').optional().nullable(),
  comment: z.string()
    .min(10, 'Comment must be at least 10 characters')
    .max(500, 'Comment must be less than 500 characters')
    .refine(val => val.trim().length >= 10, 'Comment must be at least 10 characters (excluding whitespace)')
});

type EditPlantRecordFormData = z.infer<typeof editPlantRecordSchema>;

// ============================================================================
// Component
// ============================================================================

interface EditPlantRecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: Plant | null;
  maintenanceRecord: MaintenanceRecord | null;
  onSuccess?: () => void;
  onRetire?: () => void;
}

export function EditPlantRecordDialog({
  open,
  onOpenChange,
  plant,
  maintenanceRecord,
  onSuccess,
  onRetire
}: EditPlantRecordDialogProps) {
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  
  // Check if this is a new maintenance record
  const isNewRecord = !maintenanceRecord?.id;

  // Initialize form
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    watch,
  } = useForm<EditPlantRecordFormData>({
    resolver: zodResolver(editPlantRecordSchema),
  });

  // Watch comment field for character count
  const commentValue = watch('comment') || '';
  const commentLength = commentValue.trim().length;

  // Reset form when plant/maintenance changes
  useEffect(() => {
    if (plant) {
      reset({
        nickname: plant.nickname || '',
        current_hours: maintenanceRecord?.current_hours || plant.current_hours || undefined,
        last_service_hours: maintenanceRecord?.last_service_hours || undefined,
        next_service_hours: maintenanceRecord?.next_service_hours || undefined,
        loler_due_date: formatDateForInput(plant.loler_due_date),
        loler_last_inspection_date: formatDateForInput(plant.loler_last_inspection_date),
        loler_certificate_number: plant.loler_certificate_number || '',
        loler_inspection_interval_months: plant.loler_inspection_interval_months || undefined,
        tracker_id: maintenanceRecord?.tracker_id || '',
        comment: '',
      });
    }
  }, [plant, maintenanceRecord, reset]);

  // Handle modal close attempts
  const handleOpenChange = (newOpen: boolean) => {
    // If trying to close and form has unsaved changes, prevent close and shake
    if (!newOpen && isDirty) {
      triggerShakeAnimation(dialogContentRef.current);
      return;
    }
    
    // Allow close if no changes or explicitly closing
    onOpenChange(newOpen);
  };

  // Handle explicit close button click - discard changes
  const handleDiscardChanges = () => {
    reset(); // Reset form to original values
    onOpenChange(false);
  };

  // Submit handler
  const onSubmit = async (data: EditPlantRecordFormData) => {
    if (!plant) return;

    try {
      setIsSubmitting(true);

      // ----------------------------------------------------------------------
      // Auth is REQUIRED for audit trail integrity.
      // Fail fast before any updates to avoid partial success (updates without history).
      // ----------------------------------------------------------------------
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError) {
        throw new Error(`Authentication failed: ${userError.message}`);
      }

      const user = userData.user;
      if (!user) {
        throw new Error('Your session has expired. Please sign in again to update plant records.');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      // Track changed fields with before/after values for history
      type FieldChange = {
        field_name: string;
        old_value: string | null;
        new_value: string | null;
        // Must align with maintenance_history.value_type CHECK constraint
        value_type: MaintenanceHistoryValueType;
      };
      const fieldChanges: FieldChange[] = [];

      // Update plant nickname if changed
      const newNickname = data.nickname?.trim() || null;
      const oldNickname = plant.nickname;
      if (newNickname !== oldNickname) {
        const { error: nicknameError } = await supabase
          .from('plant')
          .update({ 
            nickname: newNickname,
            updated_at: new Date().toISOString()
          })
          .eq('id', plant.id);

        if (nicknameError) {
          console.error('Error updating plant nickname:', nicknameError);
          // Continue with other updates even if nickname update fails
        } else {
          fieldChanges.push({
            field_name: 'nickname',
            old_value: oldNickname,
            new_value: newNickname,
            value_type: 'text'
          });
        }
      }

      // Update plant table fields (LOLER)
      const plantUpdates: Record<string, any> = {};
      
      // Normalize date values for comparison (treat null, undefined, empty string as equivalent)
      const normalizeDateValue = (val: string | null | undefined): string | null => {
        if (!val || val === '') return null;
        return val;
      };
      
      const newLolerDueDate = normalizeDateValue(data.loler_due_date);
      const oldLolerDueDate = normalizeDateValue(formatDateForInput(plant.loler_due_date));
      if (newLolerDueDate !== oldLolerDueDate) {
        plantUpdates.loler_due_date = newLolerDueDate;
        fieldChanges.push({
          field_name: 'loler_due_date',
          old_value: plant.loler_due_date,
          new_value: newLolerDueDate,
          value_type: 'date'
        });
      }

      const newLolerLastInspection = normalizeDateValue(data.loler_last_inspection_date);
      const oldLolerLastInspection = normalizeDateValue(formatDateForInput(plant.loler_last_inspection_date));
      if (newLolerLastInspection !== oldLolerLastInspection) {
        plantUpdates.loler_last_inspection_date = newLolerLastInspection;
        fieldChanges.push({
          field_name: 'loler_last_inspection_date',
          old_value: plant.loler_last_inspection_date,
          new_value: newLolerLastInspection,
          value_type: 'date'
        });
      }

      const newLolerCertNumber = data.loler_certificate_number?.trim() || null;
      const oldLolerCertNumber = plant.loler_certificate_number;
      if (newLolerCertNumber !== oldLolerCertNumber) {
        plantUpdates.loler_certificate_number = newLolerCertNumber;
        fieldChanges.push({
          field_name: 'loler_certificate_number',
          old_value: oldLolerCertNumber,
          new_value: newLolerCertNumber,
          value_type: 'text'
        });
      }

      const newLolerInterval = data.loler_inspection_interval_months || 12;
      const oldLolerInterval = plant.loler_inspection_interval_months || 12;
      if (newLolerInterval !== oldLolerInterval) {
        plantUpdates.loler_inspection_interval_months = newLolerInterval;
        fieldChanges.push({
          field_name: 'loler_inspection_interval_months',
          old_value: oldLolerInterval.toString(),
          new_value: newLolerInterval.toString(),
          value_type: 'mileage'
        });
      }

      // Update plant table if there are changes
      if (Object.keys(plantUpdates).length > 0) {
        plantUpdates.updated_at = new Date().toISOString();
        
        const { error: plantError } = await supabase
          .from('plant')
          .update(plantUpdates)
          .eq('id', plant.id);

        if (plantError) {
          throw new Error(`Failed to update plant record: ${plantError.message}`);
        }
      }

      // Update or create vehicle_maintenance record
      const maintenanceUpdates: Record<string, any> = {
        current_hours: data.current_hours || null,
        last_service_hours: data.last_service_hours || null,
        next_service_hours: data.next_service_hours || null,
        tracker_id: data.tracker_id?.trim() || null,
        updated_at: new Date().toISOString(),
      };

      // Helper to normalize values for comparison (treat undefined, null, '', 0 as equivalent for comparison)
      const normalizeValue = (val: any): any => {
        if (val === undefined || val === null || val === '') return null;
        return val;
      };

      // Only track changes where the values are actually different
      const newCurrentHours = normalizeValue(data.current_hours);
      const oldCurrentHours = normalizeValue(maintenanceRecord?.current_hours ?? plant.current_hours);
      if (newCurrentHours !== oldCurrentHours) {
        maintenanceUpdates.last_hours_update = new Date().toISOString();
        fieldChanges.push({
          field_name: 'current_hours',
          old_value: oldCurrentHours?.toString() || null,
          new_value: newCurrentHours?.toString() || null,
          value_type: 'mileage'
        });
      }

      const newLastServiceHours = normalizeValue(data.last_service_hours);
      const oldLastServiceHours = normalizeValue(maintenanceRecord?.last_service_hours);
      if (newLastServiceHours !== oldLastServiceHours) {
        fieldChanges.push({
          field_name: 'last_service_hours',
          old_value: oldLastServiceHours?.toString() || null,
          new_value: newLastServiceHours?.toString() || null,
          value_type: 'mileage'
        });
      }

      const newNextServiceHours = normalizeValue(data.next_service_hours);
      const oldNextServiceHours = normalizeValue(maintenanceRecord?.next_service_hours);
      if (newNextServiceHours !== oldNextServiceHours) {
        fieldChanges.push({
          field_name: 'next_service_hours',
          old_value: oldNextServiceHours?.toString() || null,
          new_value: newNextServiceHours?.toString() || null,
          value_type: 'mileage'
        });
      }

      const newTrackerId = normalizeValue(data.tracker_id?.trim());
      const oldTrackerId = normalizeValue(maintenanceRecord?.tracker_id);
      if (newTrackerId !== oldTrackerId) {
        fieldChanges.push({
          field_name: 'tracker_id',
          old_value: oldTrackerId,
          new_value: newTrackerId,
          value_type: 'text'
        });
      }

      // ----------------------------------------------------------------------
      // Create or update vehicle_maintenance for this plant.
      // Production errors showed duplicate creates (unique_plant_maintenance),
      // so we *always* verify existence by plant_id before inserting.
      // ----------------------------------------------------------------------
      let maintenanceId = maintenanceRecord?.id ?? null;
      
      if (!maintenanceId) {
        const { data: existing, error: existingError } = await supabase
          .from('vehicle_maintenance')
          .select('id')
          .eq('plant_id', plant.id)
          .maybeSingle();
        
        if (existingError) {
          throw new Error(`Failed to check existing maintenance record: ${existingError.message}`);
        }
        
        maintenanceId = existing?.id ?? null;
      }
      
      if (!maintenanceId) {
        // Create new maintenance record
        const { error: createError } = await supabase
          .from('vehicle_maintenance')
          .insert({
            plant_id: plant.id,
            ...maintenanceUpdates,
            created_at: new Date().toISOString(),
          });

        if (createError) {
          // If a duplicate slipped through (race condition), fall back to update
          const isDuplicate =
            createError.code === '23505' ||
            createError.message?.includes('unique_plant_maintenance') ||
            createError.message?.toLowerCase().includes('duplicate key');
          
          if (!isDuplicate) {
            throw new Error(`Failed to create maintenance record: ${createError.message}`);
          }
          
          const { data: existing, error: existingError } = await supabase
            .from('vehicle_maintenance')
            .select('id')
            .eq('plant_id', plant.id)
            .maybeSingle();
          
          if (existingError || !existing?.id) {
            throw new Error(`Failed to recover from duplicate maintenance record: ${createError.message}`);
          }
          
          const { error: updateError } = await supabase
            .from('vehicle_maintenance')
            .update(maintenanceUpdates)
            .eq('id', existing.id);
          
          if (updateError) {
            throw new Error(`Failed to update maintenance record: ${updateError.message}`);
          }
        }
      } else {
        // Update existing maintenance record
        const { error: updateError } = await supabase
          .from('vehicle_maintenance')
          .update(maintenanceUpdates)
          .eq('id', maintenanceId);

        if (updateError) {
          throw new Error(`Failed to update maintenance record: ${updateError.message}`);
        }
      }

      // Create maintenance history entries (one per changed field for clarity).
      // Note: This writes with plant_id after the migration.
      if (fieldChanges.length > 0) {
        const historyEntries = fieldChanges.map(change => ({
          plant_id: plant.id,
          vehicle_id: null,
          field_name: safeMaintenanceHistoryFieldName(change.field_name),
          old_value: change.old_value,
          new_value: change.new_value,
          value_type: change.value_type,
          comment: data.comment.trim(),
          updated_by: user.id,
          updated_by_name: profile?.full_name || 'Unknown User',
        }));

        const { error: historyError } = await supabase
          .from('maintenance_history')
          .insert(historyEntries);

        if (historyError) {
          throw new Error(`Failed to write maintenance history: ${historyError.message}`);
        }
      } else {
        // No fields changed, but still log the update attempt with comment
        const { error: historyError } = await supabase.from('maintenance_history').insert({
          plant_id: plant.id,
          vehicle_id: null,
          field_name: 'no_changes',
          old_value: null,
          new_value: null,
          value_type: 'text',
          comment: data.comment.trim(),
          updated_by: user.id,
          updated_by_name: profile?.full_name || 'Unknown User',
        });

        if (historyError) {
          throw new Error(`Failed to write maintenance history: ${historyError.message}`);
        }
      }

      toast.success('Plant record updated successfully', {
        description: `${plant.plant_id} maintenance record has been updated.`,
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating plant record:', error);
      toast.error('Failed to update plant record', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        duration: 5000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!plant) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        ref={dialogContentRef}
        className="border-border text-white w-full max-w-full md:max-w-2xl h-full md:h-auto max-h-screen md:max-h-[90vh] overflow-y-auto p-4 md:p-6"
        onInteractOutside={(e) => {
          // Prevent closing when clicking outside if form has changes
          if (isDirty) {
            e.preventDefault();
            triggerShakeAnimation(dialogContentRef.current);
          }
        }}
        onEscapeKeyDown={(e) => {
          // Prevent closing with Escape key if form has changes
          if (isDirty) {
            e.preventDefault();
            triggerShakeAnimation(dialogContentRef.current);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {isNewRecord ? 'Create' : 'Edit'} Plant Record - {plant.plant_id}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isNewRecord 
              ? 'Set up maintenance schedule for this plant machinery. A comment is required to explain the initial setup.' 
              : 'Update maintenance schedules and LOLER information. A comment is required to explain changes.'
            }
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Plant Nickname */}
          <div className="space-y-2">
            <Label htmlFor="nickname" className="text-white">
              Plant Nickname <span className="text-slate-400 text-xs">(Optional)</span>
            </Label>
            <Input
              id="nickname"
              {...register('nickname')}
              placeholder="e.g., VOLVO ECR88D, Big Digger, Main Excavator"
              className="bg-input border-border text-white"
            />
            <p className="text-xs text-muted-foreground">
              A friendly name to help identify this plant machine quickly
            </p>
            {errors.nickname && (
              <p className="text-sm text-red-400">{errors.nickname.message}</p>
            )}
          </div>

          {/* Hours-based Maintenance (Plant Machinery) */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg border-b border-slate-700 pb-2">
              Hours-Based Maintenance
            </h3>
            
            <div className="grid md:grid-cols-3 gap-4">
              {/* Current Hours */}
              <div className="space-y-2">
                <Label htmlFor="current_hours">Current Hours</Label>
                <Input
                  id="current_hours"
                  type="number"
                  {...register('current_hours')}
                  placeholder="e.g., 1500"
                  className="bg-input border-border text-white"
                />
                {maintenanceRecord?.last_hours_update && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last updated: {new Date(maintenanceRecord.last_hours_update).toLocaleString()}
                  </p>
                )}
                {errors.current_hours && (
                  <p className="text-sm text-red-400">{errors.current_hours.message}</p>
                )}
              </div>

              {/* Next Service Hours */}
              <div className="space-y-2">
                <Label htmlFor="next_service_hours">Next Service (Hours)</Label>
                <Input
                  id="next_service_hours"
                  type="number"
                  {...register('next_service_hours')}
                  placeholder="e.g., 2000"
                  className="bg-input border-border text-white"
                />
                {errors.next_service_hours && (
                  <p className="text-sm text-red-400">{errors.next_service_hours.message}</p>
                )}
              </div>

              {/* Last Service Hours */}
              <div className="space-y-2">
                <Label htmlFor="last_service_hours">Last Service (Hours)</Label>
                <Input
                  id="last_service_hours"
                  type="number"
                  {...register('last_service_hours')}
                  placeholder="e.g., 1000"
                  className="bg-input border-border text-white"
                />
                {errors.last_service_hours && (
                  <p className="text-sm text-red-400">{errors.last_service_hours.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* LOLER Compliance */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg border-b border-slate-700 pb-2">
              LOLER Compliance
            </h3>
            
            <div className="grid md:grid-cols-2 gap-4">
              {/* LOLER Due Date */}
              <div className="space-y-2">
                <Label htmlFor="loler_due_date">LOLER Due Date</Label>
                <Input
                  id="loler_due_date"
                  type="date"
                  {...register('loler_due_date')}
                  className="bg-input border-border text-white"
                />
                {errors.loler_due_date && (
                  <p className="text-sm text-red-400">{errors.loler_due_date.message}</p>
                )}
              </div>

              {/* LOLER Last Inspection Date */}
              <div className="space-y-2">
                <Label htmlFor="loler_last_inspection_date">Last Inspection Date</Label>
                <Input
                  id="loler_last_inspection_date"
                  type="date"
                  {...register('loler_last_inspection_date')}
                  className="bg-input border-border text-white"
                />
                {errors.loler_last_inspection_date && (
                  <p className="text-sm text-red-400">{errors.loler_last_inspection_date.message}</p>
                )}
              </div>

              {/* LOLER Certificate Number */}
              <div className="space-y-2">
                <Label htmlFor="loler_certificate_number">Certificate Number</Label>
                <Input
                  id="loler_certificate_number"
                  {...register('loler_certificate_number')}
                  placeholder="e.g., LOL2024-12345"
                  className="bg-input border-border text-white"
                />
                {errors.loler_certificate_number && (
                  <p className="text-sm text-red-400">{errors.loler_certificate_number.message}</p>
                )}
              </div>

              {/* LOLER Inspection Interval */}
              <div className="space-y-2">
                <Label htmlFor="loler_inspection_interval_months">Inspection Interval (months)</Label>
                <Input
                  id="loler_inspection_interval_months"
                  type="number"
                  {...register('loler_inspection_interval_months')}
                  placeholder="e.g., 12"
                  className="bg-input border-border text-white"
                />
                {errors.loler_inspection_interval_months && (
                  <p className="text-sm text-red-400">{errors.loler_inspection_interval_months.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Tracker ID */}
          <div className="space-y-2">
            <Label htmlFor="tracker_id" className="text-white">GPS Tracker ID</Label>
            <Input
              id="tracker_id"
              type="text"
              {...register('tracker_id')}
              placeholder="e.g., 359632101982533"
              className="bg-input border-border text-white placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              GPS tracking device identifier number
            </p>
            {errors.tracker_id && (
              <p className="text-sm text-red-400">{errors.tracker_id.message}</p>
            )}
          </div>

          {/* Mandatory Comment */}
          <div className="space-y-2 bg-blue-900/20 border border-blue-800/50 rounded-lg p-4">
            <Label htmlFor="comment" className="text-white">
              Update Comment <span className="text-red-400">*</span>
            </Label>
            <Textarea
              id="comment"
              {...register('comment')}
              placeholder="e.g., LOLER inspection completed on 15 Dec 2025, all checks passed. Certificate issued."
              className="bg-input border-border text-white"
              rows={3}
            />
            <div className="flex items-center justify-between text-xs">
              <p className="text-muted-foreground">
                Required: Explain what maintenance was performed and why fields are changing
              </p>
              <p className={`font-mono ${commentLength < 10 ? 'text-red-400' : 'text-green-400'}`}>
                {commentLength} / 500
              </p>
            </div>
            {errors.comment && (
              <p className="text-sm text-red-400">{errors.comment.message}</p>
            )}
          </div>

          <DialogFooter className="!flex-row !justify-between items-center gap-2 w-full">
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (isDirty) {
                  triggerShakeAnimation(dialogContentRef.current);
                  return;
                }
                
                // Check for open workshop tasks
                if (plant?.id) {
                  try {
                    const { data: openTasks, error: tasksError } = await supabase
                      .from('actions')
                      .select('id, status')
                      .eq('plant_id', plant.id)
                      .neq('status', 'completed')
                      .limit(1);

                    if (tasksError) {
                      console.error('Error checking for open tasks:', tasksError);
                      toast.error('Failed to verify workshop tasks');
                      return;
                    }
                    
                    if (openTasks && openTasks.length > 0) {
                      toast.error('Cannot retire plant with open workshop tasks', {
                        description: 'Please complete or delete all open tasks before retiring this plant machinery.',
                        duration: 5000,
                      });
                      return;
                    }
                  } catch (error) {
                    console.error('Error checking for open tasks:', error);
                    toast.error('Failed to verify workshop tasks');
                    return;
                  }
                }
                
                onOpenChange(false);
                onRetire?.();
              }}
              className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white"
              disabled={isSubmitting}
            >
              <Archive className="h-4 w-4 mr-2" />
              Retire Plant
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={handleDiscardChanges}
                className="border-slate-600 text-white hover:bg-slate-800"
                disabled={isSubmitting}
              >
                {isDirty ? 'Discard Changes' : 'Cancel'}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || commentLength < 10}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isNewRecord ? 'Creating...' : 'Saving...'}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {isNewRecord ? 'Create Record' : 'Save Changes'}
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
