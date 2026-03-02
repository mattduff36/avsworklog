'use client';

import { Truck, HardHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnceDialog } from '@/components/ui/once-ui';
import type { NewAssetType } from './utils';

interface AddAssetTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectType: (type: NewAssetType) => void;
}

export function AddAssetTypeDialog({ open, onOpenChange, onSelectType }: AddAssetTypeDialogProps) {
  return (
    <OnceDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add New Asset"
      description="Select which asset type you want to create."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Button
          type="button"
          variant="outline"
          className="h-24 border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
          onClick={() => onSelectType('van')}
        >
          <span className="flex flex-col items-center gap-2">
            <Truck className="h-5 w-5 text-blue-400" />
            Van
          </span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-24 border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
          onClick={() => onSelectType('plant')}
        >
          <span className="flex flex-col items-center gap-2">
            <HardHat className="h-5 w-5 text-orange-400" />
            Plant
          </span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-24 border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
          onClick={() => onSelectType('hgv')}
        >
          <span className="flex flex-col items-center gap-2">
            <Truck className="h-5 w-5 text-emerald-400" />
            HGV
          </span>
        </Button>
      </div>
    </OnceDialog>
  );
}

