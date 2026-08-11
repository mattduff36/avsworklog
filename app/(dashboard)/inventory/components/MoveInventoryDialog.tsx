'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  dialogContentViewportClassName,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getInventoryMoveCheckWarningPayload,
  type InventoryMoveCheckWarningPayload,
} from '@/lib/inventory/move-check-warning';
import type { InventoryItem, InventoryLocation, InventoryMovePayload } from '../types';
import { InventoryLocationSelect } from './InventoryLocationSelect';
import { InventoryMoveCheckWarningDialog } from './InventoryMoveCheckWarningDialog';

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
  const [moveScope, setMoveScope] = useState<'single' | 'group'>('single');
  const [saving, setSaving] = useState(false);
  const [warningPayload, setWarningPayload] = useState<InventoryMoveCheckWarningPayload | null>(null);
  const [pendingMove, setPendingMove] = useState<InventoryMovePayload | null>(null);
  const isBulkMove = items.length > 1;
  const group = !isBulkMove ? items[0]?.group : null;

  useEffect(() => {
    setLocationId('');
    setNote('');
    setMoveScope('single');
    setWarningPayload(null);
    setPendingMove(null);
  }, [open]);

  async function submitMove(payload: InventoryMovePayload) {
    setSaving(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (error) {
      const nextWarning = getInventoryMoveCheckWarningPayload(error);
      if (nextWarning) {
        setPendingMove({
          ...payload,
          check_warning_confirmation: undefined,
        });
        setWarningPayload(nextWarning);
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to move inventory items');
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void submitMove({
      location_id: locationId,
      note,
      scope: group && moveScope === 'group' ? 'group' : isBulkMove ? 'bulk' : 'single',
      group_id: group && moveScope === 'group' ? group.id : null,
    });
  }

  async function handleMoveAnyway() {
    if (!pendingMove || !warningPayload) return;
    await submitMove({
      ...pendingMove,
      check_warning_confirmation: {
        warning_item_ids: warningPayload.warning_items.map((item) => item.id),
        move_item_ids: warningPayload.move_item_ids,
      },
    });
  }

  return (
    <>
    <Dialog
      open={open && !warningPayload}
      onOpenChange={(isOpen) => {
        if (!isOpen && !saving && !warningPayload) onClose();
      }}
    >
      <DialogContent
        mobileKeyboardSafe
        data-keyboard-safe-dialog="true"
        className={dialogContentViewportClassName({
          size: 'lg',
          scroll: 'content',
          className: 'top-0 h-[100dvh] max-h-none w-screen max-w-none translate-y-0 gap-0 rounded-none border-slate-700 bg-slate-900 p-0 text-white sm:top-1/2 sm:h-auto sm:max-h-[calc(100dvh-1rem)] sm:w-[calc(100vw-1rem)] sm:max-w-lg sm:-translate-y-1/2 sm:rounded-xl',
        })}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="shrink-0 px-6 pb-4 pt-5 sm:pt-6">
            <DialogTitle>{isBulkMove ? `Move ${items.length} Items` : 'Move Inventory Item'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Select the new location bucket. The move will be written to the item movement history.
            </DialogDescription>
          </DialogHeader>

          <div
            data-mobile-scroll-lock="true"
            className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain px-6 py-4"
          >
            {!isBulkMove && items[0] ? (
              <div className="rounded-md border border-slate-700 bg-slate-800/60 p-3 text-sm">
                <div className="font-medium text-white">{items[0].name}</div>
                <div className="text-muted-foreground">{items[0].item_number}</div>
              </div>
            ) : null}

            {group ? (
              <div className="rounded-md border border-purple-500/25 bg-purple-500/10 p-3 text-sm">
                <div className="font-medium text-purple-100">This item belongs to the group “{group.name}”.</div>
                <RadioGroup
                  value={moveScope}
                  onValueChange={(value) => setMoveScope(value as 'single' | 'group')}
                  className="mt-3 space-y-2"
                >
                  <label className="flex items-center gap-2 text-slate-200">
                    <RadioGroupItem value="single" />
                    Move only this item
                  </label>
                  <label className="flex items-center gap-2 text-slate-200">
                    <RadioGroupItem value="group" />
                    Move the entire group
                  </label>
                </RadioGroup>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Destination Location *</Label>
              <InventoryLocationSelect
                value={locationId}
                onValueChange={(value) => {
                  setLocationId(value);
                  setWarningPayload(null);
                  setPendingMove(null);
                }}
                locations={locations}
                serverSearch
              />
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

          <DialogFooter className="shrink-0 border-t border-slate-700 px-6 pb-4 pt-4 sm:pb-6">
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
    <InventoryMoveCheckWarningDialog
      payload={warningPayload}
      saving={saving}
      onCancel={() => {
        setWarningPayload(null);
        setPendingMove(null);
      }}
      onConfirm={() => {
        void handleMoveAnyway();
      }}
    />
    </>
  );
}
