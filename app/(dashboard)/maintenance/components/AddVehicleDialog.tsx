'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/utils/logger';

interface AddVehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface Category {
  id: string;
  name: string;
}

export function AddVehicleDialog({
  open,
  onOpenChange,
  onSuccess
}: AddVehicleDialogProps) {
  const queryClient = useQueryClient();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    reg_number: '',
    category_id: '',
    status: 'active',
    nickname: '',
  });
  const [error, setError] = useState('');

  // Fetch categories when dialog opens
  useEffect(() => {
    if (open) {
      fetchCategories();
    }
  }, [open]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setFormData({
        reg_number: '',
        category_id: '',
        status: 'active',
        nickname: '',
      });
      setError('');
    }
  }, [open]);

  async function fetchCategories() {
    try {
      const response = await fetch('/api/admin/categories');
      const data = await response.json();
      if (response.ok) {
        setCategories(data.categories || []);
      }
    } catch (error) {
      logger.error('Error fetching categories', error, 'AddVehicleDialog');
    }
  }

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
    
    // Validate
    if (!formData.reg_number.trim()) {
      setError('Registration number is required');
      return;
    }
    
    if (!formData.category_id) {
      setError('Category is required');
      return;
    }

    try {
      setLoading(true);
      
      // Format registration number
      const formattedReg = formatRegistration(formData.reg_number);
      
      const response = await fetch('/api/admin/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          reg_number: formattedReg,
          nickname: formData.nickname.trim() || null, // Send null if empty
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Check sync result for appropriate messaging
        const syncResult = data.syncResult;
        
        if (syncResult?.success) {
          toast.success('Vehicle added successfully', {
            description: `${formattedReg} has been added with TAX and MOT data synced.`,
          });
        } else if (syncResult?.skipped) {
          toast.success('Vehicle added successfully', {
            description: `${formattedReg} has been added (test vehicle, sync skipped).`,
          });
        } else {
          toast.success('Vehicle added', {
            description: data.message || `${formattedReg} has been added. ${syncResult?.warning || 'API sync will retry automatically.'}`,
            duration: 5000,
          });
        }
        
        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['maintenance'] });
        
        onSuccess?.();
        onOpenChange(false);
      } else {
        setError(data.error || 'Failed to add vehicle');
        toast.error('Failed to add vehicle', {
          description: data.error || 'Please try again.',
        });
      }
    } catch (error: any) {
      logger.error('Error adding vehicle', error, 'AddVehicleDialog');
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
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">Add New Vehicle</DialogTitle>
          <DialogDescription className="text-slate-400">
            Add a new vehicle to the fleet management system.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Registration Number */}
          <div className="space-y-2">
            <Label htmlFor="reg_number" className="text-white">
              Registration Number <span className="text-red-400">*</span>
            </Label>
            <Input
              id="reg_number"
              value={formData.reg_number}
              onChange={(e) => handleRegistrationChange(e.target.value)}
              placeholder="e.g., AB12 CDE or A10 ABC"
              className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 uppercase"
              disabled={loading}
              required
              maxLength={9}
            />
            <p className="text-xs text-slate-400">
              Auto-formatted: UPPERCASE with space after 4th character
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
              placeholder="e.g., Andy's Van, Red Pickup, Main Truck"
              className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
              disabled={loading}
            />
            <p className="text-xs text-slate-400">
              A friendly name to help identify this vehicle quickly
            </p>
          </div>

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
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 dark:text-slate-100 text-slate-900">
                {categories.map((category) => (
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
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
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
                  Adding & Syncing...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Vehicle
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
