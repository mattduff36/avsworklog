'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function PlantServiceIntervalControl({ plantId, disabled, onSaved }: {
  plantId: string; disabled: boolean; onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [globalInterval, setGlobalInterval] = useState<number | null>(null);
  const [initial, setInitial] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setGlobalInterval(null);
    setError('');
    fetch(`/api/maintenance/plant-service-interval?plantId=${encodeURIComponent(plantId)}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (cancelled) return;
        const next = data.overrideIntervalHours == null ? '' : String(data.overrideIntervalHours);
        setValue(next); setInitial(next); setGlobalInterval(data.globalIntervalHours);
      }).catch(() => { if (!cancelled) setError('Unable to load service interval. Reopen this record to retry.'); });
    return () => { cancelled = true; };
  }, [plantId]);
  async function save() {
    const interval = value.trim() === '' ? null : Number(value);
    if (interval !== null && (!Number.isInteger(interval) || interval < 1 || interval > 1000000)) {
      setError('Enter a whole number from 1 to 1000000, or leave blank for the global interval.'); return;
    }
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/maintenance/plant-service-interval', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plantId, intervalHours: interval }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast.success(`Service interval saved: ${data.effectiveIntervalHours} hours`);
      onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save interval'); }
    finally { setSaving(false); }
  }
  return <div className="space-y-2">
    <Label htmlFor="plant-service-interval">Service interval override (hours)</Label>
    <Input id="plant-service-interval" type="number" min={1} max={1000000}
      value={value} onChange={event => setValue(event.target.value)} disabled={disabled || saving || globalInterval === null}
      placeholder={globalInterval === null ? 'Loading…' : `Global: ${globalInterval} hours`} />
    <p className="text-sm text-muted-foreground">
      Leave blank to use the global interval{globalInterval === null ? '' : ` (${globalInterval} hours)`}.
      Saving recalculates the next due reading from the recorded last service and applies to future services.
      Without a last-service reading, the existing due reading is kept.
    </p>
    {disabled && <p className="text-sm text-muted-foreground">Save other record changes before changing the interval.</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <Button type="button" variant="outline" disabled={disabled || saving || globalInterval === null || value === initial} onClick={save}>
      {saving ? 'Saving interval…' : 'Save interval and close'}
    </Button>
  </div>;
}
