'use client';

import { MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

interface HardwareQuantityRowProps {
  label: string;
  quantity: number;
  showLocationIcon?: boolean;
  selected?: boolean;
  selectionLabel?: string;
  onSelectedChange?: (selected: boolean) => void;
}

export function HardwareQuantityRow({
  label,
  quantity,
  showLocationIcon = false,
  selected = false,
  selectionLabel,
  onSelectedChange,
}: HardwareQuantityRowProps) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        {onSelectedChange ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelectedChange(checked === true)}
            aria-label={selectionLabel || `Select ${label}`}
          />
        ) : null}
        {showLocationIcon ? (
          <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-inventory" />
        ) : null}
        <span className="break-words text-sm text-slate-200">{label}</span>
      </div>
      <Badge className="shrink-0 bg-inventory/15 font-mono text-inventory-light hover:bg-inventory/20">
        {quantity.toLocaleString()}
      </Badge>
    </div>
  );
}
