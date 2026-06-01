'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronDown,
  ChevronUp,
  Archive,
  MapPin,
  PackageSearch,
  RotateCcw,
  Search,
  Truck,
} from 'lucide-react';
import {
  formatInventoryLocationOptionLabel,
  formatInventoryDate,
  getCheckStatusLabel,
  getInventoryCheckIntervalMonths,
  getInventoryCheckStatus,
  getInventoryDueDate,
} from '../utils';
import { formatInventoryCategoryLabel, type InventoryCheckStatus, type InventoryItem, type InventoryLocation, type InventoryRetireReason } from '../types';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';

type InventoryFilter = 'all' | InventoryCheckStatus | 'yard' | 'noloc';
type SortField = 'item_number' | 'serial_number' | 'name' | 'location' | 'last_checked_at';
type SortDir = 'asc' | 'desc';
const ALL_LOCATIONS_FILTER = 'all';

interface InventoryTableProps {
  items: InventoryItem[];
  selectedItemIds: Set<string>;
  onSelectedItemIdsChange: (selectedItemIds: Set<string>) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
  onRestore?: (item: InventoryItem) => void;
  onMove: (items: InventoryItem[]) => void;
  onBulkAction?: (items: InventoryItem[]) => void;
  bulkActionLabel?: string;
  onOpenDetails?: (item: InventoryItem) => void;
  locationFilterLocations?: InventoryLocation[];
  categoryLabels?: Record<string, string>;
  tableLabel?: string;
  showMinorPlantDetails?: boolean;
  retiredMode?: boolean;
}

const filters: Array<{ value: InventoryFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'due_soon', label: 'Due Soon' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'needs_check', label: 'Needs Check' },
  { value: 'yard', label: 'Yard' },
  { value: 'noloc', label: 'No Location' },
];

function getStatusBadgeClass(status: InventoryCheckStatus): string {
  if (status === 'overdue') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'due_soon') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'needs_check') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

function getRetireReasonBadgeClass(reason: InventoryRetireReason | null): string {
  if (reason === 'Sold' || reason === 'Returned') return 'border-green-500/30 bg-green-500/10 text-green-200';
  if (reason === 'Scrapped' || reason === 'Damaged') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (reason === 'Lost') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
}

function isNoLocationItem(item: InventoryItem): boolean {
  return !item.location_id;
}

function renderLocationWithHint(item: InventoryItem) {
  const isUnassigned = !item.location_id;
  const locationName = item.location?.name || 'No location assigned';
  if (!isNoLocationItem(item) || !item.source_location_hint) {
    return isUnassigned ? <span className="italic text-slate-400">{locationName}</span> : locationName;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`cursor-help underline decoration-slate-500 decoration-dotted underline-offset-4 ${isUnassigned ? 'italic text-slate-400' : ''}`}>
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
  );
}

function getVanLocationNickname(item: InventoryItem): string | null {
  if (item.location?.linked_asset_type !== 'van') return null;
  return item.location.linked_asset_nickname?.trim() || null;
}

