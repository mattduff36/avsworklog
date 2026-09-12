'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import {
  buildDailyAllocationConversionRequest,
  createDailyAllocationConversionReview,
  type DailyAllocationConversionReview,
  type DailyAllocationConversionVisitDraft,
} from '@/components/daily-allocation/board/daily-allocation-conversion';
import { fetchDailyAllocationConversionSource } from '@/lib/client/daily-allocation';
import type {
  DailyAllocationConversionSource,
  DailyAllocationConvertInput,
} from '@/types/daily-allocation';

type CoordinatedConversionRequest = Omit<DailyAllocationConvertInput, 'request_id'>;

function sourceJobKey(sourceType: string | null, sourceId: string | null): string | null {
  return sourceType && sourceId ? `${sourceType}:${sourceId}` : null;
}

function updateVisit(
  review: DailyAllocationConversionReview,
  visitKey: string,
  patch: Partial<DailyAllocationConversionVisitDraft>
): DailyAllocationConversionReview {
  return {
    ...review,
    visits: review.visits.map((visit) =>
      visit.key === visitKey ? { ...visit, ...patch } : visit
    ),
  };
}

export function GuidedLegacyConversionDialog({
  open,
  workDate,
  teamId,
  employeeNames,
  onOpenChange,
  onSubmit,
  saving,
}: {
  open: boolean;
  workDate: string;
  teamId: string;
  employeeNames: Map<string, string>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: CoordinatedConversionRequest) => Promise<void>;
  saving: boolean;
}) {
  const [source, setSource] = useState<DailyAllocationConversionSource | null>(null);
  const [review, setReview] = useState<DailyAllocationConversionReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadEpoch, setLoadEpoch] = useState(0);

  useEffect(() => {
    if (!open || !workDate || !teamId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setSource(null);
      setReview(null);
    });
    void fetchDailyAllocationConversionSource(workDate, teamId)
      .then((nextSource) => {
        if (cancelled) return;
        setSource(nextSource);
        setReview(createDailyAllocationConversionReview(nextSource, () => globalThis.crypto.randomUUID()));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load legacy drafts.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadEpoch, open, teamId, workDate]);

  const visitByKey = useMemo(
    () => new Map(review?.visits.map((visit) => [visit.key, visit]) || []),
    [review]
  );
  const draftCount = (source?.labour_drafts.length || 0) + (source?.plant_drafts.length || 0);

  async function submit() {
    if (!source || !review) return;
    try {
      setError(null);
      await onSubmit(buildDailyAllocationConversionRequest({ source, review }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to convert these drafts.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto border-slate-700 bg-slate-900 text-slate-50">
        <DialogHeader>
          <DialogTitle>Review legacy allocations for {workDate}</DialogTitle>
          <DialogDescription>
            Choose explicit 30-minute visit times and a disposition for every untimed labour and plant draft. Legacy start-time text is not used.
          </DialogDescription>
        </DialogHeader>

        {loading ? <p className="py-8 text-sm text-slate-300">Loading the authoritative conversion source…</p> : null}
        {error ? (
          <div className="flex items-start justify-between gap-3 rounded-md border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-100" role="alert">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </span>
            {!source ? (
              <Button type="button" size="sm" className={boardControlStyles.outline} onClick={() => setLoadEpoch((value) => value + 1)}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}

        {source && review && draftCount === 0 ? (
          <div className="rounded-md border border-slate-700 p-4 text-sm text-slate-300">
            No legacy drafts remain in the authoritative source. Close this dialog and refresh the board.
          </div>
        ) : null}

        {source && review && draftCount > 0 ? (
          <div className="space-y-5 py-2">
            <section className="space-y-3">
              <div>
                <h3 className="font-semibold">Timed visits</h3>
                <p className="text-xs text-slate-400">Times apply to every draft mapped to that catalogue job.</p>
              </div>
              {review.visits.map((visit) => (
                <div key={visit.key} className="grid gap-3 rounded-md border border-slate-700 p-3 lg:grid-cols-[minmax(10rem,1fr)_8rem_8rem]">
                  <div>
                    <p className="font-medium">{visit.jobCode}</p>
                    <p className="text-xs text-slate-400">{visit.siteAddress || 'Catalogue site address'}</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`conversion-start-${visit.id}`}>Start</Label>
                    <Input
                      id={`conversion-start-${visit.id}`}
                      type="time"
                      step={1800}
                      value={visit.startTime}
                      onChange={(event) => setReview(updateVisit(review, visit.key, { startTime: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`conversion-end-${visit.id}`}>End</Label>
                    <Input
                      id={`conversion-end-${visit.id}`}
                      type="time"
                      step={1800}
                      value={visit.endTime}
                      onChange={(event) => setReview(updateVisit(review, visit.key, { endTime: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`conversion-meeting-${visit.id}`}>Meeting point</Label>
                    <Input
                      id={`conversion-meeting-${visit.id}`}
                      value={visit.meetingPoint}
                      onChange={(event) => setReview(updateVisit(review, visit.key, { meetingPoint: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`conversion-meet-${visit.id}`}>Meet person</Label>
                    <Input
                      id={`conversion-meet-${visit.id}`}
                      value={visit.meetPerson}
                      onChange={(event) => setReview(updateVisit(review, visit.key, { meetPerson: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`conversion-notes-${visit.id}`}>Notes</Label>
                    <Textarea
                      id={`conversion-notes-${visit.id}`}
                      value={visit.notes}
                      onChange={(event) => setReview(updateVisit(review, visit.key, { notes: event.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">Labour drafts ({source.labour_drafts.length})</h3>
              {source.labour_drafts.map((draft) => {
                const mapping = review.labour[draft.id];
                const compatibleVisitKey = sourceJobKey(draft.job_source_type, draft.job_source_id);
                const visit = compatibleVisitKey ? visitByKey.get(compatibleVisitKey) : null;
                return (
                  <div key={draft.id} className="grid items-center gap-2 rounded-md border border-slate-700 p-3 md:grid-cols-[minmax(12rem,1fr)_11rem_minmax(10rem,1fr)]">
                    <div>
                      <p className="font-medium">{employeeNames.get(draft.profile_id) || draft.profile_id}</p>
                      <p className="text-xs text-slate-400">{draft.job_code || 'No catalogue job'} · row {draft.row_version}</p>
                    </div>
                    <select
                      aria-label={`Disposition for ${employeeNames.get(draft.profile_id) || draft.profile_id}`}
                      className="h-9 rounded-md border border-slate-600 bg-slate-950 px-2 text-sm"
                      value={mapping.disposition}
                      onChange={(event) => {
                        const disposition = event.target.value as typeof mapping.disposition;
                        setReview({
                          ...review,
                          labour: {
                            ...review.labour,
                            [draft.id]: {
                              disposition,
                              visitKey: disposition === 'visit' ? compatibleVisitKey : null,
                            },
                          },
                        });
                      }}
                    >
                      <option value="" disabled>Choose disposition</option>
                      {visit ? <option value="visit">Map to timed visit</option> : null}
                      <option value="unallocated">Unallocated</option>
                      <option value="absence">Absence</option>
                    </select>
                    <p className="text-xs text-slate-300">
                      {mapping.disposition === 'visit' && visit
                        ? `${visit.jobCode} · ${visit.startTime}–${visit.endTime}`
                        : mapping.disposition === 'absence'
                          ? 'Keep as absence disposition'
                          : mapping.disposition === 'unallocated'
                            ? 'Keep explicitly unallocated'
                            : 'Choose how to handle this draft'}
                    </p>
                  </div>
                );
              })}
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold">Plant drafts ({source.plant_drafts.length})</h3>
              {source.plant_drafts.map((draft) => {
                const mapping = review.plant[draft.id];
                const compatibleVisitKey = sourceJobKey(draft.job_source_type, draft.job_source_id);
                const visit = compatibleVisitKey ? visitByKey.get(compatibleVisitKey) : null;
                const label = draft.plant_kind === 'hired'
                  ? [draft.hired_serial, draft.hired_description].filter(Boolean).join(' · ')
                  : draft.plant_id || 'Registered plant';
                return (
                  <div key={draft.id} className="grid items-center gap-2 rounded-md border border-slate-700 p-3 md:grid-cols-[minmax(12rem,1fr)_11rem_minmax(10rem,1fr)]">
                    <div>
                      <p className="font-medium">{label}</p>
                      <p className="text-xs text-slate-400">{draft.job_code} · row {draft.row_version}</p>
                    </div>
                    <select
                      aria-label={`Disposition for ${label}`}
                      className="h-9 rounded-md border border-slate-600 bg-slate-950 px-2 text-sm"
                      value={mapping.disposition}
                      onChange={(event) => {
                        const disposition = event.target.value as typeof mapping.disposition;
                        setReview({
                          ...review,
                          plant: {
                            ...review.plant,
                            [draft.id]: {
                              disposition,
                              visitKey: disposition === 'visit' ? compatibleVisitKey : null,
                            },
                          },
                        });
                      }}
                    >
                      <option value="" disabled>Choose disposition</option>
                      {visit ? <option value="visit">Map to timed visit</option> : null}
                      <option value="unallocated">Unallocated</option>
                    </select>
                    <p className="text-xs text-slate-300">
                      {mapping.disposition === 'visit' && visit
                        ? `${visit.jobCode} · ${visit.startTime}–${visit.endTime}`
                        : mapping.disposition === 'unallocated'
                          ? 'Keep explicitly unallocated'
                          : 'Choose how to handle this draft'}
                    </p>
                  </div>
                );
              })}
            </section>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" className={boardControlStyles.outline} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className={boardControlStyles.primary}
            disabled={loading || saving || !source || !review || draftCount === 0}
            onClick={() => void submit()}
          >
            {saving ? 'Converting…' : 'Convert reviewed drafts'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
