'use client';

import { useEffect } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Save, Plus } from 'lucide-react';
import type { MaintenanceCategory, CreateCategoryRequest, UpdateCategoryRequest } from '@/types/maintenance';
import { useCreateCategory, useUpdateCategory } from '@/lib/hooks/useMaintenance';

// ============================================================================
// Zod Validation Schema
// ============================================================================

const createCategorySchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  description: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .nullable(),
  type: z.enum(['date', 'mileage'], {
    required_error: 'Type is required'
  }),
  alert_threshold_days: z.coerce.number()
    .int()
    .positive('Must be positive')
    .optional()
    .nullable(),
  alert_threshold_miles: z.coerce.number()
    .int()
    .positive('Must be positive')
    .optional()
    .nullable(),
  sort_order: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.type === 'date') {
      return data.alert_threshold_days != null && data.alert_threshold_days > 0;
    }
    if (data.type === 'mileage') {
      return data.alert_threshold_miles != null && data.alert_threshold_miles > 0;
    }
    return true;
  },
  {
    message: 'Date-based categories need days threshold, mileage-based need miles threshold',
    path: ['alert_threshold_days']
  }
);

const editCategorySchema = createCategorySchema.partial().extend({
  type: z.enum(['date', 'mileage']).optional(), // Type cannot be changed in edit
});

type CategoryFormData = z.infer<typeof createCategorySchema>;

// ============================================================================
// Component
// ============================================================================

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  category?: MaintenanceCategory | null;
}

