'use client';

import { MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { InventoryLocation } from '../types';
import { getInventoryLocationTypePresentation } from '../utils';
import { InventoryMoveButton } from './InventoryMoveButton';

interface HardwareQuantityRowProps {
  label: string;
  quantity: number;
  showLocationIcon?: boolean;
  selected?: boolean;
  selectionLabel?: string;
  onSelectedChange?: (selected: boolean) => void;
  onMove?: () => void;
  location?: Pick<InventoryLocation, 'location_type'>;
}

export function HardwareQuantityRow({
  label,
  quantity,
  showLocationIcon = false,
  selected = false,
  selectionLabel,
  onSelectedChange,
  onMove,
  location,
}: HardwareQuantityRowProps) {
  const presentation = location ? getInventoryLocationTypePresentation(location) : null;

  return (
    <div
      data-location-type={location?.location_type}
      className={cn(
        'flex min-h-11 items-center justify-between gap-4 border-l-2 border-transparent px-3 py-2 transition-colors',
        presentation?.surfaceClassName,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {onSelectedChange ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelectedChange(checked === true)}
            aria-label={selectionLabel || `Select ${label}`}
          />
        ) : null}
        {showLocationIcon ? (
          <MapPin
            aria-hidden="true"
            className={cn('h-3.5 w-3.5 shrink-0 text-inventory', presentation?.iconClassName)}
          />
        ) : null}
        <span className="break-words text-sm text-slate-200">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge className="bg-inventory/15 font-mono text-inventory-light hover:bg-inventory/20">
          {quantity.toLocaleString()}
        </Badge>
        {onMove ? <InventoryMoveButton onMove={onMove} /> : null}
      </div>
    </div>
  );
}
