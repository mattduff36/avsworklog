'use client';

import { useState } from 'react';
import { Archive, Loader2 } from 'lucide-react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  INVENTORY_RETIRE_REASONS,
  type InventoryItem,
  type InventoryRetireReason,
} from '../types';

interface InventoryRetireItemDialogProps {
  open: boolean;
  item: InventoryItem | null;
  onOpenChange: (open: boolean) => void;
  onRetire: (item: InventoryItem, reason: InventoryRetireReason) => Promise<void>;
}

export function InventoryRetireItemDialog({
  open,
  item,
  onOpenChange,
  onRetire,
}: InventoryRetireItemDialogProps) {
  const [reason, setReason] = useState<InventoryRetireReason>('Damaged');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!item) return null;

  async function handleRetire() {
    if (!item) return;
    setSaving(true);
    setError('');
    try {
      await onRetire(item, reason);
      onOpenChange(false);
      setReason('Damaged');
    } catch (retireError) {
      setError(retireError instanceof Error ? retireError.message : 'Failed to retire inventory item');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!saving) onOpenChange(isOpen); }}>
      <DialogContent
        mobileKeyboardSafe
        data-keyboard-safe-dialog="true"
        className={dialogContentViewportClassName({
          size: 'md',
          scroll: 'content',
          className: 'top-0 h-[100dvh] max-h-none w-screen max-w-none translate-y-0 gap-0 rounded-none border-border bg-slate-900 p-0 text-white sm:top-1/2 sm:h-auto sm:max-h-[calc(100dvh-1rem)] sm:w-[calc(100vw-1rem)] sm:max-w-md sm:-translate-y-1/2 sm:rounded-xl',
        })}
      >
        <DialogHeader className="shrink-0 px-6 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:pt-6">
          <DialogTitle className="flex items-center gap-2 text-inventory">
            <Archive className="h-5 w-5" />
            Retire Inventory Item
          </DialogTitle>
          <DialogDescription>
            This will move the item to Retired Items. Movement, checks, and history will be preserved.
          </DialogDescription>
        </DialogHeader>

        <div
          data-mobile-scroll-lock="true"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4"
        >
          {error ? (
            <div className="rounded-lg border border-red-800 bg-red-900/20 p-3">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          ) : null}

          <div className="space-y-2 rounded-lg bg-slate-800 p-4 text-sm">
            <p>
              <span className="text-muted-foreground">ID:</span>{' '}
              <span className="font-medium text-white">{item.item_number}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Item:</span>{' '}
              <span className="text-white">{item.name}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Location:</span>{' '}
              <span className="text-white">{item.location?.name || 'No location assigned'}</span>
            </p>
          </div>

          <div className="space-y-3">
            <Label className="text-white">
              Reason for retirement <span className="text-red-400">*</span>
            </Label>
            <RadioGroup value={reason} onValueChange={(value) => setReason(value as InventoryRetireReason)}>
              {INVENTORY_RETIRE_REASONS.map((retireReason) => (
                <div key={retireReason} className="flex items-center space-x-2 rounded-lg border border-slate-700 bg-slate-800 p-3 transition-colors hover:border-slate-600">
                  <RadioGroupItem value={retireReason} id={`inventory-retire-${retireReason}`} />
                  <Label htmlFor={`inventory-retire-${retireReason}`} className="flex-1 cursor-pointer text-white">
                    {retireReason}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-slate-700 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:pb-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-600 text-white hover:bg-slate-800"
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleRetire}
            disabled={saving}
            className="bg-inventory text-white hover:bg-inventory-dark"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
            {saving ? 'Retiring...' : 'Retire Item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
