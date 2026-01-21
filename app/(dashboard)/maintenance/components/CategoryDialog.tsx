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
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Plus, Briefcase, Wrench, Bell, Mail, Eye } from 'lucide-react';
import type { MaintenanceCategory, CreateCategoryRequest, UpdateCategoryRequest, CategoryResponsibility } from '@/types/maintenance';
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
  // New fields for duty/responsibility
  responsibility: z.enum(['workshop', 'office']).default('workshop'),
  show_on_overview: z.boolean().default(true),
  reminder_in_app_enabled: z.boolean().default(false),
  reminder_email_enabled: z.boolean().default(false),
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
      responsibility: 'workshop',
      show_on_overview: true,
      reminder_in_app_enabled: false,
      reminder_email_enabled: false,
    }
  });

  const selectedType = watch('type');
  const selectedResponsibility = watch('responsibility');
  const showOnOverview = watch('show_on_overview');
  const reminderInApp = watch('reminder_in_app_enabled');
  const reminderEmail = watch('reminder_email_enabled');

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
        responsibility: category.responsibility || 'workshop',
        show_on_overview: category.show_on_overview !== false,
        reminder_in_app_enabled: category.reminder_in_app_enabled || false,
        reminder_email_enabled: category.reminder_email_enabled || false,
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
        responsibility: 'workshop',
        show_on_overview: true,
        reminder_in_app_enabled: false,
        reminder_email_enabled: false,
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
        responsibility: data.responsibility,
        show_on_overview: data.show_on_overview,
        reminder_in_app_enabled: data.reminder_in_app_enabled,
        reminder_email_enabled: data.reminder_email_enabled,
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
        responsibility: data.responsibility,
        show_on_overview: data.show_on_overview,
        reminder_in_app_enabled: data.reminder_in_app_enabled,
        reminder_email_enabled: data.reminder_email_enabled,
      };
      await updateMutation.mutateAsync({ id: category.id, updates: updateData });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {mode === 'create' ? 'Add New Category' : 'Edit Category'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
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
              className="bg-input border-border text-white"
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
              className="bg-input border-border text-white"
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
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={mode === 'edit'}
                onClick={() => mode !== 'edit' && setValue('type', 'date')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  mode === 'edit' 
                    ? 'opacity-50 cursor-not-allowed border-slate-700 bg-slate-800/50' 
                    : selectedType === 'date'
                      ? 'border-blue-500 bg-blue-500/20 ring-2 ring-blue-500/30'
                      : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedType === 'date' 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-slate-500'
                  }`}>
                    {selectedType === 'date' && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                  <div>
                    <p className={`font-medium ${selectedType === 'date' ? 'text-blue-400' : 'text-white'}`}>
                      Date-based
                    </p>
                    <p className="text-xs text-muted-foreground">Tax, MOT, First Aid</p>
                  </div>
                </div>
              </button>
              
              <button
                type="button"
                disabled={mode === 'edit'}
                onClick={() => mode !== 'edit' && setValue('type', 'mileage')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  mode === 'edit' 
                    ? 'opacity-50 cursor-not-allowed border-slate-700 bg-slate-800/50' 
                    : selectedType === 'mileage'
                      ? 'border-blue-500 bg-blue-500/20 ring-2 ring-blue-500/30'
                      : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedType === 'mileage' 
                      ? 'border-blue-500 bg-blue-500' 
                      : 'border-slate-500'
                  }`}>
                    {selectedType === 'mileage' && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                  <div>
                    <p className={`font-medium ${selectedType === 'mileage' ? 'text-blue-400' : 'text-white'}`}>
                      Mileage-based
                    </p>
                    <p className="text-xs text-muted-foreground">Service, Cambelt</p>
                  </div>
                </div>
              </button>
            </div>
            {mode === 'edit' && (
              <p className="text-xs text-muted-foreground">Type cannot be changed after creation</p>
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
                  className="bg-input border-border text-white"
                />
                <p className="text-xs text-muted-foreground">
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
                  className="bg-input border-border text-white"
                />
                <p className="text-xs text-muted-foreground">
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
              className="bg-input border-border text-white"
            />
            <p className="text-xs text-muted-foreground">
              Lower numbers appear first. Default is 999.
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-700 pt-4 mt-4">
            <h3 className="text-lg font-medium text-white mb-4">Duty & Notification Settings</h3>
          </div>

          {/* Responsibility */}
          <div className="space-y-3">
            <Label>
              Responsibility
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setValue('responsibility', 'workshop')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  selectedResponsibility === 'workshop'
                    ? 'border-orange-500 bg-orange-500/20 ring-2 ring-orange-500/30'
                    : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    selectedResponsibility === 'workshop' 
                      ? 'bg-orange-500' 
                      : 'bg-slate-700'
                  }`}>
                    <Wrench className={`h-5 w-5 ${
                      selectedResponsibility === 'workshop' ? 'text-white' : 'text-orange-400'
                    }`} />
                  </div>
                  <div>
                    <p className={`font-medium ${selectedResponsibility === 'workshop' ? 'text-orange-400' : 'text-white'}`}>
                      Workshop
                    </p>
                    <p className="text-xs text-muted-foreground">Create Task button</p>
                  </div>
                </div>
              </button>
              
              <button
                type="button"
                onClick={() => setValue('responsibility', 'office')}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  selectedResponsibility === 'office'
                    ? 'border-avs-yellow bg-avs-yellow/20 ring-2 ring-avs-yellow/30'
                    : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    selectedResponsibility === 'office' 
                      ? 'bg-avs-yellow' 
                      : 'bg-slate-700'
                  }`}>
                    <Briefcase className={`h-5 w-5 ${
                      selectedResponsibility === 'office' ? 'text-slate-900' : 'text-avs-yellow'
                    }`} />
                  </div>
                  <div>
                    <p className={`font-medium ${selectedResponsibility === 'office' ? 'text-avs-yellow' : 'text-white'}`}>
                      Office
                    </p>
                    <p className="text-xs text-muted-foreground">Office Action button</p>
                  </div>
                </div>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedResponsibility === 'workshop' 
                ? 'Workshop tasks will show "Create Task" button for workshop staff.'
                : 'Office duties will show "Office Action" button with reminder and update options.'
              }
            </p>
          </div>

          {/* Show on Overview Toggle */}
          <div 
            className={`flex items-center justify-between p-4 rounded-lg border-2 cursor-pointer transition-all ${
              showOnOverview 
                ? 'border-green-500/50 bg-green-500/10' 
                : 'border-slate-600 bg-slate-800 hover:border-slate-500'
            }`}
            onClick={() => setValue('show_on_overview', !showOnOverview)}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                showOnOverview ? 'bg-green-500' : 'bg-slate-700'
              }`}>
                <Eye className={`h-5 w-5 ${showOnOverview ? 'text-white' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <Label htmlFor="show_on_overview" className={`text-sm font-medium cursor-pointer ${
                  showOnOverview ? 'text-green-400' : 'text-white'
                }`}>Show on Overview</Label>
                <p className="text-xs text-muted-foreground">
                  Display in Overdue/Due Soon sections
                </p>
              </div>
            </div>
            <Switch
              id="show_on_overview"
              checked={showOnOverview}
              onCheckedChange={(checked) => setValue('show_on_overview', checked)}
              className="data-[state=checked]:bg-green-500"
            />
          </div>

          {/* Reminder Settings (only for office responsibility) */}
          {selectedResponsibility === 'office' && (
            <div className="space-y-3 p-4 bg-slate-800/50 rounded-lg border border-border">
              <h4 className="text-sm font-medium text-white flex items-center gap-2">
                <Bell className="h-4 w-4 text-blue-400" />
                Reminder Notifications
              </h4>
              
              <div 
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  reminderInApp 
                    ? 'border-blue-500/50 bg-blue-500/10' 
                    : 'border-slate-600 bg-slate-800/50 hover:border-slate-500'
                }`}
                onClick={() => setValue('reminder_in_app_enabled', !reminderInApp)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    reminderInApp ? 'bg-blue-500' : 'bg-slate-700'
                  }`}>
                    <Bell className={`h-4 w-4 ${reminderInApp ? 'text-white' : 'text-blue-400'}`} />
                  </div>
                  <div>
                    <Label htmlFor="reminder_in_app" className={`text-sm cursor-pointer ${
                      reminderInApp ? 'text-blue-400 font-medium' : 'text-white'
                    }`}>In-App Notifications</Label>
                    <p className="text-xs text-muted-foreground">
                      Send reminders to notification panel
                    </p>
                  </div>
                </div>
                <Switch
                  id="reminder_in_app"
                  checked={reminderInApp}
                  onCheckedChange={(checked) => setValue('reminder_in_app_enabled', checked)}
                  className="data-[state=checked]:bg-blue-500"
                />
              </div>
              
              <div 
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  reminderEmail 
                    ? 'border-green-500/50 bg-green-500/10' 
                    : 'border-slate-600 bg-slate-800/50 hover:border-slate-500'
                }`}
                onClick={() => setValue('reminder_email_enabled', !reminderEmail)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    reminderEmail ? 'bg-green-500' : 'bg-slate-700'
                  }`}>
                    <Mail className={`h-4 w-4 ${reminderEmail ? 'text-white' : 'text-green-400'}`} />
                  </div>
                  <div>
                    <Label htmlFor="reminder_email" className={`text-sm cursor-pointer ${
                      reminderEmail ? 'text-green-400 font-medium' : 'text-white'
                    }`}>Email Notifications</Label>
                    <p className="text-xs text-muted-foreground">
                      Send email reminders to configured recipients
                    </p>
                  </div>
                </div>
                <Switch
                  id="reminder_email"
                  checked={reminderEmail}
                  onCheckedChange={(checked) => setValue('reminder_email_enabled', checked)}
                  className="data-[state=checked]:bg-green-500"
                />
              </div>
              
              {(reminderInApp || reminderEmail) && (
                <p className="text-xs text-avs-yellow mt-2 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-avs-yellow"></span>
                  Configure reminder recipients in Settings after saving.
                </p>
              )}
            </div>
          )}

          {/* Active Status (Only for edit) */}
          {mode === 'edit' && (
            <div className="flex items-center space-x-2">
              <input
                id="is_active"
                type="checkbox"
                {...register('is_active')}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-2 focus:ring-blue-500"
              />
              <Label htmlFor="is_active" className="text-sm text-muted-foreground">
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
