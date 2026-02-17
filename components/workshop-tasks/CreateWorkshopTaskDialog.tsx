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
  serial_number: string | null;
  asset_type: 'vehicle' | 'plant' | 'tool';
};

type Category = {
  id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
  sort_order: number;
  requires_subcategories: boolean;
  applies_to: 'vehicle' | 'plant';
};

type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
  workshop_task_categories?: {
    applies_to: 'vehicle' | 'plant';
  };
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
      // Fetch vehicles
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles')
        .select('id, reg_number, nickname')
        .eq('status', 'active')
        .order('reg_number');

      if (vehicleError) throw vehicleError;

      // Fetch plant
      const { data: plantData, error: plantError } = await supabase
        .from('plant')
        .select('id, plant_id, nickname, serial_number')
        .eq('status', 'active')
        .order('plant_id');

      if (plantError) throw plantError;

      // Combine both into a unified list with asset type indicators
      const combinedVehicles = [
        ...(vehicleData || []).map(v => ({
          id: v.id,
          reg_number: v.reg_number,
          plant_id: null,
          nickname: v.nickname,
          asset_type: 'vehicle' as const
        })),
        ...(plantData || []).map(p => ({
          id: p.id,
          reg_number: null,
          plant_id: p.plant_id,
          nickname: p.nickname,
          asset_type: 'plant' as const
        }))
      ];

      setVehicles(combinedVehicles);
    } catch (err) {
      console.error('Error fetching vehicles:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      // Fetch both vehicle and plant categories
      const { data, error } = await supabase
        .from('workshop_task_categories')
        .select('id, name, slug, is_active, sort_order, requires_subcategories, applies_to')
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
      // Fetch all subcategories with their parent category's applies_to
      const { data, error } = await supabase
        .from('workshop_task_subcategories')
        .select(`
          id,
          category_id,
          name,
          slug,
          is_active,
          sort_order,
          workshop_task_categories!inner(applies_to)
        `)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSubcategories(data || []);
    } catch (err) {
      console.error('Error fetching subcategories:', err);
    }
  };

  const fetchCurrentMeterReading = async (assetId: string) => {
    try {
      // First, determine asset type by checking both vehicles and plant tables
      // This is necessary because this function may be called before the vehicles state is populated
      let isPlant = false;
      
      // Check if it's a vehicle
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('id')
        .eq('id', assetId)
        .maybeSingle();
      
      // If not found in vehicles, check plant table
      if (!vehicleData) {
        const { data: plantData } = await supabase
          .from('plant')
          .select('id')
          .eq('id', assetId)
          .maybeSingle();
        
        if (plantData) {
          isPlant = true;
        } else {
          // Asset not found in either table
          setCurrentMeterReading(null);
          return;
        }
      }

      setMeterReadingType(isPlant ? 'hours' : 'mileage');

      // Query vehicle_maintenance table with appropriate filter
      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select(isPlant ? 'current_hours' : 'current_mileage')
        .eq(isPlant ? 'plant_id' : 'vehicle_id', assetId)
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

  // Get selected vehicle's asset type
  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
  const selectedAssetType = selectedVehicle?.asset_type || 'vehicle';

  // Filter categories by selected vehicle's asset type
  const filteredCategories = categories.filter(cat => cat.applies_to === selectedAssetType);

  // Check if selected category requires subcategories
  const selectedCategory = filteredCategories.find(c => c.id === selectedCategoryId);
  const selectedCategoryRequiresSubcategories = selectedCategory?.requires_subcategories ?? false;

  // Filter subcategories by selected category and asset type
  const filteredSubcategories = selectedCategoryId
    ? subcategories.filter(sub => {
        if (sub.category_id !== selectedCategoryId) return false;
        if (sub.workshop_task_categories) {
          return sub.workshop_task_categories.applies_to === selectedAssetType;
        }
        return true;
      })
    : [];

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId('');
  };

  const handleAddTask = async () => {
    if (!user?.id) {
      toast.error('You must be logged in to create tasks');
      onOpenChange(false);
      return;
    }

    const needsSubcategory = selectedCategoryRequiresSubcategories;
    if (!selectedVehicleId || !selectedCategoryId || (needsSubcategory && !selectedSubcategoryId) || !workshopComments.trim() || !newMeterReading.trim()) {
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
      const isPlant = selectedVehicle?.asset_type === 'plant';
      const assetIdLabel = isPlant
        ? (selectedVehicle?.plant_id ?? 'Unknown Plant')
        : (selectedVehicle?.reg_number ?? 'Unknown Vehicle');
      const taskTitle = alertType 
        ? getTaskContent(alertType, assetIdLabel, '').title
        : `Workshop Task - ${assetIdLabel}`;

      // Create the workshop task with correct asset reference
      const taskData: any = {
        action_type: 'workshop_vehicle_task',
        workshop_comments: workshopComments,
        title: taskTitle,
        description: workshopComments.substring(0, 200),
        status: 'pending',
        priority: 'medium',
        created_by: user.id,
      };

      // Set category/subcategory based on whether subcategories are required
      if (selectedCategoryRequiresSubcategories) {
        taskData.workshop_subcategory_id = selectedSubcategoryId;
      } else {
        taskData.workshop_category_id = selectedCategoryId;
        taskData.workshop_subcategory_id = null;
      }

      // Set either vehicle_id or plant_id, not both
      if (isPlant) {
        taskData.plant_id = selectedVehicleId;
      } else {
        taskData.vehicle_id = selectedVehicleId;
      }

      const { data: newTask, error } = await supabase
        .from('actions')
        .insert(taskData)
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

      // Update meter reading in vehicle_maintenance table
      const updateData: any = {
        last_updated_at: new Date().toISOString(),
        last_updated_by: user.id,
      };

      if (isPlant) {
        updateData.plant_id = selectedVehicleId;
        updateData.current_hours = readingValue;
        updateData.last_hours_update = new Date().toISOString();
      } else {
        updateData.vehicle_id = selectedVehicleId;
        updateData.current_mileage = readingValue;
        updateData.last_mileage_update = new Date().toISOString();
      }

      const { error: meterReadingError } = await supabase
        .from('vehicle_maintenance')
        .upsert(updateData, {
          onConflict: isPlant ? 'plant_id' : 'vehicle_id',
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
    setNewMeterReading('');
    setCurrentMeterReading(null);
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
                // Reset category and subcategory when vehicle changes
                // (different asset types have different categories)
                setSelectedCategoryId('');
                setSelectedSubcategoryId('');
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
                {filteredCategories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedCategoryRequiresSubcategories && (
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
          )}

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
