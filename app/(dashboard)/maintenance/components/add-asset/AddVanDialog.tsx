'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OnceDialog } from '@/components/ui/once-ui';
import {
  formatRegistrationForInput,
  formatRegistrationForStorage,
  isApplicableToType,
  type VehicleCategoryOption,
} from './utils';

interface AddVanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
}

export function AddVanDialog({ open, onOpenChange, onSuccess }: AddVanDialogProps) {
  const [categories, setCategories] = useState<VehicleCategoryOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingCategories, setIsFetchingCategories] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    reg_number: '',
    nickname: '',
    category_id: '',
    status: 'active',
  });

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setIsFetchingCategories(true);
        const response = await fetch('/api/admin/categories');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch categories');
        const filtered = ((data.categories || []) as VehicleCategoryOption[]).filter((category) =>
          isApplicableToType(category.applies_to, 'van')
        );
        setCategories(filtered);
      } catch (fetchError: unknown) {
        setError(getErrorMessage(fetchError, 'Unable to load categories'));
      } finally {
        setIsFetchingCategories(false);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (open) return;
    setError('');
    setFormData({
      reg_number: '',
      nickname: '',
      category_id: '',
      status: 'active',
    });
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (!formData.reg_number.trim()) {
      setError('Registration is required');
      return;
    }
    if (!formData.category_id) {
      setError('Category is required');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch('/api/admin/vans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reg_number: formatRegistrationForStorage(formData.reg_number),
          nickname: formData.nickname.trim() || null,
          category_id: formData.category_id,
          status: formData.status,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(data.error, 'Failed to create van'));

      toast.success('Van added successfully');
      await onSuccess?.();
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(getErrorMessage(submitError, 'Failed to create van'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <OnceDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Van"
      description="Create a van asset with required category details."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <p className="rounded border border-red-700 bg-red-900/20 p-2 text-sm text-red-300">{error}</p> : null}
        <div className="space-y-2">
          <Label htmlFor="van-reg">Registration *</Label>
          <Input
            id="van-reg"
            value={formData.reg_number}
            onChange={(event) => setFormData((prev) => ({ ...prev, reg_number: formatRegistrationForInput(event.target.value) }))}
            placeholder="AB12 CDE"
            className="bg-slate-900 text-white"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="van-nickname">Nickname</Label>
          <Input
            id="van-nickname"
            value={formData.nickname}
            onChange={(event) => setFormData((prev) => ({ ...prev, nickname: event.target.value }))}
            placeholder="Optional"
            className="bg-slate-900 text-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="van-category">Category *</Label>
          <Select
            value={formData.category_id}
            onValueChange={(value) => setFormData((prev) => ({ ...prev, category_id: value }))}
            disabled={isFetchingCategories}
          >
            <SelectTrigger id="van-category" className="bg-slate-900 text-white">
              <SelectValue placeholder={isFetchingCategories ? 'Loading categories...' : 'Select category'} />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900">
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id} className="text-white">
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="van-status">Status</Label>
          <Select value={formData.status} onValueChange={(value) => setFormData((prev) => ({ ...prev, status: value }))}>
            <SelectTrigger id="van-status" className="bg-slate-900 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900">
              <SelectItem value="active" className="text-white">
                Active
              </SelectItem>
              <SelectItem value="inactive" className="text-white">
                Inactive
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-slate-600 text-white">
            Cancel
          </Button>
          <Button type="submit" className="bg-maintenance hover:bg-maintenance-dark" disabled={isLoading || isFetchingCategories}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add Van
          </Button>
        </div>
      </form>
    </OnceDialog>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

