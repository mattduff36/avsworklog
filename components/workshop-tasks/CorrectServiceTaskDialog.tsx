'use client';

import { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface CorrectServiceTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string | null;
  assetType: 'van' | 'hgv' | 'plant';
  onCorrected?: () => void;
}

interface ServiceTemplateOption {
  templateId: string;
  templateName: string;
  compactLabel: string | null;
}

export function CorrectServiceTaskDialog({
  open,
  onOpenChange,
  taskId,
  assetType,
  onCorrected,
}: CorrectServiceTaskDialogProps) {
  const [templates, setTemplates] = useState<ServiceTemplateOption[]>([]);
  const [completionMeter, setCompletionMeter] = useState('');
  const [confirmedNextTemplateId, setConfirmedNextTemplateId] = useState('');
  const [correctionComment, setCorrectionComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setCompletionMeter('');
      setConfirmedNextTemplateId('');
      setCorrectionComment('');
    });

    let cancelled = false;
    setLoadingTemplates(true);
    void (async () => {
      try {
        const [response, contextResponse] = await Promise.all([
          fetch(`/api/fleet/service-types?assetType=${assetType}`),
          taskId
            ? fetch(`/api/workshop-tasks/tasks/${taskId}/correct-service`)
            : Promise.resolve(null),
        ]);
        const data = await response.json();
        if (!response.ok || cancelled) return;
        const nextTemplates = (data.templates || []) as ServiceTemplateOption[];
        setTemplates(nextTemplates);
        let suggested = '';
        if (contextResponse?.ok) {
          const contextPayload = await contextResponse.json();
          const candidate = contextPayload.context?.suggestedNextTemplateId as string | undefined;
          if (candidate && nextTemplates.some((template) => template.templateId === candidate)) {
            suggested = candidate;
          }
        }
        setConfirmedNextTemplateId(suggested);
      } catch {
        if (!cancelled) toast.error('Failed to load service types');
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, assetType, taskId]);

  const meterLabel = assetType === 'plant' ? 'Hours' : assetType === 'hgv' ? 'KM' : 'Miles';

  const handleSubmit = async () => {
    if (!taskId) return;
    const meter = Number(completionMeter);
    if (!Number.isFinite(meter) || meter < 0) {
      toast.error(`Enter a valid completion ${meterLabel.toLowerCase()} reading`);
      return;
    }
    if (!confirmedNextTemplateId) {
      toast.error('Select the corrected next service type');
      return;
    }
    if (correctionComment.trim().length < 10) {
      toast.error('Correction comment must be at least 10 characters');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/workshop-tasks/tasks/${taskId}/correct-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completionMeter: meter,
          confirmedNextTemplateId,
          correctionComment: correctionComment.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to correct service task');
      }
      toast.success('Service completion corrected');
      onOpenChange(false);
      onCorrected?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to correct service task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct Service Completion</DialogTitle>
          <DialogDescription>
            Managers and admins can adjust the recorded meter and next service type. This appends an
            audited correction and does not reopen the task.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="correct-completion-meter">Corrected completion ({meterLabel})</Label>
            <Input
              id="correct-completion-meter"
              type="number"
              min={0}
              step={1}
              value={completionMeter}
              onChange={(event) => setCompletionMeter(event.target.value)}
              placeholder={`Enter ${meterLabel.toLowerCase()}`}
            />
          </div>

          <div className="space-y-2">
            <Label>Corrected next service type</Label>
            <Select
              value={confirmedNextTemplateId}
              onValueChange={setConfirmedNextTemplateId}
              disabled={loadingTemplates || templates.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingTemplates ? 'Loading…' : 'Select type'} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.templateId} value={template.templateId}>
                    {template.compactLabel || template.templateName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="correct-comment">Correction comment</Label>
            <Textarea
              id="correct-comment"
              value={correctionComment}
              onChange={(event) => setCorrectionComment(event.target.value)}
              placeholder="Explain why this correction is needed (min 10 characters)"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || loadingTemplates}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save correction'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
