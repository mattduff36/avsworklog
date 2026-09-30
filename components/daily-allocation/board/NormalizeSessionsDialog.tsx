'use client';

import { useEffect, useState } from 'react';
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
import type { DailyAllocationSession } from '@/lib/utils/daily-allocation-sessions';

interface NormalizeVisit {
  visit_id: string;
  job_code: string;
  session: DailyAllocationSession;
}

interface NormalizePreview {
  visits: NormalizeVisit[];
  conflicts: Array<{ visit_id: string; detail: string }>;
  plan_version: number | null;
}

export function NormalizeSessionsDialog({
  open,
  workDate,
  teamId,
  planVersion,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  workDate: string;
  teamId: string;
  planVersion: number | null;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const [preview, setPreview] = useState<NormalizePreview | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setPreview(null);
  }, [open, workDate, teamId]);

  async function submit(apply: boolean) {
    if (!planVersion) return;
    setPending(true);
    try {
      const response = await fetch('/api/daily-allocation/normalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          team_id: teamId,
          work_date: workDate,
          expected_plan_version: planVersion,
          apply,
          adjustments: (preview?.visits || []).map((visit) => ({
            visit_id: visit.visit_id,
            session: visit.session,
          })),
        }),
      });
      const payload = await response.json() as NormalizePreview & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to review these sessions.');
      if (apply) {
        toast.success('Sessions updated.');
        onApplied();
        onOpenChange(false);
        return;
      }
      setPreview(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to review these sessions.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review custom times</DialogTitle>
          <DialogDescription>
            Editable visits that are not already Full, AM, or PM are listed here. Nothing is rewritten until you apply a conflict-free preview.
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="space-y-3">
            {preview.visits.length === 0 ? <p className="text-sm">No custom times need review.</p> : null}
            {preview.visits.map((visit) => (
              <label key={visit.visit_id} className="flex items-center justify-between gap-3 text-sm">
                <span>{visit.job_code}</span>
                <select
                  aria-label={`Session for ${visit.job_code}`}
                  className="h-8 rounded-md border border-slate-600 bg-slate-950 px-2"
                  value={visit.session}
                  onChange={(event) => {
                    const session = event.target.value as DailyAllocationSession;
                    setPreview({
                      ...preview,
                      visits: preview.visits.map((item) => (
                        item.visit_id === visit.visit_id ? { ...item, session } : item
                      )),
                    });
                  }}
                >
                  <option value="full">Full day</option>
                  <option value="am">AM</option>
                  <option value="pm">PM</option>
                </select>
              </label>
            ))}
            {preview.conflicts.length > 0 ? (
              <p className="text-sm text-amber-200">
                Resolve {preview.conflicts.length} overlap{preview.conflicts.length === 1 ? '' : 's'} before applying.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Preview the proposed sessions before anything changes.</p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className={boardControlStyles.outline} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {preview && preview.conflicts.length === 0 && preview.visits.length > 0 ? (
            <Button type="button" className={boardControlStyles.primary} disabled={pending} onClick={() => void submit(true)}>
              Apply sessions
            </Button>
          ) : (
            <Button type="button" className={boardControlStyles.primary} disabled={pending || !planVersion} onClick={() => void submit(false)}>
              Preview sessions
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
