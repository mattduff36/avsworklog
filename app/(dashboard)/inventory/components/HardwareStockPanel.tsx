'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  Boxes,
  Pencil,
  Plus,
  RotateCcw,
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
import {
  Table,
  TableBody,
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
  InventoryHardwareTransferPayload,
  InventoryLocation,
} from '../types';
import { INVENTORY_HARDWARE_ADJUSTMENT_REASONS } from '../types';
import { HardwareTransferDialog } from './HardwareTransferDialog';

interface HardwareStockPanelProps {
  items: InventoryHardwareItem[];
  balances: InventoryHardwareBalance[];
  locations: InventoryLocation[];
  onCreateItem: (data: { name: string; sort_order: number }) => Promise<void>;
  onUpdateItem: (
    item: InventoryHardwareItem,
    data: { name?: string; sort_order?: number; is_active?: boolean },
  ) => Promise<void>;
  onAdjust: (payload: InventoryHardwareAdjustmentPayload) => Promise<void>;
  onTransfer: (payload: InventoryHardwareTransferPayload) => Promise<void>;
}

interface MatrixRow {
  key: string;
  item: InventoryHardwareItem;
  location: InventoryLocation;
  quantity: number;
}

const ALL_ITEMS = 'all-items';
const ALL_LOCATIONS = 'all-locations';

