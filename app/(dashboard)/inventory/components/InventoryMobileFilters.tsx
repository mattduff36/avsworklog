'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollArea,
  DialogTitle,
  dialogContentViewportClassName,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import { SlidersHorizontal, X } from 'lucide-react';

export interface InventoryMobileFilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

interface InventoryMobileFiltersProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  activeFilterCount: number;
  hasAnyFilters: boolean;
  onClearAll: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Compact "Filters" icon button (near-square touch target) meant to sit beside a search input
 * on one row. Opens a full-screen mobile filter sheet. Use InventoryMobileFilterChips separately
 * to render active-filter chips only when filters are actually active.
 */
export function InventoryMobileFilters({
  open,
  onOpenChange,
  title = 'Filters',
  activeFilterCount,
  hasAnyFilters,
  onClearAll,
  children,
  className,
}: InventoryMobileFiltersProps) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(true)}
        aria-label="Filters"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn('relative h-11 w-11 shrink-0 border-slate-600 p-0 text-slate-300', className)}
        data-testid="inventory-mobile-filters-trigger"
      >
        <SlidersHorizontal className="h-4 w-4" />
        {activeFilterCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-inventory px-1 text-[10px] font-bold text-white">
            {activeFilterCount}
          </span>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          mobileKeyboardSafe
          className={dialogContentViewportClassName({
            scroll: 'content',
            className: 'border border-border bg-slate-950 p-0 text-white sm:max-w-md',
          })}
        >
          <DialogHeader className="border-b border-slate-800 p-4 pr-12">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">Refine the current list using the filters below.</DialogDescription>
          </DialogHeader>
          <DialogScrollArea className="space-y-4 p-4">
            {children}
          </DialogScrollArea>
          <div className="flex items-center justify-between gap-3 border-t border-slate-800 p-4">
            <Button
              type="button"
              variant="ghost"
              onClick={onClearAll}
              disabled={!hasAnyFilters}
              className="h-11 text-muted-foreground"
            >
              Reset filters
            </Button>
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-11 flex-1 bg-inventory text-white hover:bg-inventory-dark"
            >
              Show results
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface InventoryMobileFilterChipsProps {
  chips: InventoryMobileFilterChip[];
  onClearAll: () => void;
  className?: string;
}

/** Active-filter chip row. Renders nothing (reserves no space) when there are no chips. */
export function InventoryMobileFilterChips({ chips, onClearAll, className }: InventoryMobileFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="inventory-mobile-filter-chips">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={chip.onRemove}
          className="flex min-h-9 items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800/70 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory"
        >
          <span className="max-w-[10rem] truncate">{chip.label}</span>
          <X className="h-3 w-3 shrink-0" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="min-h-9 rounded-full px-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory"
      >
        Clear all
      </button>
    </div>
  );
}
