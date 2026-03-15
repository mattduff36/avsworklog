'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
import { SignaturePad } from '@/components/forms/SignaturePad';
import { CheckCircle2, Info } from 'lucide-react';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { triggerShakeAnimation } from '@/lib/utils/animations';
import type { CompletionUpdateConfig, CompletionFieldValues } from '@/types/workshop-completion';

export interface TaskForCompletion {
  id: string;
  status: string;
  action_type?: string;
  van_id: string | null;
  hgv_id?: string | null;
  plant_id?: string | null;
  workshop_task_categories?: {
    id: string;
    name: string;
    completion_updates?: CompletionUpdateConfig[] | null;
  } | null;
}

export interface CompletionData {
  intermediateComment: string;
  completedComment: string;
  completedSignatureData?: string;
  completedSignedAt?: string;
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
  const { tabletModeEnabled } = useTabletMode();
  const contentRef = useRef<HTMLDivElement>(null);
  const [intermediateComment, setIntermediateComment] = useState('');
  const [completedComment, setCompletedComment] = useState('');
  const [completedSignatureData, setCompletedSignatureData] = useState<string | null>(null);
  const [completedSignedAt, setCompletedSignedAt] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [maintenanceFields, setMaintenanceFields] = useState<CompletionFieldValues>({});

  const requiresIntermediateStep = task?.status === 'pending' || task?.status === 'on_hold';
  const completionUpdates = task?.workshop_task_categories?.completion_updates || [];
  const hasMaintenanceUpdates = completionUpdates.length > 0;
  const requiresCompletionSignature = task?.action_type === 'inspection_defect' && Boolean(task.hgv_id);
  const getInputValue = (value: CompletionFieldValues[string]): string | number =>
    typeof value === 'number' ? value : typeof value === 'string' ? value : '';

  // Reset form when dialog opens/closes or task changes
  useEffect(() => {
    if (open && task) {
      queueMicrotask(() => {
        setIntermediateComment('');
        setCompletedComment('');
        setCompletedSignatureData(null);
        setCompletedSignedAt(null);
        setShowSignaturePad(false);
        setMaintenanceFields({});
      });
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
      completedSignatureData: completedSignatureData || undefined,
      completedSignedAt: completedSignedAt || undefined,
      maintenanceUpdates: Object.keys(processedMaintenanceUpdates).length > 0 
        ? processedMaintenanceUpdates 
        : undefined,
    });
  };

  const handleCancel = () => {
    setIntermediateComment('');
    setCompletedComment('');
    setCompletedSignatureData(null);
    setCompletedSignedAt(null);
    setShowSignaturePad(false);
    setMaintenanceFields({});
    onOpenChange(false);
  };

  const isValid =
    (!requiresIntermediateStep || (intermediateComment.trim() && intermediateComment.length <= 300)) &&
    completedComment.trim() &&
    completedComment.length <= 500 &&
    (!requiresCompletionSignature || Boolean(completedSignatureData)) &&
    validateMaintenanceFields();
  const isDirty = useMemo(
    () =>
      intermediateComment.trim().length > 0 ||
      completedComment.trim().length > 0 ||
      Boolean(completedSignatureData) ||
      Object.values(maintenanceFields).some((value) => value !== undefined && value !== null && `${value}`.trim() !== ''),
    [intermediateComment, completedComment, completedSignatureData, maintenanceFields]
  );

  if (!task) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting && isDirty) {
          triggerShakeAnimation(contentRef.current);
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        ref={contentRef}
        className={`max-w-lg max-h-[90vh] overflow-y-auto ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}
        onInteractOutside={(event) => {
          if (!isSubmitting && isDirty) {
            event.preventDefault();
            triggerShakeAnimation(contentRef.current);
          }
        }}
        onEscapeKeyDown={(event) => {
          if (!isSubmitting && isDirty) {
            event.preventDefault();
            triggerShakeAnimation(contentRef.current);
          }
        }}
      >
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
                className={`min-h-[80px] ${tabletModeEnabled ? 'text-base' : ''}`}
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
              className={`min-h-[100px] ${tabletModeEnabled ? 'text-base' : ''}`}
              maxLength={500}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {completedComment.length}/500 characters
            </p>
          </div>

          {requiresCompletionSignature && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1">
                <Label>
                  Workshop Completion Signature <span className="text-red-500">*</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  Required for HGV inspection defect task completion.
                </p>
              </div>
              {completedSignatureData && !showSignaturePad ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={completedSignatureData} alt="Workshop completion signature" className="border rounded p-2 bg-white max-w-md" />
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowSignaturePad(true)} disabled={isSubmitting}>
                    Update Signature
                  </Button>
                </div>
              ) : (
                <SignaturePad
                  onSave={(signature) => {
                    setCompletedSignatureData(signature);
                    setCompletedSignedAt(new Date().toISOString());
                    setShowSignaturePad(false);
                  }}
                  onCancel={() => {
                    if (completedSignatureData) {
                      setShowSignaturePad(false);
                    }
                  }}
                  initialValue={completedSignatureData}
                  disabled={isSubmitting}
                />
              )}
            </div>
          )}

          {/* Dynamic Maintenance Fields */}
          {hasMaintenanceUpdates && (
            <>
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-medium text-foreground mb-3">
                  Update Asset Maintenance
                </h4>
                <p className="text-xs text-muted-foreground mb-4">
                  Optionally update maintenance records for this asset
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
                          value={
                            getInputValue(maintenanceFields[config.field_name])
                          }
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
                          value={
                            getInputValue(maintenanceFields[config.field_name])
                          }
                          onChange={(e) =>
                            handleMaintenanceFieldChange(config.field_name, e.target.value)
                          }
                        />
                      )}

                      {config.value_type === 'text' && (
                        <Input
                          id={`maintenance-${config.field_name}`}
                          type="text"
                          value={
                            getInputValue(maintenanceFields[config.field_name])
                          }
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

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
            className={tabletModeEnabled ? 'min-h-11 text-base px-4' : undefined}
          >
            {isDirty ? 'Discard Changes' : 'Cancel'}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isValid || isSubmitting}
            className={`bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed ${tabletModeEnabled ? 'min-h-11 text-base px-4' : ''}`}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isSubmitting ? 'Completing...' : 'Mark Complete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
