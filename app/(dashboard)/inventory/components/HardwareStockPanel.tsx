'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, PackagePlus, Plus, RotateCcw } from 'lucide-react';
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
import type {
  InventoryHardwareAdjustmentOperation,
  InventoryHardwareAdjustmentPayload,
  InventoryHardwareAdjustmentReason,
  InventoryHardwareBalance,
  InventoryHardwareItem,
  InventoryLocation,
} from '../types';
import { INVENTORY_HARDWARE_ADJUSTMENT_REASONS } from '../types';
import {
  HardwareStockQuantityDialog,
  type HardwareStockQuantityDialogCopy,
} from './HardwareStockQuantityDialog';

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
  source: 'item' | 'selection';
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [stockEntry, setStockEntry] = useState<StockEntry | null>(null);
  const [adjustmentOperation, setAdjustmentOperation] = useState<Exclude<InventoryHardwareAdjustmentOperation, 'add'> | null>(null);
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

  const selectedBalances = useMemo(
    () => visibleBalances.filter((entry) => selectedKeys.has(entry.key)),
    [selectedKeys, visibleBalances],
  );
  const allVisibleSelected = visibleBalances.length > 0
    && visibleBalances.every((entry) => selectedKeys.has(entry.key));

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [itemFilter, locationFilter]);

  function toggleExpandedItem(itemId: string) {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleBalance(key: string, selected: boolean) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function openAdjustment(operation: Exclude<InventoryHardwareAdjustmentOperation, 'add'>) {
    setAdjustmentOperation(operation);
    setAdjustmentQuantity('');
    setAdjustmentReason(operation === 'remove' ? 'Used' : 'Stocktake correction');
    setAdjustmentNote('');
  }

  function openSelectedStockEntry() {
    const selectedItemIds = new Set(selectedBalances.map((entry) => entry.item.id));
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
        lines: selectedBalances.map(({ item, location }) => ({
          item_id: item.id,
          location_id: location.id,
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

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={(checked) => {
              setSelectedKeys(checked === true
                ? new Set(visibleBalances.map((entry) => entry.key))
                : new Set());
            }}
            aria-label="Select all visible Hardware balances"
          />
          <Badge variant="outline" className="border-slate-600 text-slate-200">
            {selectedBalances.length} selected
          </Badge>
          <Button
            size="sm"
            onClick={openSelectedStockEntry}
            disabled={selectedBalances.length === 0}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openAdjustment('remove')}
            disabled={selectedBalances.length === 0}
          >
            Remove
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openAdjustment('recount')}
            disabled={selectedBalances.length === 0}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Recount
          </Button>
        </div>

        <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-700">
          <Table className="table-fixed">
            <TableCaption className="sr-only">All active Hardware items</TableCaption>
            <TableHeader className="sticky top-0 z-10 bg-slate-900">
              <TableRow className="border-slate-700">
                <TableHead>Hardware item</TableHead>
                <TableHead className="w-28 text-right">Total</TableHead>
                <TableHead className="w-32 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((item) => {
                const itemBalances = visibleBalancesByItem.get(item.id) || [];
                const total = itemBalances.reduce((sum, entry) => sum + entry.balance.quantity, 0);
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
                      <TableCell className="px-3 py-2 text-right font-mono font-semibold text-white">
                        {total.toLocaleString()}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          onClick={() => setStockEntry({
                            source: 'item',
                            items: [item],
                            copy: {
                              ...ITEM_STOCK_COPY,
                              description: `Record incoming stock of ${item.name} at an active Inventory location.`,
                            },
                          })}
                        >
                          <PackagePlus className="mr-1 h-3.5 w-3.5" />
                          Add stock
                        </Button>
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
                                    <TableHead className="w-12" />
                                    <TableHead>Location</TableHead>
                                    <TableHead className="w-28 text-right">Quantity</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {itemBalances.map((entry) => (
                                    <TableRow key={entry.key} className="border-slate-800">
                                      <TableCell>
                                        <Checkbox
                                          checked={selectedKeys.has(entry.key)}
                                          onCheckedChange={(checked) => toggleBalance(entry.key, checked === true)}
                                          aria-label={`Select ${item.name}, quantity ${entry.balance.quantity}, at ${entry.location.name}`}
                                        />
                                      </TableCell>
                                      <TableCell className="text-slate-200">{entry.location.name}</TableCell>
                                      <TableCell className="text-right font-mono font-semibold text-white">
                                        {entry.balance.quantity.toLocaleString()}
                                      </TableCell>
                                    </TableRow>
                                  ))}
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

      <Dialog open={adjustmentOperation !== null} onOpenChange={(open) => { if (!open) setAdjustmentOperation(null); }}>
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              {adjustmentOperation === 'remove' ? 'Remove Hardware Quantity' : 'Recount Hardware Quantity'}
            </DialogTitle>
            <DialogDescription>
              This operation applies to {selectedBalances.length} selected item/location {selectedBalances.length === 1 ? 'balance' : 'balances'}.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitAdjustment}>
            <div className="space-y-2">
              <Label htmlFor="hardware_matrix_adjustment_quantity">
                {adjustmentOperation === 'recount' ? 'New counted quantity' : 'Quantity'}
              </Label>
              <Input
                id="hardware_matrix_adjustment_quantity"
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

      {stockEntry ? (
        <HardwareStockQuantityDialog
          open
          items={stockEntry.items}
          knownLocations={locations}
          copy={stockEntry.copy}
          allowReasonSelection={stockEntry.source === 'selection'}
          onClose={() => setStockEntry(null)}
          onSubmit={onAdjust}
          onSuccess={() => {
            if (stockEntry.source === 'selection') setSelectedKeys(new Set());
          }}
        />
      ) : null}
    </Card>
  );
}
