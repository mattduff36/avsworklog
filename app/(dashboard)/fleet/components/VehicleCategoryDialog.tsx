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
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Truck, HardHat } from 'lucide-react';
import { toast } from 'sonner';

interface VehicleCategory {
  id: string;
  name: string;
  description: string | null;
  applies_to?: string[];
}

interface VehicleCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  category?: VehicleCategory | null;
  onSuccess?: () => void;
}

export function VehicleCategoryDialog({
  open,
  onOpenChange,
  mode,
  category,
  onSuccess,
}: VehicleCategoryDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [appliesToVehicle, setAppliesToVehicle] = useState(true);
  const [appliesToPlant, setAppliesToPlant] = useState(false);

  // Reset form when dialog opens/closes or category changes
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && category) {
        setName(category.name);
        setDescription(category.description || '');
        const appliesTo = category.applies_to || ['vehicle'];
        setAppliesToVehicle(appliesTo.includes('vehicle'));
        setAppliesToPlant(appliesTo.includes('plant'));
      } else {
        setName('');
        setDescription('');
        setAppliesToVehicle(true);
        setAppliesToPlant(false);
      }
    }
  }, [open, mode, category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast.error('Category name is required');
      return;
    }

    if (!appliesToVehicle && !appliesToPlant) {
      toast.error('Category must apply to at least one asset type');
      return;
    }

    setLoading(true);

    try {
      const url = mode === 'create' 
        ? '/api/admin/categories'
        : `/api/admin/categories/${category?.id}`;
      
      const method = mode === 'create' ? 'POST' : 'PUT';

      const appliesTo: string[] = [];
      if (appliesToVehicle) appliesTo.push('vehicle');
      if (appliesToPlant) appliesTo.push('plant');

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          applies_to: appliesTo,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save category');
      }

      toast.success(
        mode === 'create' 
          ? 'Vehicle category created successfully'
          : 'Vehicle category updated successfully'
      );

      onOpenChange(false);
      onSuccess?.();
      router.refresh();
    } catch (error: any) {
      console.error('Error saving vehicle category:', error);
      toast.error(error.message || 'Failed to save category');
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
              {mode === 'create' ? 'Add Vehicle Category' : 'Edit Vehicle Category'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {mode === 'create'
                ? 'Create a new vehicle category for fleet organization'
                : 'Update vehicle category details'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Category Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Vans, Cars, HGVs"
                className="bg-slate-800 border-slate-700 dark:text-slate-100 text-slate-900"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                className="bg-slate-800 border-slate-700 min-h-[80px] dark:text-slate-100 text-slate-900"
                disabled={loading}
              />
            </div>

            {/* Applies To Checkboxes */}
            <div className="space-y-3">
              <Label>Applies To *</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="applies-vehicle"
                    checked={appliesToVehicle}
                    onCheckedChange={(checked) => setAppliesToVehicle(checked as boolean)}
                    disabled={loading}
                    className="border-slate-600"
                  />
                  <Label htmlFor="applies-vehicle" className="text-white cursor-pointer flex items-center gap-2">
                    <Truck className="h-4 w-4 text-blue-400" />
                    Vehicles
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="applies-plant"
                    checked={appliesToPlant}
                    onCheckedChange={(checked) => setAppliesToPlant(checked as boolean)}
                    disabled={loading}
                    className="border-slate-600"
                  />
                  <Label htmlFor="applies-plant" className="text-white cursor-pointer flex items-center gap-2">
                    <HardHat className="h-4 w-4 text-orange-400" />
                    Plant Machinery
                  </Label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Select which asset types this category applies to
              </p>
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
              className="bg-blue-600 hover:bg-blue-700"
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
