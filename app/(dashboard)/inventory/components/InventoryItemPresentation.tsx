'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  formatInventoryUnknownLocationAge,
  getInventoryCheckIntervalMonths,
  getInventoryDueDate,
  isInventoryCheckExempt,
  isInventoryYardLocation,
  isInventoryUnknownLocation,
  shouldMuteInventoryCheckBadge,
} from '../utils';
import type { InventoryCheckStatus, InventoryItem, InventoryRetireReason } from '../types';

/**
 * Shared item presentation helpers used by both the desktop table (InventoryTable.tsx)
 * and the mobile item card (InventoryMobileItemCard.tsx). Kept in a neutral module so
 * neither component needs to import the other.
 */

export function getStatusBadgeClass(status: InventoryCheckStatus, item?: InventoryItem): string {
  if (item && shouldMuteInventoryCheckBadge(item)) return 'border-slate-600/30 bg-slate-700/20 text-slate-300';
  if (status === 'overdue') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'due_soon') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'needs_check') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  if (status === 'not_required') return 'border-slate-700 bg-slate-800/30 text-slate-500';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

export function getRetireReasonBadgeClass(reason: InventoryRetireReason | null): string {
  if (reason === 'Sold' || reason === 'Returned') return 'border-green-500/30 bg-green-500/10 text-green-200';
  if (reason === 'Scrapped' || reason === 'Damaged') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (reason === 'Lost') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
}

function isNoLocationItem(item: InventoryItem): boolean {
  return !item.location_id;
}

export function getVanLocationNickname(item: InventoryItem): string | null {
  if (item.location?.linked_asset_type !== 'van') return null;
  return item.location.linked_asset_nickname?.trim() || null;
}

function renderLocationWithHint(item: InventoryItem) {
  const isUnassigned = !item.location_id;
  const isMutedLocation = isUnassigned || isInventoryUnknownLocation(item.location);
  const locationName = item.location?.name || 'No location assigned';
  if (!isNoLocationItem(item) || !item.source_location_hint) {
    return isMutedLocation ? <span className="italic text-slate-400">{locationName}</span> : locationName;
  }

  return (
    <>
      <span className="hidden md:inline">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`cursor-help underline decoration-slate-500 decoration-dotted underline-offset-4 ${isMutedLocation ? 'italic text-slate-400' : ''}`}>
              {locationName}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs space-y-1">
            <div className="font-medium text-white">Spreadsheet location</div>
            <div>{item.source_location_hint}</div>
            {item.source_location_rows ? (
              <div className="text-[11px] text-slate-300">COMPLETE LIST row(s): {item.source_location_rows}</div>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </span>
      <details
        className="min-w-0 md:hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <summary className={`flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-1 pr-2 underline decoration-slate-500 decoration-dotted underline-offset-4 ${isMutedLocation ? 'italic text-slate-400' : ''}`}>
          <span className="break-words">{locationName}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-inventory-light">
            View hint
          </span>
        </summary>
        <div className="mt-1 rounded-md border border-slate-600 bg-slate-950/60 p-2 not-italic text-slate-200">
          <div className="font-medium">Spreadsheet location</div>
          <div className="mt-1 break-words">{item.source_location_hint}</div>
          {item.source_location_rows ? (
            <div className="mt-1 text-[11px] text-slate-400">COMPLETE LIST row(s): {item.source_location_rows}</div>
          ) : null}
        </div>
      </details>
    </>
  );
}

export function renderLocationDetails(item: InventoryItem) {
  const linkedVanNickname = getVanLocationNickname(item);

  return (
    <div>
      <div>{renderLocationWithHint(item)}</div>
      {linkedVanNickname ? (
        <div className="text-xs text-muted-foreground">{linkedVanNickname}</div>
      ) : null}
    </div>
  );
}

export function renderCheckDueDetails(item: InventoryItem) {
  if (isInventoryCheckExempt(item)) {
    return formatInventoryUnknownLocationAge(item) || 'No check required';
  }

  if (!item.last_checked_at) {
    return isInventoryYardLocation(item.location) ? 'Check required before leaving Yard' : null;
  }

  const dueText = `Due ${getInventoryDueDate(item.last_checked_at, getInventoryCheckIntervalMonths(item))}`;
  return isInventoryYardLocation(item.location) ? `${dueText} - required before leaving Yard` : dueText;
}
