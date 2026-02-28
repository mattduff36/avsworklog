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
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface HgvCategory {
  id: string;
  name: string;
  description: string | null;
}

interface HgvCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  category?: HgvCategory | null;
  onSuccess?: () => void;
}

export function HgvCategoryDialog({
  open,
  onOpenChange,
  mode,
  category,
  onSuccess,
}: HgvCategoryDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && category) {
        setName(category.name);
        setDescription(category.description || '');
      } else {
        setName('');
        setDescription('');
      }
    }
  }, [open, mode, category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('Category name is required');
      return;
    }

    setLoading(true);

    try {
      const url =
        mode === 'create'
          ? '/api/admin/hgv-categories'
          : `/api/admin/hgv-categories/${category?.id}`;

      const method = mode === 'create' ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save HGV category');
      }

      toast.success(
        mode === 'create'
          ? 'HGV category created successfully'
          : 'HGV category updated successfully'
      );

      onOpenChange(false);
      onSuccess?.();
      router.refresh();
    } catch (error: any) {
      console.error('Error saving HGV category:', error);
      toast.error(error.message || 'Failed to save HGV category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] border-border text-white">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Add HGV Category' : 'Edit HGV Category'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {mode === 'create'
                ? 'Create a new HGV category for fleet organization'
                : 'Update HGV category details'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="hgv-name">Category Name *</Label>
              <Input
                id="hgv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Rigid, Artic, Tipper"
                className="bg-slate-800 border-slate-700 dark:text-slate-100 text-slate-900"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hgv-description">Description</Label>
              <Textarea
                id="hgv-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                className="bg-slate-800 border-slate-700 min-h-[80px] dark:text-slate-100 text-slate-900"
                disabled={loading}
              />
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
              className="bg-fleet hover:bg-fleet-dark"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'create' ? 'Create Category' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
