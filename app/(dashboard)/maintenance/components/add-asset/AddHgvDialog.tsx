'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OnceDialog } from '@/components/ui/once-ui';
import { formatRegistrationForInput, formatRegistrationForStorage, parseMileage, type HgvCategoryOption } from './utils';

interface AddHgvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
}

interface HgvFormState {
  reg_number: string;
  nickname: string;
  current_mileage: string;
  category_id: string;
  status: string;
  tax_due_date: string;
  mot_due_date: string;
  six_weekly_inspection_due_date: string;
  next_service_mileage: string;
  first_aid_kit_expiry: string;
  fire_extinguisher_due_date: string;
  taco_calibration_due_date: string;
}

const INITIAL_STATE: HgvFormState = {
  reg_number: '',
  nickname: '',
  current_mileage: '',
  category_id: '',
  status: 'active',
  tax_due_date: '',
  mot_due_date: '',
  six_weekly_inspection_due_date: '',
  next_service_mileage: '',
  first_aid_kit_expiry: '',
  fire_extinguisher_due_date: '',
  taco_calibration_due_date: '',
};

export function AddHgvDialog({ open, onOpenChange, onSuccess }: AddHgvDialogProps) {
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
    if (!formData.nickname.trim()) return setError('Nickname is required');
    if (!formData.current_mileage.trim()) return setError('Mileage is required');
    if (!formData.category_id) return setError('Category is required');
    if (!formData.tax_due_date) return setError('Tax Due is required');
    if (!formData.mot_due_date) return setError('MOT Due is required');
    if (!formData.six_weekly_inspection_due_date) return setError('6 Weekly Inspection Due is required');
    if (!formData.next_service_mileage.trim()) return setError('Service Due is required');
    if (!formData.first_aid_kit_expiry) return setError('First Aid Kit Due is required');
    if (!formData.fire_extinguisher_due_date) return setError('Fire Extinguisher Due is required');
    if (!formData.taco_calibration_due_date) return setError('Taco Calibration Due is required');

    const currentMileage = parseMileage(formData.current_mileage);
    const nextServiceMileage = parseMileage(formData.next_service_mileage);
    if (currentMileage == null) return setError('Mileage must be a valid whole number');
    if (nextServiceMileage == null) return setError('Service Due must be a valid whole number');

    try {
      setIsLoading(true);
      const createHgvResponse = await fetch('/api/admin/hgvs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reg_number: formatRegistrationForStorage(formData.reg_number),
          category_id: formData.category_id,
          nickname: formData.nickname.trim(),
          status: formData.status,
        }),
      });

      const createHgvData = await createHgvResponse.json();
      if (!createHgvResponse.ok) throw new Error(getErrorMessage(createHgvData.error, 'Failed to create HGV'));

      const hgvId = createHgvData?.hgv?.id;
      if (!hgvId) throw new Error('HGV created but ID was missing from response');

      const createMaintenanceResponse = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hgv_id: hgvId,
          comment: 'Initial maintenance setup from Add HGV flow.',
          current_mileage: currentMileage,
          tax_due_date: formData.tax_due_date,
          mot_due_date: formData.mot_due_date,
          next_service_mileage: nextServiceMileage,
          first_aid_kit_expiry: formData.first_aid_kit_expiry,
          six_weekly_inspection_due_date: formData.six_weekly_inspection_due_date,
          fire_extinguisher_due_date: formData.fire_extinguisher_due_date,
          taco_calibration_due_date: formData.taco_calibration_due_date,
        }),
      });

      if (!createMaintenanceResponse.ok) {
        const maintenanceData = await createMaintenanceResponse.json();
        throw new Error(getErrorMessage(maintenanceData.error, 'HGV created, but maintenance setup failed'));
      }

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
      description="Create an HGV with required compliance and maintenance due fields."
      className="max-w-3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <p className="rounded border border-red-700 bg-red-900/20 p-2 text-sm text-red-300">{error}</p> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hgv-reg">Registration *</Label>
            <Input
              id="hgv-reg"
              value={formData.reg_number}
              onChange={(event) => updateField('reg_number', formatRegistrationForInput(event.target.value))}
              className="bg-slate-900 text-white"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hgv-nickname">Nickname *</Label>
            <Input
              id="hgv-nickname"
              value={formData.nickname}
              onChange={(event) => updateField('nickname', event.target.value)}
              className="bg-slate-900 text-white"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hgv-mileage">Mileage *</Label>
            <Input
              id="hgv-mileage"
              type="number"
              value={formData.current_mileage}
              onChange={(event) => updateField('current_mileage', event.target.value)}
              className="bg-slate-900 text-white"
              required
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
            <Label htmlFor="hgv-tax">Tax Due *</Label>
            <Input
              id="hgv-tax"
              type="date"
              value={formData.tax_due_date}
              onChange={(event) => updateField('tax_due_date', event.target.value)}
              className="bg-slate-900 text-white"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hgv-mot">MOT Due *</Label>
            <Input
              id="hgv-mot"
              type="date"
              value={formData.mot_due_date}
              onChange={(event) => updateField('mot_due_date', event.target.value)}
              className="bg-slate-900 text-white"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hgv-six-weekly">6 Weekly Inspection Due *</Label>
            <Input
              id="hgv-six-weekly"
              type="date"
              value={formData.six_weekly_inspection_due_date}
              onChange={(event) => updateField('six_weekly_inspection_due_date', event.target.value)}
              className="bg-slate-900 text-white"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hgv-service">Service Due *</Label>
            <Input
              id="hgv-service"
              type="number"
              value={formData.next_service_mileage}
              onChange={(event) => updateField('next_service_mileage', event.target.value)}
              className="bg-slate-900 text-white"
              placeholder="Next service mileage"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hgv-first-aid">First Aid Kit Due *</Label>
            <Input
              id="hgv-first-aid"
              type="date"
              value={formData.first_aid_kit_expiry}
              onChange={(event) => updateField('first_aid_kit_expiry', event.target.value)}
              className="bg-slate-900 text-white"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hgv-fire">Fire Extinguisher Due *</Label>
            <Input
              id="hgv-fire"
              type="date"
              value={formData.fire_extinguisher_due_date}
              onChange={(event) => updateField('fire_extinguisher_due_date', event.target.value)}
              className="bg-slate-900 text-white"
              required
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="hgv-taco">Taco Calibration Due *</Label>
            <Input
              id="hgv-taco"
              type="date"
              value={formData.taco_calibration_due_date}
              onChange={(event) => updateField('taco_calibration_due_date', event.target.value)}
              className="bg-slate-900 text-white"
              required
            />
          </div>
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

