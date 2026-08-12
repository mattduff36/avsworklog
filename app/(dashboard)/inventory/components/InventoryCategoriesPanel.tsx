'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Tags } from 'lucide-react';
import type { InventoryItemCategory, InventoryItemCategoryFormData } from '../types';
import { InventorySettingsListRow } from './InventorySettingsListRow';

interface InventoryCategoriesPanelProps {
  categories: InventoryItemCategory[];
  onCreate: (data: InventoryItemCategoryFormData) => Promise<void>;
  onUpdate: (category: InventoryItemCategory, data: InventoryItemCategoryFormData) => Promise<void>;
  onRemove: (category: InventoryItemCategory) => Promise<void>;
}

const emptyForm: InventoryItemCategoryFormData = {
  name: '',
  slug: '',
  description: '',
  sort_order: '',
};

function slugifyCategoryName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function InventoryCategoriesPanel({
  categories,
  onCreate,
  onUpdate,
  onRemove,
}: InventoryCategoriesPanelProps) {
  const [form, setForm] = useState<InventoryItemCategoryFormData>(emptyForm);
  const [editingCategory, setEditingCategory] = useState<InventoryItemCategory | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editingCategory) {
      setForm(emptyForm);
      return;
    }

    setForm({
      name: editingCategory.name,
      slug: editingCategory.slug,
      description: editingCategory.description || '',
      sort_order: String(editingCategory.sort_order),
    });
  }, [editingCategory]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  function updateName(name: string) {
    setForm((current) => ({
      ...current,
      name,
      slug: editingCategory ? current.slug : slugifyCategoryName(name),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;

    setIsSaving(true);
    try {
      if (editingCategory) await onUpdate(editingCategory, form);
      else await onCreate(form);
      setEditingCategory(null);
      setForm(emptyForm);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Tags className="h-5 w-5 text-inventory" />
            Item Categories
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedCategories.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No inventory categories have been created yet.</p>
          ) : (
            sortedCategories.map((category) => (
              <InventorySettingsListRow
                key={category.id}
                title={category.name}
                meta={`${category.item_count || 0} item${category.item_count === 1 ? '' : 's'} · Inventory category`}
                onEdit={() => setEditingCategory(category)}
                onRemove={() => onRemove(category)}
                removeDisabled={(category.item_count || 0) > 0}
                removeDisabledReason="Move items to another category before deleting"
                removeLabel="Delete category"
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-700 bg-slate-900/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Plus className="h-5 w-5 text-inventory" />
            {editingCategory ? 'Edit Category' : 'Create Category'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="category_name">Category Name *</Label>
              <Input
                id="category_name"
                value={form.name}
                onChange={(event) => updateName(event.target.value)}
                className="bg-slate-800 border-slate-600"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" className="min-h-11 bg-inventory text-white hover:bg-inventory-dark" disabled={isSaving || !form.name.trim()}>
                {editingCategory ? 'Save Category' : 'Create Category'}
              </Button>
              {editingCategory ? (
                <Button type="button" variant="outline" onClick={() => setEditingCategory(null)} disabled={isSaving} className="min-h-11">
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
