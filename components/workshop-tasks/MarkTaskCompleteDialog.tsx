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
import { useWorkshopDraftPersistence } from '@/lib/hooks/useWorkshopDraftPersistence';
import type { CompletionUpdateConfig, CompletionFieldValues } from '@/types/workshop-completion';
import {
  getSuccessorStep,
  resolveStepForTemplateFirst,
  type ServiceRotationStep,
} from '@/lib/utils/assetServiceRotation';

export interface TaskForCompletion {
  id: string;
  status: string | null;
  created_at?: string | null;
  logged_at?: string | null;
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
  completedAt: string;
  createdAt?: string;
  intermediateAt?: string;
  completedSignatureData?: string;
  completedSignedAt?: string;
  maintenanceUpdates?: CompletionFieldValues;
  /** Required for Service-category workshop tasks */
  completionMeter?: number;
  confirmedNextTemplateId?: string;
  isServiceTask?: boolean;
}

interface MarkTaskCompleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskForCompletion | null;
  onConfirm: (data: CompletionData) => Promise<boolean | void>;
  isSubmitting?: boolean;
  userId?: string | null;
}

function toLocalDateTimeInputValue(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function parseLocalDateTimeInput(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildSuggestedTimelineDates(task: TaskForCompletion, completedAt: Date) {
  const currentCreatedAt = parseIsoDate(task.created_at);
  const currentInProgressAt = parseIsoDate(task.logged_at);
  const completedAtMs = completedAt.getTime();
  const suggestedCreatedAt =
    currentCreatedAt && currentCreatedAt.getTime() < completedAtMs
      ? currentCreatedAt
      : new Date(completedAtMs - 2 * 60_000);
  const suggestedInProgressAt =
    currentInProgressAt &&
    currentInProgressAt.getTime() > suggestedCreatedAt.getTime() &&
    currentInProgressAt.getTime() < completedAtMs
      ? currentInProgressAt
      : new Date(completedAtMs - 60_000);

  return {
    needsConfirmation:
      Boolean(currentCreatedAt && currentCreatedAt.getTime() > completedAtMs) ||
      Boolean(currentInProgressAt && currentInProgressAt.getTime() > completedAtMs),
    createdAtLocal: toLocalDateTimeInputValue(suggestedCreatedAt),
    intermediateAtLocal: toLocalDateTimeInputValue(suggestedInProgressAt),
  };
}

export function MarkTaskCompleteDialog({
  open,
  onOpenChange,
  task,
  onConfirm,
  isSubmitting = false,
  userId = null,
}: MarkTaskCompleteDialogProps) {
  const { tabletModeEnabled } = useTabletMode();
  const contentRef = useRef<HTMLDivElement>(null);
  const [intermediateComment, setIntermediateComment] = useState('');
  const [completedComment, setCompletedComment] = useState('');
  const [completedAtLocal, setCompletedAtLocal] = useState('');
  const [maxCompletedAtLocal, setMaxCompletedAtLocal] = useState('');
  const [initialCompletedAtLocal, setInitialCompletedAtLocal] = useState('');
  const [showTimelineConfirm, setShowTimelineConfirm] = useState(false);
  const [confirmedCreatedAtLocal, setConfirmedCreatedAtLocal] = useState('');
  const [confirmedIntermediateAtLocal, setConfirmedIntermediateAtLocal] = useState('');
  const [pendingCompletionData, setPendingCompletionData] = useState<CompletionData | null>(null);
  const [completedSignatureData, setCompletedSignatureData] = useState<string | null>(null);
  const [completedSignedAt, setCompletedSignedAt] = useState<string | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [maintenanceFields, setMaintenanceFields] = useState<CompletionFieldValues>({});
  const [completionMeter, setCompletionMeter] = useState('');
  const [confirmedNextTemplateId, setConfirmedNextTemplateId] = useState('');
  const [serviceTemplates, setServiceTemplates] = useState<Array<{ templateId: string; templateName: string; compactLabel: string | null }>>([]);
  const [suggestedNextTemplateId, setSuggestedNextTemplateId] = useState('');

  const requiresIntermediateStep = task?.status === 'pending' || task?.status === 'on_hold';
  const completionUpdates = task?.workshop_task_categories?.completion_updates || [];
  const hasMaintenanceUpdates = completionUpdates.length > 0;
  const requiresCompletionSignature = task?.action_type === 'inspection_defect' && Boolean(task.hgv_id);
  const isHgvTask = Boolean(task?.hgv_id);
  const isServiceTask = Boolean(
    task?.workshop_task_categories?.name &&
      /^service(\s|\(|$)/i.test(task.workshop_task_categories.name),
  );
  const serviceAssetType = task?.hgv_id ? 'hgv' : task?.plant_id ? 'plant' : 'van';
  const formatDistanceCopy = (value: string) =>
    isHgvTask
      ? value
          .replace(/\b[Mm]ileage\b/g, 'KM')
          .replace(/\b[Mm]iles\b/g, 'KM')
      : value;
  const getInputValue = (value: CompletionFieldValues[string]): string | number =>
    typeof value === 'number' ? value : typeof value === 'string' ? value : '';

  // Reset form when dialog opens/closes or task changes
  useEffect(() => {
    if (open && task) {
      queueMicrotask(() => {
        const defaultCompletedAtLocal = toLocalDateTimeInputValue(new Date());
        setInitialCompletedAtLocal(defaultCompletedAtLocal);
        setMaxCompletedAtLocal(defaultCompletedAtLocal);
        setShowTimelineConfirm(false);
        setConfirmedCreatedAtLocal('');
        setConfirmedIntermediateAtLocal('');
        setPendingCompletionData(null);
        setIntermediateComment('');
        setCompletedComment('');
        setCompletedAtLocal(defaultCompletedAtLocal);
        setCompletedSignatureData(null);
        setCompletedSignedAt(null);
        setShowSignaturePad(false);
        setMaintenanceFields({});
        setCompletionMeter('');
        setConfirmedNextTemplateId('');
        setSuggestedNextTemplateId('');
        setServiceTemplates([]);
      });
    }
  }, [open, task]);

  useEffect(() => {
    if (!open || !task || !isServiceTask) return;
    let cancelled = false;
    (async () => {
      try {
        const assetId = task.hgv_id || task.plant_id || task.van_id;
        const [typesResponse, attachmentsResponse] = await Promise.all([
          fetch(
            `/api/fleet/service-types?assetType=${serviceAssetType}${
              assetId ? `&assetId=${encodeURIComponent(assetId)}` : ''
            }`,
          ),
          fetch(`/api/workshop-tasks/attachments/task/${task.id}`),
        ]);
        const data = await typesResponse.json();
        if (!typesResponse.ok || cancelled) return;
        const templates = (data.templates || []) as Array<{
          templateId: string;
          templateName: string;
          compactLabel: string | null;
        }>;
        const rotation = (data.rotation || []) as Array<{
          id: string;
          position: number;
          templateId: string;
          templateName?: string | null;
          compactLabel?: string | null;
        }>;
        setServiceTemplates(templates);

        let completedTemplateId = '';
        if (attachmentsResponse.ok) {
          const attachmentPayload = await attachmentsResponse.json();
          const attachments = (attachmentPayload.attachments || attachmentPayload.data || []) as Array<{
            template_id?: string;
            status?: string;
          }>;
          const completed =
            attachments.find((attachment) => attachment.status === 'completed') || attachments[0];
          completedTemplateId = completed?.template_id || '';
        }

        const steps: ServiceRotationStep[] = rotation.map((step) => ({
          id: step.id,
          position: step.position,
          attachmentTemplateId: step.templateId,
          compactLabel: step.compactLabel,
          templateName: step.templateName,
        }));
        const cursorStep =
          completedTemplateId && data.currentNextServiceRotationStepId
            ? steps.find(
                (step) =>
                  step.id === data.currentNextServiceRotationStepId &&
                  step.attachmentTemplateId === completedTemplateId,
              ) ?? null
            : null;
        const completedStep =
          cursorStep ||
          (completedTemplateId
            ? resolveStepForTemplateFirst(steps, completedTemplateId)
            : null);
        const successor = getSuccessorStep(steps, completedStep?.id);
        const suggested =
          successor?.attachmentTemplateId ||
          rotation[0]?.templateId ||
          templates[0]?.templateId ||
          '';
        setSuggestedNextTemplateId(suggested);
        setConfirmedNextTemplateId(suggested);
      } catch {
        // optional UI enrichment
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, task, isServiceTask, serviceAssetType]);

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

  const buildCompletionData = (completedAtDate: Date): CompletionData => {
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

    return {
      intermediateComment: intermediateComment.trim(),
      completedComment: completedComment.trim(),
      completedAt: completedAtDate.toISOString(),
      completedSignatureData: completedSignatureData || undefined,
      completedSignedAt: completedSignedAt || undefined,
      maintenanceUpdates: Object.keys(processedMaintenanceUpdates).length > 0 
        ? processedMaintenanceUpdates 
        : undefined,
      isServiceTask,
      completionMeter: isServiceTask ? Number(completionMeter) : undefined,
      confirmedNextTemplateId: isServiceTask ? confirmedNextTemplateId : undefined,
    };
  };

  const submitCompletion = async (data: CompletionData) => {
    const completed = await onConfirm(data);
    if (completed !== false) {
      await clearDraft();
    }
  };

  const handleConfirm = async () => {
    if (!task) return;
    const completedAtDate = parseLocalDateTimeInput(completedAtLocal);
    const maxCompletedAtDate = parseLocalDateTimeInput(maxCompletedAtLocal);
    if (!completedAtDate || (maxCompletedAtDate && completedAtDate.getTime() > maxCompletedAtDate.getTime())) {
      triggerShakeAnimation(contentRef.current);
      return;
    }

    const completionData = buildCompletionData(completedAtDate);
    const timelineSuggestions = buildSuggestedTimelineDates(task, completedAtDate);
    if (timelineSuggestions.needsConfirmation) {
      setPendingCompletionData(completionData);
      setConfirmedCreatedAtLocal(timelineSuggestions.createdAtLocal);
      setConfirmedIntermediateAtLocal(timelineSuggestions.intermediateAtLocal);
      setShowTimelineConfirm(true);
      return;
    }

    await submitCompletion(completionData);
  };

  const handleConfirmTimelineDates = async () => {
    if (!pendingCompletionData) return;
    const createdAtDate = parseLocalDateTimeInput(confirmedCreatedAtLocal);
    const intermediateAtDate = parseLocalDateTimeInput(confirmedIntermediateAtLocal);
    const completedAtDate = new Date(pendingCompletionData.completedAt);
    if (
      !createdAtDate ||
      !intermediateAtDate ||
      createdAtDate.getTime() > intermediateAtDate.getTime() ||
      intermediateAtDate.getTime() > completedAtDate.getTime()
    ) {
      triggerShakeAnimation(contentRef.current);
      return;
    }

    setShowTimelineConfirm(false);
    await submitCompletion({
      ...pendingCompletionData,
      createdAt: createdAtDate.toISOString(),
      intermediateAt: intermediateAtDate.toISOString(),
    });
  };

  const handleCancel = () => {
    void clearDraft();
    setIntermediateComment('');
    setCompletedComment('');
    setCompletedAtLocal('');
    setInitialCompletedAtLocal('');
    setMaxCompletedAtLocal('');
    setShowTimelineConfirm(false);
    setConfirmedCreatedAtLocal('');
    setConfirmedIntermediateAtLocal('');
    setPendingCompletionData(null);
    setCompletedSignatureData(null);
    setCompletedSignedAt(null);
    setShowSignaturePad(false);
    setMaintenanceFields({});
    onOpenChange(false);
  };

  const completedAtDate = parseLocalDateTimeInput(completedAtLocal);
  const maxCompletedAtDate = parseLocalDateTimeInput(maxCompletedAtLocal);
  const isCompletedAtValid =
    Boolean(completedAtDate) &&
    (!maxCompletedAtDate || completedAtDate!.getTime() <= maxCompletedAtDate.getTime());
  const isServiceMeterValid =
    !isServiceTask ||
    (completionMeter.trim() !== '' &&
      Number.isFinite(Number(completionMeter)) &&
      Number(completionMeter) >= 0 &&
      Number.isInteger(Number(completionMeter)));
  const isValid =
    (!requiresIntermediateStep || (intermediateComment.trim() && intermediateComment.length <= 300)) &&
    completedComment.trim() &&
    completedComment.length <= 500 &&
    isCompletedAtValid &&
    (!requiresCompletionSignature || Boolean(completedSignatureData)) &&
    validateMaintenanceFields() &&
    isServiceMeterValid &&
    (!isServiceTask || Boolean(confirmedNextTemplateId));
  const isDirty = useMemo(
    () =>
      intermediateComment.trim().length > 0 ||
      completedComment.trim().length > 0 ||
      (completedAtLocal !== '' && completedAtLocal !== initialCompletedAtLocal) ||
      Boolean(completedSignatureData) ||
      Object.values(maintenanceFields).some((value) => value !== undefined && value !== null && `${value}`.trim() !== ''),
    [intermediateComment, completedComment, completedAtLocal, initialCompletedAtLocal, completedSignatureData, maintenanceFields]
  );
  const { clearDraft } = useWorkshopDraftPersistence({
    enabled: open && Boolean(task),
    draftId: `workshop-task-complete:${userId || 'anonymous'}:${task?.id || 'none'}`,
    kind: 'workshop-task-complete',
    ownerId: userId,
    value: {
      intermediateComment,
      completedComment,
      completedAtLocal,
      completedSignatureData,
      completedSignedAt,
      maintenanceFields,
    },
    isDirty,
    onRestore: (draft) => {
      setIntermediateComment(draft.intermediateComment || '');
      setCompletedComment(draft.completedComment || '');
      setCompletedAtLocal(draft.completedAtLocal || initialCompletedAtLocal || toLocalDateTimeInputValue(new Date()));
      setCompletedSignatureData(draft.completedSignatureData || null);
      setCompletedSignedAt(draft.completedSignedAt || null);
      setMaintenanceFields(draft.maintenanceFields || {});
    },
  });

  if (!task) return null;

  return (
    <>
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
            <Label htmlFor="completed-at">
              Completed Date &amp; Time <span className="text-red-500">*</span>
            </Label>
            <Input
              id="completed-at"
              type="datetime-local"
              value={completedAtLocal}
              max={maxCompletedAtLocal}
              onFocus={() => setMaxCompletedAtLocal(toLocalDateTimeInputValue(new Date()))}
              onChange={(e) => setCompletedAtLocal(e.target.value)}
              className={tabletModeEnabled ? 'text-base' : undefined}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Confirm the real completion date. This date is used for future maintenance due dates.
            </p>
          </div>

          {isServiceTask && (
            <div className="space-y-3 border rounded-md p-3 bg-muted/30">
              <div className="space-y-2">
                <Label htmlFor="service-completion-meter">
                  Actual {serviceAssetType === 'plant' ? 'hours' : serviceAssetType === 'hgv' ? 'KM' : 'mileage'} at service{' '}
                  <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="service-completion-meter"
                  type="number"
                  min="0"
                  step="1"
                  value={completionMeter}
                  onChange={(e) => setCompletionMeter(e.target.value)}
                  placeholder={serviceAssetType === 'plant' ? 'e.g., 1250' : 'e.g., 275402'}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-next-type">
                  Next service type due <span className="text-red-500">*</span>
                </Label>
                <select
                  id="service-next-type"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={confirmedNextTemplateId}
                  onChange={(e) => setConfirmedNextTemplateId(e.target.value)}
                  disabled={isSubmitting || serviceTemplates.length === 0}
                >
                  <option value="">Select next service type</option>
                  {serviceTemplates.map((template) => (
                    <option key={template.templateId} value={template.templateId}>
                      {template.compactLabel || template.templateName}
                    </option>
                  ))}
                </select>
                {suggestedNextTemplateId && confirmedNextTemplateId === suggestedNextTemplateId ? (
                  <p className="text-xs text-muted-foreground">
                    Preselected from the configured service rotation. Confirm or override before completing.
                  </p>
                ) : null}
              </div>
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
                        {formatDistanceCopy(config.label)}
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
                          {formatDistanceCopy(config.help_text)}
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

    <Dialog open={showTimelineConfirm} onOpenChange={setShowTimelineConfirm}>
        <DialogContent className={`max-w-md ${tabletModeEnabled ? 'p-5 sm:p-6' : ''}`}>
          <DialogHeader>
            <DialogTitle>Confirm Earlier Task Dates</DialogTitle>
            <DialogDescription>
              The completed date is before the current created or in progress date.
              Please confirm the suggested dates below before completing the task.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="confirmed-created-at">
                Created Date &amp; Time <span className="text-red-500">*</span>
              </Label>
              <Input
                id="confirmed-created-at"
                type="datetime-local"
                value={confirmedCreatedAtLocal}
                onChange={(event) => setConfirmedCreatedAtLocal(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmed-intermediate-at">
                In Progress Date &amp; Time <span className="text-red-500">*</span>
              </Label>
              <Input
                id="confirmed-intermediate-at"
                type="datetime-local"
                value={confirmedIntermediateAtLocal}
                onChange={(event) => setConfirmedIntermediateAtLocal(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Suggested dates are set just before the completed date so the task timeline stays in the correct order.
            </p>
          </div>

          <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : undefined}>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowTimelineConfirm(false)}
              disabled={isSubmitting}
            >
              Go Back
            </Button>
            <Button
              type="button"
              onClick={handleConfirmTimelineDates}
              disabled={isSubmitting}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              OK, Use These Dates
            </Button>
          </DialogFooter>
        </DialogContent>
    </Dialog>
    </>
  );
}
