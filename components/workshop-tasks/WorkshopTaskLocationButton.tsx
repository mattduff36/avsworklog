'use client';

import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { resolveWorkshopTaskAsset } from '@/lib/workshop-tasks/task-asset';

interface WorkshopTaskLocationButtonProps {
  task: {
    plant_id?: string | null;
    hgv_id?: string | null;
    van_id?: string | null;
  };
  onOpen: () => void;
  disabled?: boolean;
  className?: string;
  iconOnly?: boolean;
  variant?: 'outline' | 'ghost';
}

export function WorkshopTaskLocationButton({
  task,
  onOpen,
  disabled = false,
  className = '',
  iconOnly = false,
  variant = 'outline',
}: WorkshopTaskLocationButtonProps) {
  const asset = resolveWorkshopTaskAsset(task);
  return (
    <Button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (!asset) return;
        onOpen();
      }}
      disabled={disabled || !asset}
      size="sm"
      variant={variant}
      className={className}
      title="Location"
      aria-label="Location"
    >
      <MapPin className={`h-3.5 w-3.5 ${iconOnly ? '' : 'mr-1.5'}`} />
      {iconOnly ? null : 'Location'}
    </Button>
  );
}
