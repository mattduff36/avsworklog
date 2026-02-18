'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Save, Send, CheckCircle2, XCircle, AlertCircle, Info, User, Camera } from 'lucide-react';
import { BackButton } from '@/components/ui/back-button';
import { formatDateISO, formatDate, getDayOfWeek } from '@/lib/utils/date';
import { InspectionStatus } from '@/types/inspection';
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';
import { Database } from '@/types/database';
import { Employee } from '@/types/common';
import { toast } from 'sonner';
import { showErrorWithReport } from '@/lib/utils/error-reporting';

// Dynamic imports for heavy components
const PhotoUpload = dynamic(() => import('@/components/forms/PhotoUpload'), { ssr: false });
const SignaturePad = dynamic(() => import('@/components/forms/SignaturePad'), { ssr: false });

// Type definitions
type InspectionItem = {
  id: string;
  inspection_id: string;
  item_number: number;
  item_description: string;
  status: InspectionStatus;
  day_of_week: number;
  comments?: string | null;
};

type PlantWithCategory = {
  id: string;
  plant_id: string;
  nickname?: string | null;
  vehicle_categories?: { name: string } | null;
};

type InspectionWithRelations = {
  id: string;
  user_id: string;
  plant_id: string;
  inspection_date: string;
  inspection_end_date: string;
  status: string;
  plant?: PlantWithCategory;
  inspection_items?: InspectionItem[];
};

type LoggedAction = {
  id: string;
  status: string;
  logged_comment: string | null;
  inspection_items?: {
    item_number: number;
    item_description: string;
  } | null;
};

type ProfileWithRole = {
  role?: {
    is_manager_admin?: boolean;
  } | null;
};

function NewPlantInspectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('id');
  const { user, isManager } = useAuth();
  const supabase = createClient();
  
  const [plants, setPlants] = useState<Array<{ 
    id: string; 
    plant_id: string; 
    nickname?: string | null;
    vehicle_categories?: { name: string } | null;
  }>>([]);
  const [selectedPlantId, setSelectedPlantId] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  
  // Current hours state (single value, like vehicle mileage)
  const [currentHours, setCurrentHours] = useState('');
  // Track original current_mileage for backward compatibility with old drafts
  const [originalCurrentMileage, setOriginalCurrentMileage] = useState<number | null | undefined>(undefined);
  
  const [checkboxStates, setCheckboxStates] = useState<Record<string, InspectionStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const currentChecklist = PLANT_INSPECTION_ITEMS;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [showConfirmSubmitDialog, setShowConfirmSubmitDialog] = useState(false);
  const [savingDraftFromConfirm, setSavingDraftFromConfirm] = useState(false);
  const [existingInspectionId, setExistingInspectionId] = useState<string | null>(null);
  
  // Manager-specific states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  // Logged defects tracking
  const [loggedDefects, setLoggedDefects] = useState<Map<string, { comment: string; actionId: string }>>(new Map());
  
  const [checklistStarted, setChecklistStarted] = useState(false);
  const [duplicateCheckLoading, setDuplicateCheckLoading] = useState(false);
  const [duplicateInspection, setDuplicateInspection] = useState<string | null>(null);
  
  const [photoUploadItem, setPhotoUploadItem] = useState<{ itemNumber: number; dayOfWeek: number } | null>(null);
  
  // End of inspection comment + inform workshop states
  const [inspectorComments, setInspectorComments] = useState('');
  const [informWorkshop, setInformWorkshop] = useState(false);
  const [creatingWorkshopTask, setCreatingWorkshopTask] = useState(false);

  useEffect(() => {
    const fetchPlants = async () => {
      try {
        const { data, error } = await supabase
          .from('plant')
          .select(`
            *,
            vehicle_categories (
              name
            )
          `)
          .eq('status', 'active')
          .order('plant_id');

        if (error) throw error;
        setPlants(data || []);
      } catch (err) {
        console.error('Error fetching plants:', err);
        setError('Failed to load plants');
      }
    };

    fetchPlants();
  }, [supabase]);

  useEffect(() => {
    if (draftId && user && !loading) {
      const loadDraftInspection = async (id: string) => {
        try {
          setLoading(true);
          setError('');

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

          const { data: inspection, error: inspectionError } = await supabase
            .from('vehicle_inspections')
            .select(`
              *,
              plant (
                id,
                plant_id,
                nickname,
                vehicle_categories (name)
              )
            `)
            .eq('id', id)
            .single();

          if (inspectionError) throw inspectionError;

          if (!userIsManager && inspection.user_id !== user?.id) {
            setError('You do not have permission to edit this inspection');
            return;
          }

          if (inspection.status !== 'draft') {
            setError('Only draft inspections can be edited here');
            return;
          }

          const { data: items, error: itemsError } = await supabase
            .from('inspection_items')
            .select('*')
            .eq('inspection_id', id)
            .order('item_number');

          if (itemsError) throw itemsError;

          setExistingInspectionId(id);
          const inspectionData = inspection as InspectionWithRelations;
          setSelectedPlantId(inspectionData.plant?.id || '');
          setInspectionDate(inspection.inspection_date || formatDateISO(new Date()));
          setSelectedEmployeeId(inspection.user_id);

          setOriginalCurrentMileage(inspection.current_mileage);
          setCurrentHours(inspection.current_mileage?.toString() || '');

          const newCheckboxStates: Record<string, InspectionStatus> = {};
          const newComments: Record<string, string> = {};
          
          (items as InspectionItem[] | null)?.forEach((item: InspectionItem) => {
            const key = `${item.item_number}`;
            const existing = newCheckboxStates[key];
            if (existing && existing === 'attention') return;
            newCheckboxStates[key] = item.status;
            if (item.comments) {
              newComments[key] = item.comments;
            }
          });

          setCheckboxStates(newCheckboxStates);
          setComments(newComments);
          
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

      const timer = setTimeout(() => {
        loadDraftInspection(draftId);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [draftId, user, loading, supabase]);

  useEffect(() => {
    if (user && isManager) {
      const fetchEmployees = async () => {
        try {
          const { data: profiles, error } = await supabase
            .from('profiles')
            .select('id, full_name, employee_id')
            .order('full_name');

          if (error) throw error;

          const formattedEmployees: Employee[] = (profiles || [])
            .map((emp) => ({
              id: emp.id,
              full_name: emp.full_name || 'Unnamed User',
              employee_id: emp.employee_id || null,
            }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name));
          
          setEmployees(formattedEmployees);
          
          if (user) {
            setSelectedEmployeeId(user.id);
          }
        } catch (err) {
          console.error('Error fetching employees:', err);
        }
      };

      fetchEmployees();
    } else if (user) {
      setSelectedEmployeeId(user.id);
    }
  }, [user, isManager, supabase]);

  const checkForDuplicate = useCallback(async (
    plantIdToCheck: string, 
    dateToCheck: string,
    clearOtherErrors: boolean = false
  ): Promise<boolean> => {
    if (!plantIdToCheck || !dateToCheck || existingInspectionId) {
      setDuplicateInspection(null);
      return false;
    }

    setDuplicateCheckLoading(true);
    
    try {
      const { data, error } = await supabase
        .from('vehicle_inspections')
        .select('id, status')
        .eq('plant_id', plantIdToCheck)
        .eq('inspection_date', dateToCheck)
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        const existing = data[0];
        setDuplicateInspection(existing.id);
        setError(`An inspection for this plant and date already exists (${existing.status}). Please select a different plant or date.`);
        return true;
      } else {
        setDuplicateInspection(null);
        setError(prev => {
          if (prev.includes('already exists')) {
            return '';
          }
          return clearOtherErrors ? '' : prev;
        });
        return false;
      }
    } catch (err) {
      console.error('Error checking for duplicate:', err);
      setDuplicateInspection(null);
      return false;
    } finally {
      setDuplicateCheckLoading(false);
    }
  }, [existingInspectionId, supabase]);

  useEffect(() => {
    if (selectedPlantId && inspectionDate && !existingInspectionId) {
      checkForDuplicate(selectedPlantId, inspectionDate);
    }
  }, [selectedPlantId, inspectionDate, existingInspectionId, checkForDuplicate]);

  const loadLockedDefects = async (plantId: string) => {
    try {
      const response = await fetch(`/api/plant-inspections/locked-defects?plantId=${plantId}`);
      
      if (response.ok) {
        const { lockedItems } = await response.json();
        
        const loggedMap = new Map<string, { comment: string; actionId: string }>();
        
        lockedItems.forEach((item: any) => {
          const key = `${item.item_number}-${item.item_description}`;
          const statusLabel = 
            item.status === 'on_hold' ? 'on hold' :
            item.status === 'logged' ? 'logged' :
            'in progress';
          loggedMap.set(key, {
            comment: item.comment || `Defect ${statusLabel} by management`,
            actionId: item.actionId
          });
        });

        setLoggedDefects(loggedMap);

        const newCheckboxStates: Record<string, InspectionStatus> = {};
        const newComments: Record<string, string> = {};

        loggedMap.forEach((loggedInfo, key) => {
          const [itemNumStr] = key.split('-');
          const itemNum = parseInt(itemNumStr);
          const stateKey = `${itemNum}`;
          newCheckboxStates[stateKey] = 'attention';
          newComments[stateKey] = loggedInfo.comment;
        });

        setCheckboxStates(newCheckboxStates);
        setComments(newComments);
      } else {
        console.error('Failed to fetch locked defects');
        setError('Warning: Unable to check for existing defects. Please refresh the page before continuing.');
      }
    } catch (err) {
      console.error('Error loading locked defects:', err);
      setLoggedDefects(new Map());
    }
  };

  const handleStatusChange = (itemNumber: number, status: InspectionStatus) => {
    const key = `${itemNumber}`;
    
    if (!checklistStarted) {
      setChecklistStarted(true);
    }
    
    setCheckboxStates(prev => ({ ...prev, [key]: status }));
  };

  const handleCommentChange = (itemNumber: number, comment: string) => {
    const key = `${itemNumber}`;
    setComments(prev => ({ ...prev, [key]: comment }));
  };

  const getParsedHours = (): number | null => {
    if (!currentHours || currentHours.trim() === '') return null;
    const hoursValue = parseInt(currentHours, 10);
    if (Number.isNaN(hoursValue) || hoursValue < 0) return null;
    return hoursValue;
  };

  const handleSubmit = () => {
    if (!existingInspectionId) {
      setShowConfirmSubmitDialog(true);
      return;
    }
    
    validateAndSubmit();
  };
  
  const validateAndSubmit = () => {
    if (!selectedPlantId) {
      setError('Please select a plant');
      return;
    }

    const hoursValue = getParsedHours();
    // Allow null hours only for existing inspections that originally had null (backward compatibility)
    const isOldDraftWithoutHours = existingInspectionId && originalCurrentMileage === null;
    if (hoursValue === null && !isOldDraftWithoutHours) {
      setError('Please enter a valid current hours reading');
      return;
    }

    // Validate: all defects must have comments
    const defectsWithoutComments: string[] = [];
    Object.entries(checkboxStates).forEach(([key, status]) => {
      if (status === 'attention' && !comments[key]) {
        const itemNumber = parseInt(key);
        const itemName = currentChecklist[itemNumber - 1] || `Item ${itemNumber}`;
        defectsWithoutComments.push(itemName);
      }
    });

    if (defectsWithoutComments.length > 0) {
      setError(`Please add comments for all defects: ${defectsWithoutComments.join(', ')}`);
      toast.error('Missing defect comments', {
        description: `Please add comments for: ${defectsWithoutComments.slice(0, 3).join(', ')}${defectsWithoutComments.length > 3 ? '...' : ''}`,
      });
      return;
    }

    // Validate inform workshop
    if (informWorkshop && inspectorComments.trim().length < 10) {
      setError('Workshop notification requires at least 10 characters in the comment field');
      toast.error('Comment too short');
      return;
    }
    
    setError('');
    setShowConfirmSubmitDialog(false);
    
    setTimeout(() => {
      setShowSignatureDialog(true);
    }, 100);
  };

  const handleSignatureComplete = async (sig: string) => {
    setSignature(sig);
    setShowSignatureDialog(false);
    await saveInspection('submitted', sig);
  };

  const saveInspection = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId || !selectedPlantId) return;
    
    if (!inspectionDate || inspectionDate.trim() === '') {
      setError('Please select an inspection date');
      return;
    }
    
    if (duplicateInspection) {
      setError('An inspection for this plant and date already exists.');
      return;
    }
    
    const isDuplicate = await checkForDuplicate(selectedPlantId, inspectionDate, true);
    if (isDuplicate) {
      setError('An inspection for this plant and date already exists.');
      return;
    }
    
    if (loading) {
      return;
    }

    setError('');
    setLoading(true);

    try {
      type InspectionInsert = Database['public']['Tables']['vehicle_inspections']['Insert'];
      const inspectionData: InspectionInsert = {
        plant_id: selectedPlantId,
        user_id: selectedEmployeeId,
        inspection_date: inspectionDate,
        inspection_end_date: inspectionDate,
        current_mileage: getParsedHours(),
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        signature_data: signatureData || null,
        signed_at: signatureData ? new Date().toISOString() : null,
        inspector_comments: inspectorComments.trim() || null,
      };

      let inspection: InspectionWithRelations;

      if (existingInspectionId) {
        const { data: existingItems, error: fetchError } = await supabase
          .from('inspection_items')
          .select('id')
          .eq('inspection_id', existingInspectionId);

        if (fetchError) throw new Error(`Failed to fetch existing items: ${fetchError.message}`);

        if (existingItems && existingItems.length > 0) {
          const { error: deleteError } = await supabase
            .from('inspection_items')
            .delete()
            .eq('inspection_id', existingInspectionId);

          if (deleteError) throw new Error(`Failed to delete existing items: ${deleteError.message}`);
        }

        inspection = { id: existingInspectionId };
      } else {
        const { data: newInspection, error: insertError } = await supabase
          .from('vehicle_inspections')
          .insert(inspectionData)
          .select()
          .single();

        if (insertError) throw insertError;
        inspection = newInspection;
      }

      if (!inspection) throw new Error('Failed to save inspection');

      type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
      const items: InspectionItemInsert[] = [];
      const dayOfWeek = getDayOfWeek(new Date(inspectionDate + 'T00:00:00'));
      
      currentChecklist.forEach((item, index) => {
        const itemNumber = index + 1;
        const key = `${itemNumber}`;
        
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

      let insertedItems: InspectionItem[] = [];
      if (items.length > 0) {
        const { data, error: itemsError } = await supabase
          .from('inspection_items')
          .insert(items)
          .select();

        if (itemsError) throw new Error(`Failed to save inspection items: ${itemsError.message}`);
        
        insertedItems = (data || []) as InspectionItem[];
      }

      if (existingInspectionId) {
        type InspectionUpdate = Database['public']['Tables']['vehicle_inspections']['Update'];
        const inspectionUpdate: InspectionUpdate = {
          plant_id: selectedPlantId,
          user_id: selectedEmployeeId,
          inspection_date: inspectionDate,
          inspection_end_date: inspectionDate,
          current_mileage: getParsedHours(),
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

        if (updateError) throw updateError;
        
        if (!updatedInspection || updatedInspection.length === 0) {
          throw new Error('Failed to update inspection');
        }
        
        inspection = updatedInspection[0];
      }

      // Sync defect tasks
      if (insertedItems && insertedItems.length > 0) {
        const failedItems = insertedItems.filter((item: InspectionItem) => item.status === 'attention');
        
        if (failedItems.length > 0) {
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

          const defects = Array.from(groupedDefects.values()).map(group => ({
            item_number: group.item_number,
            item_description: group.item_description,
            days: group.days,
            comment: group.comments.length > 0 ? group.comments[0] : '',
            primaryInspectionItemId: group.item_ids[0]
          }));

          try {
            const syncResponse = await fetch('/api/plant-inspections/sync-defect-tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inspectionId: inspection.id,
                plantId: selectedPlantId,
                createdBy: user!.id,
                defects
              })
            });

            if (syncResponse.ok) {
              const syncResult = await syncResponse.json();
              console.log(`✅ Sync complete: ${syncResult.message}`);
            } else {
              const errorData = await syncResponse.json();
              throw new Error(errorData.error || 'Failed to sync defect tasks');
            }
          } catch (error) {
            console.error('Error syncing defect tasks:', error);
            const errorMsg = error instanceof Error ? error.message : 'Failed to sync defect tasks';
            toast.error(`Warning: Inspection saved, but ${errorMsg}`);
          }
        }
      }

      // Handle inform workshop
      if (informWorkshop && inspectorComments.trim().length >= 10) {
        try {
          setCreatingWorkshopTask(true);
          
          const informResponse = await fetch('/api/plant-inspections/inform-workshop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inspectionId: inspection.id,
              plantId: selectedPlantId,
              createdBy: user!.id,
              comments: inspectorComments.trim(),
            }),
          });

          if (informResponse.ok) {
            const result = await informResponse.json();
            toast.success('Workshop task created');
          } else {
            const errorData = await informResponse.json();
            throw new Error(errorData.error || 'Failed to create workshop task');
          }
        } catch (informError) {
          console.error('Error in inform-workshop flow:', informError);
          const errorMsg = informError instanceof Error ? informError.message : 'Failed to create workshop task';
          setError(`Inspection saved, but workshop task creation failed: ${errorMsg}`);
          setLoading(false);
          setCreatingWorkshopTask(false);
          return;
        } finally {
          setCreatingWorkshopTask(false);
        }
      }

      if (status === 'draft') {
        toast.success('Draft saved successfully');
      } else {
        toast.success('Inspection submitted successfully');
      }

      router.push('/plant-inspections');
    } catch (err) {
      console.error('Error saving inspection:', err);
      
      let errorMessage = 'An unexpected error occurred';
      
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      
      showErrorWithReport(
        'Failed to save inspection',
        errorMessage,
        { plantId: selectedPlantId, inspectionDate, existingInspectionId }
      );
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: InspectionStatus, isSelected: boolean) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-green-400' : 'text-muted-foreground'}`} />;
      case 'attention':
        return <XCircle className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-red-400' : 'text-muted-foreground'}`} />;
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
        return 'bg-slate-800/30 border-border';
    }
  };

  const totalItems = currentChecklist.length;
  const completedItems = Object.keys(checkboxStates).length;
  const progressPercent = Math.round((completedItems / totalItems) * 100);

  return (
    <div className="space-y-4 pb-32 md:pb-6 max-w-5xl">
      
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <BackButton fallbackHref="/plant-inspections" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-foreground">
                {existingInspectionId ? 'Edit Plant Inspection' : 'New Plant Inspection'}
              </h1>
              <p className="text-sm text-muted-foreground hidden md:block">
                {existingInspectionId ? 'Continue editing your draft' : 'Daily plant safety check'}
              </p>
            </div>
          </div>
          {selectedPlantId && (
            <div className="bg-plant-inspection/10 dark:bg-plant-inspection/20 border border-plant-inspection/30 rounded-lg px-3 py-2">
              <div className="text-xs text-muted-foreground">Progress</div>
              <div className="text-lg font-bold text-foreground">{completedItems}/{totalItems}</div>
            </div>
          )}
        </div>
        {selectedPlantId && (
          <div className="h-2 bg-slate-200 dark:bg-slate-800/50 rounded-full overflow-hidden">
            <div 
              className="h-full bg-plant-inspection transition-all duration-300"
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

      {/* Plant Details Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-foreground">Inspection Details</CardTitle>
          <CardDescription className="text-muted-foreground">
            {inspectionDate ? `Date: ${formatDate(inspectionDate)}` : 'Select a date'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Manager: Employee Selector */}
          {isManager && (
            <div className="space-y-2 pb-4 border-b border-border">
              <Label htmlFor="employee" className="text-foreground text-base flex items-center gap-2">
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
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plant" className="text-foreground text-base">Plant</Label>
              <Select 
                value={selectedPlantId} 
                disabled={checklistStarted}
                onValueChange={(value) => {
                  setSelectedPlantId(value);
                  loadLockedDefects(value);
                }}
              >
                <SelectTrigger id="plant" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white" disabled={checklistStarted}>
                  <SelectValue placeholder="Select a plant" />
                </SelectTrigger>
                <SelectContent className="border-border max-h-[300px] md:max-h-[400px]">
                  <SelectGroup>
                    {plants.map((plant) => (
                      <SelectItem key={plant.id} value={plant.id}>
                        {plant.plant_id} {plant.nickname ? `- ${plant.nickname}` : ''} ({plant.vehicle_categories?.name || 'Uncategorized'})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inspectionDate" className="text-foreground text-base flex items-center gap-2">
                Inspection Date
                <span className="text-red-400">*</span>
              </Label>
              <Input
                id="inspectionDate"
                type="date"
                value={inspectionDate}
                onChange={(e) => {
                  setError('');
                  setInspectionDate(e.target.value);
                }}
                max={formatDateISO(new Date())}
                disabled={checklistStarted}
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white w-full"
                required
              />
            </div>
          </div>

          {/* Current Hours */}
          <div className="space-y-2">
            <Label htmlFor="currentHours" className="text-foreground text-base flex items-center gap-2">
              Current Hours
              {!(existingInspectionId && originalCurrentMileage === null) && (
                <span className="text-red-400">*</span>
              )}
            </Label>
            <Input
              id="currentHours"
              type="number"
              value={currentHours}
              onChange={(e) => setCurrentHours(e.target.value)}
              placeholder="e.g., 45000"
              min="0"
              step="1"
              className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-muted-foreground"
              required={!(existingInspectionId && originalCurrentMileage === null)}
            />
            {existingInspectionId && originalCurrentMileage === null && (
              <p className="text-xs text-muted-foreground">
                Optional for this draft (created before current hours was required)
              </p>
            )}
          </div>
          
          {checklistStarted && (
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-400">
                <Info className="h-4 w-4 inline mr-2" />
                Plant and date are locked once you start filling the checklist.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Safety Check */}
      {selectedPlantId && inspectionDate && !duplicateInspection && !duplicateCheckLoading && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground">{currentChecklist.length}-Point Plant Safety Check</CardTitle>
          <CardDescription className="text-muted-foreground">
            Mark each item as Pass or Fail
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 md:p-6">

          {/* Mobile View */}
          <div className="md:hidden space-y-3">
            {currentChecklist.map((item, index) => {
              const itemNumber = index + 1;
              const key = `${itemNumber}`;
              const currentStatus = checkboxStates[key];
              
              const loggedKey = `${itemNumber}-${item}`;
              const isLogged = loggedDefects.has(loggedKey);
        
              return (
                <div key={itemNumber} className={`bg-slate-900/30 border rounded-lg p-4 space-y-3 ${
                  isLogged ? 'border-red-500/50 bg-red-500/5' : 'border-border/50'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                      <span className="text-sm font-bold text-muted-foreground">{itemNumber}</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-base font-medium text-white leading-tight">{item}</h4>
                      {isLogged && (
                        <Badge className="mt-2 bg-red-500/20 text-red-400 border-red-500/30">
                          LOGGED DEFECT
                        </Badge>
                      )}
                    </div>
                  </div>

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

                  {(currentStatus === 'attention' || comments[key]) && (
                    <div className="space-y-2">
                      <Label className="text-foreground text-sm">
                        {currentStatus === 'attention' ? (isLogged ? 'Manager Comment' : 'Comments (Required)') : 'Notes'}
                      </Label>
                      <Textarea
                        value={comments[key] || ''}
                        onChange={(e) => !isLogged && handleCommentChange(itemNumber, e.target.value)}
                        placeholder={isLogged ? '' : 'Add details...'}
                        className={`w-full min-h-[80px] text-base bg-slate-900/50 border-slate-600 text-white ${
                          currentStatus === 'attention' && !comments[key] && !isLogged ? 'border-red-500' : ''
                        } ${isLogged ? 'cursor-not-allowed opacity-70' : ''}`}
                        required={currentStatus === 'attention' && !isLogged}
                        readOnly={isLogged}
                      />
                    </div>
                  )}

                  {currentStatus === 'attention' && !isLogged && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (existingInspectionId) {
                          setPhotoUploadItem({ itemNumber, dayOfWeek: getDayOfWeek(new Date(inspectionDate + 'T00:00:00')) });
                        } else {
                          toast.info('Save as draft first to upload photos');
                        }
                      }}
                      disabled={!existingInspectionId}
                      className="w-full border-border text-muted-foreground hover:bg-slate-800"
                    >
                      <Camera className="h-4 w-4 mr-2" />
                      {existingInspectionId ? 'Add Photo' : 'Save draft to upload photos'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 w-12 font-medium text-white">#</th>
                  <th className="text-left p-3 font-medium text-white">Item</th>
                  <th className="text-center p-3 w-48 font-medium text-white">Status</th>
                  <th className="text-left p-3 font-medium text-white">Comments</th>
                  <th className="text-center p-3 w-20 font-medium text-white">Photo</th>
                </tr>
              </thead>
              <tbody>
                {currentChecklist.map((item, index) => {
                  const itemNumber = index + 1;
                  const key = `${itemNumber}`;
                  const currentStatus = checkboxStates[key];
                  
                  const loggedKey = `${itemNumber}-${item}`;
                  const isLogged = loggedDefects.has(loggedKey);
                  
                  return (
                    <tr key={itemNumber} className={`border-b border-border/50 hover:bg-slate-800/30 ${
                      isLogged ? 'bg-red-500/5' : ''
                    }`}>
                      <td className="p-3 text-sm text-muted-foreground">{itemNumber}</td>
                      <td className="p-3 text-sm text-white">
                        {item}
                        {isLogged && (
                          <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                            LOGGED
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
                          className={`bg-slate-900/50 border-slate-600 text-white ${
                            currentStatus === 'attention' && !comments[key] && !isLogged ? 'border-red-500' : ''
                          } ${isLogged ? 'cursor-not-allowed opacity-70' : ''}`}
                          readOnly={isLogged}
                        />
                      </td>
                      <td className="p-3 text-center">
                        {currentStatus === 'attention' && !isLogged ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (existingInspectionId) {
                                setPhotoUploadItem({ itemNumber, dayOfWeek: getDayOfWeek(new Date(inspectionDate + 'T00:00:00')) });
                              } else {
                                toast.info('Save draft first');
                              }
                            }}
                            disabled={!existingInspectionId}
                            className="text-muted-foreground hover:text-white"
                          >
                            <Camera className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* End of Inspection Comments */}
          <div className="mt-6 p-4 bg-slate-800/40 border border-border/50 rounded-lg">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inspector-comments" className="text-white text-base">
                  End of Inspection Notes <span className="text-muted-foreground text-sm">(Optional)</span>
                </Label>
                <Textarea
                  id="inspector-comments"
                  value={inspectorComments}
                  onChange={(e) => setInspectorComments(e.target.value)}
                  placeholder="Add any additional notes..."
                  className="min-h-[100px] bg-slate-900/50 border-slate-600 text-white"
                  maxLength={500}
                />
              </div>

              <div className="flex items-start space-x-3 p-3 bg-slate-900/30 rounded-lg border border-border/30">
                <Checkbox
                  id="inform-workshop"
                  checked={informWorkshop}
                  onCheckedChange={(checked) => setInformWorkshop(checked === true)}
                  className="mt-0.5 border-slate-500 data-[state=checked]:bg-workshop data-[state=checked]:border-workshop"
                />
                <div className="flex-1">
                  <Label 
                    htmlFor="inform-workshop" 
                    className="text-white cursor-pointer flex items-center gap-2"
                  >
                    Inform Workshop
                    <Badge variant="outline" className="text-xs border-workshop/50 text-workshop">
                      Creates Task
                    </Badge>
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Creates a workshop task from your notes.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop Action Buttons */}
          <div className="hidden md:flex flex-row gap-3 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => saveInspection('draft')}
              disabled={loading || !selectedPlantId}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || !selectedPlantId}
              className="bg-plant-inspection hover:bg-plant-inspection/90 text-slate-900 font-semibold"
            >
              <Send className="h-4 w-4 mr-2" />
              {loading ? 'Submitting...' : 'Submit Inspection'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Mobile Sticky Footer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-border/50 p-4 z-20">
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => saveInspection('draft')}
            disabled={loading || !selectedPlantId}
            className="flex-1 h-14 border-slate-600 text-white hover:bg-slate-800"
          >
            <Save className="h-5 w-5 mr-2" />
            Save Draft
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !selectedPlantId}
            className="flex-1 h-14 bg-plant-inspection hover:bg-plant-inspection/90 text-slate-900 font-semibold text-base"
          >
            <Send className="h-5 w-5 mr-2" />
            Submit
          </Button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog 
        open={showConfirmSubmitDialog} 
        onOpenChange={(open) => {
          if (!open && (savingDraftFromConfirm || error)) return;
          if (!open) setError('');
          setShowConfirmSubmitDialog(open);
        }}
      >
        <DialogContent className="border-border text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Confirm Submission</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Before you submit, please confirm
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-red-400 font-semibold mb-1">Validation Error</p>
                    <p className="text-red-300 text-sm">{error}</p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
              <p className="text-slate-200">
                Have you completed this plant inspection for {inspectionDate ? formatDate(inspectionDate) : 'today'}?
              </p>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Plant inspections should be submitted <strong className="text-white">daily</strong>.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setError('');
                setShowConfirmSubmitDialog(false);
              }}
              disabled={savingDraftFromConfirm}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setSavingDraftFromConfirm(true);
                try {
                  await saveInspection('draft');
                } catch (error) {
                  console.error('Failed to save draft:', error);
                } finally {
                  setSavingDraftFromConfirm(false);
                }
              }}
              disabled={savingDraftFromConfirm || loading}
              className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
            >
              <Save className="h-4 w-4 mr-2" />
              {savingDraftFromConfirm ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={validateAndSubmit}
              disabled={savingDraftFromConfirm}
              className="bg-plant-inspection hover:bg-plant-inspection/90 text-slate-900 font-semibold"
            >
              <Send className="h-4 w-4 mr-2" />
              Submit Inspection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Signature Dialog */}
      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="border-border text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Inspection</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Sign below to confirm your inspection is accurate
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

      {/* Photo Upload Modal */}
      {photoUploadItem && existingInspectionId && (
        <PhotoUpload
          inspectionId={existingInspectionId}
          itemNumber={photoUploadItem.itemNumber}
          onClose={() => setPhotoUploadItem(null)}
          onUploadComplete={() => {
            setPhotoUploadItem(null);
            toast.success('Photo uploaded successfully');
          }}
        />
      )}
    </div>
  );
}

export default function NewPlantInspectionPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><p className="text-muted-foreground">Loading...</p></div>}>
      <NewPlantInspectionContent />
    </Suspense>
  );
}
