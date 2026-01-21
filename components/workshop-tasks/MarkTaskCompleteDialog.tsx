'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Info } from 'lucide-react';
import type { CompletionUpdateConfig, CompletionFieldValues } from '@/types/workshop-completion';

export interface TaskForCompletion {
  id: string;
  status: string;
  vehicle_id: string | null;
  workshop_task_categories?: {
    id: string;
    name: string;
    completion_updates?: CompletionUpdateConfig[] | null;
  } | null;
}

export interface CompletionData {
  intermediateComment: string;
  completedComment: string;
  maintenanceUpdates?: CompletionFieldValues;
}

interface MarkTaskCompleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskForCompletion | null;
  onConfirm: (data: CompletionData) => Promise<void>;
  isSubmitting?: boolean;
}

export function MarkTaskCompleteDialog({
  open,
  onOpenChange,
  task,
  onConfirm,
  isSubmitting = false,
}: MarkTaskCompleteDialogProps) {
  const [intermediateComment, setIntermediateComment] = useState('');
  const [completedComment, setCompletedComment] = useState('');
  const [maintenanceFields, setMaintenanceFields] = useState<CompletionFieldValues>({});

  const requiresIntermediateStep = task?.status === 'pending' || task?.status === 'on_hold';
  const completionUpdates = task?.workshop_task_categories?.completion_updates || [];
  const hasMaintenanceUpdates = completionUpdates.length > 0;

  // Reset form when dialog opens/closes or task changes
  useEffect(() => {
    if (open && task) {
      setIntermediateComment('');
      setCompletedComment('');
      setMaintenanceFields({});
    }
  }, [open, task]);

  const handleMaintenanceFieldChange = (fieldName: string, value: string) => {
    setMaintenanceFields((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
  };

  const validateMaintenanceFields = (): boolean => {
    for (const config of completionUpdates) {
      const value = maintenanceFields[config.field_name];
      
      // Check required fields
      if (config.required && (!value || value === '')) {
        return false;
      }

      // Validate mileage type (positive integer)
      if (config.value_type === 'mileage' && value && value !== '') {
        const numValue = Number(value);
        if (isNaN(numValue) || numValue <= 0 || !Number.isInteger(numValue)) {
          return false;
        }
      }
    }
    return true;
  };

  const handleConfirm = async () => {
    if (!task) return;

    // Prepare maintenance updates (convert string values to appropriate types)
    const processedMaintenanceUpdates: CompletionFieldValues = {};
    
    for (const config of completionUpdates) {
      const value = maintenanceFields[config.field_name];
      
      if (value !== undefined && value !== null && value !== '') {
        if (config.value_type === 'mileage') {
          processedMaintenanceUpdates[config.field_name] = Number(value);
        } else if (config.value_type === 'boolean') {
          processedMaintenanceUpdates[config.field_name] = value === 'true' || value === true;
        } else {
          processedMaintenanceUpdates[config.field_name] = value;
        }
      }
    }

    await onConfirm({
      intermediateComment: intermediateComment.trim(),
      completedComment: completedComment.trim(),
      maintenanceUpdates: Object.keys(processedMaintenanceUpdates).length > 0 
        ? processedMaintenanceUpdates 
        : undefined,
    });
  };

  const handleCancel = () => {
    setIntermediateComment('');
    setCompletedComment('');
    setMaintenanceFields({});
    onOpenChange(false);
  };

  const isValid =
    (!requiresIntermediateStep || (intermediateComment.trim() && intermediateComment.length <= 300)) &&
    completedComment.trim() &&
    completedComment.length <= 500 &&
    validateMaintenanceFields();

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Mark Task Complete
          </DialogTitle>
          <DialogDescription>
            {requiresIntermediateStep
              ? 'This task will be moved through In Progress and then marked as Complete'
              : 'Add detailed notes about the work completed'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info Banner */}
          {requiresIntermediateStep ? (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <Info className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-300">
                  This task will be moved to In Progress and then immediately marked as Complete.
                  Please provide notes for both steps.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-sm text-green-300">
                  This task will be marked as &quot;Completed&quot; and moved to the completed tasks section.
                </p>
            </div>
          )}

          {/* Intermediate Comment (if needed) */}
          {requiresIntermediateStep && (
            <div className="space-y-2">
              <Label htmlFor="intermediate-comment">
                Step 1: {task.status === 'on_hold' ? 'Resume Note' : 'In Progress Note'}{' '}
                <span className="text-muted-foreground">(max 300 chars)</span>{' '}
                <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="intermediate-comment"
                value={intermediateComment}
                onChange={(e) => {
                  if (e.target.value.length <= 300) {
                    setIntermediateComment(e.target.value);
                  }
                }}
                placeholder={
                  task.status === 'on_hold'
                    ? 'e.g., Parts have arrived, resuming work'
                    : 'e.g., Started work on this task'
                }
                className="min-h-[80px]"
                maxLength={300}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {intermediateComment.length}/300 characters
              </p>
            </div>
          )}

          {/* Completion Comment */}
          <div className="space-y-2">
            <Label htmlFor="completed-comment">
              {requiresIntermediateStep ? 'Step 2: ' : ''}Completion Note{' '}
              <span className="text-muted-foreground">(max 500 chars)</span>{' '}
              <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="completed-comment"
              value={completedComment}
              onChange={(e) => {
                if (e.target.value.length <= 500) {
                  setCompletedComment(e.target.value);
                }
              }}
              placeholder="e.g., Replaced brake pads and discs on front axle. Tested and working correctly."
              className="min-h-[100px]"
              maxLength={500}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {completedComment.length}/500 characters
            </p>
          </div>

          {/* Dynamic Maintenance Fields */}
          {hasMaintenanceUpdates && (
            <>
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium text-foreground mb-3">
                  Update Vehicle Maintenance
                </h4>
                <p className="text-xs text-muted-foreground mb-4">
                  Optionally update maintenance records for this vehicle
                </p>

                <div className="space-y-3">
                  {completionUpdates.map((config) => (
                    <div key={config.field_name} className="space-y-2">
                      <Label
                        htmlFor={`maintenance-${config.field_name}`}
                      >
                        {config.label}
                        {config.required && <span className="text-red-500 ml-1">*</span>}
                      </Label>

                      {config.value_type === 'mileage' && (
                        <Input
                          id={`maintenance-${config.field_name}`}
                          type="number"
                          min="1"
                          step="1"
                          value={maintenanceFields[config.field_name] || ''}
                          onChange={(e) =>
                            handleMaintenanceFieldChange(config.field_name, e.target.value)
                          }
                          placeholder="e.g., 120000"
                        />
                      )}

                      {config.value_type === 'date' && (
                        <Input
                          id={`maintenance-${config.field_name}`}
                          type="date"
                          value={maintenanceFields[config.field_name] || ''}
                          onChange={(e) =>
                            handleMaintenanceFieldChange(config.field_name, e.target.value)
                          }
                        />
                      )}

                      {config.value_type === 'text' && (
                        <Input
                          id={`maintenance-${config.field_name}`}
                          type="text"
                          value={maintenanceFields[config.field_name] || ''}
                          onChange={(e) =>
                            handleMaintenanceFieldChange(config.field_name, e.target.value)
                          }
                        />
                      )}

                      {config.help_text && (
                        <p className="text-xs text-muted-foreground">
                          {config.help_text}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isValid || isSubmitting}
            className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Completing...' : 'Mark Complete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