function renderLocationDetails(item: InventoryItem) {
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

export function InventoryTable({
  items,
  selectedItemIds,
  onSelectedItemIdsChange,
  onEdit,
  onDelete,
  onRestore,
  onMove,
  onBulkAction,
  bulkActionLabel,
  onOpenDetails,
  locationFilterLocations,
  categoryLabels,
  tableLabel = 'inventory',
  showMinorPlantDetails = false,
  retiredMode = false,
}: InventoryTableProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InventoryFilter>('all');
  const [locationFilterId, setLocationFilterId] = useState(ALL_LOCATIONS_FILTER);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const showLocationFilter = Boolean(locationFilterLocations?.length);
  const showSerialNumberColumn = showMinorPlantDetails && items.some((item) => Boolean(item.minor_plant_detail?.serial_number));
  const paginationKey = `${filter}:${locationFilterId}:${search.trim()}:${sortField}:${sortDir}:${items.length}`;

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const locationName = item.location?.name || '';
      const linkedVanNickname = getVanLocationNickname(item) || '';
      const serialNumber = item.minor_plant_detail?.serial_number || '';
      const checkStatus = getInventoryCheckStatus(item);
      const retireReason = item.retire_reason || '';

      if (locationFilterId !== ALL_LOCATIONS_FILTER && item.location_id !== locationFilterId) return false;
      if (!retiredMode) {
        if (filter === 'yard' && locationName.toLowerCase() !== 'yard') return false;
        if (filter === 'noloc' && item.location_id) return false;
        if (filter !== 'all' && filter !== 'yard' && filter !== 'noloc' && checkStatus !== filter) return false;
      }

      if (!query) return true;
      return (
        item.item_number.toLowerCase().includes(query) ||
        serialNumber.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        locationName.toLowerCase().includes(query) ||
        linkedVanNickname.toLowerCase().includes(query) ||
        retireReason.toLowerCase().includes(query)
      );
    });

    return filtered.sort((a, b) => {
      const aValue = sortField === 'location'
        ? a.location?.name || ''
        : sortField === 'serial_number'
          ? a.minor_plant_detail?.serial_number || ''
          : retiredMode && sortField === 'last_checked_at'
            ? a.retired_at || ''
            : a[sortField] || '';
      const bValue = sortField === 'location'
        ? b.location?.name || ''
        : sortField === 'serial_number'
          ? b.minor_plant_detail?.serial_number || ''
          : retiredMode && sortField === 'last_checked_at'
            ? b.retired_at || ''
            : b[sortField] || '';
      const compare = String(aValue).localeCompare(String(bValue), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? compare : -compare;
    });
  }, [filter, items, locationFilterId, retiredMode, search, sortDir, sortField]);

  const {
    visibleItems,
    showMore,
  } = useLoadMorePagination(filteredItems, { resetKey: paginationKey });

  const selectedItems = useMemo(
    () => retiredMode ? [] : visibleItems.filter((item) => selectedItemIds.has(item.id)),
    [retiredMode, visibleItems, selectedItemIds]
  );

  useEffect(() => {
    if (retiredMode) return;
    const visibleItemIds = new Set(visibleItems.map((item) => item.id));
    const nextSelectedItemIds = new Set(
      Array.from(selectedItemIds).filter((itemId) => visibleItemIds.has(itemId))
    );

    if (nextSelectedItemIds.size !== selectedItemIds.size) {
      onSelectedItemIdsChange(nextSelectedItemIds);
    }
  }, [onSelectedItemIdsChange, retiredMode, selectedItemIds, visibleItems]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortField(field);
    setSortDir('asc');
  }

  function renderSortIcon(field: SortField) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="ml-1 inline h-3 w-3" />
      : <ChevronDown className="ml-1 inline h-3 w-3" />;
  }

  function toggleSelected(itemId: string, checked: boolean) {
    const next = new Set(selectedItemIds);
    if (checked) next.add(itemId);
    else next.delete(itemId);
    onSelectedItemIdsChange(next);
  }

  function toggleVisibleItems(checked: boolean) {
    const next = new Set(selectedItemIds);
    visibleItems.forEach((item) => {
      if (checked) next.add(item.id);
      else next.delete(item.id);
    });
    onSelectedItemIdsChange(next);
  }

  const allVisibleSelected = !retiredMode && visibleItems.length > 0 && visibleItems.every((item) => selectedItemIds.has(item.id));
  const emptyColSpan = (showSerialNumberColumn ? 8 : 7) - (retiredMode ? 1 : 0);

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${tableLabel}...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="bg-slate-800 border-slate-600 pl-9 text-white placeholder:text-muted-foreground"
          />
        </div>

        {selectedItems.length > 0 ? (
          <Button
            variant="outline"
            onClick={() => (onBulkAction || onMove)(selectedItems)}
            className="border-slate-600 text-white hover:bg-slate-800"
          >
            <Truck className="mr-2 h-4 w-4" />
            {bulkActionLabel || 'Move Selected'} ({selectedItems.length})
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        {!retiredMode ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Inventory Filters</p>
            <div className="flex flex-wrap gap-2">
              {filters.map((filterOption) => (
                <Button
                  key={filterOption.value}
                  variant={filter === filterOption.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(filterOption.value)}
                  className={filter === filterOption.value
                    ? 'bg-inventory text-white hover:bg-inventory-dark'
                    : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'
                  }
                >
                  {filterOption.label}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Retired Items</p>
            <p className="text-sm text-muted-foreground">Search retired inventory by ID, name, location, or retirement reason.</p>
          </div>
        )}

        {showLocationFilter ? (
          <div className="w-full space-y-2 lg:w-72">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Select Location Bin</p>
            <Select value={locationFilterId} onValueChange={setLocationFilterId}>
              <SelectTrigger className="border-slate-600 bg-slate-800 text-white">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_LOCATIONS_FILTER}>All</SelectItem>
                {(locationFilterLocations || []).map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {formatInventoryLocationOptionLabel(location)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-slate-700 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/80">
              {!retiredMode ? (
                <th className="w-10 px-4 py-3 text-left">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) => toggleVisibleItems(checked === true)}
                    aria-label="Select visible inventory items"
                  />
                </th>
              ) : null}
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('item_number')}>
                ID {renderSortIcon('item_number')}
              </th>
              {showSerialNumberColumn ? (
                <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('serial_number')}>
                  Serial Number {renderSortIcon('serial_number')}
                </th>
              ) : null}
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('name')}>
                Name {renderSortIcon('name')}
              </th>
              <th className="cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('location')}>
                Location {renderSortIcon('location')}
              </th>
              <th className="w-28 cursor-pointer px-4 py-3 text-left font-semibold text-muted-foreground hover:text-white" onClick={() => toggleSort('last_checked_at')}>
                {retiredMode ? 'Retired' : 'Last Checked'} {renderSortIcon('last_checked_at')}
              </th>
              <th className="w-36 px-4 py-3 text-left font-semibold text-muted-foreground">{retiredMode ? 'Reason' : 'Check Status'}</th>
              <th className="w-36 px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={emptyColSpan} className="py-12 text-center text-muted-foreground">
                  {search ? `No ${tableLabel} items match your search.` : `No ${tableLabel} items found.`}
                </td>
              </tr>
            ) : (
              visibleItems.map((item) => {
                const checkStatus = getInventoryCheckStatus(item);
                return (
                  <tr
                    key={item.id}
                    className={onOpenDetails ? 'cursor-pointer transition-colors hover:bg-slate-800/50' : 'transition-colors hover:bg-slate-800/50'}
                    onClick={() => onOpenDetails?.(item)}
                  >
                    {!retiredMode ? (
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedItemIds.has(item.id)}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                          aria-label={`Select ${item.name}`}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3 font-medium text-white">{item.item_number}</td>
                    {showSerialNumberColumn ? (
                      <td className="px-4 py-3 text-slate-300">{item.minor_plant_detail?.serial_number || 'Not recorded'}</td>
                    ) : null}
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{formatInventoryCategoryLabel(item.category, categoryLabels)}</div>
                      {item.group ? (
                        <Badge variant="outline" className="mt-1 border-purple-500/30 bg-purple-500/10 text-purple-200">
                          Group: {item.group.name}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{renderLocationDetails(item)}</td>
                    <td className="w-28 px-4 py-3 text-slate-300">
                      <div>{formatInventoryDate(retiredMode ? item.retired_at : item.last_checked_at)}</div>
                      {!retiredMode && item.last_checked_at ? (
                        <div className="whitespace-nowrap text-[11px] leading-4 text-muted-foreground">Due {getInventoryDueDate(item.last_checked_at, getInventoryCheckIntervalMonths(item))}</div>
                      ) : null}
                    </td>
                    <td className="w-36 px-4 py-3">
                      {retiredMode ? (
                        <Badge variant="outline" className={`whitespace-nowrap ${getRetireReasonBadgeClass(item.retire_reason)}`}>
                          {item.retire_reason || 'Other'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={`whitespace-nowrap ${getStatusBadgeClass(checkStatus)}`}>
                          {getCheckStatusLabel(checkStatus)}
                        </Badge>
                      )}
                    </td>
                    <td className="w-36 px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {!retiredMode ? (
                          <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onMove([item]); }} className="border-slate-600">
                            Move
                          </Button>
                        ) : null}
                        {!retiredMode && onEdit ? (
                          <Button size="sm" onClick={(event) => { event.stopPropagation(); onEdit(item); }} className="bg-inventory text-white hover:bg-inventory-dark">
                            Edit
                          </Button>
                        ) : null}
                        {retiredMode && onRestore ? (
                          <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onRestore(item); }} className="border-green-500/40 text-green-200 hover:bg-green-500/10">
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Restore
                          </Button>
                        ) : null}
                        {!retiredMode && onDelete ? (
                          <Button
                            onClick={(event) => { event.stopPropagation(); onDelete(item); }}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                            aria-label={`Retire ${item.name}`}
                            title="Retire item"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            {search ? `No ${tableLabel} items match your search.` : `No ${tableLabel} items found.`}
          </div>
        ) : (
          visibleItems.map((item) => {
            const checkStatus = getInventoryCheckStatus(item);
            return (
              <div
                key={item.id}
                className={onOpenDetails ? 'cursor-pointer rounded-lg border border-slate-700 bg-slate-800/50 p-4' : 'rounded-lg border border-slate-700 bg-slate-800/50 p-4'}
                onClick={() => onOpenDetails?.(item)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    {!retiredMode ? (
                      <Checkbox
                        checked={selectedItemIds.has(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                        aria-label={`Select ${item.name}`}
                      />
                    ) : null}
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-white">
                        <PackageSearch className="h-4 w-4 text-inventory" />
                        {item.name}
                      </div>
                      <div className="text-xs text-muted-foreground">{item.item_number}</div>
                      {showSerialNumberColumn ? (
                        <div className="text-xs text-muted-foreground">Serial: {item.minor_plant_detail?.serial_number || 'Not recorded'}</div>
                      ) : null}
                      {item.group ? (
                        <Badge variant="outline" className="mt-1 border-purple-500/30 bg-purple-500/10 text-purple-200">
                          Group: {item.group.name}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {retiredMode ? (
                    <Badge variant="outline" className={getRetireReasonBadgeClass(item.retire_reason)}>
                      {item.retire_reason || 'Other'}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className={getStatusBadgeClass(checkStatus)}>
                      {getCheckStatusLabel(checkStatus)}
                    </Badge>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <div className="flex items-start gap-1">
                    <MapPin className="mt-0.5 h-3 w-3" />
                    {renderLocationDetails(item)}
                  </div>
                  <span>{retiredMode ? 'Retired' : 'Last'}: {formatInventoryDate(retiredMode ? item.retired_at : item.last_checked_at)}</span>
                  {!retiredMode && item.last_checked_at ? (
                    <span>Due: {getInventoryDueDate(item.last_checked_at, getInventoryCheckIntervalMonths(item))}</span>
                  ) : null}
                </div>
                <div className="mt-4 flex gap-2">
                  {!retiredMode ? (
                    <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onMove([item]); }} className="flex-1 border-slate-600">
                      Move
                    </Button>
                  ) : null}
                  {!retiredMode && onEdit ? (
                    <Button size="sm" onClick={(event) => { event.stopPropagation(); onEdit(item); }} className="flex-1 bg-inventory text-white hover:bg-inventory-dark">
                      Edit
                    </Button>
                  ) : null}
                  {retiredMode && onRestore ? (
                    <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onRestore(item); }} className="flex-1 border-green-500/40 text-green-200 hover:bg-green-500/10">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Restore
                    </Button>
                  ) : null}
                  {!retiredMode && onDelete ? (
                    <Button
                      onClick={(event) => { event.stopPropagation(); onDelete(item); }}
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                      aria-label={`Retire ${item.name}`}
                      title="Retire item"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <LoadMorePagination
        visibleCount={visibleItems.length}
        totalCount={filteredItems.length}
        itemLabel="inventory items"
        onShowMore={showMore}
      />
    </div>
    </TooltipProvider>
  );
}
