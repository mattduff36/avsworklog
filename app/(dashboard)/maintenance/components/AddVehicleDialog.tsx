'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
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
import { Loader2, Plus, Truck, HardHat } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { logger } from '@/lib/utils/logger';
import { normalizePlantSerialNumber, isValidPlantSerialNumber } from '@/lib/utils/plant-serial-number';

interface AddVehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>; // ✅ Support both sync and async callbacks
  assetType?: AssetType; // Default to 'vehicle' if not provided
}

interface Category {
  id: string;
  name: string;
}

type AssetType = 'vehicle' | 'plant';

export function AddVehicleDialog({
  open,
  onOpenChange,
  onSuccess,
  assetType: initialAssetType = 'vehicle', // Default to 'vehicle'
}: AddVehicleDialogProps) {
  const queryClient = useQueryClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>(initialAssetType);
  const [formData, setFormData] = useState({
    reg_number: '',
    plant_id: '',
    category_id: '',
    status: 'active',
    nickname: '',
    serial_number: '',
    year: '',
    weight_class: '',
  });
  const [error, setError] = useState('');

  // ✅ Memoize fetchCategories with proper dependencies
  const fetchCategories = useCallback(async () => {
    try {
      const supabase = createClient(); // Create client inside callback
      const { data, error } = await supabase
        .from('vehicle_categories')
        .select('*')
        .order('name');
      
      if (error) throw error;
      
      // ✅ Filter categories based on asset type
      // Consistent with SELECT dropdown: undefined applies_to defaults to ['vehicle']
      const filtered = (data || []).filter(cat => {
        const appliesTo = cat.applies_to || ['vehicle']; // ✅ Default to ['vehicle']
        return appliesTo.includes(assetType);
      });
      
      setCategories(filtered);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  }, [assetType]); // ✅ Only depends on assetType

  // Fetch categories when dialog opens
  useEffect(() => {
    if (open) {
      // ✅ Set asset type FIRST, then fetch categories
      // This ensures fetchCategories uses the correct assetType
      setAssetType(initialAssetType);
      // fetchCategories will run automatically via its dependency on assetType
    }
  }, [open, initialAssetType]);

  // ✅ Fetch categories when assetType changes
  useEffect(() => {
    if (open) {
      fetchCategories();
    }
  }, [open, fetchCategories]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setAssetType(initialAssetType); // Reset to prop value, not hardcoded 'vehicle'
      setFormData({
        reg_number: '',
        plant_id: '',
        category_id: '',
        status: 'active',
        nickname: '',
        serial_number: '',
        year: '',
        weight_class: '',
      });
      setError('');
    }
  }, [open, initialAssetType]);

  // Handle registration input with auto-uppercase and smart spacing
  function handleRegistrationChange(value: string) {
    // Convert to uppercase
    let formatted = value.toUpperCase();
    
    // Only allow alphanumeric characters and spaces
    formatted = formatted.replace(/[^A-Z0-9\s]/g, '');
    
    // Smart spacing logic
    const hasSpace = formatted.includes(' ');
    const cleanedLength = formatted.replace(/\s/g, '').length;
    
    // If user hasn't added a space and we have 4+ chars, auto-add space after 4th char
    if (!hasSpace && cleanedLength >= 4) {
      const cleaned = formatted.replace(/\s/g, '');
      formatted = `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
    }
    
    setFormData({ ...formData, reg_number: formatted });
  }

  // Format UK registration plates for submission (LLNNLLL -> LLNN LLL)
  function formatRegistration(reg: string): string {
    const cleaned = reg.replace(/\s/g, '').toUpperCase();
    
    // Check if it matches UK format: 2 letters, 2 numbers, 3 letters (7 chars total)
    if (cleaned.length === 7 && /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned)) {
      return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
    }
    
    return cleaned;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    
    // Validate based on asset type
    if (assetType === 'vehicle' && !formData.reg_number.trim()) {
      setError('Registration number is required for vehicles');
      return;
    }
    
    if (assetType === 'plant' && !formData.plant_id.trim()) {
      setError('Plant ID is required for plant machinery');
      return;
    }
    
    if (!formData.category_id) {
      setError('Category is required');
      return;
    }

    // Validate serial number for plant (if provided)
    if (assetType === 'plant' && formData.serial_number.trim()) {
      if (!isValidPlantSerialNumber(formData.serial_number.trim())) {
        setError('Serial Number must contain only letters and numbers (no spaces or special characters)');
        return;
      }
    }

    try {
      setLoading(true);
      
      // Prepare payload based on asset type
      const payload: any = {
        asset_type: assetType,
        category_id: formData.category_id,
        status: formData.status,
        nickname: formData.nickname.trim() || null,
      };

      if (assetType === 'vehicle') {
        payload.reg_number = formatRegistration(formData.reg_number);
      } else {
        payload.plant_id = formData.plant_id.trim();
        payload.reg_number = formData.reg_number.trim() || null;
        payload.serial_number = formData.serial_number.trim() || null;
        payload.year = formData.year ? parseInt(formData.year) : null;
        payload.weight_class = formData.weight_class.trim() || null;
      }
      
      const response = await fetch('/api/admin/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        const identifier = assetType === 'vehicle' ? payload.reg_number : formData.plant_id;
        const syncResult = data.syncResult;
        
        if (assetType === 'plant' || syncResult?.skipped) {
          toast.success(`${assetType === 'vehicle' ? 'Vehicle' : 'Plant machinery'} added successfully`, {
            description: `${identifier} has been added to the system.`,
          });
        } else if (syncResult?.success) {
          toast.success('Vehicle added successfully', {
            description: `${identifier} has been added with TAX and MOT data synced.`,
          });
        } else {
          toast.success(`${assetType === 'vehicle' ? 'Vehicle' : 'Plant'} added`, {
            description: data.message || `${identifier} has been added. ${syncResult?.warning || ''}`,
            duration: 5000,
          });
        }
        
        queryClient.invalidateQueries({ queryKey: ['maintenance'] });
        await onSuccess?.(); // ✅ Await async callback before closing dialog
        onOpenChange(false);
      } else {
        // Handle unique constraint violation for serial number
        const errorMessage = data.error || `Failed to add ${assetType}`;
        const isSerialDuplicate = errorMessage.toLowerCase().includes('serial') && errorMessage.toLowerCase().includes('unique');
        
        setError(errorMessage);
        toast.error(`Failed to add ${assetType}`, {
          description: isSerialDuplicate 
            ? 'This serial number is already in use. Please use a unique serial number.'
            : errorMessage || 'Please try again.',
        });
      }
    } catch (error: any) {
      logger.error(`Error adding ${assetType}`, error, 'AddVehicleDialog');
      setError('An unexpected error occurred');
      toast.error('An unexpected error occurred', {
        description: 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border text-white max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Add New Asset</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Add a new vehicle or plant machinery to the fleet management system.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Asset Type Selector */}
          <div className="space-y-2">
            <Label className="text-white">Asset Type <span className="text-red-400">*</span></Label>
            <Tabs value={assetType} onValueChange={(v) => setAssetType(v as AssetType)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="vehicle" className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Vehicle
                </TabsTrigger>
                <TabsTrigger value="plant" className="flex items-center gap-2">
                  <HardHat className="h-4 w-4" />
                  Plant
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Vehicle Registration Number */}
          {assetType === 'vehicle' && (
            <div className="space-y-2">
              <Label htmlFor="reg_number" className="text-white">
                Registration Number <span className="text-red-400">*</span>
              </Label>
              <Input
                id="reg_number"
                value={formData.reg_number}
                onChange={(e) => handleRegistrationChange(e.target.value)}
                placeholder="e.g., AB12 CDE or A10 ABC"
                className="bg-input border-border text-white placeholder:text-muted-foreground uppercase"
                disabled={loading}
                required={assetType === 'vehicle'}
                maxLength={9}
              />
              <p className="text-xs text-muted-foreground">
                Auto-formatted: UPPERCASE with space after 4th character
              </p>
            </div>
          )}

          {/* Plant ID */}
          {assetType === 'plant' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="plant_id" className="text-white">
                  Plant ID <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="plant_id"
                  value={formData.plant_id}
                  onChange={(e) =>
                    setFormData({ ...formData, plant_id: e.target.value })
                  }
                  placeholder="e.g., 203, DIGGER-01"
                  className="bg-input border-border text-white placeholder:text-muted-foreground"
                  disabled={loading}
                  required={assetType === 'plant'}
                />
                <p className="text-xs text-muted-foreground">
                  Unique identifier for this plant machinery
                </p>
              </div>

              {/* Nickname */}
              <div className="space-y-2">
                <Label htmlFor="nickname" className="text-white">
                  Nickname <span className="text-slate-400 text-xs">(Optional)</span>
                </Label>
                <Input
                  id="nickname"
                  value={formData.nickname}
                  onChange={(e) =>
                    setFormData({ ...formData, nickname: e.target.value })
                  }
                  placeholder="e.g., Mini Excavator, Forklift"
                  className="bg-input border-border text-white placeholder:text-muted-foreground"
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  A friendly name to help identify this plant quickly
                </p>
              </div>

              {/* Serial Number */}
              <div className="space-y-2">
                <Label htmlFor="plant_serial" className="text-white">
                  Serial Number <span className="text-slate-400 text-xs">(Optional)</span>
                </Label>
                <Input
                  id="plant_serial"
                  value={formData.serial_number}
                  onChange={(e) => {
                    const normalized = normalizePlantSerialNumber(e.target.value) || '';
                    setFormData({ ...formData, serial_number: normalized });
                  }}
                  placeholder="e.g., MANUFACTURERSN123"
                  className="bg-input border-border text-white placeholder:text-muted-foreground uppercase"
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  Manufacturer's serial number (alphanumeric only, auto-uppercase)
                </p>
              </div>

              {/* Optional Registration for Plant */}
              <div className="space-y-2">
                <Label htmlFor="plant_reg" className="text-white">
                  Registration Number <span className="text-slate-400 text-xs">(Optional - if road-registered)</span>
                </Label>
                <Input
                  id="plant_reg"
                  value={formData.reg_number}
                  onChange={(e) => {
                    const formatted = e.target.value.toUpperCase().replace(/[^A-Z0-9\s]/g, '');
                    setFormData({ ...formData, reg_number: formatted });
                  }}
                  placeholder="e.g., AB12 CDE"
                  className="bg-input border-border text-white placeholder:text-muted-foreground uppercase"
                  disabled={loading}
                  maxLength={9}
                />
              </div>
            </>
          )}

          {/* Nickname (vehicles only - plant has its own above) */}
          {assetType === 'vehicle' && (
            <div className="space-y-2">
              <Label htmlFor="nickname" className="text-white">
                Nickname <span className="text-slate-400 text-xs">(Optional)</span>
              </Label>
              <Input
                id="nickname"
                value={formData.nickname}
                onChange={(e) =>
                  setFormData({ ...formData, nickname: e.target.value })
                }
                placeholder="e.g., Andy's Van, Red Pickup"
                className="bg-input border-border text-white placeholder:text-muted-foreground"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                A friendly name to help identify this vehicle quickly
              </p>
            </div>
          )}

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category" className="text-white">
              Vehicle Category <span className="text-red-400">*</span>
            </Label>
            <Select
              value={formData.category_id}
              onValueChange={(value) =>
                setFormData({ ...formData, category_id: value })
              }
              disabled={loading}
              required
            >
              <SelectTrigger className="bg-input border-border text-white">
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 dark:text-slate-100 text-slate-900">
                {categories
                  .filter(category => {
                    // ✅ Filter categories based on asset type
                    // Note: fetchCategories already filters, but double-check here for safety
                    const appliesTo = category.applies_to || ['vehicle'];
                    return appliesTo.includes(assetType);
                  })
                  .map((category) => (
                  <SelectItem
                    key={category.id}
                    value={category.id}
                    className="text-white hover:bg-slate-700"
                  >
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label htmlFor="status" className="text-white">
              Status
            </Label>
            <Select
              value={formData.status}
              onValueChange={(value) =>
                setFormData({ ...formData, status: value })
              }
              disabled={loading}
            >
              <SelectTrigger className="bg-input border-border text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 dark:text-slate-100 text-slate-900">
                <SelectItem value="active" className="text-white hover:bg-slate-700">
                  Active
                </SelectItem>
                <SelectItem value="inactive" className="text-white hover:bg-slate-700">
                  Inactive
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {assetType === 'vehicle' ? 'Adding & Syncing...' : 'Adding...'}
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add {assetType === 'vehicle' ? 'Vehicle' : 'Plant'}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
