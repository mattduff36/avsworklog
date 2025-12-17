'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { useOfflineStore } from '@/lib/stores/offline-queue';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { ArrowLeft, Save, Send, CheckCircle2, XCircle, AlertCircle, Info, User, Plus, Check, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { formatDateISO, formatDate, getWeekEnding } from '@/lib/utils/date';
import { INSPECTION_ITEMS, InspectionStatus, getChecklistForCategory } from '@/types/inspection';
import { Database } from '@/types/database';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { Employee } from '@/types/common';
import { toast } from 'sonner';
import { showErrorWithReport } from '@/lib/utils/error-reporting';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function NewInspectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('id'); // Get draft ID from URL if editing
  const { user, isManager } = useAuth();
  const { isOnline } = useOfflineSync();
  const { addToQueue } = useOfflineStore();
  const supabase = createClient();
  
  const [vehicles, setVehicles] = useState<Array<{ 
    id: string; 
    reg_number: string; 
    vehicle_type: string;
    vehicle_categories?: { name: string } | null;
  }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [weekEnding, setWeekEnding] = useState(formatDateISO(getWeekEnding()));
  const [activeDay, setActiveDay] = useState('0'); // 0-6 for Monday-Sunday
  const [currentMileage, setCurrentMileage] = useState('');
  // Store checkbox states as "dayOfWeek-itemNumber": status (e.g., "1-5": "ok")
  const [checkboxStates, setCheckboxStates] = useState<Record<string, InspectionStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  // Dynamic checklist items based on selected vehicle category
  const [currentChecklist, setCurrentChecklist] = useState<string[]>(INSPECTION_ITEMS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [showAddVehicleDialog, setShowAddVehicleDialog] = useState(false);
  const [newVehicleReg, setNewVehicleReg] = useState('');
  const [newVehicleCategoryId, setNewVehicleCategoryId] = useState('');
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [existingInspectionId, setExistingInspectionId] = useState<string | null>(null);
  
  // Manager-specific states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  useEffect(() => {
    fetchVehicles();
    fetchCategories();
  }, []);

  // Load draft inspection if ID is provided in URL
  useEffect(() => {
    if (draftId && user && !loading) {
      // Wait a bit for isManager to be set
      const timer = setTimeout(() => {
        loadDraftInspection(draftId);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [draftId, user]);

  // Fetch employees if manager, and set initial selected employee
  useEffect(() => {
    if (user && isManager) {
      fetchEmployees();
    } else if (user) {
      // If not a manager, set selected employee to current user
      setSelectedEmployeeId(user.id);
    }
  }, [user, isManager]);

  const fetchEmployees = async () => {
    try {
      // Get all profiles
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .order('full_name');

      if (error) throw error;

      const allEmployees = profiles || [];
      
      // Convert to expected format
      const formattedEmployees: Employee[] = allEmployees
        .map((emp) => ({
          id: emp.id,
          full_name: emp.full_name || 'Unnamed User',
          employee_id: emp.employee_id || null,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
      
      setEmployees(formattedEmployees);
      
      // Set default to current user
      if (user) {
        setSelectedEmployeeId(user.id);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  };

  const fetchVehicles = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select(`
          *,
          vehicle_categories (
            name
          )
        `)
        .eq('status', 'active')
        .order('reg_number');

      if (error) throw error;
      setVehicles(data || []);
    } catch (err) {
      console.error('Error fetching vehicles:', err);
      setError('Failed to load vehicles');
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_categories')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setCategories(data || []);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const loadDraftInspection = async (id: string) => {
    try {
      setLoading(true);
      setError('');

      // Fetch user's profile to check if they're a manager (bypasses hook timing issues)
      const { data: profileData } = await supabase
        .from('profiles')
        .select(`
          id,
          role:roles (
            name,
            is_manager_admin
          )
        `)
        .eq('id', user?.id)
        .single();

      const userIsManager = (profileData as any)?.role?.is_manager_admin || false;

      // Fetch inspection
      const { data: inspection, error: inspectionError } = await supabase
        .from('vehicle_inspections')
        .select(`
          *,
          vehicles (
            id,
            reg_number,
            vehicle_type,
            vehicle_categories (name)
          )
        `)
        .eq('id', id)
        .single();

      if (inspectionError) throw inspectionError;

      // Check if user has access (must be owner or manager)
      if (!userIsManager && inspection.user_id !== user?.id) {
        setError('You do not have permission to edit this inspection');
        return;
      }

      // Only allow loading drafts
      if (inspection.status !== 'draft') {
        setError('Only draft inspections can be edited here');
        return;
      }

      // Update checklist FIRST based on vehicle category (important for progress calculation)
      let checklist = INSPECTION_ITEMS;
      if ((inspection as any).vehicles?.vehicle_categories?.name || (inspection as any).vehicles?.vehicle_type) {
        const categoryName = (inspection as any).vehicles?.vehicle_categories?.name || (inspection as any).vehicles?.vehicle_type;
        checklist = getChecklistForCategory(categoryName);
        setCurrentChecklist(checklist);
      }

      // Fetch inspection items
      const { data: items, error: itemsError } = await supabase
        .from('inspection_items')
        .select('*')
        .eq('inspection_id', id)
        .order('item_number');

      if (itemsError) throw itemsError;

      // Populate form with inspection data
      setExistingInspectionId(id);
      setVehicleId((inspection as any).vehicles?.id || '');
      setWeekEnding(inspection.inspection_end_date || formatDateISO(getWeekEnding()));
      setCurrentMileage(inspection.current_mileage?.toString() || '');
      
      // Set the employee (for managers creating inspections for others)
      setSelectedEmployeeId(inspection.user_id);

      // Populate checkbox states and comments from items
      const newCheckboxStates: Record<string, InspectionStatus> = {};
      const newComments: Record<string, string> = {};
      
      items?.forEach((item: any) => {
        const key = `${item.day_of_week}-${item.item_number}`;
        newCheckboxStates[key] = item.status;
        if (item.comments) {
          newComments[key] = item.comments;
        }
      });

      setCheckboxStates(newCheckboxStates);
      setComments(newComments);

      toast.success('Draft inspection loaded');
    } catch (err) {
      console.error('Error loading draft inspection:', err);
      setError(err instanceof Error ? err.message : 'Failed to load draft inspection');
    } finally {
      setLoading(false);
    }
  };

  // Format UK registration plates (LLNNLLL -> LLNN LLL)
  const formatRegistration = (reg: string): string => {
    const cleaned = reg.replace(/\s/g, '').toUpperCase();
    
    // Check if it matches UK format: 2 letters, 2 numbers, 3 letters (7 chars total)
    if (cleaned.length === 7 && /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned)) {
      return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
    }
    
    return cleaned;
  };

  const handleStatusChange = (itemNumber: number, status: InspectionStatus) => {
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const key = `${dayOfWeek}-${itemNumber}`;
    setCheckboxStates(prev => ({ ...prev, [key]: status }));
  };

  const handleCommentChange = (itemNumber: number, comment: string) => {
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const key = `${dayOfWeek}-${itemNumber}`;
    setComments(prev => ({ ...prev, [key]: comment }));
  };

  const handleMarkAllPass = () => {
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const allPassStates: Record<string, InspectionStatus> = {};
    currentChecklist.forEach((_, index) => {
      const key = `${dayOfWeek}-${index + 1}`;
      allPassStates[key] = 'ok';
    });
    setCheckboxStates(prev => ({ ...prev, ...allPassStates }));
    // Clear comments for this day
    const updatedComments = { ...comments };
    currentChecklist.forEach((_, index) => {
      const key = `${dayOfWeek}-${index + 1}`;
      delete updatedComments[key];
    });
    setComments(updatedComments);
  };

  const handleSubmit = () => {
    if (!vehicleId) {
      setError('Please select a vehicle');
      return;
    }

    if (!currentMileage || parseInt(currentMileage) < 0) {
      setError('Please enter a valid current mileage');
      return;
    }

    // Validate week ending is a Sunday
    const weekEndDate = new Date(weekEnding + 'T00:00:00');
    if (weekEndDate.getDay() !== 0) {
      setError('Week ending must be a Sunday');
      return;
    }

    // Validate: all defects must have comments
    const defectsWithoutComments: string[] = [];
    Object.entries(checkboxStates).forEach(([key, status]) => {
      if (status === 'attention' && !comments[key]) {
        const [dayOfWeek, itemNumber] = key.split('-').map(Number);
        const dayName = DAY_NAMES[dayOfWeek - 1] || `Day ${dayOfWeek}`;
        const itemName = currentChecklist[itemNumber - 1] || `Item ${itemNumber}`;
        defectsWithoutComments.push(`${itemName} (${dayName})`);
      }
    });

    if (defectsWithoutComments.length > 0) {
      setError(`Please add comments for all defects: ${defectsWithoutComments.join(', ')}`);
      toast.error('Missing defect comments', {
        description: `Please add comments for: ${defectsWithoutComments.slice(0, 3).join(', ')}${defectsWithoutComments.length > 3 ? '...' : ''}`,
      });
      return;
    }
    
    // Show signature dialog
    setShowSignatureDialog(true);
  };

  const handleSignatureComplete = async (sig: string) => {
    setSignature(sig);
    setShowSignatureDialog(false);
    await saveInspection('submitted', sig);
  };

  const handleAddVehicle = async () => {
    if (!newVehicleReg.trim()) {
      setError('Please enter a registration number');
      return;
    }

    if (!newVehicleCategoryId) {
      setError('Please select a vehicle category');
      return;
    }

    setAddingVehicle(true);
    setError('');

    try {
      // Format the registration before saving
      const formattedReg = formatRegistration(newVehicleReg.trim());
      
      type VehicleInsert = Database['public']['Tables']['vehicles']['Insert'];
      const vehicleData: VehicleInsert = {
        reg_number: formattedReg,
        category_id: newVehicleCategoryId,
        // vehicle_type auto-syncs from category via database trigger
        status: 'active',
      };

      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select()
        .single();

      if (vehicleError) {
        if (vehicleError.code === '23505') {
          throw new Error('A vehicle with this registration already exists');
        }
        throw vehicleError;
      }

      // Refresh vehicles list
      await fetchVehicles();
      
      // Select the new vehicle and update checklist based on its category
      if (newVehicle) {
        setVehicleId(newVehicle.id);
        
        // Find the category name and update checklist
        const category = categories.find(c => c.id === newVehicleCategoryId);
        if (category) {
          const checklist = getChecklistForCategory(category.name);
          setCurrentChecklist(checklist);
        }
      }

      // Close dialog and reset form
      // Use setTimeout to ensure dialog closes properly on mobile
      setTimeout(() => {
        setShowAddVehicleDialog(false);
        setNewVehicleReg('');
        setNewVehicleCategoryId('');
      }, 100);
    } catch (err) {
      console.error('Error adding vehicle:', err);
      setError(err instanceof Error ? err.message : 'Failed to add vehicle');
    } finally {
      setAddingVehicle(false);
    }
  };

  const saveInspection = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId || !vehicleId) return;
    
    // Prevent duplicate saves
    if (loading) {
      console.log('Save already in progress, ignoring duplicate request');
      return;
    }

    setError('');
    setLoading(true);

    try {
      // Calculate inspection start date (Monday of the week)
      const weekEndDate = new Date(weekEnding + 'T00:00:00');
      const startDate = new Date(weekEndDate);
      startDate.setDate(weekEndDate.getDate() - 6); // Go back 6 days to Monday
      
      // Create inspection record
      type InspectionInsert = Database['public']['Tables']['vehicle_inspections']['Insert'];
      const inspectionData: InspectionInsert = {
        vehicle_id: vehicleId,
        user_id: selectedEmployeeId, // Use selected employee ID (can be manager's own ID or another employee's)
        inspection_date: formatDateISO(startDate),
        inspection_end_date: weekEnding,
        current_mileage: parseInt(currentMileage),
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        signature_data: signatureData || null,
        signed_at: signatureData ? new Date().toISOString() : null,
      };

      // Check if offline
      if (!isOnline) {
        // Prepare items data - ONLY items that have been explicitly set by the user
        type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
        const items: Omit<InspectionItemInsert, 'inspection_id'>[] = [];
        
        for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
          currentChecklist.forEach((item, index) => {
            const itemNumber = index + 1;
            const key = `${dayOfWeek}-${itemNumber}`;
            
            // Only save items that have been explicitly set by the user
            if (checkboxStates[key]) {
              items.push({
                item_number: itemNumber,
                day_of_week: dayOfWeek,
                item_description: item,
                status: checkboxStates[key],
              });
            }
          });
        }

        // Save to offline queue
        addToQueue({
          type: 'inspection',
          action: 'create',
          data: {
            ...inspectionData,
            items,
          },
        });
        
        toast.success('Inspection saved offline', {
          description: 'Your inspection will be submitted when you are back online.',
          icon: <WifiOff className="h-4 w-4" />,
        });
        
        router.push('/inspections');
        return;
      }

      let inspection: any;

      // Update existing draft or create new inspection
      if (existingInspectionId) {
        // IMPORTANT: Delete and insert items BEFORE updating inspection status
        // This ensures RLS policies work correctly (they require status = 'draft')
        
        // Delete existing items first (while inspection is still in 'draft' status)
        console.log(`Fetching existing items for inspection ${existingInspectionId}...`);
        const { data: existingItems, error: fetchError } = await supabase
          .from('inspection_items')
          .select('id, item_number, day_of_week')
          .eq('inspection_id', existingInspectionId);

        if (fetchError) {
          console.error('Error fetching existing items:', fetchError);
          throw new Error(`Failed to fetch existing items: ${fetchError.message}`);
        }

        if (existingItems && existingItems.length > 0) {
          console.log(`Deleting ${existingItems.length} existing items...`);
          const { error: deleteError } = await supabase
            .from('inspection_items')
            .delete()
            .eq('inspection_id', existingInspectionId);

          if (deleteError) {
            console.error('Error deleting existing items:', deleteError);
            throw new Error(`Failed to delete existing items: ${deleteError.message}`);
          }
          console.log(`Successfully deleted existing items`);
        } else {
          console.log('No existing items to delete');
        }

        // Set inspection reference for items insertion (below)
        inspection = { id: existingInspectionId };

        // Note: Inspection update happens AFTER items are inserted (see below)
      } else {
        // Create new inspection
        const { data: newInspection, error: insertError } = await supabase
          .from('vehicle_inspections')
          .insert(inspectionData)
          .select()
          .single();

        if (insertError) throw insertError;
        inspection = newInspection;
      }

      if (!inspection) throw new Error('Failed to save inspection');

      // Create inspection items ONLY for items that have been explicitly set by the user
      // This prevents drafts from showing all items as 'ok' when they haven't been completed
      type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
      const items: InspectionItemInsert[] = [];
      
      for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
        currentChecklist.forEach((item, index) => {
          const itemNumber = index + 1;
          const key = `${dayOfWeek}-${itemNumber}`;
          
          // Only save items that have been explicitly set by the user
          if (checkboxStates[key]) {
            items.push({
              inspection_id: inspection.id,
              item_number: itemNumber,
              item_description: item,
              day_of_week: dayOfWeek,
              status: checkboxStates[key],
              comments: comments[key] || null,
            });
          }
        });
      }

      // Only insert if there are items to save
      let insertedItems: any[] = [];
      if (items.length > 0) {
        console.log(`Saving ${items.length} inspection items for inspection ${inspection.id}...`);
        
        // Use regular INSERT since we already deleted all existing items
        // This avoids RLS policy issues with UPSERT triggering UPDATE policies
        const { data, error: itemsError } = await supabase
          .from('inspection_items')
          .insert(items)
          .select();

        if (itemsError) {
          console.error('Error saving items:', itemsError);
          console.error('Items that failed:', JSON.stringify(items.slice(0, 3))); // Log first 3 for debugging
          throw new Error(`Failed to save inspection items: ${itemsError.message}`);
        }
        
        insertedItems = data || [];
        console.log(`Successfully saved ${insertedItems.length} items`);
      } else {
        console.warn('No items to save - inspection has no completed items');
      }

      // NOW update the inspection (after items are saved)
      // This is important for existing inspections to avoid RLS issues
      if (existingInspectionId) {
        type InspectionUpdate = Database['public']['Tables']['vehicle_inspections']['Update'];
        const inspectionUpdate: InspectionUpdate = {
          vehicle_id: vehicleId,
          user_id: selectedEmployeeId,
          inspection_date: formatDateISO(startDate),
          inspection_end_date: weekEnding,
          current_mileage: parseInt(currentMileage),
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
          signature_data: signatureData || null,
          signed_at: signatureData ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        };

        const { data: updatedInspection, error: updateError } = await supabase
          .from('vehicle_inspections')
          .update(inspectionUpdate)
          .eq('id', existingInspectionId)
          .select();

        if (updateError) {
          console.error('Update error:', updateError);
          throw updateError;
        }
        
        if (!updatedInspection || updatedInspection.length === 0) {
          throw new Error('Failed to update inspection - no rows returned. You may not have permission to edit this inspection.');
        }
        
        inspection = updatedInspection[0];
      }

      // Auto-create actions for failed items (only when submitting, not drafting)
      if (status === 'submitted' && insertedItems) {
        const failedItems = insertedItems.filter((item: any) => item.status === 'attention');
        
        if (failedItems.length > 0) {
          type ActionInsert = Database['public']['Tables']['actions']['Insert'];
          const actions: ActionInsert[] = failedItems.map((item: any) => {
            const itemName = item.item_description || `Item ${item.item_number}`;
            const dayName = DAY_NAMES[item.day_of_week - 1] || `Day ${item.day_of_week}`;
            return {
              inspection_id: inspection.id,
              inspection_item_id: item.id,
              title: `Defect: ${itemName} (${dayName})`,
              description: `Vehicle inspection item failed during ${dayName} inspection`,
              priority: 'high',
              status: 'pending',
              created_by: user!.id,
            };
          });

          const { error: actionsError } = await supabase
            .from('actions')
            .insert(actions);

          if (actionsError) {
            console.error('Error creating actions:', actionsError);
            // Don't throw - we don't want to fail the inspection if action creation fails
          }
        }
      }

      // Show success message based on status
      if (status === 'draft') {
        toast.success('Draft saved successfully', {
          description: 'Your inspection has been saved as a draft.',
        });
      } else {
        toast.success('Inspection submitted successfully', {
          description: 'Your inspection has been submitted for review.',
        });
      }

      // Navigate back to inspections list
      router.push('/inspections');
    } catch (err) {
      console.error('Error saving inspection:', err);
      console.error('Error details:', JSON.stringify(err, null, 2));
      
      // Get detailed error message
      let errorMessage = 'An unexpected error occurred';
      
      if (err instanceof Error) {
        errorMessage = err.message;
        console.error('Error stack:', err.stack);
      }
      
      // Check if this is a network/offline error
      if (!isOnline || (err instanceof Error && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('network')))) {
        showErrorWithReport(
          'Cannot save while offline',
          'No internet connection detected. Please check your connection and try again.',
          {
            offline: true,
            vehicleId,
            weekEnding,
          }
        );
      } else {
        showErrorWithReport(
          'Failed to save inspection',
          errorMessage,
          {
            vehicleId,
            weekEnding,
            existingInspectionId: existingInspectionId || null,
          }
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: InspectionStatus, isSelected: boolean) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-green-400' : 'text-slate-500'}`} />;
      case 'attention':
        return <XCircle className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-red-400' : 'text-slate-500'}`} />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: InspectionStatus, isSelected: boolean) => {
    if (!isSelected) return 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50';
    
    switch (status) {
      case 'ok':
        return 'bg-green-500/20 border-green-500 shadow-lg shadow-green-500/20';
      case 'attention':
        return 'bg-red-500/20 border-red-500 shadow-lg shadow-red-500/20';
      default:
        return 'bg-slate-800/30 border-slate-700';
    }
  };

  // Calculate progress (7 days × number of items)
  const totalItems = currentChecklist.length * 7;
  const completedItems = Object.keys(checkboxStates).length;
  const progressPercent = Math.round((completedItems / totalItems) * 100);

  return (
    <div className="space-y-4 pb-32 md:pb-6 max-w-5xl">
      {/* Offline Banner */}
      {!isOnline && <OfflineBanner />}
      
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <Link href="/inspections">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 md:w-auto md:px-3 hover:bg-slate-100 dark:hover:bg-slate-800">
                <ArrowLeft className="h-5 w-5 md:mr-2" />
                <span className="hidden md:inline">Back</span>
              </Button>
            </Link>
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-slate-900 dark:text-white">
                {existingInspectionId ? 'Edit Inspection' : 'New Inspection'}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 hidden md:block">
                {existingInspectionId ? 'Continue editing your draft' : 'Daily safety check'}
              </p>
            </div>
          </div>
          {/* Progress Badge */}
          <div className="bg-inspection/10 dark:bg-inspection/20 border border-inspection/30 rounded-lg px-3 py-2">
            <div className="text-xs text-slate-600 dark:text-slate-400">Progress</div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">{completedItems}/{totalItems}</div>
          </div>
        </div>
        {/* Progress Bar */}
        <div className="h-2 bg-slate-200 dark:bg-slate-800/50 rounded-full overflow-hidden">
          <div 
            className="h-full bg-inspection transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg backdrop-blur-xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {/* Vehicle Details Card */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader className="pb-4">
          <CardTitle className="text-slate-900 dark:text-white">Inspection Details</CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            Week ending: {formatDate(weekEnding)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Manager: Employee Selector */}
          {isManager && (
            <div className="space-y-2 pb-4 border-b border-slate-700">
              <Label htmlFor="employee" className="text-slate-900 dark:text-white text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating inspection for
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                      {employee.id === user?.id && ' (You)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                Select which employee this inspection is for
              </p>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vehicle" className="text-slate-900 dark:text-white text-base">Vehicle</Label>
              <Select 
                value={vehicleId} 
                onValueChange={(value) => {
                  if (value === 'add-new') {
                    // Don't set the value, just open the dialog
                    setShowAddVehicleDialog(true);
                  } else {
                    setVehicleId(value);
                    // Update checklist based on vehicle category
                    const selectedVehicle = vehicles.find(v => v.id === value);
                    if (selectedVehicle) {
                      const categoryName = selectedVehicle.vehicle_categories?.name || selectedVehicle.vehicle_type || '';
                      const checklist = getChecklistForCategory(categoryName);
                      setCurrentChecklist(checklist);
                    }
                  }
                }}
                onOpenChange={(open) => {
                  // Ensure select closes when dialog opens
                  if (open && showAddVehicleDialog) {
                    return;
                  }
                }}
              >
                <SelectTrigger id="vehicle" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 max-h-[300px] md:max-h-[400px]">
                  <SelectItem value="add-new" className="text-avs-yellow font-semibold border-b border-slate-700">
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Add New Vehicle
                    </div>
                  </SelectItem>
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id} className="text-white">
                      {vehicle.reg_number} - {vehicle.vehicle_categories?.name || vehicle.vehicle_type || 'Uncategorized'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="weekEnding" className="text-slate-900 dark:text-white text-base flex items-center gap-2">
                Week Ending (Sunday)
                <span className="text-red-400">*</span>
              </Label>
              <Input
                id="weekEnding"
                type="date"
                value={weekEnding}
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + 'T00:00:00');
                  if (selectedDate.getDay() !== 0) {
                    setError('Week ending must be a Sunday');
                    return;
                  }
                  setError('');
                  setWeekEnding(e.target.value);
                }}
                max={formatDateISO(new Date())}
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white w-full"
                required
              />
              <p className="text-xs text-slate-400">Select the Sunday that ends the inspection week</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mileage" className="text-slate-900 dark:text-white text-base flex items-center gap-2">
                Current Mileage
                <span className="text-red-400">*</span>
              </Label>
                  <Input
                    id="mileage"
                    type="number"
                    value={currentMileage}
                    onChange={(e) => setCurrentMileage(e.target.value)}
                    placeholder="e.g., 45000"
                    min="0"
                    step="1"
                    className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    required
                  />
                </div>
          </div>
        </CardContent>
      </Card>

      {/* Safety Check - Only shown when vehicle is selected */}
      {vehicleId && (
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-slate-900 dark:text-white">{currentChecklist.length}-Point Safety Check</CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            Mark each item as Pass or Fail for each day
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 md:p-6">
          
          <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
            <TabsList className="grid w-full grid-cols-7 bg-slate-900/50 p-1 rounded-lg mb-4">
              {DAY_NAMES.map((day, index) => {
                const dayOfWeek = index + 1;
                // Check if all items for this day have a status
                const isComplete = currentChecklist.every((_, itemIndex) => {
                  const itemNumber = itemIndex + 1;
                  const key = `${dayOfWeek}-${itemNumber}`;
                  return checkboxStates[key] !== undefined;
                });
                
                return (
                  <TabsTrigger 
                    key={index} 
                    value={index.toString()} 
                    className={`text-xs py-3 data-[state=active]:bg-inspection data-[state=active]:text-slate-900 text-slate-400 ${
                      isComplete 
                        ? 'data-[state=active]:border-2 data-[state=active]:border-green-500 border-2 border-green-500/50' 
                        : 'data-[state=active]:border-2 data-[state=active]:border-white'
                    }`}
                  >
                    {day.substring(0, 3)}
                    {isComplete && (
                      <Check className="h-3 w-3 ml-1" />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {DAY_NAMES.map((day, dayIndex) => (
              <TabsContent key={dayIndex} value={dayIndex.toString()} className="mt-0">
                {/* Mark All Pass Button - Mobile */}
                <div className="md:hidden mb-4">
                  <Button
                    type="button"
                    onClick={handleMarkAllPass}
                    variant="outline"
                    className="w-full h-12 border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500"
                  >
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Mark All as PASS
                  </Button>
                </div>

                {/* Mobile View - Card-based */}
                <div className="md:hidden space-y-3">
                  {currentChecklist.map((item, index) => {
                    const itemNumber = index + 1;
                    const dayOfWeek = dayIndex + 1;
                    const key = `${dayOfWeek}-${itemNumber}`;
                    const currentStatus = checkboxStates[key];
                    const hasDefectComment = currentStatus === 'attention' && comments[key];
              
              return (
                <div key={itemNumber} className="bg-slate-900/30 border border-slate-700/50 rounded-lg p-4 space-y-3">
                  {/* Item Header */}
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                      <span className="text-sm font-bold text-slate-400">{itemNumber}</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-base font-medium text-white leading-tight">{item}</h4>
                    </div>
                  </div>

                  {/* Status Buttons - Pass or Fail */}
                  <div className="grid grid-cols-2 gap-3">
                    {(['ok', 'attention'] as InspectionStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => handleStatusChange(itemNumber, status)}
                        className={`flex items-center justify-center h-12 rounded-xl border-3 transition-all ${
                          getStatusColor(status, currentStatus === status)
                        }`}
                      >
                        {getStatusIcon(status, currentStatus === status)}
                      </button>
                    ))}
                  </div>

                  {/* Comments/Notes */}
                  {(currentStatus === 'attention' || comments[key]) && (
                    <div className="space-y-2">
                      <Label className="text-slate-900 dark:text-white text-sm">
                        {currentStatus === 'attention' ? 'Comments (Required)' : 'Notes'}
                      </Label>
                      <Textarea
                        value={comments[key] || ''}
                        onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                        placeholder="Add details..."
                        className={`w-full min-h-[80px] text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 ${
                          currentStatus === 'attention' && !comments[key] ? 'border-red-500' : ''
                        }`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Mark All Pass Button - Desktop */}
          <div className="hidden md:block mb-4">
            <Button
              type="button"
              onClick={handleMarkAllPass}
              variant="outline"
              className="border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark All as PASS
            </Button>
          </div>

          {/* Desktop View - Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left p-3 w-12 font-medium text-white">#</th>
                  <th className="text-left p-3 font-medium text-white">Item</th>
                  <th className="text-center p-3 w-48 font-medium text-white">Status</th>
                  <th className="text-left p-3 font-medium text-white">Comments</th>
                </tr>
              </thead>
              <tbody>
                {currentChecklist.map((item, index) => {
                  const itemNumber = index + 1;
                  const dayOfWeek = dayIndex + 1;
                  const key = `${dayOfWeek}-${itemNumber}`;
                  const currentStatus = checkboxStates[key];
                  
                  return (
                    <tr key={itemNumber} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                      <td className="p-3 text-sm text-slate-400">{itemNumber}</td>
                      <td className="p-3 text-sm text-white">{item}</td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-3">
                          {(['ok', 'attention'] as InspectionStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => handleStatusChange(itemNumber, status)}
                              className={`flex items-center justify-center w-12 h-12 rounded-lg border-2 transition-all ${
                                getStatusColor(status, currentStatus === status)
                              }`}
                              title={status === 'ok' ? 'Pass' : 'Fail'}
                            >
                              {getStatusIcon(status, currentStatus === status)}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">
                        <Input
                          value={comments[key] || ''}
                          onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                          placeholder={currentStatus === 'attention' ? 'Required for defects' : 'Optional notes'}
                          className={`bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 ${
                            currentStatus === 'attention' && !comments[key] ? 'border-red-500' : ''
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Information Box - Desktop Only */}
          <div className="hidden md:block p-4 bg-slate-800/40 border border-slate-700/50 rounded-lg backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-inspection flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white mb-2">Inspection Guidelines:</p>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                    <span><strong>Pass:</strong> Item is in good working condition</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-400" />
                    <span><strong>Fail:</strong> Item needs attention - comment required</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

              </TabsContent>
            ))}
          </Tabs>

          {/* Desktop Action Buttons */}
          <div className="hidden md:flex flex-row gap-3 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => saveInspection('draft')}
              disabled={loading || !vehicleId}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || !vehicleId}
              className="bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold"
            >
              <Send className="h-4 w-4 mr-2" />
              {loading ? 'Submitting...' : 'Submit Inspection'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Mobile Sticky Footer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-700/50 p-4 z-20">
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => saveInspection('draft')}
            disabled={loading || !vehicleId}
            className="flex-1 h-14 border-slate-600 text-white hover:bg-slate-800"
          >
            <Save className="h-5 w-5 mr-2" />
            Save Draft
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !vehicleId}
            className="flex-1 h-14 bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold text-base"
          >
            <Send className="h-5 w-5 mr-2" />
            Submit
          </Button>
        </div>
      </div>

      {/* Add Vehicle Dialog */}
      <Dialog open={showAddVehicleDialog} onOpenChange={setShowAddVehicleDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Add New Vehicle</DialogTitle>
            <DialogDescription className="text-slate-400">
              Enter the vehicle registration number and select its category
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newVehicleReg" className="text-slate-900 dark:text-white">
                Registration Number <span className="text-red-400">*</span>
              </Label>
              <Input
                id="newVehicleReg"
                value={newVehicleReg}
                onChange={(e) => setNewVehicleReg(e.target.value.toUpperCase())}
                onBlur={(e) => setNewVehicleReg(formatRegistration(e.target.value))}
                placeholder="e.g., BG21 EXH"
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 uppercase"
                disabled={addingVehicle}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newVehicleCategory" className="text-slate-900 dark:text-white">
                Vehicle Category <span className="text-red-400">*</span>
              </Label>
              <Select 
                value={newVehicleCategoryId || undefined} 
                onValueChange={(value) => setNewVehicleCategoryId(value || '')}
                disabled={addingVehicle}
              >
                <SelectTrigger className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 max-h-[300px] md:max-h-[400px]">
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowAddVehicleDialog(false);
                setNewVehicleReg('');
                setNewVehicleCategoryId('');
              }}
              disabled={addingVehicle}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddVehicle}
              disabled={addingVehicle || !newVehicleReg.trim() || !newVehicleCategoryId}
              className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900 font-semibold"
            >
              {addingVehicle ? 'Adding...' : 'Add Vehicle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signature Dialog */}
      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Inspection</DialogTitle>
            <DialogDescription className="text-slate-400">
              Please sign below to confirm your inspection is accurate
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SignaturePad
              onSave={handleSignatureComplete}
              onCancel={() => setShowSignatureDialog(false)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSignatureDialog(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function NewInspectionPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><p className="text-muted-foreground">Loading...</p></div>}>
      <NewInspectionContent />
    </Suspense>
  );
}
