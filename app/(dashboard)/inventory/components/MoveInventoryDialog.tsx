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
import type { InventoryItem, InventoryLocation, InventoryMovePayload } from '../types';

interface MoveInventoryDialogProps {
  open: boolean;
  items: InventoryItem[];
  locations: InventoryLocation[];
  onClose: () => void;
  onSubmit: (payload: InventoryMovePayload) => Promise<void>;
}

export function MoveInventoryDialog({
  open,
  items,
  locations,
  onClose,
  onSubmit,
}: MoveInventoryDialogProps) {
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const isBulkMove = items.length > 1;

  useEffect(() => {
    setLocationId('');
    setNote('');
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ location_id: locationId, note });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent className="max-w-lg bg-slate-900 text-white border-slate-700">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isBulkMove ? `Move ${items.length} Items` : 'Move Inventory Item'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Select the new location bucket. The move will be written to the item movement history.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {!isBulkMove && items[0] ? (
              <div className="rounded-md border border-slate-700 bg-slate-800/60 p-3 text-sm">
                <div className="font-medium text-white">{items[0].name}</div>
                <div className="text-muted-foreground">{items[0].item_number}</div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Destination Location *</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="bg-slate-800 border-slate-600">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="move_note">Move Note</Label>
              <Textarea
                id="move_note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="bg-slate-800 border-slate-600"
                rows={3}
                placeholder="Optional reason or handover note"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-inventory text-white hover:bg-inventory-dark"
              disabled={saving || !locationId || items.length === 0}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
