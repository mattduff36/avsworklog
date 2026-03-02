'use client';

import { useEffect, useState } from 'react';
import { AddAssetTypeDialog } from './AddAssetTypeDialog';
import { AddVanDialog } from './AddVanDialog';
import { AddPlantDialog } from './AddPlantDialog';
import { AddHgvDialog } from './AddHgvDialog';
import type { NewAssetType } from './utils';

interface AddAssetFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
  initialAssetType?: NewAssetType | null;
}

export function AddAssetFlowDialog({
  open,
  onOpenChange,
  onSuccess,
  initialAssetType = null,
}: AddAssetFlowDialogProps) {
  const [selectedType, setSelectedType] = useState<NewAssetType | null>(initialAssetType);

  useEffect(() => {
    queueMicrotask(() => {
      if (open) {
        setSelectedType(initialAssetType);
      } else {
        setSelectedType(null);
      }
    });
  }, [open, initialAssetType]);

  function handleCloseAll() {
    setSelectedType(null);
    onOpenChange(false);
  }

  return (
    <>
      <AddAssetTypeDialog
        open={open && !selectedType}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) handleCloseAll();
        }}
        onSelectType={(type) => setSelectedType(type)}
      />
      <AddVanDialog open={open && selectedType === 'van'} onOpenChange={handleCloseAll} onSuccess={onSuccess} />
      <AddPlantDialog open={open && selectedType === 'plant'} onOpenChange={handleCloseAll} onSuccess={onSuccess} />
      <AddHgvDialog open={open && selectedType === 'hgv'} onOpenChange={handleCloseAll} onSuccess={onSuccess} />
    </>
  );
}