export function HardwareStockPanel({
  items,
  balances,
  locations,
  onCreateItem,
  onUpdateItem,
  onAdjust,
  onTransfer,
}: HardwareStockPanelProps) {
  const [itemFilter, setItemFilter] = useState(ALL_ITEMS);
  const [locationFilter, setLocationFilter] = useState(ALL_LOCATIONS);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [adjustmentOperation, setAdjustmentOperation] = useState<InventoryHardwareAdjustmentOperation | null>(null);
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState<InventoryHardwareAdjustmentReason>('Delivery');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryHardwareItem | null>(null);
  const [catalogName, setCatalogName] = useState('');
  const [catalogSortOrder, setCatalogSortOrder] = useState('');
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);

  const activeLocations = useMemo(
    () => locations
      .filter((location) => location.is_active)
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    [locations],
  );
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [items],
  );
  const activeItems = useMemo(
    () => sortedItems.filter((item) => item.is_active),
    [sortedItems],
  );
  const balanceByKey = useMemo(
    () => new Map(
      balances.map((balance) => [
        `${balance.hardware_item_id}:${balance.location_id}`,
        balance.quantity,
      ]),
    ),
    [balances],
  );
  const matrixRows = useMemo(() => {
    const filteredItems = itemFilter === ALL_ITEMS
      ? activeItems
      : activeItems.filter((item) => item.id === itemFilter);
    const filteredLocations = locationFilter === ALL_LOCATIONS
      ? activeLocations
      : activeLocations.filter((location) => location.id === locationFilter);

    return filteredItems.flatMap((item) => (
      filteredLocations.map((location): MatrixRow => {
        const key = `${item.id}:${location.id}`;
        return {
          key,
          item,
          location,
          quantity: balanceByKey.get(key) || 0,
        };
      })
    ));
  }, [activeItems, activeLocations, balanceByKey, itemFilter, locationFilter]);
  const selectedRows = useMemo(
    () => matrixRows.filter((row) => selectedKeys.has(row.key)),
    [matrixRows, selectedKeys],
  );
  const allVisibleSelected = matrixRows.length > 0 && matrixRows.every((row) => selectedKeys.has(row.key));
  const totalByItem = useMemo(() => {
    const totals = new Map<string, number>();
    for (const balance of balances) {
      totals.set(
        balance.hardware_item_id,
        (totals.get(balance.hardware_item_id) || 0) + balance.quantity,
      );
    }
    return totals;
  }, [balances]);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [itemFilter, locationFilter]);

  useEffect(() => {
    if (!editingItem) {
      setCatalogName('');
      setCatalogSortOrder('');
      return;
    }
    setCatalogName(editingItem.name);
    setCatalogSortOrder(String(editingItem.sort_order));
  }, [editingItem]);

  function toggleRow(key: string, checked: boolean) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedKeys(checked ? new Set(matrixRows.map((row) => row.key)) : new Set());
  }

  function openAdjustment(operation: InventoryHardwareAdjustmentOperation) {
    setAdjustmentOperation(operation);
    setAdjustmentQuantity('');
    setAdjustmentReason(operation === 'add' ? 'Delivery' : operation === 'remove' ? 'Used' : 'Stocktake correction');
    setAdjustmentNote('');
  }

  async function submitAdjustment(event: React.FormEvent) {
    event.preventDefault();
    if (!adjustmentOperation || selectedRows.length === 0) return;
    const quantity = Number.parseInt(adjustmentQuantity, 10);
    const validQuantity = adjustmentOperation === 'recount' ? quantity >= 0 : quantity > 0;
    if (!Number.isInteger(quantity) || !validQuantity) return;
    if (adjustmentReason === 'Other' && !adjustmentNote.trim()) return;

    setIsAdjusting(true);
    try {
      await onAdjust({
        operation_type: adjustmentOperation,
        reason: adjustmentReason,
        note: adjustmentNote,
        lines: selectedRows.map((row) => ({
          item_id: row.item.id,
          location_id: row.location.id,
          quantity,
        })),
      });
      setAdjustmentOperation(null);
      setSelectedKeys(new Set());
    } finally {
      setIsAdjusting(false);
    }
  }

  async function submitCatalog(event: React.FormEvent) {
    event.preventDefault();
    if (!catalogName.trim()) return;

    setIsSavingCatalog(true);
    try {
      const sortOrder = Number.parseInt(catalogSortOrder, 10);
      if (editingItem) {
        await onUpdateItem(editingItem, {
          name: catalogName.trim(),
          sort_order: Number.isInteger(sortOrder) ? sortOrder : 0,
        });
      } else {
        await onCreateItem({
          name: catalogName.trim(),
          sort_order: Number.isInteger(sortOrder) ? sortOrder : 0,
        });
      }
      setEditingItem(null);
      setCatalogName('');
      setCatalogSortOrder('');
    } finally {
      setIsSavingCatalog(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader className="border-b border-slate-700">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <Boxes className="h-5 w-5 text-inventory" />
                Hardware Stock Matrix
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Zero balances are included here so deliveries and stocktakes can be entered in bulk.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setTransferOpen(true)}
              className="border-slate-600"
            >
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Transfer Stock
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Select value={itemFilter} onValueChange={setItemFilter}>
              <SelectTrigger className="border-slate-600 bg-slate-800">
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
              <SelectTrigger className="border-slate-600 bg-slate-800">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_LOCATIONS}>All active locations</SelectItem>
                {activeLocations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
            <Badge variant="outline" className="border-slate-600 text-slate-200">
              {selectedRows.length} selected
            </Badge>
            <Button size="sm" onClick={() => openAdjustment('add')} disabled={selectedRows.length === 0}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAdjustment('remove')} disabled={selectedRows.length === 0}>
              Remove
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAdjustment('recount')} disabled={selectedRows.length === 0}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Recount
            </Button>
          </div>

          <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-700">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-900">
                <TableRow className="border-slate-700">
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                      aria-label="Select all visible Hardware balances"
                    />
                  </TableHead>
                  <TableHead>Hardware item</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrixRows.map((row) => (
                  <TableRow key={row.key} className="border-slate-800">
                    <TableCell>
                      <Checkbox
                        checked={selectedKeys.has(row.key)}
                        onCheckedChange={(checked) => toggleRow(row.key, checked === true)}
                        aria-label={`Select ${row.item.name} at ${row.location.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-white">{row.item.name}</TableCell>
                    <TableCell className="text-slate-300">{row.location.name}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-white">
                      {row.quantity.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="border-slate-700 bg-slate-900/70">
          <CardHeader>
            <CardTitle className="text-white">Hardware Catalogue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sortedItems.map((item) => {
              const total = totalByItem.get(item.id) || 0;
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{item.name}</span>
                      {!item.is_active ? <Badge variant="secondary">Archived</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sort {item.sort_order} · {total.toLocaleString()} units company-wide
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingItem(item)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={item.is_active && total > 0}
                      title={item.is_active && total > 0 ? 'Reduce all balances to zero before archiving' : undefined}
                      onClick={() => onUpdateItem(item, { is_active: !item.is_active })}
                    >
                      {item.is_active ? <Archive className="mr-1 h-3.5 w-3.5" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                      {item.is_active ? 'Archive' : 'Restore'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="h-fit border-slate-700 bg-slate-900/70">
          <CardHeader>
            <CardTitle className="text-white">{editingItem ? 'Edit Hardware Item' : 'Add Hardware Item'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submitCatalog}>
              <div className="space-y-2">
                <Label htmlFor="hardware_catalog_name">Name</Label>
                <Input
                  id="hardware_catalog_name"
                  value={catalogName}
                  onChange={(event) => setCatalogName(event.target.value)}
                  className="border-slate-600 bg-slate-800"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hardware_catalog_sort_order">Sort order</Label>
                <Input
                  id="hardware_catalog_sort_order"
                  type="number"
                  step={1}
                  value={catalogSortOrder}
                  onChange={(event) => setCatalogSortOrder(event.target.value)}
                  className="border-slate-600 bg-slate-800"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={!catalogName.trim() || isSavingCatalog}>
                  {editingItem ? 'Save Changes' : 'Add Item'}
                </Button>
                {editingItem ? (
                  <Button type="button" variant="outline" onClick={() => setEditingItem(null)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Dialog open={adjustmentOperation !== null} onOpenChange={(open) => { if (!open) setAdjustmentOperation(null); }}>
        <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              {adjustmentOperation === 'add'
                ? 'Add Hardware Quantity'
                : adjustmentOperation === 'remove'
                  ? 'Remove Hardware Quantity'
                  : 'Recount Hardware Quantity'}
            </DialogTitle>
            <DialogDescription>
              This operation will apply to {selectedRows.length} selected item/location {selectedRows.length === 1 ? 'balance' : 'balances'}.
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
        locations={locations}
        onClose={() => setTransferOpen(false)}
        onSubmit={onTransfer}
      />
    </div>
  );
}
