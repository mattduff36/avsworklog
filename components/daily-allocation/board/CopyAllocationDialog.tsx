'use client';

import { useEffect, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import type { DailyAllocationCopyProjectionResult } from '@/components/daily-allocation/board/daily-allocation-copy-projection';

type CopyCategory = 'employees' | 'jobs' | 'plant';

interface CopyPreview {
  additions: Array<{ label: string; detail: string }>;
  skips: Array<{ label: string; detail: string }>;
  warnings: Array<{ label: string; detail: string }>;
}

interface CopyAllocationDialogProps {
  open: boolean;
  sourceDate: string;
  teamId: string;
  sourcePlanVersion: number | null;
  targetPlanVersion: number | null;
  onOpenChange: (open: boolean) => void;
  onApplied: (result: DailyAllocationCopyProjectionResult) => void;
}

export function CopyAllocationDialog({
  open,
  sourceDate,
  teamId,
  sourcePlanVersion,
  targetPlanVersion,
  onOpenChange,
  onApplied,
}: CopyAllocationDialogProps) {
  const [categories, setCategories] = useState<CopyCategory[]>(['employees', 'jobs', 'plant']);
  const [preview, setPreview] = useState<(CopyPreview & { target_plan_version: number | null }) | null>(null);
  const [pending, setPending] = useState(false);
  const targetDate = sourceDate
    ? format(addDays(parseISO(sourceDate), 1), 'yyyy-MM-dd')
    : '';

  useEffect(() => {
    setPreview(null);
  }, [sourceDate, teamId]);

  function toggle(category: CopyCategory) {
    setPreview(null);
    setCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
  }

  async function submit(apply: boolean) {
    if (!sourcePlanVersion || categories.length === 0) {
      toast.error('Choose at least one category on a planned day.');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/daily-allocation/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          source_date: sourceDate,
          target_date: targetDate,
          team_id: teamId,
          categories,
          apply,
          expected_source_plan_version: sourcePlanVersion,
          expected_target_plan_version: apply ? preview?.target_plan_version ?? targetPlanVersion : targetPlanVersion,
        }),
      });
      const payload = await response.json() as CopyPreview & DailyAllocationCopyProjectionResult & {
        error?: string;
        target_plan_version: number | null;
      };
      if (!response.ok) throw new Error(payload.error || 'Unable to copy this allocation.');
      setPreview(payload);
      if (apply) {
        toast.success(`Copied non-conflicting allocation to ${targetDate}.`);
        onApplied({
          source_date: payload.source_date || sourceDate,
          target_date: payload.target_date || targetDate,
          additions: payload.additions || [],
        });
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to copy this allocation.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy to the next day</DialogTitle>
          <DialogDescription>
            Copy from {sourceDate} into {targetDate}. Existing work is left unchanged, and only non-conflicting items are added.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Copy</legend>
          {(['employees', 'jobs', 'plant'] as const).map((category) => (
            <label key={category} className="flex items-center gap-2 text-sm capitalize">
              <input
                type="checkbox"
                checked={categories.includes(category)}
                onChange={() => toggle(category)}
              />
              {category}
            </label>
          ))}
        </fieldset>
        {preview ? (
          <div className="space-y-2 text-sm">
            <p>{preview.additions.length} to add, {preview.skips.length} skipped, {preview.warnings.length} warnings.</p>
            {preview.warnings.map((warning) => (
              <p key={`${warning.label}:${warning.detail}`} className="text-amber-200">{warning.label}: {warning.detail}</p>
            ))}
            {preview.skips.map((skip) => (
              <p key={`${skip.label}:${skip.detail}`} className="text-muted-foreground">{skip.label}: {skip.detail}</p>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void submit(false)}>Preview</Button>
          <Button type="button" className={boardControlStyles.primary} disabled={pending || !preview} onClick={() => void submit(true)}>
            {pending ? 'Copying…' : 'Copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
