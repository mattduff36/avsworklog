'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';
import { getTaskContent } from '@/lib/utils/serviceTaskCreation';
import { getRecentVehicleIds, recordRecentVehicleId, splitVehiclesByRecent } from '@/lib/utils/recentVehicles';
import { useAttachmentTemplates } from '@/lib/hooks/useAttachmentTemplates';

type Vehicle = {
  id: string;
  reg_number: string | null;
  plant_id: string | null;
  nickname: string | null;
  asset_type: 'vehicle' | 'plant' | 'tool';
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
  const [recentVehicleIds, setRecentVehicleIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('');
  const [workshopComments, setWorkshopComments] = useState('');
  const [newMeterReading, setNewMeterReading] = useState('');
  const [currentMeterReading, setCurrentMeterReading] = useState<number | null>(null);
  const [meterReadingType, setMeterReadingType] = useState<'mileage' | 'hours'>('mileage');
  const [submitting, setSubmitting] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  
  // Fetch available attachment templates
  const { templates: attachmentTemplates } = useAttachmentTemplates();

  // Load initial data and set prefilled values
  useEffect(() => {
    if (open) {
      fetchVehicles();
      fetchCategories();
      fetchSubcategories();
      
      // Load recent vehicle IDs
      if (user?.id) {
        setRecentVehicleIds(getRecentVehicleIds(user.id));
      }
      
      // Set initial values if provided
      if (initialVehicleId) {
        setSelectedVehicleId(initialVehicleId);
        fetchCurrentMeterReading(initialVehicleId);
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
        .select('id, reg_number, plant_id, nickname, asset_type')
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

  const fetchCurrentMeterReading = async (vehicleId: string) => {
    try {
      // First get the vehicle to check asset_type
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles')
        .select('asset_type')
        .eq('id', vehicleId)
        .single();

      if (vehicleError) throw vehicleError;

      const isPlant = vehicleData?.asset_type === 'plant';
      setMeterReadingType(isPlant ? 'hours' : 'mileage');

      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select(isPlant ? 'current_hours' : 'current_mileage')
        .eq('vehicle_id', vehicleId)
        .single();

      if (error) {
        // If no maintenance record exists, set to null
        if (error.code === 'PGRST116') {
          setCurrentMeterReading(null);
          return;
        }
        throw error;
      }

      setCurrentMeterReading(isPlant ? (data?.current_hours || null) : (data?.current_mileage || null));
    } catch (err) {
      console.error('Error fetching current meter reading:', err);
      setCurrentMeterReading(null);
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
    // Validate user is authenticated before proceeding
    if (!user?.id) {
      toast.error('You must be logged in to create tasks');
      onOpenChange(false);
      return;
    }

    if (!selectedVehicleId || !selectedSubcategoryId || !workshopComments.trim() || !newMeterReading.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (workshopComments.length < 10) {
      toast.error('Comments must be at least 10 characters');
      return;
    }

    const readingValue = parseInt(newMeterReading);
    if (isNaN(readingValue) || readingValue < 0) {
      toast.error(`Please enter a valid ${meterReadingType === 'hours' ? 'hours' : 'mileage'}`);
      return;
    }

    // Validate reading is >= current reading
    if (currentMeterReading !== null && readingValue < currentMeterReading) {
      const unit = meterReadingType === 'hours' ? 'hours' : 'miles';
      toast.error(`${meterReadingType === 'hours' ? 'Hours' : 'Mileage'} must be equal to or greater than current reading (${currentMeterReading.toLocaleString()} ${unit})`);
      return;
    }

    try {
      setSubmitting(true);

      // Generate title based on alert type if provided, otherwise use generic title
      const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
      const assetIdLabel = selectedVehicle?.asset_type === 'plant' 
        ? (selectedVehicle?.plant_id ?? 'Unknown Plant')
        : (selectedVehicle?.reg_number ?? 'Unknown Vehicle');
      const taskTitle = alertType 
        ? getTaskContent(alertType, assetIdLabel, '').title
        : `Workshop Task - ${assetIdLabel}`;

      // Create the workshop task
      const { data: newTask, error } = await supabase
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
          created_by: user.id,
        })
        .select('id')
        .single();

      if (error) throw error;

      // Create attachments for selected templates
      if (newTask && selectedTemplateIds.length > 0) {
        const attachmentErrors: string[] = [];
        
        for (const templateId of selectedTemplateIds) {
          const { error: attachmentError } = await supabase
            .from('workshop_task_attachments')
            .insert({
              task_id: newTask.id,
              template_id: templateId,
              status: 'pending',
              created_by: user.id,
            });

          if (attachmentError) {
            console.error('Error creating attachment:', attachmentError);
            attachmentErrors.push(templateId);
          }
        }

        if (attachmentErrors.length > 0) {
          toast.error(`Task created but ${attachmentErrors.length} attachment(s) failed to link`);
        }
      }

      // Update vehicle meter reading in vehicle_maintenance table
      const updateData = meterReadingType === 'hours' 
        ? {
            vehicle_id: selectedVehicleId,
            current_hours: readingValue,
            last_hours_update: new Date().toISOString(),
            last_updated_at: new Date().toISOString(),
            last_updated_by: user.id,
          }
        : {
            vehicle_id: selectedVehicleId,
            current_mileage: readingValue,
            last_mileage_update: new Date().toISOString(),
            last_updated_at: new Date().toISOString(),
            last_updated_by: user.id,
          };

      const { error: meterReadingError } = await supabase
        .from('vehicle_maintenance')
        .upsert(updateData, {
          onConflict: 'vehicle_id',
        });

      if (meterReadingError) {
        console.error('Error updating meter reading:', meterReadingError);
        toast.error(`Task created but failed to update ${meterReadingType}`);
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
    setSelectedTemplateIds([]);
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Create Workshop Task</DialogTitle>
          <DialogDescription>
            Add a new vehicle repair or maintenance task
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vehicle">
              Vehicle <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedVehicleId} onValueChange={(value) => {
              setSelectedVehicleId(value);
              // Record as recent vehicle selection
              if (value && user?.id) {
                const updatedRecent = recordRecentVehicleId(user.id, value);
                setRecentVehicleIds(updatedRecent);
              }
              if (value) {
                fetchCurrentMeterReading(value);
              } else {
                setCurrentMeterReading(null);
              }
            }}>
              <SelectTrigger id="vehicle">
                <SelectValue placeholder="Select vehicle" />
              </SelectTrigger>
              <SelectContent>
                {(() => {
                  const { recentVehicles, otherVehicles } = splitVehiclesByRecent(vehicles, recentVehicleIds);
                  return (
                    <>
                      {recentVehicles.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Recent</SelectLabel>
                          {recentVehicles.map((vehicle) => (
                            <SelectItem key={vehicle.id} value={vehicle.id}>
                              {vehicle.reg_number || vehicle.plant_id}{vehicle.nickname ? ` (${vehicle.nickname})` : ''}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {recentVehicles.length > 0 && otherVehicles.length > 0 && (
                        <SelectSeparator />
                      )}
                      {otherVehicles.length > 0 && (
                        <SelectGroup>
                          {recentVehicles.length > 0 && (
                            <SelectLabel>All Vehicles</SelectLabel>
                          )}
                          {otherVehicles.map((vehicle) => (
                            <SelectItem key={vehicle.id} value={vehicle.id}>
                              {vehicle.reg_number || vehicle.plant_id}{vehicle.nickname ? ` (${vehicle.nickname})` : ''}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </>
                  );
                })()}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">
              Category <span className="text-red-500">*</span>
            </Label>
            <Select value={selectedCategoryId} onValueChange={handleCategoryChange}>
              <SelectTrigger id="category">
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
            <Label htmlFor="subcategory">
              Subcategory <span className="text-red-500">*</span>
            </Label>
            <Select 
              value={selectedSubcategoryId} 
              onValueChange={setSelectedSubcategoryId}
              disabled={!selectedCategoryId}
            >
              <SelectTrigger id="subcategory">
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
            <Label htmlFor="mileage">
              {meterReadingType === 'hours' ? 'Current Hours' : 'Current Mileage'} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="mileage"
              type="number"
              value={newMeterReading}
              onChange={(e) => setNewMeterReading(e.target.value)}
              placeholder={`Enter current ${meterReadingType === 'hours' ? 'hours' : 'mileage'}`}
              min="0"
              step="1"
            />
            {currentMeterReading !== null && (
              <p className="text-xs text-muted-foreground">
                Last recorded: {currentMeterReading.toLocaleString()} {meterReadingType === 'hours' ? 'hours' : 'miles'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">
              Task Details <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="comments"
              value={workshopComments}
              onChange={(e) => setWorkshopComments(e.target.value)}
              placeholder="Describe the work needed (minimum 10 characters)"
              className="min-h-[100px]"
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground">
              {workshopComments.length}/300 characters (minimum 10)
            </p>
          </div>

          {/* Attachment Templates Selection */}
          {attachmentTemplates.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Attachments (Optional)
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Add service checklists or documentation to complete later
              </p>
              <div className="space-y-2 max-h-32 overflow-y-auto p-2 border rounded-md bg-muted/30">
                {attachmentTemplates.map((template) => (
                  <div key={template.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`template-${template.id}`}
                      checked={selectedTemplateIds.includes(template.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedTemplateIds(prev => [...prev, template.id]);
                        } else {
                          setSelectedTemplateIds(prev => prev.filter(id => id !== template.id));
                        }
                      }}
                    />
                    <Label
                      htmlFor={`template-${template.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {template.name}
                    </Label>
                  </div>
                ))}
              </div>
              {selectedTemplateIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selectedTemplateIds.length} attachment{selectedTemplateIds.length > 1 ? 's' : ''} will be added to this task
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAddTask}
            disabled={submitting || !selectedVehicleId || !selectedSubcategoryId || workshopComments.length < 10 || !newMeterReading.trim()}
            className="bg-workshop hover:bg-workshop-dark text-white"
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
