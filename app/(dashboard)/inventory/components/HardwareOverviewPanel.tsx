'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Boxes,
  ChevronDown,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  InventoryHardwareAdjustmentOperation,
  InventoryHardwareAdjustmentPayload,
  InventoryHardwareAdjustmentReason,
  InventoryHardwareBalance,
  InventoryHardwareItem,
  InventoryHardwareTransferPayload,
  InventoryLocation,
} from '../types';
import { INVENTORY_HARDWARE_ADJUSTMENT_REASONS } from '../types';
import { isInventoryYardLocation } from '../utils';
import {
  HardwareStockQuantityDialog,
  type HardwareStockQuantityDialogCopy,
} from './HardwareStockQuantityDialog';
import { HardwareTransferDialog } from './HardwareTransferDialog';
import { HardwareQuantityRow } from './HardwareQuantityRow';

interface HardwareOverviewPanelProps {
  items: InventoryHardwareItem[];
  balances: InventoryHardwareBalance[];
  locations: InventoryLocation[];
  onAdjust: (payload: InventoryHardwareAdjustmentPayload) => Promise<void>;
  onTransfer: (payload: InventoryHardwareTransferPayload) => Promise<void>;
}

interface HardwareStockEntryContext {
  source: 'item' | 'selection';
  items: InventoryHardwareItem[];
  copy: HardwareStockQuantityDialogCopy;
}

const ALL_LOCATIONS = 'all-locations';

