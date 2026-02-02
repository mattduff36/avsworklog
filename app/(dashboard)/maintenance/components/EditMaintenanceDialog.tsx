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
import type { VehicleMaintenanceWithStatus } from '@/types/maintenance';
import { useUpdateMaintenance, useCreateMaintenance } from '@/lib/hooks/useMaintenance';
import { formatDateForInput } from '@/lib/utils/maintenanceCalculations';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

// ============================================================================
// Zod Validation Schema
// ============================================================================

const editMaintenanceSchema = z.object({
  nickname: z.string().max(100, 'Nickname must be less than 100 characters').optional().nullable(),
  current_mileage: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number().int().positive('Current mileage must be a positive number').optional().nullable()
  ),
  tax_due_date: z.string().optional().nullable(),
  mot_due_date: z.string().optional().nullable(),
  first_aid_kit_expiry: z.string().optional().nullable(),
  next_service_mileage: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number().int().positive('Too small expected number to be >0').optional().nullable()
  ),
  last_service_mileage: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number().int().positive('Too small expected number to be >0').optional().nullable()
  ),
  cambelt_due_mileage: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? null : Number(val),
    z.number().int().positive('Too small expected number to be >0').optional().nullable()
  ),
  // Hours-based fields for plant machinery
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
  tracker_id: z.string().max(50, 'Tracker ID must be less than 50 characters').optional().nullable(),
  // notes field removed from schema - kept in database/backend for future use but not used in form
  comment: z.string()
    .min(10, 'Comment must be at least 10 characters')
    .max(500, 'Comment must be less than 500 characters')
    .refine(val => val.trim().length >= 10, 'Comment must be at least 10 characters (excluding whitespace)')
});

type EditMaintenanceFormData = z.infer<typeof editMaintenanceSchema>;

// ============================================================================
// Component
// ============================================================================

interface EditMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle: VehicleMaintenanceWithStatus | null;
  onSuccess?: () => void;
  onRetire?: () => void;
}

