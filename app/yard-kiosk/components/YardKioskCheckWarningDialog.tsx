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
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getCheckStatusLabel } from '@/app/(dashboard)/inventory/utils';

interface YardKioskCheckWarningDialogProps {
  payload: InventoryMoveCheckWarningPayload | null;
  saving: boolean;
  enabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function YardKioskCheckWarningDialog({
  payload,
  saving,
  enabled,
  onCancel,
  onConfirm,
}: YardKioskCheckWarningDialogProps) {
  return (
    <AlertDialog
      open={enabled && Boolean(payload)}
      onOpenChange={(open) => {
        if (!open && !saving && enabled) onCancel();
      }}
    >
      <AlertDialogContent className="max-w-2xl border-amber-300/35 bg-slate-950 p-8 text-white">
        <AlertDialogHeader>
          <div className="flex items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-amber-300 text-slate-950">
              <AlertTriangle className="h-8 w-8" />
            </span>
            <div>
              <AlertDialogTitle className="text-2xl font-black">
                {payload?.warning_items.length === 1
                  ? 'This item needs a check'
                  : 'These items need checks'}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-2 text-base text-slate-300">
                {payload?.warning_items.length === 1
                  ? 'Are you sure you want to move it anyway?'
                  : 'Are you sure you want to move them anyway?'}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <div
          className="max-h-[40dvh] space-y-2 overflow-y-auto"
          aria-label="Items needing inventory checks"
        >
          {payload?.warning_items.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3"
            >
              <div className="text-lg font-black text-white">{item.name}</div>
              <div className="text-sm font-bold text-amber-100/80">
                {item.item_number} · {getCheckStatusLabel(item.check_status)}
              </div>
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving} className="h-14 px-6 text-base font-black">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="h-14 bg-amber-300 px-6 text-base font-black text-slate-950 hover:bg-amber-200"
          >
            {saving ? <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> : null}
            {saving ? 'Moving…' : 'Move anyway'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
