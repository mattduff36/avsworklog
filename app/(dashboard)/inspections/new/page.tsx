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
import { Badge } from '@/components/ui/badge';
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

// Type definitions for inspection data
type InspectionItem = {
  id: string;
  inspection_id: string;
  item_number: number;
  item_description: string;
  status: InspectionStatus;
  day_of_week: number;
  comments?: string | null;
};

type VehicleWithCategory = {
  id: string;
  reg_number: string;
  vehicle_type: string;
  vehicle_categories?: { name: string } | null;
};

type InspectionWithRelations = {
  id: string;
  user_id: string;
  vehicle_id: string;
  inspection_date: string;
  inspection_end_date: string;
  current_mileage: number | null;
  status: string;
  vehicles?: VehicleWithCategory;
  inspection_items?: InspectionItem[];
};

type LoggedAction = {
  id: string;
  logged_comment: string | null;
  inspection_items?: {
    item_number: number;
    item_description: string;
  } | null;
  vehicle_inspections?: {
    vehicle_id: string;
  };
};

type PreviousDefect = {
  item_number: number;
  item_description: string;
  days: number[];
};

type ProfileWithRole = {
  role?: {
    is_manager_admin?: boolean;
  } | null;
};

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
  const [weekEnding, setWeekEnding] = useState('');
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

  // Resolution tracking states
  const [previousDefects, setPreviousDefects] = useState<Map<string, PreviousDefect>>(new Map());
  const [showResolutionDialog, setShowResolutionDialog] = useState(false);
  const [pendingResolution, setPendingResolution] = useState<{ day: number; itemNum: number; itemDesc: string } | null>(null);
  const [resolutionComment, setResolutionComment] = useState('');
  const [resolvedItems, setResolvedItems] = useState<Map<string, string>>(new Map()); // key: "day-itemNum", value: resolution comment
  
  // Logged defects tracking (read-only auto-marked items)
  const [loggedDefects, setLoggedDefects] = useState<Map<string, { comment: string; actionId: string }>>(new Map()); // key: "itemNum-itemDesc", value: { comment, actionId }
  
  // Track if user has started filling checklist (to lock vehicle/date fields)
  const [checklistStarted, setChecklistStarted] = useState(false);
  const [duplicateCheckLoading, setDuplicateCheckLoading] = useState(false);
  const [duplicateInspection, setDuplicateInspection] = useState<string | null>(null);

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

  // Check for duplicate inspection when vehicle or week ending changes
  useEffect(() => {
    if (vehicleId && weekEnding && !existingInspectionId) {
      checkForDuplicate(vehicleId, weekEnding);
    }
  }, [vehicleId, weekEnding, existingInspectionId]);

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

  // Check for duplicate inspection (same vehicle + week ending)
  // clearOtherErrors: whether to clear non-duplicate validation errors
  //   - false for background checks (useEffect) - preserves validation errors
  //   - true for explicit save checks - clears stale errors before validation re-runs
  const checkForDuplicate = async (
    vehicleIdToCheck: string, 
    weekEndingToCheck: string,
    clearOtherErrors: boolean = false
  ): Promise<boolean> => {
    if (!vehicleIdToCheck || !weekEndingToCheck || existingInspectionId) {
      setDuplicateInspection(null);
      return false;
    }

    setDuplicateCheckLoading(true);
    
    try {
      const { data, error } = await supabase
        .from('vehicle_inspections')
        .select('id, status')
        .eq('vehicle_id', vehicleIdToCheck)
        .eq('inspection_end_date', weekEndingToCheck)
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        const existing = data[0];
        setDuplicateInspection(existing.id);
        setError(`An inspection for this vehicle and week already exists (${existing.status}). Please select a different vehicle or week.`);
        return true; // Duplicate found
      } else {
        setDuplicateInspection(null);
        // Always clear duplicate-related errors when no duplicate is found
        // For other validation errors, only clear if explicitly requested
        setError(prev => {
          // If previous error was about duplicates, always clear it
          if (prev.includes('already exists')) {
            return '';
          }
          // For other validation errors, only clear if clearOtherErrors=true
          return clearOtherErrors ? '' : prev;
        });
        return false; // No duplicate
      }
    } catch (err) {
      console.error('Error checking for duplicate:', err);
      // Don't block the user if the check fails
      setDuplicateInspection(null);
      return false;
    } finally {
      setDuplicateCheckLoading(false);
    }
  };

  // Load previous defects for the selected vehicle
  const loadPreviousDefects = async (selectedVehicleId: string) => {
    try {
      // Get the most recent submitted inspection for this vehicle
      const { data: lastInspection, error: inspectionError } = await supabase
        .from('vehicle_inspections')
        .select(`
          id,
          inspection_items (
            item_number,
            item_description,
            status,
            day_of_week
          )
        `)
        .eq('vehicle_id', selectedVehicleId)
        .eq('status', 'submitted')
        .order('inspection_date', { ascending: false })
        .limit(1)
        .single();

      if (inspectionError || !lastInspection) {
        // No previous inspection, clear previous defects
        setPreviousDefects(new Map());
      } else {
        // Build map of defective items: key = "itemNumber-itemDescription"
        const defectsMap = new Map<string, PreviousDefect>();
        const items = (lastInspection as InspectionWithRelations).inspection_items || [];
        
        items.forEach((item: InspectionItem) => {
          if (item.status === 'attention') {
            const key = `${item.item_number}-${item.item_description}`;
            if (!defectsMap.has(key)) {
              defectsMap.set(key, {
                item_number: item.item_number,
                item_description: item.item_description,
                days: []
              });
            }
            defectsMap.get(key).days.push(item.day_of_week);
          }
        });

        setPreviousDefects(defectsMap);
      }

      // Load logged actions for this vehicle
      const { data: loggedActionsData, error: loggedError } = await supabase
        .from('actions')
        .select(`
          id,
          logged_comment,
          inspection_items (
            item_number,
            item_description
          ),
          vehicle_inspections!inner (
            vehicle_id
          )
        `)
        .eq('status', 'logged')
        .eq('vehicle_inspections.vehicle_id', selectedVehicleId);

      if (!loggedError && loggedActionsData) {
        const loggedMap = new Map<string, { comment: string; actionId: string }>();
        
        (loggedActionsData as LoggedAction[]).forEach((action: LoggedAction) => {
          if (action.inspection_items) {
            const key = `${action.inspection_items.item_number}-${action.inspection_items.item_description}`;
            loggedMap.set(key, {
              comment: action.logged_comment || 'Defect logged by management',
              actionId: action.id
            });
          }
        });

        setLoggedDefects(loggedMap);

        // Auto-mark logged items as defective for all days
        const newCheckboxStates = { ...checkboxStates };
        const newComments = { ...comments };

        loggedMap.forEach((loggedInfo, key) => {
          const [itemNumStr] = key.split('-');
          const itemNum = parseInt(itemNumStr);
          
          // Mark as defective for all 7 days
          for (let day = 1; day <= 7; day++) {
            const stateKey = `${day}-${itemNum}`;
            newCheckboxStates[stateKey] = 'attention';
            newComments[stateKey] = loggedInfo.comment;
          }
        });

        setCheckboxStates(newCheckboxStates);
        setComments(newComments);
      } else {
        setLoggedDefects(new Map());
      }
    } catch (err) {
      console.error('Error loading previous defects:', err);
      setPreviousDefects(new Map());
      setLoggedDefects(new Map());
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

      const userIsManager = (profileData as ProfileWithRole)?.role?.is_manager_admin || false;

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
      const inspectionData = inspection as InspectionWithRelations;
      if (inspectionData.vehicles?.vehicle_categories?.name || inspectionData.vehicles?.vehicle_type) {
        const categoryName = inspectionData.vehicles?.vehicle_categories?.name || inspectionData.vehicles?.vehicle_type;
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
      setVehicleId(inspectionData.vehicles?.id || '');
      setWeekEnding(inspection.inspection_end_date || formatDateISO(getWeekEnding()));
      setCurrentMileage(inspection.current_mileage?.toString() || '');
      
      // Set the employee (for managers creating inspections for others)
      setSelectedEmployeeId(inspection.user_id);

      // Populate checkbox states and comments from items
      const newCheckboxStates: Record<string, InspectionStatus> = {};
      const newComments: Record<string, string> = {};
      
      (items as InspectionItem[] | null)?.forEach((item: InspectionItem) => {
        const key = `${item.day_of_week}-${item.item_number}`;
        newCheckboxStates[key] = item.status;
        if (item.comments) {
          newComments[key] = item.comments;
        }
      });

      setCheckboxStates(newCheckboxStates);
      setComments(newComments);
      
      // If draft has any items, mark checklist as started (locks vehicle/date fields)
      if (Object.keys(newCheckboxStates).length > 0) {
        setChecklistStarted(true);
      }

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
    
    // Mark checklist as started (locks vehicle/date fields)
    if (!checklistStarted) {
      setChecklistStarted(true);
    }
    
    // Check if marking previously-defective item as OK
    if (status === 'ok') {
      const itemDescription = currentChecklist[itemNumber - 1];
      const defectKey = `${itemNumber}-${itemDescription}`;
      
      if (previousDefects.has(defectKey)) {
        // This item was defective in the last inspection
        // Show modal requiring resolution comment
        setPendingResolution({ day: dayOfWeek, itemNum: itemNumber, itemDesc: itemDescription });
        setShowResolutionDialog(true);
        return; // Don't set the status yet
      }
    }
    
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
    
    // Validate week ending is provided
    if (!weekEnding || weekEnding.trim() === '') {
      setError('Please select a week ending date');
      return;
    }
    
    // Check for duplicate inspection before saving
    if (duplicateInspection) {
      setError('An inspection for this vehicle and week already exists. Please select a different vehicle or week.');
      return;
    }
    
    // Re-check for duplicates to prevent race conditions
    // Pass true to clear other errors since validation will re-run on save anyway
    const isDuplicate = await checkForDuplicate(vehicleId, weekEnding, true);
    if (isDuplicate) {
      setError('An inspection for this vehicle and week already exists. Please select a different vehicle or week.');
      return;
    }
    
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

      let inspection: InspectionWithRelations;

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
      let insertedItems: InspectionItem[] = [];
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
        
        insertedItems = (data || []) as InspectionItem[];
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
        const failedItems = insertedItems.filter((item: InspectionItem) => item.status === 'attention');
        
        if (failedItems.length > 0) {
          // Get vehicle registration for action title
          const { data: vehicleData } = await supabase
            .from('vehicles')
            .select('reg_number')
            .eq('id', vehicleId)
            .single();
          
          const vehicleReg = vehicleData?.reg_number || 'Unknown Vehicle';

          // Group defects by item_number and description to consolidate duplicates
          const groupedDefects = new Map<string, { 
            item_number: number; 
            item_description: string; 
            days: number[]; 
            comments: string[];
            item_ids: string[];
          }>();

          failedItems.forEach((item: InspectionItem) => {
            const key = `${item.item_number}-${item.item_description}`;
            if (!groupedDefects.has(key)) {
              groupedDefects.set(key, {
                item_number: item.item_number,
                item_description: item.item_description,
                days: [],
                comments: [],
                item_ids: []
              });
            }
            const group = groupedDefects.get(key)!;
            group.days.push(item.day_of_week);
            group.item_ids.push(item.id);
            if (item.comments) {
              group.comments.push(item.comments);
            }
          });

          // Create ONE action per unique defect (so each can be resolved independently)
          type ActionInsert = Database['public']['Tables']['actions']['Insert'];
          const actions: ActionInsert[] = Array.from(groupedDefects.values()).map((group) => {
            let dayRange: string;
            if (group.days.length === 1) {
              const dayName = DAY_NAMES[group.days[0] - 1] || `Day ${group.days[0]}`;
              dayRange = dayName;
            } else if (group.days.length > 1) {
              const firstDay = DAY_NAMES[group.days[0] - 1] || `Day ${group.days[0]}`;
              const lastDay = DAY_NAMES[group.days[group.days.length - 1] - 1] || `Day ${group.days[group.days.length - 1]}`;
              dayRange = `${firstDay.substring(0, 3)}-${lastDay.substring(0, 3)}`;
            } else {
              dayRange = 'Unknown';
            }

            const itemName = group.item_description || `Item ${group.item_number}`;
            const comment = group.comments.length > 0 ? `\nComment: ${group.comments[0]}` : '';
            
            return {
              inspection_id: inspection.id,
              inspection_item_id: group.item_ids[0], // Link to first occurrence
              title: `${vehicleReg} - ${itemName} (${dayRange})`,
              description: `Vehicle inspection defect found:\nItem ${group.item_number} - ${itemName} (${dayRange})${comment}`,
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

      // Auto-complete actions for resolved items
      if (status === 'submitted' && resolvedItems.size > 0 && vehicleId) {
        try {
          // Find pending actions for this vehicle's defects
          const { data: pendingActions } = await supabase
            .from('actions')
            .select(`
              id,
              inspection_item_id,
              inspection_id,
              vehicle_inspections!inner (
                vehicle_id
              )
            `)
            .eq('status', 'pending')
            .eq('vehicle_inspections.vehicle_id', vehicleId);

          if (pendingActions && pendingActions.length > 0) {
            // Get the inspection items from the previous inspection to match with actions
            const { data: previousInspectionItems } = await supabase
              .from('inspection_items')
              .select('id, item_number, item_description')
              .in('id', pendingActions.map(a => a.inspection_item_id).filter(Boolean));

            // For each resolved item, find matching action and complete it
            for (const [key, resolutionComment] of resolvedItems.entries()) {
              const [, itemNumStr] = key.split('-');
              const itemNum = parseInt(itemNumStr);
              const itemDesc = currentChecklist[itemNum - 1];

              // Find matching action
              const matchingItem = previousInspectionItems?.find(
                item => item.item_number === itemNum && item.item_description === itemDesc
              );

              if (matchingItem) {
                const matchingAction = pendingActions.find(a => a.inspection_item_id === matchingItem.id);

                if (matchingAction) {
                  // Complete the action with resolution comment
                  await supabase
                    .from('actions')
                    .update({
                      status: 'completed',
                      actioned: true,
                      actioned_at: new Date().toISOString(),
                      actioned_by: user!.id,
                      description: `${matchingAction.description || ''}\n\nResolution: ${resolutionComment}`
                    })
                    .eq('id', matchingAction.id);

                  console.log(`✅ Auto-completed action ${matchingAction.id} for resolved item ${itemNum}`);
                }
              }
            }
          }
        } catch (err) {
          console.error('Error completing resolved actions:', err);
          // Don't throw - we don't want to fail the inspection if this fails
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
          {/* Progress Badge - Only show when vehicle is selected */}
          {vehicleId && (
            <div className="bg-inspection/10 dark:bg-inspection/20 border border-inspection/30 rounded-lg px-3 py-2">
              <div className="text-xs text-slate-600 dark:text-slate-400">Progress</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">{completedItems}/{totalItems}</div>
            </div>
          )}
        </div>
        {/* Progress Bar - Only show when vehicle is selected */}
        {vehicleId && (
          <div className="h-2 bg-slate-200 dark:bg-slate-800/50 rounded-full overflow-hidden">
            <div 
              className="h-full bg-inspection transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
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
                disabled={checklistStarted}
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
                    // Load previous defects for resolution tracking
                    loadPreviousDefects(value);
                  }
                }}
                onOpenChange={(open) => {
                  // Ensure select closes when dialog opens
                  if (open && showAddVehicleDialog) {
                    return;
                  }
                }}
              >
                <SelectTrigger id="vehicle" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white" disabled={checklistStarted}>
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
                disabled={checklistStarted}
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
          
          {checklistStarted && (
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-400">
                <Info className="h-4 w-4 inline mr-2" />
                Vehicle and week ending are locked once you start filling the checklist. Save or leave the page to unlock.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Safety Check - Only shown when vehicle AND week ending are selected AND no duplicate exists */}
      {vehicleId && weekEnding && !duplicateInspection && !duplicateCheckLoading && (
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
                <div className="md:hidden mb-4 hidden">
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
                    
                    // Check if this item has a logged action (read-only)
                    const loggedKey = `${itemNumber}-${item}`;
                    const isLogged = loggedDefects.has(loggedKey);
                    const loggedInfo = loggedDefects.get(loggedKey);
              
              return (
                <div key={itemNumber} className={`bg-slate-900/30 border rounded-lg p-4 space-y-3 ${
                  isLogged ? 'border-red-500/50 bg-red-500/5' : 'border-slate-700/50'
                }`}>
                  {/* Item Header */}
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                      <span className="text-sm font-bold text-slate-400">{itemNumber}</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-base font-medium text-white leading-tight">{item}</h4>
                      {isLogged && (
                        <Badge className="mt-2 bg-red-500/20 text-red-400 border-red-500/30">
                          🔒 LOGGED DEFECT (Read-Only)
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Status Buttons - Pass or Fail */}
                  <div className="grid grid-cols-2 gap-3">
                    {(['ok', 'attention'] as InspectionStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => !isLogged && handleStatusChange(itemNumber, status)}
                        disabled={isLogged}
                        className={`flex items-center justify-center h-12 rounded-xl border-3 transition-all ${
                          getStatusColor(status, currentStatus === status)
                        } ${isLogged ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {getStatusIcon(status, currentStatus === status)}
                      </button>
                    ))}
                  </div>

                  {/* Comments/Notes */}
                  {(currentStatus === 'attention' || comments[key]) && (
                    <div className="space-y-2">
                      <Label className="text-slate-900 dark:text-white text-sm">
                        {currentStatus === 'attention' ? (isLogged ? 'Manager Comment (Read-Only)' : 'Comments (Required)') : 'Notes'}
                      </Label>
                      <Textarea
                        value={comments[key] || ''}
                        onChange={(e) => !isLogged && handleCommentChange(itemNumber, e.target.value)}
                        placeholder={isLogged ? '' : 'Add details...'}
                        className={`w-full min-h-[80px] text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 ${
                          currentStatus === 'attention' && !comments[key] && !isLogged ? 'border-red-500' : ''
                        } ${isLogged ? 'cursor-not-allowed opacity-70' : ''}`}
                        required={currentStatus === 'attention' && !isLogged}
                        readOnly={isLogged}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Mark All Pass Button - Desktop */}
          <div className="hidden md:block mb-4 !hidden">
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
                  
                  // Check if this item has a logged action (read-only)
                  const loggedKey = `${itemNumber}-${item}`;
                  const isLogged = loggedDefects.has(loggedKey);
                  
                  return (
                    <tr key={itemNumber} className={`border-b border-slate-700/50 hover:bg-slate-800/30 ${
                      isLogged ? 'bg-red-500/5' : ''
                    }`}>
                      <td className="p-3 text-sm text-slate-400">{itemNumber}</td>
                      <td className="p-3 text-sm text-white">
                        {item}
                        {isLogged && (
                          <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                            🔒 LOGGED
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-3">
                          {(['ok', 'attention'] as InspectionStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => !isLogged && handleStatusChange(itemNumber, status)}
                              disabled={isLogged}
                              className={`flex items-center justify-center w-12 h-12 rounded-lg border-2 transition-all ${
                                getStatusColor(status, currentStatus === status)
                              } ${isLogged ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                          onChange={(e) => !isLogged && handleCommentChange(itemNumber, e.target.value)}
                          placeholder={isLogged ? '' : (currentStatus === 'attention' ? 'Required for defects' : 'Optional notes')}
                          className={`bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 ${
                            currentStatus === 'attention' && !comments[key] && !isLogged ? 'border-red-500' : ''
                          } ${isLogged ? 'cursor-not-allowed opacity-70' : ''}`}
                          readOnly={isLogged}
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

      {/* Resolution Dialog - Required when marking previously-defective items as OK */}
      <Dialog open={showResolutionDialog} onOpenChange={(open) => {
        if (!open && pendingResolution) {
          // User cancelled - don't mark as OK
          setPendingResolution(null);
          setResolutionComment('');
        }
        setShowResolutionDialog(open);
      }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Defect Resolution Required
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              This item was defective in the previous inspection
            </DialogDescription>
          </DialogHeader>
          
          {pendingResolution && (
            <div className="py-4 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <p className="text-sm text-amber-200">
                  <strong>Item {pendingResolution.itemNum}:</strong> {pendingResolution.itemDesc}
                </p>
                <p className="text-xs text-amber-300 mt-2">
                  This item was marked as defective in the last inspection. 
                  Please explain why it is now marked as OK.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="resolution-comment" className="text-white">
                  Resolution Explanation *
                </Label>
                <Textarea
                  id="resolution-comment"
                  value={resolutionComment}
                  onChange={(e) => setResolutionComment(e.target.value)}
                  placeholder="e.g., Light bulb replaced on Wednesday by Dave"
                  className="bg-slate-800 border-slate-600 text-white min-h-[100px]"
                  required
                />
                <p className="text-xs text-slate-400">
                  This comment will be added to the action and marked as complete.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowResolutionDialog(false);
                setPendingResolution(null);
                setResolutionComment('');
              }}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!resolutionComment.trim()) {
                  toast.error('Please provide an explanation');
                  return;
                }
                if (pendingResolution) {
                  // Mark as OK and store resolution comment
                  const key = `${pendingResolution.day}-${pendingResolution.itemNum}`;
                  setCheckboxStates(prev => ({ ...prev, [key]: 'ok' }));
                  setResolvedItems(prev => new Map(prev).set(key, resolutionComment.trim()));
                  
                  // Close dialog and reset
                  setShowResolutionDialog(false);
                  setPendingResolution(null);
                  setResolutionComment('');
                  
                  toast.success('Resolution recorded');
                }
              }}
              className="bg-green-600 hover:bg-green-700"
              disabled={!resolutionComment.trim()}
            >
              Mark as Resolved
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
