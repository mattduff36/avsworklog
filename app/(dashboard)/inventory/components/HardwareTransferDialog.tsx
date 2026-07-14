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
import { Textarea } from '@/components/ui/textarea';
import type {
  InventoryHardwareBalance,
  InventoryHardwareItem,
  InventoryHardwareTransferPayload,
  InventoryLocation,
} from '../types';
import { InventoryLocationSelect } from './InventoryLocationSelect';

interface HardwareTransferDialogProps {
  open: boolean;
  items: InventoryHardwareItem[];
  balances: InventoryHardwareBalance[];
  locations: InventoryLocation[];
  responsibleLocationIds?: string[];
  onClose: () => void;
  onSubmit: (payload: InventoryHardwareTransferPayload) => Promise<void>;
}

export function HardwareTransferDialog({
  open,
  items,
  balances,
  locations,
  responsibleLocationIds,
  onClose,
  onSubmit,
}: HardwareTransferDialogProps) {
  const [itemId, setItemId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const responsibleIds = useMemo(
    () => new Set(responsibleLocationIds || []),
    [responsibleLocationIds],
  );
  const activeLocations = useMemo(
    () => locations.filter((location) => location.is_active),
    [locations],
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
    if (!open) {
      setItemId('');
      setFromLocationId('');
      setToLocationId('');
      setQuantity('');
      setNote('');
      setIsSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    setFromLocationId('');
    setToLocationId('');
    setQuantity('');
  }, [itemId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        note,
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
      <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
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
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger className="border-slate-600 bg-slate-800">
                <SelectValue placeholder="Choose an item" />
              </SelectTrigger>
              <SelectContent>
                {activeItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>From</Label>
              <Select
                value={fromLocationId}
                onValueChange={(value) => {
                  setFromLocationId(value);
                  setToLocationId('');
                }}
                disabled={!itemId}
              >
                <SelectTrigger className="border-slate-600 bg-slate-800">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  {activeLocations
                    .filter((location) => sourceLocationIds.has(location.id))
                    .map((location) => {
                      const balance = itemBalances.find((row) => row.location_id === location.id);
                      return (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name} ({balance?.quantity || 0})
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>To</Label>
              {sourceIsResponsible ? (
                <InventoryLocationSelect
                  value={toLocationId}
                  onValueChange={setToLocationId}
                  locations={activeLocations.filter((location) => location.id !== fromLocationId)}
                  disabled={!fromLocationId}
                  placeholder="Destination"
                  serverSearch
                  locationFilter={(location) => location.id !== fromLocationId}
                />
              ) : (
                <Select value={toLocationId} onValueChange={setToLocationId} disabled={!fromLocationId}>
                  <SelectTrigger className="border-slate-600 bg-slate-800">
                    <SelectValue placeholder="Destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeLocations
                      .filter((location) => (
                        location.id !== fromLocationId && responsibleIds.has(location.id)
                      ))
                      .map((location) => (
                        <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
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

          <div className="space-y-2">
            <Label htmlFor="hardware_transfer_note">Note (optional)</Label>
            <Textarea
              id="hardware_transfer_note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="border-slate-600 bg-slate-800"
              rows={3}
            />
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
