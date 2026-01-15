'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Subcategory {
  id: string;
  name: string;
  category_id: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
}

interface SubcategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  categoryId: string;
  categoryName: string;
  subcategory?: Subcategory | null;
  onSuccess?: () => void;
}

export function SubcategoryDialog({
  open,
  onOpenChange,
  mode,
  categoryId,
  categoryName,
  subcategory,
  onSuccess,
}: SubcategoryDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');

  // Reset form when dialog opens/closes or subcategory changes
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && subcategory) {
        setName(subcategory.name);
        setSortOrder(subcategory.sort_order.toString());
      } else {
        setName('');
        setSortOrder('0');
      }
    }
  }, [open, mode, subcategory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast.error('Subcategory name is required');
      return;
    }

    setLoading(true);

    try {
      const url = mode === 'create' 
        ? '/api/workshop-tasks/subcategories'
        : `/api/workshop-tasks/subcategories/${subcategory?.id}`;
      
      const method = mode === 'create' ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category_id: categoryId,
          sort_order: parseInt(sortOrder) || 0,
          is_active: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save subcategory');
      }

      toast.success(
        mode === 'create' 
          ? 'Subcategory created successfully'
          : 'Subcategory updated successfully'
      );

      onOpenChange(false);
      onSuccess?.();
      router.refresh();
    } catch (error: any) {
      console.error('Error saving subcategory:', error);
      toast.error(error.message || 'Failed to save subcategory');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-slate-900 border-slate-700 text-white">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? `Add Subcategory to ${categoryName}` : 'Edit Subcategory'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {mode === 'create'
                ? 'Create a new subcategory for more specific task classification'
                : 'Update subcategory details'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Subcategory Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Engine, Brakes, Body Work"
                className="bg-slate-800 border-slate-700"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort-order">Sort Order</Label>
              <Input
                id="sort-order"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                placeholder="0"
                className="bg-slate-800 border-slate-700"
                disabled={loading}
                min="0"
                step="1"
              />
              <p className="text-xs text-slate-500">Lower numbers appear first</p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-workshop hover:bg-workshop-dark"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'create' ? 'Create Subcategory' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
