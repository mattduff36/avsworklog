'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, PackagePlus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  InventoryHardwareAdjustmentOperation,
  InventoryHardwareAdjustmentPayload,
  InventoryHardwareAdjustmentReason,
  InventoryHardwareBalance,
  InventoryHardwareItem,
  InventoryLocation,
} from '../types';
import { INVENTORY_HARDWARE_ADJUSTMENT_REASONS } from '../types';
import { getInventoryLocationTypePresentation, isInventoryYardLocation } from '../utils';
import {
  HardwareStockQuantityDialog,
  type HardwareStockQuantityDialogCopy,
} from './HardwareStockQuantityDialog';
import { InventoryLocationSelect } from './InventoryLocationSelect';

interface HardwareStockPanelProps {
  items: InventoryHardwareItem[];
  balances: InventoryHardwareBalance[];
  locations: InventoryLocation[];
  onAdjust: (payload: InventoryHardwareAdjustmentPayload) => Promise<void>;
}

interface MatrixBalance {
  key: string;
  item: InventoryHardwareItem;
  balance: InventoryHardwareBalance;
  location: InventoryLocation;
}

interface StockEntry {
  items: InventoryHardwareItem[];
  copy: HardwareStockQuantityDialogCopy;
}

const ALL_ITEMS = 'all-items';
const ALL_LOCATIONS = 'all-locations';

const ITEM_STOCK_COPY: HardwareStockQuantityDialogCopy = {
  title: 'Add stock',
  description: 'Record incoming stock at an active Inventory location.',
  noteLabel: 'Delivery note',
  submitLabel: 'Add stock',
  submittingLabel: 'Adding stock...',
};

