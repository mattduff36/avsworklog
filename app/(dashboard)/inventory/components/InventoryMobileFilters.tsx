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
  chips: InventoryMobileFilterChip[];
  hasAnyFilters: boolean;
  onClearAll: () => void;
  children: ReactNode;
  className?: string;
}

/** Mobile-only "Filters" trigger button + full-screen filter sheet, plus active filter chips row. */
export function InventoryMobileFilters({
  open,
  onOpenChange,
  title = 'Filters',
  activeFilterCount,
  chips,
  hasAnyFilters,
  onClearAll,
  children,
  className,
}: InventoryMobileFiltersProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="h-11 w-full justify-center border-slate-600 text-slate-200"
        data-testid="inventory-mobile-filters-trigger"
      >
        <SlidersHorizontal className="mr-2 h-4 w-4" />
        {title}
        {activeFilterCount > 0 ? (
          <span className="ml-2 rounded-full bg-inventory px-2 py-0.5 text-xs font-bold text-white">
            {activeFilterCount}
          </span>
        ) : null}
      </Button>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="inventory-mobile-filter-chips">
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
          {hasAnyFilters ? (
            <button
              type="button"
              onClick={onClearAll}
              className="min-h-9 rounded-full px-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

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
    </div>
  );
}
