'use client';

import { useEffect, useMemo, useState } from 'react';
import { Boxes, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  InventoryHardwareBalance,
  InventoryHardwareItem,
} from '../types';

interface HardwareCataloguePanelProps {
  items: InventoryHardwareItem[];
  balances: InventoryHardwareBalance[];
  onCreateItem: (data: { name: string }) => Promise<void>;
  onUpdateItem: (
    item: InventoryHardwareItem,
    data: { name: string },
  ) => Promise<void>;
  onRemoveItem: (item: InventoryHardwareItem) => Promise<void>;
}

export function HardwareCataloguePanel({
  items,
  balances,
  onCreateItem,
  onUpdateItem,
  onRemoveItem,
}: HardwareCataloguePanelProps) {
  const [editingItem, setEditingItem] = useState<InventoryHardwareItem | null>(null);
  const [catalogueName, setCatalogueName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const sortedItems = useMemo(
    () => [...items].toSorted((a, b) => (
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      || a.id.localeCompare(b.id)
    )),
    [items],
  );

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
    setCatalogueName(editingItem?.name || '');
  }, [editingItem]);

  async function submitCatalogueItem(event: React.FormEvent) {
    event.preventDefault();
    const name = catalogueName.trim();
    if (!name) return;

    setIsSaving(true);
    try {
      if (editingItem) await onUpdateItem(editingItem, { name });
      else await onCreateItem({ name });
      setEditingItem(null);
      setCatalogueName('');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader className="border-b border-slate-700">
          <CardTitle className="flex items-center gap-2 text-white">
            <Boxes className="h-5 w-5 text-inventory" />
            Hardware Catalogue
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the Hardware item types available to stock workflows.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {sortedItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No Hardware catalogue items have been configured.
            </p>
          ) : sortedItems.map((item) => {
            const total = totalByItem.get(item.id) || 0;
            const canDelete = item.can_delete ?? total === 0;
            return (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-semibold text-white">{item.name}</span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Total stock: {total.toLocaleString()} units
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditingItem(item)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={!canDelete}
                    title={canDelete
                      ? 'Delete Hardware item'
                      : 'Hardware items with stock balances or audit history cannot be deleted'}
                    aria-label={`Delete ${item.name}`}
                    onClick={() => onRemoveItem(item)}
                    className="border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="h-fit border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="text-white">
            {editingItem ? 'Edit Hardware Item' : 'Add Hardware Item'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitCatalogueItem}>
            <div className="space-y-2">
              <Label htmlFor="hardware_catalogue_name">Name</Label>
              <Input
                id="hardware_catalogue_name"
                value={catalogueName}
                onChange={(event) => setCatalogueName(event.target.value)}
                className="border-slate-600 bg-slate-800"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                className="bg-inventory text-white hover:bg-inventory-dark"
                disabled={!catalogueName.trim() || isSaving}
              >
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
  );
}
