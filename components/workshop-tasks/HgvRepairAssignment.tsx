'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export type HgvRepairSide = 'pair' | 'tractor' | 'trailer';
export interface HgvRepairPair {
  tractor_label: string;
  trailer_label: string;
}

export function HgvRepairAssignment({ taskId, pair, side, editable, refresh }: {
  taskId: string;
  pair: HgvRepairPair;
  side: HgvRepairSide;
  editable: boolean;
  refresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [savedSide, setSavedSide] = useState(side);

  async function assign(next: 'tractor' | 'trailer') {
    setSaving(true);
    try {
      const response = await fetch(`/api/workshop-tasks/tasks/${taskId}/assign-hgv-repair`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side: next, expectedSide: savedSide }),
      });
      if (!response.ok) throw new Error('Refresh the task and check its current assignment.');
      setSavedSide(next);
      await refresh();
      toast.success('Repair assignment saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to assign repair');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <p className="text-sm font-medium">Tractor {pair.tractor_label} · Trailer {pair.trailer_label}</p>
      <p className="text-sm text-muted-foreground">
        {savedSide === 'pair' ? 'Awaiting workshop diagnosis' : `Repair assigned to ${savedSide}`}
      </p>
      {editable && <div className="flex flex-wrap gap-2">
        {(['tractor', 'trailer'] as const).filter(option => option !== savedSide).map(option => (
          <Button key={option} type="button" size="sm" variant="outline" disabled={saving}
            onClick={() => void assign(option)}>Assign to {option}</Button>
        ))}
      </div>}
    </div>
  );
}
