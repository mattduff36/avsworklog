'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatInspectionMeter, inspectionMeterUnit, type InspectionAssetType, type InspectionMeterSnapshot } from '@/lib/inspections/meter-correction';

export interface InspectionMeterCorrectionTarget {
  id: string;
  label: string;
}

export function InspectionMeterCorrectionDialog({ assetType, target, onClose, onSaved }: {
  assetType: InspectionAssetType;
  target: InspectionMeterCorrectionTarget | null;
  onClose: () => void;
  onSaved: (id: string, reading: number) => void;
}) {
  const [snapshot, setSnapshot] = useState<InspectionMeterSnapshot | null>(null);
  const [reading, setReading] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unit = inspectionMeterUnit(assetType);

  useEffect(() => {
    setSnapshot(null);
    setReading('');
    setComment('');
    setError(null);
    if (!target) return;
    const abort = new AbortController();
    setLoading(true);
    const query = new URLSearchParams({ assetType, inspectionId: target.id });
    void fetch(`/api/inspection-meter-corrections?${query}`, { signal: abort.signal, cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load this reading.');
        if (!abort.signal.aborted) {
          setSnapshot(data);
          setReading(data.reading == null ? '' : String(data.reading));
        }
      })
      .catch(error => { if (!abort.signal.aborted) setError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [assetType, target]);

  async function save() {
    if (!target || !snapshot) return;
    if (!/^\d+$/.test(reading) || Number(reading) > 2147483647) {
      setError('Enter a whole-number reading of zero or above.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/inspection-meter-corrections', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetType, inspectionId: target.id, reading: Number(reading),
          expectedReading: snapshot.reading, expectedVersion: snapshot.version, comment }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save this correction.');
      onSaved(target.id, data.reading);
      toast.success('Daily Check reading corrected.');
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save this correction.');
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto" onInteractOutside={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Edit Daily Check reading</DialogTitle>
          <DialogDescription>{target?.label}. Corrections are recorded in the history below.</DialogDescription>
        </DialogHeader>
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading reading…</p> : snapshot && (
          <form id="inspection-meter-correction" className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
            <p className="text-sm text-muted-foreground">Recorded: {formatInspectionMeter(snapshot.reading, assetType)}</p>
            <div className="space-y-2">
              <Label htmlFor="inspection-corrected-reading">Correct reading ({unit})</Label>
              <Input id="inspection-corrected-reading" type="number" inputMode="numeric" min="0" max="2147483647" step="1"
                required value={reading} onChange={event => setReading(event.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inspection-correction-comment">Reason / comment (optional)</Label>
              <Textarea id="inspection-correction-comment" maxLength={2000} value={comment}
                onChange={event => setComment(event.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Correction history</h3>
              {snapshot.history.length === 0 ? <p className="text-sm text-muted-foreground">No previous corrections.</p> : (
                <ul className="max-h-48 overflow-y-auto space-y-3 text-sm">
                  {snapshot.history.map(entry => (
                    <li key={entry.id} className="border-t border-border pt-2">
                      <p>{formatInspectionMeter(entry.changes.old_reading, assetType)} → {formatInspectionMeter(entry.changes.new_reading, assetType)}</p>
                      <p className="text-muted-foreground">{entry.actor_name || 'Unknown user'} · {new Date(entry.created_at).toLocaleString('en-GB')}</p>
                      {entry.changes.comment && <p className="break-words whitespace-pre-wrap">{entry.changes.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </form>
        )}
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="inspection-meter-correction" disabled={loading || saving || !snapshot || reading.trim() === '' || Number(reading) === snapshot.reading}>
            {saving ? 'Saving…' : 'Save correction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
