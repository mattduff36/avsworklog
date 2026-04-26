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
  type InventoryItemFormData,
  type InventoryLocation,
  type InventoryStatus,
} from '../types';

interface InventoryItemDialogProps {
  open: boolean;
  item?: InventoryItem | null;
  locations: InventoryLocation[];
  onClose: () => void;
  onSubmit: (data: InventoryItemFormData) => Promise<void>;
}

const categoryOptions = Object.entries(INVENTORY_CATEGORY_LABELS) as Array<[InventoryCategory, string]>;

export function InventoryItemDialog({
  open,
  item,
  locations,
  onClose,
  onSubmit,
}: InventoryItemDialogProps) {
  const [form, setForm] = useState<InventoryItemFormData>(EMPTY_INVENTORY_ITEM_FORM);
  const [saving, setSaving] = useState(false);
  const isEditing = !!item;

  useEffect(() => {
    if (item) {
      setForm({
        item_number: item.item_number,
        name: item.name,
        category: item.category,
        location_id: item.location_id,
        last_checked_at: item.last_checked_at || '',
        status: item.status,
      });
      return;
    }

    setForm({
      ...EMPTY_INVENTORY_ITEM_FORM,
      location_id: locations[0]?.id || '',
    });
  }, [item, locations, open]);

  function updateField<K extends keyof InventoryItemFormData>(key: K, value: InventoryItemFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl bg-slate-900 text-white border-slate-700">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Inventory Item' : 'Add Inventory Item'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Track item identity, location, and the last six-week check date.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
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
                  value={form.location_id}
                  onValueChange={(value) => updateField('location_id', value)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
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
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => updateField('status', value as InventoryStatus)}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="bg-inventory text-white hover:bg-inventory-dark" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
