'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  dialogContentViewportClassName,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  SelectValue,
} from '@/components/ui/select';
import {
  TabletAwareButton,
  TabletAwareSelectContent,
  TabletAwareSelectItem,
  TabletAwareSelectTrigger,
} from '@/components/ui/tablet-mode-controls';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { useTaskAttachments } from '@/lib/hooks/useTaskAttachments';
import { isArchivedWorkshopTask } from '@/lib/workshop-tasks/archive';
import { isServiceWorkshopTask } from '@/lib/workshop-tasks/is-service-task';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';

const CORRECTION_REASON_MIN_LENGTH = 10;
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import type { Action, Category, Subcategory, Vehicle } from '@/app/(dashboard)/workshop-tasks/types';

interface CorrectTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Action | null;
  vehicles: Vehicle[];
  categories: Category[];
  plantCategories: Category[];
  hgvCategories: Category[];
  subcategories: Subcategory[];
  plantSubcategories: Subcategory[];
  hgvSubcategories: Subcategory[];
  recentVehicleIds?: string[];
  onCorrectAttachment?: (attachmentId: string) => void;
  getAssetDisplay: (
    asset?: {
      reg_number?: string | null;
      plant_id?: string | null;
      nickname?: string | null;
      category?: string | null;
      asset_type?: string | null;
    },
    options?: { forSelect?: boolean },
  ) => string;
  onCorrected?: () => void;
}

interface ServiceTemplateOption {
  templateId: string;
  templateName: string;
  compactLabel: string | null;
}

interface FormBaseline {
  comments: string;
  meter: string;
  vehicleId: string;
  categoryId: string;
  subcategoryId: string;
  nextTemplateId: string;
}

function assetTypeFromTask(task: Action | null): 'van' | 'hgv' | 'plant' {
  if (task?.hgv_id) return 'hgv';
  if (task?.plant_id) return 'plant';
  return 'van';
}

function meterCopy(assetType: 'van' | 'hgv' | 'plant') {
  if (assetType === 'plant') {
    return { label: 'Hours', unit: 'hours', placeholder: 'hours' };
  }
  if (assetType === 'hgv') {
    return { label: 'KM', unit: 'km', placeholder: 'KM' };
  }
  return { label: 'Miles', unit: 'miles', placeholder: 'mileage' };
}

function sameMeter(left: string, right: string) {
  const leftValue = Number(left);
  const rightValue = Number(right);
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    return Math.trunc(leftValue) === Math.trunc(rightValue);
  }
  return left.trim() === right.trim();
}

