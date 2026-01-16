'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getTaskContent } from '@/lib/utils/serviceTaskCreation';

type Vehicle = {
  id: string;
  reg_number: string;
  nickname: string | null;
};

type Category = {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  sort_order: number;
};

type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
};

interface CreateWorkshopTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialVehicleId?: string;
  initialCategoryId?: string;
  alertType?: 'Tax' | 'MOT' | 'Service' | 'Cambelt' | 'First Aid Kit';
  onSuccess?: () => void;
}

export function CreateWorkshopTaskDialog({
  open,
  onOpenChange,
  initialVehicleId,
  initialCategoryId,
  alertType,
  onSuccess
}: CreateWorkshopTaskDialogProps) {
  const { user } = useAuth();
  const supabase = createClient();
  
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('');
  const [workshopComments, setWorkshopComments] = useState('');
  const [newMileage, setNewMileage] = useState('');
  const [currentMileage, setCurrentMileage] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load initial data and set prefilled values
  useEffect(() => {
    if (open) {
      fetchVehicles();
      fetchCategories();
      fetchSubcategories();
      
      // Set initial values if provided
      if (initialVehicleId) {
        setSelectedVehicleId(initialVehicleId);
        fetchCurrentMileage(initialVehicleId);
      }
      if (initialCategoryId) {
        setSelectedCategoryId(initialCategoryId);
      }
    }
  }, [open, initialVehicleId, initialCategoryId]);

  const fetchVehicles = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, reg_number, nickname')
        .eq('status', 'active')
        .order('reg_number');

      if (error) throw error;
      setVehicles(data || []);
    } catch (err) {
      console.error('Error fetching vehicles:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('workshop_task_categories')
        .select('id, name, slug, is_active, sort_order')
        .eq('applies_to', 'vehicle')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      
      setCategories(data || []);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const fetchSubcategories = async () => {
    try {
      const { data, error } = await supabase
        .from('workshop_task_subcategories')
        .select('id, category_id, name, slug, is_active, sort_order')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSubcategories(data || []);
    } catch (err) {
      console.error('Error fetching subcategories:', err);
    }
  };

  const fetchCurrentMileage = async (vehicleId: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select('current_mileage')
        .eq('vehicle_id', vehicleId)
        .single();

      if (error) {
        // If no maintenance record exists, set to null
        if (error.code === 'PGRST116') {
          setCurrentMileage(null);
          return;
        }
        throw error;
      }

      setCurrentMileage(data?.current_mileage || null);
    } catch (err) {
      console.error('Error fetching current mileage:', err);
      setCurrentMileage(null);
    }
  };

  // Filter subcategories by selected category
  const filteredSubcategories = selectedCategoryId
    ? subcategories.filter(sub => sub.category_id === selectedCategoryId)
    : [];

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId('');  // Reset subcategory
  };

  const handleAddTask = async () => {
    if (!selectedVehicleId || !selectedSubcategoryId || !workshopComments.trim() || !newMileage.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (workshopComments.length < 10) {
      toast.error('Comments must be at least 10 characters');
      return;
    }

    const mileageValue = parseInt(newMileage);
    if (isNaN(mileageValue) || mileageValue < 0) {
      toast.error('Please enter a valid mileage');
      return;
    }

    // Validate mileage is >= current mileage
    if (currentMileage !== null && mileageValue < currentMileage) {
      toast.error(`Mileage must be equal to or greater than current mileage (${currentMileage.toLocaleString()} miles)`);
      return;
    }

    try {
      setSubmitting(true);

      // Generate title based on alert type if provided, otherwise use generic title
      const regNumber = vehicles.find(v => v.id === selectedVehicleId)?.reg_number || 'Unknown';
      const taskTitle = alertType 
        ? getTaskContent(alertType, regNumber, '').title
        : `Workshop Task - ${regNumber}`;

      // Create the workshop task
      const { error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          vehicle_id: selectedVehicleId,
          workshop_subcategory_id: selectedSubcategoryId,
          workshop_comments: workshopComments,
          title: taskTitle,
          description: workshopComments.substring(0, 200),
          status: 'pending',
          priority: 'medium',
          created_by: user!.id,
        });

      if (error) throw error;

      // Update vehicle mileage in vehicle_maintenance table
      const { error: mileageError } = await supabase
        .from('vehicle_maintenance')
        .upsert({
          vehicle_id: selectedVehicleId,
          current_mileage: mileageValue,
          last_mileage_update: new Date().toISOString(),
          last_updated_at: new Date().toISOString(),
          last_updated_by: user!.id,
        }, {
          onConflict: 'vehicle_id',
        });

      if (mileageError) {
        console.error('Error updating mileage:', mileageError);
        toast.error('Task created but failed to update mileage');
      } else {
        toast.success('Workshop task created successfully');
      }

      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      console.error('Error creating task:', err);
      toast.error('Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedVehicleId('');
    setSelectedCategoryId('');
    setSelectedSubcategoryId('');
    setWorkshopComments('');
    setNewMileage('');
    setCurrentMileage(null);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };
  
  // Wrapper to ensure form is reset on ANY close action
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-slate-900 dark:text-white text-xl">Create Workshop Task</DialogTitle>
          <DialogDescription className="text-slate-600 dark:text-slate-400">
            Add a new vehicle repair or maintenance task
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vehicle" className="text-slate-900 dark:text-white">
              Vehicle <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedVehicleId} onValueChange={(value) => {
              setSelectedVehicleId(value);
              if (value) {
                fetchCurrentMileage(value);
              } else {
                setCurrentMileage(null);
              }
            }}>
              <SelectTrigger id="vehicle" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white">
                <SelectValue placeholder="Select vehicle" />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((vehicle) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.reg_number}{vehicle.nickname ? ` (${vehicle.nickname})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category" className="text-slate-900 dark:text-white">
              Category <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedCategoryId} onValueChange={handleCategoryChange}>
              <SelectTrigger id="category" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subcategory" className="text-slate-900 dark:text-white">
              Subcategory <span className="text-red-500">*</span>
            </Label>
            <Select 
              value={selectedSubcategoryId} 
              onValueChange={setSelectedSubcategoryId}
              disabled={!selectedCategoryId}
            >
              <SelectTrigger id="subcategory" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white">
                <SelectValue placeholder={selectedCategoryId ? "Select subcategory" : "Select a category first"} />
              </SelectTrigger>
              <SelectContent>
                {filteredSubcategories.map((subcategory) => (
                  <SelectItem key={subcategory.id} value={subcategory.id}>
                    {subcategory.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mileage" className="text-slate-900 dark:text-white">
              Current Mileage <span className="text-red-500">*</span>
            </Label>
            <Input
              id="mileage"
              type="number"
              value={newMileage}
              onChange={(e) => setNewMileage(e.target.value)}
              placeholder="Enter current mileage"
              className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white"
              min="0"
              step="1"
            />
            {currentMileage !== null && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Last recorded: {currentMileage.toLocaleString()} miles
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments" className="text-slate-900 dark:text-white">
              Task Details <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="comments"
              value={workshopComments}
              onChange={(e) => setWorkshopComments(e.target.value)}
              placeholder="Describe the work needed (minimum 10 characters)"
              className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white min-h-[100px]"
              maxLength={300}
            />
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {workshopComments.length}/300 characters (minimum 10)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAddTask}
            disabled={submitting || !selectedVehicleId || !selectedSubcategoryId || workshopComments.length < 10 || !newMileage.trim()}
            className="bg-workshop hover:bg-workshop-dark text-white"
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
