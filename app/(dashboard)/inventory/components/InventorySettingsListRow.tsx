'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils/cn';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

interface InventorySettingsListRowProps {
  title: string;
  meta?: ReactNode;
  onEdit?: () => void;
  onRemove?: () => void;
  removeDisabled?: boolean;
  removeDisabledReason?: string;
  removeLabel?: string;
  className?: string;
  children?: ReactNode;
}

/** Compact settings/list row shared by Categories and Groups (and similar list panels): title primary, edit obvious, delete de-emphasised. */
export function InventorySettingsListRow({
  title,
  meta,
  onEdit,
  onRemove,
  removeDisabled = false,
  removeDisabledReason,
  removeLabel = 'Remove',
  className,
  children,
}: InventorySettingsListRowProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-start justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-800/40 px-3.5 py-3',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="break-words font-medium text-white">{title}</div>
        {meta ? <div className="mt-1 text-xs text-muted-foreground">{meta}</div> : null}
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onEdit ? (
          <Button size="sm" variant="outline" onClick={onEdit} className="h-11 border-slate-600 px-3">
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
        ) : null}
        {onRemove ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-11 w-11 border-slate-600 text-slate-300"
                aria-label={`More actions for ${title}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onRemove}
                disabled={removeDisabled}
                title={removeDisabled ? removeDisabledReason : undefined}
                className="text-red-300 focus:bg-red-500/10 focus:text-red-200"
              >
                <Trash2 className="h-4 w-4" />
                {removeLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