export function CorrectTaskDialog({
  open,
  onOpenChange,
  task,
  vehicles,
  categories,
  plantCategories,
  hgvCategories,
  subcategories,
  plantSubcategories,
  hgvSubcategories,
  recentVehicleIds = [],
  getAssetDisplay,
  onCorrected,
  onCorrectAttachment,
}: CorrectTaskDialogProps) {
  const { tabletModeEnabled } = useTabletMode();
  const { attachments, loading: loadingAttachments } = useTaskAttachments({
    taskId: task?.id ?? null,
    enabled: open && Boolean(task?.id),
  });
  const completedAttachments = useMemo(
    () => attachments.filter((attachment) => attachment.status === 'completed'),
    [attachments],
  );
  const isServiceTask = Boolean(task && isServiceWorkshopTask(task));
  const assetType = assetTypeFromTask(task);
  const meter = meterCopy(assetType);

  const [comments, setComments] = useState('');
  const [completionMeter, setCompletionMeter] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [initialCategoryId, setInitialCategoryId] = useState('');
  const [initialHadSubcategory, setInitialHadSubcategory] = useState(false);
  const [confirmedNextTemplateId, setConfirmedNextTemplateId] = useState('');
  const [correctionComment, setCorrectionComment] = useState('');
  const [templates, setTemplates] = useState<ServiceTemplateOption[]>([]);
  const [baseline, setBaseline] = useState<FormBaseline | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const taskCategories = task?.plant_id ? plantCategories : task?.hgv_id ? hgvCategories : categories;
  const taskSubcategories = task?.plant_id ? plantSubcategories : task?.hgv_id ? hgvSubcategories : subcategories;
  const filteredSubcategories = useMemo(
    () => taskSubcategories.filter((subcategory) => subcategory.category_id === categoryId),
    [categoryId, taskSubcategories],
  );
  const filteredVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.asset_type === assetType),
    [assetType, vehicles],
  );
  const { recentVehicles, otherVehicles } = useMemo(
    () => splitVehiclesByRecent(filteredVehicles, recentVehicleIds),
    [filteredVehicles, recentVehicleIds],
  );

  useEffect(() => {
    if (!open || !task) return;

    const resolvedCategoryId = task.workshop_category_id
      || task.workshop_task_categories?.id
      || '';
    const nextComments = task.workshop_comments || '';
    const nextMeter = task.asset_meter_reading != null ? String(Math.trunc(task.asset_meter_reading)) : '';
    const nextVehicleId = task.van_id ?? task.hgv_id ?? task.plant_id ?? '';
    const nextSubcategoryId = task.workshop_subcategory_id || '';

    queueMicrotask(() => {
      setComments(nextComments);
      setCompletionMeter(nextMeter);
      setVehicleId(nextVehicleId);
      setCategoryId(resolvedCategoryId);
      setSubcategoryId(nextSubcategoryId);
      setInitialCategoryId(resolvedCategoryId);
      setInitialHadSubcategory(Boolean(task.workshop_subcategory_id));
      setConfirmedNextTemplateId('');
      setCorrectionComment('');
      setTemplates([]);
      setBaseline({
        comments: nextComments,
        meter: nextMeter,
        vehicleId: nextVehicleId,
        categoryId: resolvedCategoryId,
        subcategoryId: nextSubcategoryId,
        nextTemplateId: '',
      });
    });

    if (!isServiceWorkshopTask(task)) {
      return;
    }

    let cancelled = false;
    setLoadingTemplates(true);
    void (async () => {
      try {
        const [response, contextResponse] = await Promise.all([
          fetch(`/api/fleet/service-types?assetType=${assetType}`),
          fetch(`/api/workshop-tasks/tasks/${task.id}/correct-service`),
        ]);
        const data = await response.json();
        if (!response.ok || cancelled) return;
        const nextTemplates = (data.templates || []) as ServiceTemplateOption[];
        setTemplates(nextTemplates);

        let suggested = '';
        let contextMeter = nextMeter;
        if (contextResponse.ok) {
          const contextPayload = await contextResponse.json();
          const context = contextPayload.context as {
            suggestedNextTemplateId?: string | null;
            currentNextTemplateId?: string | null;
            currentCompletionMeter?: number | null;
          } | undefined;
          const currentMeter = context?.currentCompletionMeter;
          if (typeof currentMeter === 'number' && Number.isFinite(currentMeter)) {
            contextMeter = String(Math.trunc(currentMeter));
            setCompletionMeter(contextMeter);
          }
          const candidate =
            context?.currentNextTemplateId || context?.suggestedNextTemplateId || '';
          if (candidate && nextTemplates.some((template) => template.templateId === candidate)) {
            suggested = candidate;
          }
        }
        setConfirmedNextTemplateId(suggested);
        setBaseline((current) => ({
          comments: current?.comments ?? nextComments,
          meter: contextMeter,
          vehicleId: current?.vehicleId ?? nextVehicleId,
          categoryId: current?.categoryId ?? resolvedCategoryId,
          subcategoryId: current?.subcategoryId ?? nextSubcategoryId,
          nextTemplateId: suggested,
        }));
      } catch {
        if (!cancelled) toast.error('Failed to load service types');
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetType, open, task]);

  const commentsDirty = comments.trim() !== (baseline?.comments || '').trim();
  const meterDirty = !sameMeter(completionMeter, baseline?.meter || '');
  const vehicleDirty = vehicleId !== (baseline?.vehicleId || '');
  const categoryDirty = categoryId !== (baseline?.categoryId || '');
  const subcategoryDirty = subcategoryId !== (baseline?.subcategoryId || '');
  const nextTypeDirty = confirmedNextTemplateId !== (baseline?.nextTemplateId || '');
  const serviceDirty = isServiceTask && (meterDirty || nextTypeDirty);
  const detailsDirty = isServiceTask
    ? commentsDirty
    : commentsDirty || meterDirty || vehicleDirty || categoryDirty || subcategoryDirty;

  const handleSubmit = async () => {
    if (!task) return;
    if (isArchivedWorkshopTask(task)) {
      toast.error('Archived tasks cannot be corrected');
      onOpenChange(false);
      return;
    }
    if (correctionComment.trim().length < CORRECTION_REASON_MIN_LENGTH) {
      toast.error(`Correction comment must be at least ${CORRECTION_REASON_MIN_LENGTH} characters`);
      return;
    }
    if (!serviceDirty && !detailsDirty) {
      toast.error('No changes to save');
      return;
    }

    const parsedMeter = Number(completionMeter);
    if ((serviceDirty || (!isServiceTask && detailsDirty)) && (!Number.isFinite(parsedMeter) || parsedMeter < 0)) {
      toast.error(`Enter a valid completion ${meter.label.toLowerCase()} reading`);
      return;
    }
    if (serviceDirty && !confirmedNextTemplateId) {
      toast.error('Select the corrected next service type');
      return;
    }
    if (detailsDirty && comments.trim().length < WORKSHOP_TASK_COMMENT_MIN_LENGTH) {
      toast.error(`Comments must be at least ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters`);
      return;
    }
    if (!isServiceTask && detailsDirty) {
      const needsSubcategory = filteredSubcategories.length > 0
        && (initialHadSubcategory || categoryId !== initialCategoryId);
      if (!vehicleId || !categoryId || (needsSubcategory && !subcategoryId)) {
        toast.error('Please fill in all fields');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (detailsDirty) {
        const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId);
        const payload: Record<string, unknown> = {
          reason: correctionComment.trim(),
          expectedUpdatedAt: task.updated_at,
        };
        if (commentsDirty || !isServiceTask) {
          payload.workshop_comments = comments.trim();
        }
        if (!isServiceTask) {
          payload.meter_reading = Math.trunc(parsedMeter);
          if (selectedVehicle?.asset_type === 'van' || selectedVehicle?.asset_type === 'hgv' || selectedVehicle?.asset_type === 'plant') {
            payload.vehicle_id = vehicleId;
            payload.asset_type = selectedVehicle.asset_type;
          }
          payload.workshop_category_id = categoryId || null;
          payload.workshop_subcategory_id = subcategoryId || null;
        }

        const response = await fetch(`/api/workshop-tasks/tasks/${task.id}/correct-completed`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) {
          throw new Error(data.error || 'Failed to correct completed task');
        }
      }

      if (serviceDirty) {
        const response = await fetch(`/api/workshop-tasks/tasks/${task.id}/correct-service`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            completionMeter: Math.trunc(parsedMeter),
            confirmedNextTemplateId,
            correctionComment: correctionComment.trim(),
          }),
        });
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) {
          throw new Error(data.error || 'Failed to correct service task');
        }
      }

      toast.success('Task corrected');
      onOpenChange(false);
      onCorrected?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to correct task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        mobileKeyboardSafe
        data-accent="workshop"
        className={dialogContentViewportClassName({
          size: 'xl',
          className: `bg-white dark:bg-slate-900 border-border text-foreground ${
            tabletModeEnabled ? 'p-5 sm:p-6' : ''
          }`,
        })}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground text-xl">Correct Task</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Managers can correct completed task details. The task stays completed and the change is audited.
          </DialogDescription>
        </DialogHeader>

        <div className={tabletModeEnabled ? 'space-y-5' : 'space-y-4'}>
          {isServiceTask ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="correct-completion-meter" className="text-foreground">
                  Corrected completion ({meter.label})
                </Label>
                <Input
                  id="correct-completion-meter"
                  type="number"
                  min={0}
                  step={1}
                  value={completionMeter}
                  onChange={(event) => setCompletionMeter(event.target.value)}
                  placeholder={`Enter ${meter.placeholder}`}
                  className="bg-white dark:bg-slate-800 border-border text-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Corrected next service type</Label>
                <Select
                  value={confirmedNextTemplateId}
                  onValueChange={setConfirmedNextTemplateId}
                  disabled={loadingTemplates || templates.length === 0}
                >
                  <TabletAwareSelectTrigger className="bg-white dark:bg-slate-800 border-border text-foreground">
                    <SelectValue placeholder={loadingTemplates ? 'Loading…' : 'Select type'} />
                  </TabletAwareSelectTrigger>
                  <TabletAwareSelectContent>
                    {templates.map((template) => (
                      <TabletAwareSelectItem key={template.templateId} value={template.templateId}>
                        {template.compactLabel || template.templateName}
                      </TabletAwareSelectItem>
                    ))}
                  </TabletAwareSelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="correct-vehicle" className="text-foreground">
                    {assetType === 'plant' ? 'Plant' : assetType === 'hgv' ? 'HGV' : 'Van'} <span className="text-red-500">*</span>
                  </Label>
                  <Select value={vehicleId} onValueChange={setVehicleId}>
                    <TabletAwareSelectTrigger id="correct-vehicle" className="bg-white dark:bg-slate-800 border-border text-foreground">
                      <SelectValue placeholder={assetType === 'plant' ? 'Select plant' : assetType === 'hgv' ? 'Select HGV' : 'Select van'} />
                    </TabletAwareSelectTrigger>
                    <TabletAwareSelectContent>
                      {recentVehicles.length > 0 && (
                        <SelectGroup>
                          <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">Recent</SelectLabel>
                          {recentVehicles.map((vehicle) => (
                            <TabletAwareSelectItem key={vehicle.id} value={vehicle.id}>
                              {getAssetDisplay(vehicle, { forSelect: true })}
                            </TabletAwareSelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {recentVehicles.length > 0 && otherVehicles.length > 0 && <SelectSeparator />}
                      {otherVehicles.length > 0 && (
                        <SelectGroup>
                          {recentVehicles.length > 0 && (
                            <SelectLabel className="text-muted-foreground text-xs px-2 py-1.5">
                              All {assetType === 'plant' ? 'Plant' : assetType === 'hgv' ? 'HGVs' : 'Vans'}
                            </SelectLabel>
                          )}
                          {otherVehicles.map((vehicle) => (
                            <TabletAwareSelectItem key={vehicle.id} value={vehicle.id}>
                              {getAssetDisplay(vehicle, { forSelect: true })}
                            </TabletAwareSelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </TabletAwareSelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="correct-category" className="text-foreground">
                    Category <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={categoryId}
                    onValueChange={(value) => {
                      setCategoryId(value);
                      setSubcategoryId('');
                    }}
                  >
                    <TabletAwareSelectTrigger id="correct-category" className="bg-white dark:bg-slate-800 border-border text-foreground">
                      <SelectValue placeholder="Select category" />
                    </TabletAwareSelectTrigger>
                    <TabletAwareSelectContent>
                      {taskCategories.map((category) => (
                        <TabletAwareSelectItem key={category.id} value={category.id}>
                          {category.name}
                        </TabletAwareSelectItem>
                      ))}
                    </TabletAwareSelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {filteredSubcategories.length > 0 ? (
                  <div className="space-y-2">
                    <Label htmlFor="correct-subcategory" className="text-foreground">
                      Subcategory {(initialHadSubcategory || categoryId !== initialCategoryId) && <span className="text-red-500">*</span>}
                    </Label>
                    <Select value={subcategoryId} onValueChange={setSubcategoryId}>
                      <TabletAwareSelectTrigger id="correct-subcategory" className="bg-white dark:bg-slate-800 border-border text-foreground">
                        <SelectValue placeholder="Select subcategory" />
                      </TabletAwareSelectTrigger>
                      <TabletAwareSelectContent>
                        {filteredSubcategories.map((subcategory) => (
                          <TabletAwareSelectItem key={subcategory.id} value={subcategory.id}>
                            {subcategory.name}
                          </TabletAwareSelectItem>
                        ))}
                      </TabletAwareSelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="correct-meter" className="text-foreground">
                    Current {meter.label} <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="correct-meter"
                    type="number"
                    min={0}
                    step={1}
                    value={completionMeter}
                    onChange={(event) => setCompletionMeter(event.target.value)}
                    placeholder={`Enter current ${meter.placeholder}`}
                    className="bg-white dark:bg-slate-800 border-border text-foreground"
                  />
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="correct-comments" className="text-foreground">
              Task Details {detailsDirty && <span className="text-red-500">*</span>}
            </Label>
            <Textarea
              id="correct-comments"
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              placeholder={`Describe the work (minimum ${WORKSHOP_TASK_COMMENT_MIN_LENGTH} characters)`}
              className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground">
              {comments.length}/300 characters (minimum {WORKSHOP_TASK_COMMENT_MIN_LENGTH})
            </p>
          </div>

          {!loadingAttachments && completedAttachments.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-foreground">Correct attachments</Label>
              <div className="space-y-2">
                {completedAttachments.map((attachment) => (
                  <TabletAwareButton
                    key={attachment.id}
                    type="button"
                    variant="outline"
                    onClick={() => onCorrectAttachment?.(attachment.id)}
                    className="w-full justify-start border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <FileText className="mr-2 h-4 w-4 text-workshop" />
                    {attachment.workshop_attachment_templates?.name || 'Attachment'}
                  </TabletAwareButton>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="correct-comment" className="text-foreground">
              Correction comment <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="correct-comment"
              value={correctionComment}
              onChange={(event) => setCorrectionComment(event.target.value)}
              placeholder="Explain why this correction is needed (min 10 characters)"
              className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[80px]"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className={tabletModeEnabled ? 'gap-3 pt-2' : 'gap-3'}>
          <TabletAwareButton
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </TabletAwareButton>
          <TabletAwareButton
            onClick={() => void handleSubmit()}
            disabled={submitting || loadingTemplates}
            className="bg-workshop hover:bg-workshop-dark text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save correction'
            )}
          </TabletAwareButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
