'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OnceDialog } from '@/components/ui/once-ui';
import { formatRegistrationForInput, formatRegistrationForStorage, type HgvCategoryOption } from './utils';

interface AddHgvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
}

interface HgvFormState {
  reg_number: string;
  nickname: string;
  category_id: string;
  status: string;
}

const INITIAL_STATE: HgvFormState = {
  reg_number: '',
  nickname: '',
  category_id: '',
  status: 'active',
};

export function AddHgvDialog({ open, onOpenChange, onSuccess }: AddHgvDialogProps) {
  const queryClient = useQueryClient();
  const [categories, setCategories] = useState<HgvCategoryOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingCategories, setIsFetchingCategories] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<HgvFormState>(INITIAL_STATE);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setIsFetchingCategories(true);
        const response = await fetch('/api/admin/hgv-categories');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch HGV categories');
        setCategories((data.categories || []) as HgvCategoryOption[]);
      } catch (fetchError: unknown) {
        setError(getErrorMessage(fetchError, 'Unable to load HGV categories'));
      } finally {
        setIsFetchingCategories(false);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (open) return;
    setError('');
    setFormData(INITIAL_STATE);
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (!formData.reg_number.trim()) return setError('Registration is required');
    if (!formData.category_id) return setError('Category is required');

    try {
      setIsLoading(true);
      const createHgvResponse = await fetch('/api/admin/hgvs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reg_number: formatRegistrationForStorage(formData.reg_number),
          category_id: formData.category_id,
          nickname: formData.nickname.trim() || null,
          status: formData.status,
        }),
      });

      const createHgvData = await createHgvResponse.json();
      if (!createHgvResponse.ok) throw new Error(getErrorMessage(createHgvData.error, 'Failed to create HGV'));

      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      toast.success('HGV added successfully');
      await onSuccess?.();
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(getErrorMessage(submitError, 'Failed to create HGV'));
    } finally {
      setIsLoading(false);
    }
  }

  function updateField<Key extends keyof HgvFormState>(field: Key, value: HgvFormState[Key]) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <OnceDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add HGV"
      description="Create an HGV asset with required category details."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <p className="rounded border border-red-700 bg-red-900/20 p-2 text-sm text-red-300">{error}</p> : null}
        <div className="space-y-2">
          <Label htmlFor="hgv-reg">Registration *</Label>
          <Input
            id="hgv-reg"
            value={formData.reg_number}
            onChange={(event) => updateField('reg_number', formatRegistrationForInput(event.target.value))}
            placeholder="AB12 CDE"
            className="bg-slate-900 text-white"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hgv-nickname">Nickname</Label>
          <Input
            id="hgv-nickname"
            value={formData.nickname}
            onChange={(event) => updateField('nickname', event.target.value)}
            placeholder="Optional"
            className="bg-slate-900 text-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hgv-category">Category *</Label>
          <Select
            value={formData.category_id}
            onValueChange={(value) => updateField('category_id', value)}
            disabled={isFetchingCategories}
          >
            <SelectTrigger id="hgv-category" className="bg-slate-900 text-white">
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
          <Label htmlFor="hgv-status">Status</Label>
          <Select value={formData.status} onValueChange={(value) => updateField('status', value)}>
            <SelectTrigger id="hgv-status" className="bg-slate-900 text-white">
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
            Add HGV
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

