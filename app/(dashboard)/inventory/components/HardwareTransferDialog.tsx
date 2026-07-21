'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type {
  InventoryHardwareBalance,
  InventoryHardwareItem,
  InventoryHardwareTransferPayload,
  InventoryLocation,
} from '../types';
import {
  formatInventoryLocationContextLabel,
  isLegacyQuoteInventoryLocation,
} from '../utils';
import { InventoryLocationSelect } from './InventoryLocationSelect';
import { LegacyQuoteLocationOptIn } from './LegacyQuoteLocationOptIn';

interface HardwareTransferDialogProps {
  open: boolean;
  items: InventoryHardwareItem[];
  balances: InventoryHardwareBalance[];
  locations: InventoryLocation[];
  responsibleLocationIds?: string[];
  prefill?: HardwareTransferPrefill | null;
  onClose: () => void;
  onSubmit: (payload: InventoryHardwareTransferPayload) => Promise<void>;
}

export interface HardwareTransferPrefill {
  itemId: string;
  fromLocationId: string;
}

export function HardwareTransferDialog({
  open,
  items,
  balances,
  locations,
  responsibleLocationIds,
  prefill,
  onClose,
  onSubmit,
}: HardwareTransferDialogProps) {
  const [itemId, setItemId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [includeLegacyQuotes, setIncludeLegacyQuotes] = useState(false);

  const responsibleIds = useMemo(
    () => new Set(responsibleLocationIds || []),
    [responsibleLocationIds],
  );
  const activeLocations = useMemo(
    () => locations.filter((location) => location.is_active),
    [locations],
  );
  const discoverableActiveLocations = useMemo(
    () => activeLocations.filter((location) => (
      includeLegacyQuotes
      || !isLegacyQuoteInventoryLocation(location)
      || location.id === fromLocationId
      || location.id === toLocationId
    )),
    [activeLocations, fromLocationId, includeLegacyQuotes, toLocationId],
  );
  const stockedItemIds = useMemo(
    () => new Set(
      balances
        .filter((balance) => balance.quantity > 0)
        .map((balance) => balance.hardware_item_id),
    ),
    [balances],
  );
  const activeItems = useMemo(
    () => items.filter((item) => item.is_active && stockedItemIds.has(item.id)),
    [items, stockedItemIds],
  );
  const itemBalances = useMemo(
    () => balances.filter((balance) => (
      balance.hardware_item_id === itemId
      && balance.quantity > 0
    )),
    [balances, itemId],
  );
  const sourceLocationIds = useMemo(
    () => new Set(itemBalances.map((balance) => balance.location_id)),
    [itemBalances],
  );
  const sourceQuantityByLocationId = useMemo(
    () => new Map(itemBalances.map((balance) => [balance.location_id, balance.quantity])),
    [itemBalances],
  );
  const availableQuantity = itemBalances.find(
    (balance) => balance.location_id === fromLocationId,
  )?.quantity || 0;
  const sourceIsResponsible = responsibleLocationIds === undefined
    || responsibleIds.has(fromLocationId);
  const parsedQuantity = Number.parseInt(quantity, 10);
  const canSubmit = Boolean(
    itemId
    && fromLocationId
    && toLocationId
    && Number.isInteger(parsedQuantity)
    && parsedQuantity > 0
    && parsedQuantity <= availableQuantity,
  );

  useEffect(() => {
    setItemId(open ? prefill?.itemId || '' : '');
    setFromLocationId(open ? prefill?.fromLocationId || '' : '');
    setToLocationId('');
    setQuantity('');
    setIsSubmitting(false);
    setIncludeLegacyQuotes(false);
  }, [open, prefill?.fromLocationId, prefill?.itemId]);

  function handleItemChange(value: string) {
    setItemId(value);
    setFromLocationId('');
    setToLocationId('');
    setQuantity('');
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        lines: [{
          item_id: itemId,
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          quantity: parsedQuantity,
        }],
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto border-slate-700 bg-slate-900 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <ArrowRightLeft className="h-5 w-5 text-inventory" />
            Transfer Hardware
          </DialogTitle>
          <DialogDescription>
            Move a whole-number quantity between eligible Inventory locations.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label>Hardware item</Label>
            <Select value={itemId} onValueChange={handleItemChange}>
              <SelectTrigger className="border-slate-600 bg-slate-800" aria-label="Hardware item">
                <SelectValue placeholder="Choose an item" />
              </SelectTrigger>
              <SelectContent>
                {activeItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/30 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-white">Transfer locations</p>
                <p className="text-xs text-muted-foreground">
                  Choose the stock bucket to move from and its destination.
                </p>
              </div>
              <LegacyQuoteLocationOptIn
                enabled={includeLegacyQuotes}
                onEnabledChange={setIncludeLegacyQuotes}
                className="self-start sm:self-auto"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>From</Label>
              <InventoryLocationSelect
                value={fromLocationId}
                onValueChange={(value) => {
                  setFromLocationId(value);
                  setToLocationId('');
                }}
                locations={discoverableActiveLocations.filter((location) => sourceLocationIds.has(location.id))}
                disabled={!itemId}
                placeholder="Choose source location"
                searchPlaceholder="Search source locations..."
                ariaLabel="Source location"
                allowLegacyQuoteOptIn={false}
                includeLegacyQuotes={includeLegacyQuotes}
                getOptionDescription={(location) => (
                  `${formatInventoryLocationContextLabel(location)} · ${(sourceQuantityByLocationId.get(location.id) || 0).toLocaleString()} available`
                )}
              />
            </div>

            <div className="space-y-2">
              <Label>To</Label>
              <InventoryLocationSelect
                value={toLocationId}
                onValueChange={setToLocationId}
                locations={discoverableActiveLocations.filter((location) => (
                  location.id !== fromLocationId
                  && (sourceIsResponsible || responsibleIds.has(location.id))
                ))}
                disabled={!fromLocationId}
                placeholder="Choose destination"
                searchPlaceholder="Search destination locations..."
                ariaLabel="Destination location"
                serverSearch={sourceIsResponsible}
                locationFilter={(location) => (
                  location.id !== fromLocationId
                  && (sourceIsResponsible || responsibleIds.has(location.id))
                )}
                allowLegacyQuoteOptIn={false}
                includeLegacyQuotes={includeLegacyQuotes}
                getOptionDescription={formatInventoryLocationContextLabel}
              />
            </div>
          </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hardware_transfer_quantity">Quantity</Label>
            <Input
              id="hardware_transfer_quantity"
              type="number"
              min={1}
              max={availableQuantity || undefined}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="border-slate-600 bg-slate-800"
            />
            {fromLocationId ? (
              <p className="text-xs text-muted-foreground">
                {availableQuantity.toLocaleString()} available at the source location.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="bg-inventory text-white hover:bg-inventory-dark"
            >
              {isSubmitting ? 'Transferring...' : 'Transfer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
