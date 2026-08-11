'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { InventoryMoveCheckWarningPayload } from '@/lib/inventory/move-check-warning';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { getCheckStatusLabel } from '../utils';

interface InventoryMoveCheckWarningDialogProps {
  payload: InventoryMoveCheckWarningPayload | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function InventoryMoveCheckWarningDialog({
  payload,
  saving,
  onCancel,
  onConfirm,
}: InventoryMoveCheckWarningDialogProps) {
  return (
    <AlertDialog
      open={Boolean(payload)}
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <AlertDialogContent className="border-amber-500/30 bg-slate-950 text-white">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-300">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <div>
              <AlertDialogTitle>
                {payload?.warning_items.length === 1
                  ? 'This item needs a check'
                  : 'These items need checks'}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-1 text-slate-300">
                {payload?.warning_items.length === 1
                  ? 'Are you sure you want to move it anyway?'
                  : 'Are you sure you want to move them anyway?'}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <div className="max-h-56 space-y-2 overflow-y-auto" aria-label="Items needing inventory checks">
          {payload?.warning_items.map((item) => (
            <div key={item.id} className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="font-medium text-white">{item.name}</div>
              <div className="text-sm text-amber-100/80">
                {item.item_number} · {getCheckStatusLabel(item.check_status)}
              </div>
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-amber-500 text-slate-950 hover:bg-amber-400"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? 'Moving…' : 'Move anyway'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