export function HardwareOverviewPanel({
  items,
  balances,
  locations,
  onAdjust,
  onTransfer,
}: HardwareOverviewPanelProps) {
  const [search, setSearch] = useState('');
  const [yardZeroOnly, setYardZeroOnly] = useState(false);
  const [locationFilter, setLocationFilter] = useState(ALL_LOCATIONS);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [adjustmentOperation, setAdjustmentOperation] = useState<Exclude<InventoryHardwareAdjustmentOperation, 'add'> | null>(null);
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState<InventoryHardwareAdjustmentReason>('Used');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [stockEntry, setStockEntry] = useState<HardwareStockEntryContext | null>(null);

  const locationById = useMemo(() => {
    const mappedLocations = new Map(locations.map((location) => [location.id, location]));
    for (const balance of balances) {
      if (balance.location) mappedLocations.set(balance.location.id, balance.location);
    }
    return mappedLocations;
  }, [balances, locations]);

  const activeLocations = useMemo(
    () => [...locationById.values()]
      .filter((location) => location.is_active)
      .toSorted((a, b) => (
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        || a.id.localeCompare(b.id)
      )),
    [locationById],
  );

  const positiveBalancesByItem = useMemo(() => {
    const grouped = new Map<string, InventoryHardwareBalance[]>();
    for (const balance of balances) {
      if (balance.quantity <= 0) continue;
      const itemBalances = grouped.get(balance.hardware_item_id) || [];
      itemBalances.push(balance);
      grouped.set(balance.hardware_item_id, itemBalances);
    }
    for (const itemBalances of grouped.values()) {
      itemBalances.sort((a, b) => (
        (a.location?.name || locationById.get(a.location_id)?.name || '')
          .localeCompare(b.location?.name || locationById.get(b.location_id)?.name || '')
      ));
    }
    return grouped;
  }, [balances, locationById]);

  const activeItems = useMemo(
    () => items
      .filter((item) => item.is_active)
      .toSorted((a, b) => (
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        || a.id.localeCompare(b.id)
      )),
    [items],
  );

  const yardQuantityByItem = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const balance of balances) {
      const location = balance.location || locationById.get(balance.location_id);
      if (!isInventoryYardLocation(location)) continue;
      quantities.set(
        balance.hardware_item_id,
        (quantities.get(balance.hardware_item_id) || 0) + balance.quantity,
      );
    }
    return quantities;
  }, [balances, locationById]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeItems.filter((item) => {
      const itemBalances = positiveBalancesByItem.get(item.id) || [];
      if (yardZeroOnly && (yardQuantityByItem.get(item.id) || 0) > 0) return false;
      if (
        locationFilter !== ALL_LOCATIONS
        && !itemBalances.some((balance) => balance.location_id === locationFilter)
      ) {
        return false;
      }
      if (!query) return true;
      return item.name.toLowerCase().includes(query)
        || itemBalances.some((balance) => (
          (balance.location?.name || locationById.get(balance.location_id)?.name || '')
            .toLowerCase()
            .includes(query)
        ));
    });
  }, [
    activeItems,
    locationById,
    locationFilter,
    positiveBalancesByItem,
    search,
    yardQuantityByItem,
    yardZeroOnly,
  ]);

  const selectableBalances = useMemo(
    () => filteredItems.flatMap((item) => {
      if ((yardQuantityByItem.get(item.id) || 0) > 0) return [];
      return (positiveBalancesByItem.get(item.id) || []).filter((balance) => {
        const location = balance.location || locationById.get(balance.location_id);
        return !isInventoryYardLocation(location);
      });
    }),
    [filteredItems, locationById, positiveBalancesByItem, yardQuantityByItem],
  );

  const selectedBalances = useMemo(
    () => selectableBalances.filter((balance) => (
      selectedKeys.has(`${balance.hardware_item_id}:${balance.location_id}`)
    )),
    [selectableBalances, selectedKeys],
  );

  const allVisibleSelected = selectableBalances.length > 0 && selectableBalances.every((balance) => (
    selectedKeys.has(`${balance.hardware_item_id}:${balance.location_id}`)
  ));

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [locationFilter, search, yardZeroOnly]);

  function toggleExpandedItem(itemId: string) {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleBalance(balance: InventoryHardwareBalance, selected: boolean) {
    const key = `${balance.hardware_item_id}:${balance.location_id}`;
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAllVisible(selected: boolean) {
    setSelectedKeys(selected
      ? new Set(selectableBalances.map((balance) => `${balance.hardware_item_id}:${balance.location_id}`))
      : new Set());
  }

  function openItemStockEntry(item: InventoryHardwareItem) {
    setStockEntry({
      source: 'item',
      items: [item],
      copy: {
        title: 'Add stock',
        description: `Record incoming stock of ${item.name} at an active Inventory location.`,
        noteLabel: 'Delivery note',
        submitLabel: 'Add stock',
        submittingLabel: 'Adding stock...',
      },
    });
  }

  function openSelectedStockEntry() {
    const selectedItemIds = new Set(selectedBalances.map((balance) => balance.hardware_item_id));
    const selectedItems = activeItems.filter((item) => selectedItemIds.has(item.id));
    setStockEntry({
      source: 'selection',
      items: selectedItems,
      copy: {
        title: 'Add Hardware Quantity',
        description: `Add the same quantity to ${selectedItems.length} selected Hardware ${selectedItems.length === 1 ? 'item' : 'items'} at one active destination location.`,
        noteLabel: 'Note',
        submitLabel: 'Apply Adjustment',
        submittingLabel: 'Saving...',
      },
    });
  }

  function openAdjustment(operation: Exclude<InventoryHardwareAdjustmentOperation, 'add'>) {
    setAdjustmentOperation(operation);
    setAdjustmentQuantity('');
    setAdjustmentReason(operation === 'remove' ? 'Used' : 'Stocktake correction');
    setAdjustmentNote('');
  }

  async function submitAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!adjustmentOperation || selectedBalances.length === 0) return;
    const quantity = Number(adjustmentQuantity);
    const validQuantity = adjustmentOperation === 'recount' ? quantity >= 0 : quantity > 0;
    if (!Number.isInteger(quantity) || !validQuantity) return;
    if (adjustmentReason === 'Other' && !adjustmentNote.trim()) return;

    setIsAdjusting(true);
    try {
      await onAdjust({
        operation_type: adjustmentOperation,
        reason: adjustmentReason,
        note: adjustmentNote,
        lines: selectedBalances.map((balance) => ({
          item_id: balance.hardware_item_id,
          location_id: balance.location_id,
          quantity,
        })),
      });
      setAdjustmentOperation(null);
      setSelectedKeys(new Set());
    } finally {
      setIsAdjusting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-slate-700 bg-slate-900/70">
        <CardHeader className="border-b border-slate-700 bg-slate-950/40">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <Boxes className="h-5 w-5 text-inventory" />
                Hardware Stock
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                View company-wide quantities, replenish stock, reconcile balances, and transfer Hardware.
              </p>
            </div>
            <Button variant="outline" onClick={() => setTransferOpen(true)} className="border-slate-600">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Transfer Stock
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search Hardware or location..."
                className="border-slate-600 bg-slate-800 pl-9"
              />
            </div>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="border-slate-600 bg-slate-800" aria-label="Filter Hardware by location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_LOCATIONS}>All locations</SelectItem>
                {activeLocations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-slate-200">
              <Checkbox
                checked={yardZeroOnly}
                onCheckedChange={(checked) => setYardZeroOnly(checked === true)}
                aria-label="Show only items with zero Yard stock"
              />
              Yard stock = 0
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(checked) => toggleAllVisible(checked === true)}
              aria-label="Select all visible eligible Hardware balances"
            />
            <Badge variant="outline" className="border-slate-600 text-slate-200">
              {selectedBalances.length} selected
            </Badge>
            <Button size="sm" onClick={openSelectedStockEntry} disabled={selectedBalances.length === 0}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAdjustment('remove')} disabled={selectedBalances.length === 0}>
              Remove
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAdjustment('recount')} disabled={selectedBalances.length === 0}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Recount
            </Button>
            <span className="text-xs text-muted-foreground">
              Balance selection is available for positive non-Yard stock when Yard stock is zero.
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-700">
            {filteredItems.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {activeItems.length === 0
                  ? 'No active Hardware items have been configured.'
                  : 'No Hardware items match the current search and filters.'}
              </p>
            ) : (
              <div className="divide-y divide-slate-800">
                {filteredItems.map((item) => {
                  const itemBalances = positiveBalancesByItem.get(item.id) || [];
                  const visibleBalances = locationFilter === ALL_LOCATIONS
                    ? itemBalances
                    : itemBalances.filter((balance) => balance.location_id === locationFilter);
                  const total = itemBalances.reduce((sum, balance) => sum + balance.quantity, 0);
                  const yardQuantity = yardQuantityByItem.get(item.id) || 0;
                  const isExpanded = expandedItemIds.has(item.id);

                  return (
                    <div key={item.id}>
                      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleExpandedItem(item.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                          <span className="truncate font-semibold text-white">{item.name}</span>
                          {yardQuantity === 0 ? (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-200">
                              Yard zero
                            </Badge>
                          ) : null}
                          <Badge className="shrink-0 bg-inventory/15 text-inventory-light hover:bg-inventory/20">
                            {total.toLocaleString()} total
                          </Badge>
                        </button>
                        <Button size="sm" onClick={() => openItemStockEntry(item)}>
                          <PackagePlus className="mr-1 h-3.5 w-3.5" />
                          Add stock
                        </Button>
                      </div>
                      {isExpanded ? (
                        <div className="border-t border-slate-800 bg-slate-950/30 p-3 sm:pl-10">
                          {visibleBalances.length === 0 ? (
                            <p className="py-2 text-sm text-muted-foreground">
                              No positive stock is recorded{locationFilter === ALL_LOCATIONS ? '.' : ' at this location.'}
                            </p>
                          ) : (
                            <div
                              role="table"
                              aria-label={`Locations and quantities for ${item.name}`}
                              className="divide-y divide-slate-800 overflow-hidden rounded-md border border-slate-700"
                            >
                              {visibleBalances.map((balance) => {
                                const location = balance.location || locationById.get(balance.location_id);
                                const selectable = yardQuantity === 0 && !isInventoryYardLocation(location);
                                const key = `${item.id}:${balance.location_id}`;
                                return (
                                  <HardwareQuantityRow
                                    key={key}
                                    label={location?.name || 'Unknown location'}
                                    quantity={balance.quantity}
                                    showLocationIcon
                                    selected={selectedKeys.has(key)}
                                    selectionLabel={`Select ${item.name}, quantity ${balance.quantity}, at ${location?.name || 'Unknown location'}`}
                                    onSelectedChange={selectable ? (selected) => toggleBalance(balance, selected) : undefined}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={adjustmentOperation !== null} onOpenChange={(open) => { if (!open) setAdjustmentOperation(null); }}>
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              {adjustmentOperation === 'remove' ? 'Remove Hardware Quantity' : 'Recount Hardware Quantity'}
            </DialogTitle>
            <DialogDescription>
              This operation will apply to {selectedBalances.length} selected item/location {selectedBalances.length === 1 ? 'balance' : 'balances'}.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitAdjustment}>
            <div className="space-y-2">
              <Label htmlFor="hardware_adjustment_quantity">
                {adjustmentOperation === 'recount' ? 'New counted quantity' : 'Quantity'}
              </Label>
              <Input
                id="hardware_adjustment_quantity"
                type="number"
                min={adjustmentOperation === 'recount' ? 0 : 1}
                step={1}
                value={adjustmentQuantity}
                onChange={(event) => setAdjustmentQuantity(event.target.value)}
                className="border-slate-600 bg-slate-800"
              />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={adjustmentReason} onValueChange={(value) => setAdjustmentReason(value as InventoryHardwareAdjustmentReason)}>
                <SelectTrigger className="border-slate-600 bg-slate-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVENTORY_HARDWARE_ADJUSTMENT_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hardware_adjustment_note">
                Note {adjustmentReason === 'Other' ? '(required)' : '(optional)'}
              </Label>
              <Textarea
                id="hardware_adjustment_note"
                value={adjustmentNote}
                onChange={(event) => setAdjustmentNote(event.target.value)}
                className="border-slate-600 bg-slate-800"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdjustmentOperation(null)} disabled={isAdjusting}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  isAdjusting
                  || !adjustmentQuantity
                  || (adjustmentReason === 'Other' && !adjustmentNote.trim())
                }
              >
                {isAdjusting ? 'Saving...' : 'Apply Adjustment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <HardwareTransferDialog
        open={transferOpen}
        items={items}
        balances={balances}
        locations={activeLocations}
        onClose={() => setTransferOpen(false)}
        onSubmit={onTransfer}
      />

      {stockEntry ? (
        <HardwareStockQuantityDialog
          open
          items={stockEntry.items}
          knownLocations={activeLocations}
          copy={stockEntry.copy}
          allowReasonSelection={stockEntry.source === 'selection'}
          onClose={() => setStockEntry(null)}
          onSubmit={onAdjust}
          onSuccess={() => {
            if (stockEntry.source === 'selection') setSelectedKeys(new Set());
          }}
        />
      ) : null}
    </div>
  );
}
