'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
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
import { Textarea } from '@/components/ui/textarea';
import type {
  InventoryHardwareAdjustmentPayload,
  InventoryHardwareItem,
  InventoryLocation,
} from '../types';
import { InventoryLocationSelect } from './InventoryLocationSelect';

interface HardwareAddStockDialogProps {
  item: InventoryHardwareItem | null;
  locations: InventoryLocation[];
  onClose: () => void;
  onSubmit: (payload: InventoryHardwareAdjustmentPayload) => Promise<void>;
}

export function HardwareAddStockDialog({
  item,
  locations,
  onClose,
  onSubmit,
}: HardwareAddStockDialogProps) {
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const parsedQuantity = Number(quantity);
  const canSubmit = Boolean(
    item
    && locationId
    && quantity
    && Number.isInteger(parsedQuantity)
    && parsedQuantity > 0,
  );
  const activeKnownLocations = useMemo(
    () => locations.filter((location) => location.is_active),
    [locations],
  );

  useEffect(() => {
    if (!item) {
      setLocationId('');
      setQuantity('');
      setNote('');
      setErrorMessage('');
      setIsSubmitting(false);
    }
  }, [item]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!item || !canSubmit) return;

    setErrorMessage('');
    setIsSubmitting(true);
    try {
      await onSubmit({
        operation_type: 'add',
        reason: 'Delivery',
        note,
        lines: [{
          item_id: item.id,
          location_id: locationId,
          quantity: parsedQuantity,
        }],
      });
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add Hardware stock';
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <PackagePlus className="h-5 w-5 text-inventory" />
            Add stock
          </DialogTitle>
          <DialogDescription>
            Record an incoming delivery of {item?.name || 'Hardware'} at an active Inventory location.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label id="hardware_add_stock_location_label">Destination location</Label>
            <InventoryLocationSelect
              value={locationId}
              onValueChange={setLocationId}
              locations={activeKnownLocations}
              placeholder="Search for a destination"
              searchPlaceholder="Search destination locations"
              ariaLabel="Destination location"
              serverSearch
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Search by location name. Locations without existing Hardware stock are eligible.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hardware_add_stock_quantity">Quantity</Label>
            <Input
              id="hardware_add_stock_quantity"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={isSubmitting}
              required
              aria-describedby="hardware_add_stock_quantity_help"
              className="border-slate-600 bg-slate-800"
            />
            <p id="hardware_add_stock_quantity_help" className="text-xs text-muted-foreground">
              Enter a positive whole-number quantity.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hardware_add_stock_note">Delivery note (optional)</Label>
            <Textarea
              id="hardware_add_stock_note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={isSubmitting}
              className="border-slate-600 bg-slate-800"
              rows={3}
            />
          </div>

          {errorMessage ? (
            <p className="text-sm text-red-300" role="alert">{errorMessage}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="bg-inventory text-white hover:bg-inventory-dark"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Adding stock...
                </>
              ) : 'Add stock'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
