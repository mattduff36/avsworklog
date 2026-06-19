'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import {
  EMPTY_INVENTORY_ITEM_FORM,
  INVENTORY_CATEGORY_LABELS,
  type InventoryCategory,
  type InventoryItem,
  type InventoryItemCategory,
  type InventoryItemFormData,
  type InventoryLocation,
} from '../types';
import {
  CHECK_INTERVAL_MONTHS,
  hasInventoryCheckLapsedForCategoryExit,
  formatInventoryLocationOptionLabel,
  getInventoryCheckIntervalMonths,
  isInventoryCheckExempt,
  isInventoryCheckOnDemandCategory,
  isInventoryUnknownLocation,
} from '../utils';
import { toast } from 'sonner';

interface InventoryItemDialogProps {
  open: boolean;
  item?: InventoryItem | null;
  locations: InventoryLocation[];
  categories: InventoryItemCategory[];
  onClose: () => void;
  onSubmit: (data: InventoryItemFormData) => Promise<void>;
}

export function InventoryItemDialog({
  open,
  item,
  locations,
  categories,
  onClose,
  onSubmit,
}: InventoryItemDialogProps) {
  const [form, setForm] = useState<InventoryItemFormData>(EMPTY_INVENTORY_ITEM_FORM);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const isEditing = !!item;
  const selectedLocation = locations.find((location) => location.id === form.location_id) || null;
  const hasSpecialCheckStatus = isInventoryCheckExempt({
    category: form.category,
    location: selectedLocation,
    last_checked_at: form.last_checked_at || null,
  });
  const isUnknownLocationSelected = isInventoryUnknownLocation(selectedLocation);
  const isCheckOnDemandSelected = isInventoryCheckOnDemandCategory(form.category);
  const isBlockedCategoryExit = Boolean(
    item &&
    isInventoryCheckOnDemandCategory(item.category) &&
    form.category !== item.category &&
    hasInventoryCheckLapsedForCategoryExit(item)
  );

  useEffect(() => {
    setSubmitError('');
    if (item) {
      setForm({
        item_number: item.item_number,
        name: item.name,
        category: item.category,
        location_id: item.location_id || '',
        last_checked_at: item.last_checked_at || '',
        check_interval_months: item.check_interval_days ? String(getInventoryCheckIntervalMonths(item)) : '',
        status: item.status,
      });
      return;
    }

    setForm({
      ...EMPTY_INVENTORY_ITEM_FORM,
      category: categories[0]?.slug || EMPTY_INVENTORY_ITEM_FORM.category,
    });
  }, [categories, item, locations, open]);

  const categoryOptions = categories.length > 0
    ? [...categories]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => [
        category.slug,
        category.name,
      ] as const)
    : (Object.entries(INVENTORY_CATEGORY_LABELS) as Array<[InventoryCategory, string]>);

  function updateField<K extends keyof InventoryItemFormData>(key: K, value: InventoryItemFormData[K]) {
    setSubmitError('');
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError('');
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save inventory item';
      setSubmitError(message);
      toast.error(message, { id: 'inventory-item-save-error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto bg-slate-900 text-white border-slate-700">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Inventory Item' : 'Add Inventory Item'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Track item identity, location, and the last check date.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
              Fleet Plant guidance: anything with an engine, valued over £1000, or too large for a standard van should normally be added to Fleet Plant instead of Inventory. This is guidance only for this phase.
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="item_number">ID Number *</Label>
                <Input
                  id="item_number"
                  required
                  value={form.item_number}
                  onChange={(event) => updateField('item_number', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  required
                  value={form.name}
                  onChange={(event) => updateField('name', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            {hasSpecialCheckStatus ? (
              <div className="rounded-md border border-slate-500/25 bg-slate-500/10 p-3 text-xs text-slate-200">
                {isUnknownLocationSelected
                  ? 'Unknown is a system location for lost or missing items. It does not generate check due dates; the item list will show how long the item has been in Unknown.'
                  : isCheckOnDemandSelected
                    ? 'Check on Demand is for long-term storage. Check dates and intervals are kept on the item, but no due date is generated until it moves back to a regular category.'
                    : 'This item will not generate check due dates while the special status applies.'}
              </div>
            ) : null}

            {isBlockedCategoryExit ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                Record an inventory check before moving this item out of Check on Demand.
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(value) => updateField('category', value as InventoryCategory)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Location *</Label>
                <Select
                  value={form.location_id || undefined}
                  onValueChange={(value) => updateField('location_id', value)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {formatInventoryLocationOptionLabel(location)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="last_checked_at">Last Checked</Label>
                <Input
                  id="last_checked_at"
                  type="date"
                  value={form.last_checked_at}
                  onChange={(event) => updateField('last_checked_at', event.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="check_interval_months">Check Interval Months</Label>
                <Input
                  id="check_interval_months"
                  type="number"
                  min={1}
                  max={120}
                  value={form.check_interval_months}
                  onChange={(event) => updateField('check_interval_months', event.target.value)}
                  placeholder={`Default ${CHECK_INTERVAL_MONTHS}`}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            {submitError ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                {submitError}
              </div>
            ) : null}

            {isEditing ? (
              <div className="rounded-md border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-300">
                Use the table action to retire inventory items so a retirement reason is recorded.
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="bg-inventory text-white hover:bg-inventory-dark" disabled={saving || isBlockedCategoryExit || !form.location_id}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