export function HardwareStockPanel({
  items,
  balances,
  locations,
  onAdjust,
}: HardwareStockPanelProps) {
  const [itemFilter, setItemFilter] = useState(ALL_ITEMS);
  const [locationFilter, setLocationFilter] = useState(ALL_LOCATIONS);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [stockEntry, setStockEntry] = useState<StockEntry | null>(null);
  const [adjustmentOperation, setAdjustmentOperation] = useState<Exclude<InventoryHardwareAdjustmentOperation, 'add'> | null>(null);
  const [adjustmentItem, setAdjustmentItem] = useState<InventoryHardwareItem | null>(null);
  const [adjustmentLocationId, setAdjustmentLocationId] = useState('');
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState<InventoryHardwareAdjustmentReason>('Used');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);

  const locationById = useMemo(() => {
    const mapped = new Map(locations.map((location) => [location.id, location]));
    for (const balance of balances) {
      if (balance.location) mapped.set(balance.location.id, balance.location);
    }
    return mapped;
  }, [balances, locations]);

  const activeItems = useMemo(
    () => items
      .filter((item) => item.is_active)
      .toSorted((a, b) => (
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        || a.id.localeCompare(b.id)
      )),
    [items],
  );

  const activeItemById = useMemo(
    () => new Map(activeItems.map((item) => [item.id, item])),
    [activeItems],
  );

  const positiveBalances = useMemo(() => balances.flatMap((balance): MatrixBalance[] => {
    const item = activeItemById.get(balance.hardware_item_id);
    const location = balance.location || locationById.get(balance.location_id);
    if (
      !item
      || balance.quantity < 1
      || !location?.is_active
    ) {
      return [];
    }
    return [{
      key: `${item.id}:${location.id}`,
      item,
      balance,
      location,
    }];
  }).toSorted((a, b) => (
    a.item.name.localeCompare(b.item.name, undefined, { sensitivity: 'base' })
    || a.location.name.localeCompare(b.location.name, undefined, { sensitivity: 'base' })
  )), [activeItemById, balances, locationById]);

  const stockLocations = useMemo(
    () => [...new Map(positiveBalances.map((entry) => [entry.location.id, entry.location])).values()]
      .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [positiveBalances],
  );

  const positiveBalancesByItem = useMemo(() => {
    const grouped = new Map<string, MatrixBalance[]>();
    for (const entry of positiveBalances) {
      const itemBalances = grouped.get(entry.item.id) || [];
      itemBalances.push(entry);
      grouped.set(entry.item.id, itemBalances);
    }
    return grouped;
  }, [positiveBalances]);

  const visibleItems = useMemo(
    () => activeItems.filter((item) => itemFilter === ALL_ITEMS || item.id === itemFilter),
    [activeItems, itemFilter],
  );

  const visibleBalances = useMemo(
    () => positiveBalances.filter((entry) => (
      visibleItems.some((item) => item.id === entry.item.id)
      && (locationFilter === ALL_LOCATIONS || entry.location.id === locationFilter)
    )),
    [locationFilter, positiveBalances, visibleItems],
  );

  const visibleBalancesByItem = useMemo(() => {
    const grouped = new Map<string, MatrixBalance[]>();
    for (const entry of visibleBalances) {
      const itemBalances = grouped.get(entry.item.id) || [];
      itemBalances.push(entry);
      grouped.set(entry.item.id, itemBalances);
    }
    return grouped;
  }, [visibleBalances]);

  const adjustmentLocationOptions = useMemo(() => {
    if (!adjustmentItem || !adjustmentOperation) return [];
    if (adjustmentOperation === 'remove') {
      return (positiveBalancesByItem.get(adjustmentItem.id) || []).map((entry) => entry.location);
    }
    return [...locationById.values()]
      .filter((location) => location.is_active)
      .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [adjustmentItem, adjustmentOperation, locationById, positiveBalancesByItem]);

  const selectedAdjustmentBalance = adjustmentItem
    ? (positiveBalancesByItem.get(adjustmentItem.id) || [])
      .find((entry) => entry.location.id === adjustmentLocationId)
    : undefined;

  function toggleExpandedItem(itemId: string) {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function openAdjustment(
    operation: Exclude<InventoryHardwareAdjustmentOperation, 'add'>,
    item: InventoryHardwareItem,
  ) {
    const itemBalances = positiveBalancesByItem.get(item.id) || [];
    const filteredLocation = locationFilter === ALL_LOCATIONS
      ? null
      : locationById.get(locationFilter) || null;
    const defaultLocation = operation === 'remove'
      ? itemBalances.find((entry) => entry.location.id === filteredLocation?.id)?.location
        || itemBalances[0]?.location
      : filteredLocation
        || itemBalances[0]?.location
        || [...locationById.values()].find((location) => (
          location.is_active && isInventoryYardLocation(location)
        ))
        || [...locationById.values()].find((location) => location.is_active);

    setAdjustmentItem(item);
    setAdjustmentOperation(operation);
    setAdjustmentLocationId(defaultLocation?.id || '');
    setAdjustmentQuantity('');
    setAdjustmentReason(operation === 'remove' ? 'Used' : 'Stocktake correction');
    setAdjustmentNote('');
  }

  function closeAdjustment() {
    if (isAdjusting) return;
    setAdjustmentOperation(null);
    setAdjustmentItem(null);
    setAdjustmentLocationId('');
  }

  async function submitAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!adjustmentOperation || !adjustmentItem || !adjustmentLocationId) return;
    const quantity = Number(adjustmentQuantity);
    const validQuantity = adjustmentOperation === 'recount'
      ? quantity >= 0
      : quantity > 0 && quantity <= (selectedAdjustmentBalance?.balance.quantity || 0);
    if (!Number.isInteger(quantity) || !validQuantity) return;
    if (adjustmentReason === 'Other' && !adjustmentNote.trim()) return;

    setIsAdjusting(true);
    try {
      await onAdjust({
        operation_type: adjustmentOperation,
        reason: adjustmentReason,
        note: adjustmentNote,
        lines: [{
          item_id: adjustmentItem.id,
          location_id: adjustmentLocationId,
          quantity,
        }],
      });
      setAdjustmentOperation(null);
      setAdjustmentItem(null);
      setAdjustmentLocationId('');
    } finally {
      setIsAdjusting(false);
    }
  }

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader className="border-b border-slate-700">
        <CardTitle className="text-white">Hardware Stock Matrix</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          All active Hardware items. Expand an item to review positive stock by location.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Select value={itemFilter} onValueChange={setItemFilter}>
            <SelectTrigger className="border-slate-600 bg-slate-800" aria-label="Filter Hardware item">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ITEMS}>All Hardware items</SelectItem>
              {activeItems.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="border-slate-600 bg-slate-800" aria-label="Filter stock location">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_LOCATIONS}>All positive stock locations</SelectItem>
              {stockLocations.map((location) => (
                <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-700">
          <Table className="min-w-[900px] table-fixed">
            <TableCaption className="sr-only">All active Hardware items</TableCaption>
            <TableHeader className="sticky top-0 z-10 bg-slate-900">
              <TableRow className="border-slate-700">
                <TableHead className="w-[55%]">Hardware item</TableHead>
                <TableHead className="w-[15%] text-center">Total</TableHead>
                <TableHead className="w-[30%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((item) => {
                const itemBalances = visibleBalancesByItem.get(item.id) || [];
                const total = itemBalances.reduce((sum, entry) => sum + entry.balance.quantity, 0);
                const hasPositiveStock = (positiveBalancesByItem.get(item.id)?.length || 0) > 0;
                const isExpanded = expandedItemIds.has(item.id);
                const detailsId = `hardware-matrix-details-${item.id}`;
                return (
                  <Fragment key={item.id}>
                    <TableRow className="border-slate-800">
                      <TableCell className="p-0">
                        <button
                          type="button"
                          aria-controls={detailsId}
                          aria-expanded={isExpanded}
                          onClick={() => toggleExpandedItem(item.id)}
                          className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left font-semibold text-white"
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                          <span className="break-words">{item.name}</span>
                        </button>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-center font-mono font-semibold text-white">
                        {total.toLocaleString()}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            className="bg-inventory text-white hover:bg-inventory-dark"
                            onClick={() => setStockEntry({
                              items: [item],
                              copy: {
                                ...ITEM_STOCK_COPY,
                                description: `Record incoming stock of ${item.name} at an active Inventory location.`,
                              },
                            })}
                            aria-label={`Add ${item.name} stock`}
                          >
                            <PackagePlus className="mr-1 h-3.5 w-3.5" />
                            Add
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!hasPositiveStock}
                            onClick={() => openAdjustment('remove', item)}
                            aria-label={`Remove ${item.name} stock`}
                          >
                            Remove
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAdjustment('recount', item)}
                            aria-label={`Recount ${item.name} stock`}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            Recount
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <TableRow id={detailsId} className="border-slate-700 bg-slate-950/30 hover:bg-slate-950/30">
                        <TableCell colSpan={3} className="p-3 sm:pl-9">
                          {itemBalances.length === 0 ? (
                            <p className="py-2 text-sm text-muted-foreground">
                              No positive stock is currently held.
                            </p>
                          ) : (
                            <div className="overflow-hidden rounded-md border border-slate-700">
                              <Table>
                                <TableCaption className="sr-only">
                                  Location balances for {item.name}
                                </TableCaption>
                                <TableHeader className="bg-slate-950/50">
                                  <TableRow className="border-slate-700">
                                    <TableHead>Location</TableHead>
                                    <TableHead className="w-28 text-right">Quantity</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {itemBalances.map((entry) => {
                                    const presentation = getInventoryLocationTypePresentation(entry.location);
                                    return (
                                      <TableRow
                                        key={entry.key}
                                        data-location-type={entry.location.location_type}
                                        className={cn(
                                          'border-l-2 border-slate-800 transition-colors',
                                          presentation.surfaceClassName,
                                        )}
                                      >
                                        <TableCell className="text-slate-200">{entry.location.name}</TableCell>
                                        <TableCell className="text-right font-mono font-semibold text-white">
                                          {entry.balance.quantity.toLocaleString()}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
              {visibleItems.length === 0 ? (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    No Hardware items match the current filter.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog
        open={adjustmentOperation !== null && adjustmentItem !== null}
        onOpenChange={(open) => {
          if (!open) closeAdjustment();
        }}
      >
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              {adjustmentOperation === 'remove' ? 'Remove' : 'Recount'} {adjustmentItem?.name} stock
            </DialogTitle>
            <DialogDescription>
              {adjustmentOperation === 'remove'
                ? 'Remove stock from one location.'
                : 'Set the counted stock level at one location.'}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitAdjustment}>
            <div className="space-y-2">
              <Label>Location</Label>
              <InventoryLocationSelect
                value={adjustmentLocationId}
                onValueChange={setAdjustmentLocationId}
                locations={adjustmentLocationOptions}
                serverSearch={adjustmentOperation === 'recount'}
                ariaLabel="Adjustment location"
                searchPlaceholder="Search locations..."
              />
              {adjustmentOperation === 'remove' && selectedAdjustmentBalance ? (
                <p className="text-xs text-muted-foreground">
                  Available: {selectedAdjustmentBalance.balance.quantity.toLocaleString()}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="hardware_matrix_adjustment_quantity">
                {adjustmentOperation === 'recount' ? 'New counted quantity' : 'Quantity'}
              </Label>
              <Input
                id="hardware_matrix_adjustment_quantity"
                type="number"
                min={adjustmentOperation === 'recount' ? 0 : 1}
                max={adjustmentOperation === 'remove'
                  ? selectedAdjustmentBalance?.balance.quantity
                  : undefined}
                step={1}
                value={adjustmentQuantity}
                onChange={(event) => setAdjustmentQuantity(event.target.value)}
                className="border-slate-600 bg-slate-800"
              />
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select
                value={adjustmentReason}
                onValueChange={(value) => setAdjustmentReason(value as InventoryHardwareAdjustmentReason)}
              >
                <SelectTrigger className="border-slate-600 bg-slate-800"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVENTORY_HARDWARE_ADJUSTMENT_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hardware_matrix_adjustment_note">
                Note {adjustmentReason === 'Other' ? '(required)' : '(optional)'}
              </Label>
              <Textarea
                id="hardware_matrix_adjustment_note"
                value={adjustmentNote}
                onChange={(event) => setAdjustmentNote(event.target.value)}
                className="border-slate-600 bg-slate-800"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeAdjustment} disabled={isAdjusting}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-inventory text-white hover:bg-inventory-dark"
                disabled={
                  isAdjusting
                  || !adjustmentLocationId
                  || !adjustmentQuantity
                  || (adjustmentReason === 'Other' && !adjustmentNote.trim())
                }
              >
                {isAdjusting
                  ? 'Saving...'
                  : adjustmentOperation === 'remove'
                    ? 'Remove stock'
                    : 'Save recount'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {stockEntry ? (
        <HardwareStockQuantityDialog
          open
          items={stockEntry.items}
          knownLocations={locations}
          copy={stockEntry.copy}
          onClose={() => setStockEntry(null)}
          onSubmit={onAdjust}
        />
      ) : null}
    </Card>
  );
}