export function CategoryDialog({
  open,
  onOpenChange,
  mode,
  category
}: CategoryDialogProps) {
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
    setValue,
  } = useForm<CategoryFormData>({
    resolver: zodResolver(mode === 'create' ? createCategorySchema : editCategorySchema),
    defaultValues: {
      type: 'date',
      is_active: true,
    }
  });

  const selectedType = watch('type');

  // Reset form when dialog opens/closes or category changes
  useEffect(() => {
    if (open && mode === 'edit' && category) {
      reset({
        name: category.name,
        description: category.description || '',
        type: category.type,
        alert_threshold_days: category.alert_threshold_days || undefined,
        alert_threshold_miles: category.alert_threshold_miles || undefined,
        sort_order: category.sort_order,
        is_active: category.is_active,
      });
    } else if (open && mode === 'create') {
      reset({
        name: '',
        description: '',
        type: 'date',
        alert_threshold_days: 30,
        alert_threshold_miles: undefined,
        sort_order: 999,
        is_active: true,
      });
    }
  }, [open, mode, category, reset]);

  // Clear opposite threshold when type changes
  useEffect(() => {
    if (selectedType === 'date') {
      setValue('alert_threshold_miles', null);
      if (!watch('alert_threshold_days')) {
        setValue('alert_threshold_days', 30);
      }
    } else if (selectedType === 'mileage') {
      setValue('alert_threshold_days', null);
      if (!watch('alert_threshold_miles')) {
        setValue('alert_threshold_miles', 1000);
      }
    }
  }, [selectedType, setValue, watch]);

  const onSubmit = async (data: CategoryFormData) => {
    if (mode === 'create') {
      const createData: CreateCategoryRequest = {
        name: data.name,
        description: data.description || undefined,
        type: data.type,
        alert_threshold_days: data.type === 'date' ? data.alert_threshold_days : undefined,
        alert_threshold_miles: data.type === 'mileage' ? data.alert_threshold_miles : undefined,
        sort_order: data.sort_order,
      };
      await createMutation.mutateAsync(createData);
      onOpenChange(false);
    } else if (mode === 'edit' && category) {
      const updateData: UpdateCategoryRequest = {
        name: data.name,
        description: data.description || undefined,
        alert_threshold_days: data.type === 'date' ? data.alert_threshold_days : undefined,
        alert_threshold_miles: data.type === 'mileage' ? data.alert_threshold_miles : undefined,
        is_active: data.is_active,
        sort_order: data.sort_order,
      };
      await updateMutation.mutateAsync({ id: category.id, updates: updateData });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {mode === 'create' ? 'Add New Category' : 'Edit Category'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {mode === 'create' 
              ? 'Create a new maintenance category with custom alert threshold'
              : 'Update category settings. Note: Type cannot be changed after creation.'
            }
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Category Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Category Name <span className="text-red-400">*</span>
            </Label>
            <Input
              id="name"
              {...register('name')}
              placeholder="e.g., Brake Service, Tyre Replacement"
              className="bg-slate-800 border-slate-600 text-white"
            />
            {errors.name && (
              <p className="text-sm text-red-400">{errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="Brief description of this maintenance type..."
              className="bg-slate-800 border-slate-600 text-white"
              rows={2}
            />
            {errors.description && (
              <p className="text-sm text-red-400">{errors.description.message}</p>
            )}
          </div>

          {/* Type Selection (Only for create) */}
          <div className="space-y-3">
            <Label>
              Type <span className="text-red-400">*</span>
            </Label>
            <RadioGroup
              value={selectedType}
              onValueChange={(value) => setValue('type', value as 'date' | 'mileage')}
              disabled={mode === 'edit'} // Cannot change type after creation
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="date" id="type-date" disabled={mode === 'edit'} />
                <Label htmlFor="type-date" className={mode === 'edit' ? 'text-slate-500' : ''}>
                  Date-based
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="mileage" id="type-mileage" disabled={mode === 'edit'} />
                <Label htmlFor="type-mileage" className={mode === 'edit' ? 'text-slate-500' : ''}>
                  Mileage-based
                </Label>
              </div>
            </RadioGroup>
            {mode === 'edit' && (
              <p className="text-xs text-slate-500">Type cannot be changed after creation</p>
            )}
          </div>

          {/* Alert Threshold */}
          <div className="space-y-2">
            {selectedType === 'date' ? (
              <>
                <Label htmlFor="alert_threshold_days">
                  Alert Threshold (Days) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="alert_threshold_days"
                  type="number"
                  {...register('alert_threshold_days')}
                  placeholder="e.g., 30"
                  className="bg-slate-800 border-slate-600 text-white"
                />
                <p className="text-xs text-slate-400">
                  Show "Due Soon" alert when this many days before the due date
                </p>
                {errors.alert_threshold_days && (
                  <p className="text-sm text-red-400">{errors.alert_threshold_days.message}</p>
                )}
              </>
            ) : (
              <>
                <Label htmlFor="alert_threshold_miles">
                  Alert Threshold (Miles) <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="alert_threshold_miles"
                  type="number"
                  {...register('alert_threshold_miles')}
                  placeholder="e.g., 1000"
                  className="bg-slate-800 border-slate-600 text-white"
                />
                <p className="text-xs text-slate-400">
                  Show "Due Soon" alert when this many miles before the due mileage
                </p>
                {errors.alert_threshold_miles && (
                  <p className="text-sm text-red-400">{errors.alert_threshold_miles.message}</p>
                )}
              </>
            )}
          </div>

          {/* Sort Order */}
          <div className="space-y-2">
            <Label htmlFor="sort_order">Display Order (Optional)</Label>
            <Input
              id="sort_order"
              type="number"
              {...register('sort_order')}
              placeholder="e.g., 1"
              className="bg-slate-800 border-slate-600 text-white"
            />
            <p className="text-xs text-slate-400">
              Lower numbers appear first. Default is 999.
            </p>
          </div>

          {/* Active Status (Only for edit) */}
          {mode === 'edit' && (
            <div className="flex items-center space-x-2">
              <input
                id="is_active"
                type="checkbox"
                {...register('is_active')}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-2 focus:ring-blue-500"
              />
              <Label htmlFor="is_active" className="text-sm text-slate-300">
                Active (uncheck to disable this category)
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {(isSubmitting || createMutation.isPending || updateMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : mode === 'create' ? (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
