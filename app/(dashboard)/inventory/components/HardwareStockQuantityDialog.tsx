'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  InventoryHardwareAdjustmentPayload,
  InventoryHardwareAdjustmentReason,
  InventoryHardwareItem,
  InventoryLocation,
} from '../types';
import { INVENTORY_HARDWARE_ADJUSTMENT_REASONS } from '../types';
import { InventoryLocationSelect } from './InventoryLocationSelect';

export interface HardwareStockQuantityDialogCopy {
  title: string;
  description: string;
  noteLabel: string;
  submitLabel: string;
  submittingLabel: string;
}

interface HardwareStockQuantityDialogProps {
  open: boolean;
  items: InventoryHardwareItem[];
  knownLocations: InventoryLocation[];
  copy: HardwareStockQuantityDialogCopy;
  allowReasonSelection?: boolean;
  initialReason?: InventoryHardwareAdjustmentReason;
  onClose: () => void;
  onSubmit: (payload: InventoryHardwareAdjustmentPayload) => Promise<void>;
  onSuccess?: () => void;
}

interface YardLocationResponse {
  location?: InventoryLocation | null;
}

const YARD_LOCATION_LOOKUP_URL = '/api/inventory/locations?lookup=yard';

function isActiveNamedYard(location: InventoryLocation | null | undefined): location is InventoryLocation {
  return Boolean(location?.is_active && location.name === 'Yard');
}

export function HardwareStockQuantityDialog({
  open,
  items,
  knownLocations,
  copy,
  allowReasonSelection = false,
  initialReason = 'Delivery',
  onClose,
  onSubmit,
  onSuccess,
}: HardwareStockQuantityDialogProps) {
  const [locationId, setLocationId] = useState('');
  const [defaultLocation, setDefaultLocation] = useState<InventoryLocation | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<InventoryHardwareAdjustmentReason>(initialReason);
  const [note, setNote] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResolvingDefault, setIsResolvingDefault] = useState(true);
  const userSelectedLocation = useRef(false);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    async function resolveDefaultLocation() {
      try {
        const response = await fetch(YARD_LOCATION_LOOKUP_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json() as YardLocationResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Failed to find the Yard location');

        const yard = isActiveNamedYard(payload.location) ? payload.location : null;
        setDefaultLocation(yard);
        if (yard && !userSelectedLocation.current) setLocationId(yard.id);
      } catch {
        if (!controller.signal.aborted) setDefaultLocation(null);
      } finally {
        if (!controller.signal.aborted) setIsResolvingDefault(false);
      }
    }

    void resolveDefaultLocation();
    return () => controller.abort();
  }, [open]);

  const activeKnownLocations = useMemo(() => {
    const locationsById = new Map<string, InventoryLocation>();
    if (defaultLocation) locationsById.set(defaultLocation.id, defaultLocation);
    knownLocations.forEach((location) => {
      if (location.is_active) locationsById.set(location.id, location);
    });
    return [...locationsById.values()];
  }, [defaultLocation, knownLocations]);

  const parsedQuantity = Number(quantity);
  const noteIsValid = reason !== 'Other' || Boolean(note.trim());
  const canSubmit = Boolean(
    items.length > 0
    && locationId
    && quantity
    && Number.isInteger(parsedQuantity)
    && parsedQuantity > 0
    && noteIsValid,
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setErrorMessage('');
    setIsSubmitting(true);
    try {
      await onSubmit({
        operation_type: 'add',
        reason,
        note,
        lines: items.map((item) => ({
          item_id: item.id,
          location_id: locationId,
          quantity: parsedQuantity,
        })),
      });
      onSuccess?.();
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
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) onClose();
      }}
    >
      <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <PackagePlus className="h-5 w-5 text-inventory" aria-hidden="true" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label id="hardware_stock_quantity_location_label">Destination location</Label>
            <InventoryLocationSelect
              value={locationId}
              onValueChange={(value) => {
                userSelectedLocation.current = true;
                setLocationId(value);
              }}
              locations={activeKnownLocations}
              placeholder={isResolvingDefault ? 'Finding Yard...' : 'Search for a destination'}
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
            <Label htmlFor="hardware_stock_quantity">Quantity</Label>
            <Input
              id="hardware_stock_quantity"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={isSubmitting}
              required
              aria-describedby="hardware_stock_quantity_help"
              className="border-slate-600 bg-slate-800"
            />
            <p id="hardware_stock_quantity_help" className="text-xs text-muted-foreground">
              Enter a positive whole-number quantity.
            </p>
          </div>

          {allowReasonSelection ? (
            <div className="space-y-2">
              <Label htmlFor="hardware_stock_quantity_reason">Reason</Label>
              <Select
                value={reason}
                onValueChange={(value) => setReason(value as InventoryHardwareAdjustmentReason)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="hardware_stock_quantity_reason" className="border-slate-600 bg-slate-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVENTORY_HARDWARE_ADJUSTMENT_REASONS.map((adjustmentReason) => (
                    <SelectItem key={adjustmentReason} value={adjustmentReason}>
                      {adjustmentReason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="hardware_stock_quantity_note">
              {copy.noteLabel} {reason === 'Other' ? '(required)' : '(optional)'}
            </Label>
            <Textarea
              id="hardware_stock_quantity_note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={isSubmitting}
              required={reason === 'Other'}
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
                  {copy.submittingLabel}
                </>
              ) : copy.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
