'use client';

import type { MouseEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils/cn';
import { Archive, MapPin, MoreHorizontal, PackageSearch, RotateCcw } from 'lucide-react';
import type { InventoryCheckStatus, InventoryItem } from '../types';
import { formatInventoryCategoryLabel } from '../types';
import { formatInventoryDate, getInventoryCheckStatus, getCheckStatusLabel, shouldMuteInventoryCheckBadge } from '../utils';
import {
  getRetireReasonBadgeClass,
  getStatusBadgeClass,
  renderCheckDueDetails,
  renderLocationDetails,
} from './InventoryItemPresentation';

/** Same restrained "full tinted border" grammar used by Location cards; only communicates when it's useful (overdue/due soon/needs check). */
const STATUS_SURFACE_CLASSNAME: Record<InventoryCheckStatus, string> = {
  overdue: 'border-red-500/25 bg-red-500/[0.04]',
  due_soon: 'border-amber-500/25 bg-amber-500/[0.04]',
  needs_check: 'border-blue-500/25 bg-blue-500/[0.04]',
  not_required: 'border-slate-700/70 bg-slate-900/50',
  ok: 'border-slate-700/70 bg-slate-900/50',
};

interface InventoryMobileItemCardProps {
  item: InventoryItem;
  categoryLabels?: Record<string, string>;
  showSerialNumber?: boolean;
  retiredMode?: boolean;
  selected?: boolean;
  onToggleSelected?: (checked: boolean) => void;
  onOpenDetails?: (item: InventoryItem) => void;
  onMove?: (item: InventoryItem) => void;
  onRetire?: (item: InventoryItem) => void;
  onRestore?: (item: InventoryItem) => void;
}

export function InventoryMobileItemCard({
  item,
  categoryLabels,
  showSerialNumber = false,
  retiredMode = false,
  selected = false,
  onToggleSelected,
  onOpenDetails,
  onMove,
  onRetire,
  onRestore,
}: InventoryMobileItemCardProps) {
  const checkStatus = getInventoryCheckStatus(item);
  const isMuted = shouldMuteInventoryCheckBadge(item);
  const surfaceClassName = retiredMode || isMuted
    ? 'border-slate-700/70 bg-slate-900/50'
    : STATUS_SURFACE_CLASSNAME[checkStatus];
  const checkDueDetails = !retiredMode ? renderCheckDueDetails(item) : null;
  const metaParts = [
    item.item_number,
    showSerialNumber ? `SN ${item.minor_plant_detail?.serial_number || 'Not recorded'}` : null,
    formatInventoryCategoryLabel(item.category, categoryLabels),
    item.group ? item.group.name : null,
  ].filter(Boolean);

  function stop(event: MouseEvent) {
    event.stopPropagation();
  }

  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border p-3.5 transition-colors',
        surfaceClassName,
        onOpenDetails && 'cursor-pointer active:brightness-110',
      )}
      onClick={onOpenDetails ? () => onOpenDetails(item) : undefined}
      data-testid="inventory-mobile-item-card"
    >
      <div className="flex items-start gap-3">
        {!retiredMode && onToggleSelected ? (
          <Checkbox
            checked={selected}
            onClick={stop}
            onCheckedChange={(checked) => onToggleSelected(checked === true)}
            aria-label={`Select ${item.name}`}
            className="mt-1"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            {onOpenDetails ? (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); onOpenDetails(item); }}
                className="min-w-0 flex-1 break-words text-left text-[15px] font-semibold leading-snug text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory"
                aria-label={`Open ${item.name} details`}
              >
                {item.name}
              </button>
            ) : (
              <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug text-white">{item.name}</span>
            )}
            {retiredMode ? (
              <Badge variant="outline" className={cn('shrink-0 whitespace-nowrap text-[10px]', getRetireReasonBadgeClass(item.retire_reason))}>
                {item.retire_reason || 'Other'}
              </Badge>
            ) : (
              <Badge variant="outline" className={cn('shrink-0 whitespace-nowrap text-[10px]', getStatusBadgeClass(checkStatus, item))}>
                {getCheckStatusLabel(checkStatus)}
              </Badge>
            )}
          </div>

          <div className="ml-6 mt-0.5 truncate text-xs text-muted-foreground">
            {metaParts.join(' · ')}
          </div>

          <div className="ml-6 mt-1.5 flex min-w-0 items-start gap-1.5 text-sm text-slate-300">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
            <div className="min-w-0 break-words">{renderLocationDetails(item)}</div>
          </div>

          <div className="ml-6 mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {retiredMode
              ? `Retired ${formatInventoryDate(item.retired_at)}`
              : (
                <>
                  Last checked {formatInventoryDate(item.last_checked_at)}
                  {checkDueDetails ? <> · {checkDueDetails}</> : null}
                </>
              )}
          </div>

          <div className="ml-6 mt-3 flex items-center gap-2">
            {!retiredMode && onMove ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(event) => { event.stopPropagation(); onMove(item); }}
                className="h-11 flex-1 min-w-0 border-slate-600 justify-center"
              >
                Move
              </Button>
            ) : null}

            {retiredMode && onRestore ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(event) => { event.stopPropagation(); onRestore(item); }}
                className="h-11 flex-1 min-w-0 justify-center border-green-500/40 text-green-200 hover:bg-green-500/10"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Restore
              </Button>
            ) : null}

            {!retiredMode && onRetire ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={stop}
                    className="h-11 w-11 shrink-0 border-slate-600 text-slate-300"
                    aria-label={`More actions for ${item.name}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={stop}>
                  <DropdownMenuItem
                    onClick={(event) => { event.stopPropagation(); onRetire(item); }}
                    className="text-red-300 focus:bg-red-500/10 focus:text-red-200"
                  >
                    <Archive className="h-4 w-4" />
                    Retire item
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