export function EditMaintenanceDialog({
  open,
  onOpenChange,
  vehicle,
  onSuccess,
  onRetire
}: EditMaintenanceDialogProps) {
  const supabase = createClient();
  const updateMutation = useUpdateMaintenance();
  const createMutation = useCreateMaintenance();
  const [isMileageFocused, setIsMileageFocused] = useState(false);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  
  // Check if this is a new maintenance record (vehicle.id is null for vehicles without maintenance records)
  const isNewRecord = !vehicle?.id;

  // Initialize form
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    watch,
  } = useForm<EditMaintenanceFormData>({
    resolver: zodResolver(editMaintenanceSchema),
  });

  // Watch comment field for character count
  const commentValue = watch('comment') || '';
  const commentLength = commentValue.trim().length;

  // Reset form when vehicle changes
  useEffect(() => {
    if (vehicle) {
      reset({
        nickname: vehicle.vehicle?.nickname || '',
        current_mileage: vehicle.current_mileage || undefined,
        tax_due_date: formatDateForInput(vehicle.tax_due_date),
        mot_due_date: formatDateForInput(vehicle.mot_due_date),
        first_aid_kit_expiry: formatDateForInput(vehicle.first_aid_kit_expiry),
        next_service_mileage: vehicle.next_service_mileage || undefined,
        last_service_mileage: vehicle.last_service_mileage || undefined,
        cambelt_due_mileage: vehicle.cambelt_due_mileage || undefined,
        current_hours: vehicle.current_hours || undefined,
        last_service_hours: vehicle.last_service_hours || undefined,
        next_service_hours: vehicle.next_service_hours || undefined,
        tracker_id: vehicle.tracker_id || '',
        comment: '',
      });
    }
  }, [vehicle, reset]);

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
  const onSubmit = async (data: EditMaintenanceFormData) => {
    if (!vehicle) return;

    // If nickname has changed, update the vehicle record first
    const nicknameChanged = data.nickname?.trim() !== vehicle.vehicle?.nickname;
    if (nicknameChanged && vehicle.vehicle?.id) {
      try {
        const response = await fetch(`/api/admin/vehicles/${vehicle.vehicle.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nickname: data.nickname?.trim() || null,
          }),
        });
        
        if (!response.ok) {
          throw new Error('Failed to update vehicle nickname');
        }
      } catch (error) {
        console.error('Error updating vehicle nickname:', error);
        // Continue with maintenance update even if nickname update fails
      }
    }

    // Convert empty strings to null for dates
    // Note: comment is included here for the API request body (used for audit logging),
    // but the API will extract it and not include it in the database update
    // Note: notes field is kept in schema for future use but hidden from UI
    const updates = {
      current_mileage: data.current_mileage || null,
      tax_due_date: data.tax_due_date || null,
      mot_due_date: data.mot_due_date || null,
      first_aid_kit_expiry: data.first_aid_kit_expiry || null,
      next_service_mileage: data.next_service_mileage || null,
      last_service_mileage: data.last_service_mileage || null,
      cambelt_due_mileage: data.cambelt_due_mileage || null,
      current_hours: data.current_hours || null,
      last_service_hours: data.last_service_hours || null,
      next_service_hours: data.next_service_hours || null,
      tracker_id: data.tracker_id || null,
      // notes field intentionally omitted - kept in DB/backend for future use but hidden from UI
      comment: data.comment.trim(), // Mandatory comment for audit trail (not a DB column)
    };

    if (isNewRecord) {
      // Create new maintenance record
      await createMutation.mutateAsync({ 
        vehicle_id: vehicle.vehicle_id, 
        data: updates 
      });
    } else {
      // Update existing maintenance record
      await updateMutation.mutateAsync({ id: vehicle.id, updates });
    }
    
    onSuccess?.();
  };

  if (!vehicle) return null;

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
            {isNewRecord ? 'Create' : 'Edit'} {vehicle.vehicle?.asset_type === 'plant' ? 'Plant' : 'Vehicle'} Record - {vehicle.vehicle?.reg_number || vehicle.vehicle?.plant_id}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isNewRecord 
              ? 'Set up maintenance schedule for this asset. A comment is required to explain the initial setup.' 
              : 'Update maintenance dates and schedules. A comment is required to explain changes.'
            }
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Vehicle Nickname */}
          <div className="space-y-2">
            <Label htmlFor="nickname" className="text-white">
              Vehicle Nickname <span className="text-slate-400 text-xs">(Optional)</span>
            </Label>
            <Input
              id="nickname"
              {...register('nickname')}
              placeholder="e.g., Andy's Van, Red Pickup, Main Truck"
              className="bg-input border-border text-white"
            />
            <p className="text-xs text-muted-foreground">
              A friendly name to help identify this vehicle quickly
            </p>
            {errors.nickname && (
              <p className="text-sm text-red-400">{errors.nickname.message}</p>
            )}
          </div>

          {/* Current Mileage (Editable for manual corrections) - Vehicle only */}
          {vehicle.vehicle?.asset_type !== 'plant' && (
            <div className={`rounded-lg p-4 transition-colors ${
              isMileageFocused 
                ? 'bg-amber-900/20 border border-amber-800/50' 
                : 'bg-slate-800/50 border border-border'
            }`}>
              <Label htmlFor="current_mileage" className="text-white">
                Current Mileage {isMileageFocused && <span className="text-amber-400">(Manual Override)</span>}
              </Label>
              <Input
                id="current_mileage"
                type="number"
                {...register('current_mileage')}
                onFocus={() => setIsMileageFocused(true)}
                onBlur={() => setIsMileageFocused(false)}
                placeholder="e.g., 75000"
                className="bg-input border-border text-white mt-2"
              />
              {isMileageFocused && (
                <p className="text-xs text-amber-400 mt-2">
                  ⚠️ Normally auto-updated from inspections. Only edit if the current mileage is incorrect (e.g., typo in inspection).
                </p>
              )}
              {!isMileageFocused && vehicle.last_mileage_update && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last updated: {new Date(vehicle.last_mileage_update).toLocaleString()}
                </p>
              )}
              {errors.current_mileage && (
                <p className="text-sm text-red-400 mt-2">{errors.current_mileage.message}</p>
              )}
            </div>
          )}

          {/* Date-based Maintenance - Show for vehicles, or plant with reg_number */}
          {(vehicle.vehicle?.asset_type !== 'plant' || vehicle.vehicle?.reg_number) && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg border-b border-slate-700 pb-2">
                Date-Based Maintenance
              </h3>
              
              <div className="grid md:grid-cols-3 gap-4">
                {/* Tax Due Date */}
                <div className="space-y-2">
                  <Label htmlFor="tax_due_date">Tax Due Date</Label>
                  <Input
                    id="tax_due_date"
                    type="date"
                    {...register('tax_due_date')}
                    className="bg-input border-border text-white"
                  />
                  {errors.tax_due_date && (
                    <p className="text-sm text-red-400">{errors.tax_due_date.message}</p>
                  )}
                </div>

                {/* MOT Due Date */}
                <div className="space-y-2">
                  <Label htmlFor="mot_due_date">MOT Due Date</Label>
                  <Input
                    id="mot_due_date"
                    type="date"
                    {...register('mot_due_date')}
                    className="bg-input border-border text-white"
                  />
                  {errors.mot_due_date && (
                    <p className="text-sm text-red-400">{errors.mot_due_date.message}</p>
                  )}
                </div>

                {/* First Aid Expiry */}
                <div className="space-y-2">
                  <Label htmlFor="first_aid_kit_expiry">First Aid Kit Expiry</Label>
                  <Input
                    id="first_aid_kit_expiry"
                    type="date"
                    {...register('first_aid_kit_expiry')}
                    className="bg-input border-border text-white"
                  />
                  {errors.first_aid_kit_expiry && (
                    <p className="text-sm text-red-400">{errors.first_aid_kit_expiry.message}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Mileage-based Maintenance - Vehicle only */}
          {vehicle.vehicle?.asset_type !== 'plant' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg border-b border-slate-700 pb-2">
                Mileage-Based Maintenance
              </h3>
              
              <div className="grid md:grid-cols-3 gap-4">
                {/* Service Due */}
                <div className="space-y-2">
                  <Label htmlFor="next_service_mileage">Next Service (Miles)</Label>
                  <Input
                    id="next_service_mileage"
                    type="number"
                    {...register('next_service_mileage')}
                    placeholder="e.g., 50000"
                    className="bg-input border-border text-white"
                  />
                  {errors.next_service_mileage && (
                    <p className="text-sm text-red-400">{errors.next_service_mileage.message}</p>
                  )}
                </div>

                {/* Last Service */}
                <div className="space-y-2">
                  <Label htmlFor="last_service_mileage">Last Service (Miles)</Label>
                  <Input
                    id="last_service_mileage"
                    type="number"
                    {...register('last_service_mileage')}
                    placeholder="e.g., 40000"
                    className="bg-input border-border text-white"
                  />
                  {errors.last_service_mileage && (
                    <p className="text-sm text-red-400">{errors.last_service_mileage.message}</p>
                  )}
                </div>

                {/* Cambelt Due */}
                <div className="space-y-2">
                  <Label htmlFor="cambelt_due_mileage">Cambelt Due (Miles)</Label>
                  <Input
                    id="cambelt_due_mileage"
                    type="number"
                    {...register('cambelt_due_mileage')}
                    placeholder="e.g., 100000"
                    className="bg-input border-border text-white"
                  />
                  {errors.cambelt_due_mileage && (
                    <p className="text-sm text-red-400">{errors.cambelt_due_mileage.message}</p>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Hours-based Maintenance (Plant Machinery) */}
          {vehicle.vehicle?.asset_type === 'plant' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-lg border-b border-slate-700 pb-2">
                Hours-Based Maintenance (Plant Machinery)
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
                  {vehicle.last_hours_update && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last updated: {new Date(vehicle.last_hours_update).toLocaleString()}
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
          )}

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
              placeholder="e.g., MOT passed on 15 Dec 2025, renewed for 12 months. Cost: £55"
              className="bg-input border-border text-white"
              rows={3}
            />
            <div className="flex items-center justify-between text-xs">
              <p className="text-muted-foreground">
                Required: Explain what maintenance was performed and why dates are changing
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
                if (vehicle?.vehicle_id) {
                  try {
                    const { data: openTasks, error: tasksError } = await supabase
                      .from('actions')
                      .select('id, status')
                      .eq('vehicle_id', vehicle.vehicle_id)
                      .in('action_type', ['workshop_vehicle_task', 'inspection_defect'])
                      .neq('status', 'completed')
                      .limit(1);

                    if (tasksError) {
                      console.error('Error checking for open tasks:', tasksError);
                      toast.error('Failed to verify workshop tasks');
                      return;
                    }
                    
                    if (openTasks && openTasks.length > 0) {
                      toast.error('Cannot retire vehicle with open workshop tasks', {
                        description: 'Please complete or delete all open tasks before retiring this vehicle.',
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
              disabled={isSubmitting || updateMutation.isPending || createMutation.isPending}
            >
              <Archive className="h-4 w-4 mr-2" />
              Retire Vehicle
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={handleDiscardChanges}
                className="border-slate-600 text-white hover:bg-slate-800"
                disabled={isSubmitting || updateMutation.isPending || createMutation.isPending}
              >
                {isDirty ? 'Discard Changes' : 'Cancel'}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || updateMutation.isPending || createMutation.isPending || commentLength < 10}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {(isSubmitting || updateMutation.isPending || createMutation.isPending) ? (
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
