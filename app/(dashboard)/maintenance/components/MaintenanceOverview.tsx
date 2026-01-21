'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Calendar, Wrench, ChevronDown, ChevronUp, Loader2, Clock, CheckCircle2, MessageSquare, Pause, Play, Undo2, Briefcase, Info, RefreshCw, Bell } from 'lucide-react';
import type { VehicleMaintenanceWithStatus, MaintenanceCategory, CategoryResponsibility } from '@/types/maintenance';
import { formatDaysUntil, formatMilesUntil, formatMileage, formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';
import type { CompletionUpdatesArray } from '@/types/workshop-completion';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { CreateWorkshopTaskDialog } from '@/components/workshop-tasks/CreateWorkshopTaskDialog';
import { TaskCommentsDrawer } from '@/components/workshop-tasks/TaskCommentsDrawer';
import { MarkTaskCompleteDialog, type CompletionData } from '@/components/workshop-tasks/MarkTaskCompleteDialog';
import { OfficeActionDialog } from './OfficeActionDialog';
import { QuickEditPopover } from './QuickEditPopover';
import { getTaskContent } from '@/lib/utils/serviceTaskCreation';
import { appendStatusHistory, buildStatusHistoryEvent } from '@/lib/utils/workshopTaskStatusHistory';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

// Map alert type to category name for lookup
const ALERT_TO_CATEGORY_NAME: Record<string, string> = {
  'Tax': 'tax due date',
  'MOT': 'mot due date',
  'Service': 'service due',
  'Cambelt': 'cambelt replacement',
  'First Aid Kit': 'first aid kit expiry',
};

interface MaintenanceOverviewProps {
  vehicles: VehicleMaintenanceWithStatus[];
  summary: {
    total: number;
    overdue: number;
    due_soon: number;
  };
  onVehicleClick?: (vehicle: VehicleMaintenanceWithStatus) => void;
}

interface Alert {
  type: string;
  detail: string;
  severity: 'overdue' | 'due_soon';
  sortValue: number; // Normalized to days equivalent - lower = more urgent
}

// Estimated average daily mileage for normalizing mileage-based alerts to days
// This allows comparing date-based (Tax, MOT) with mileage-based (Service, Cambelt) alerts
const ESTIMATED_DAILY_MILES = 35;

interface VehicleWithAlerts extends VehicleMaintenanceWithStatus {
  alerts: Alert[];
}

interface HistoryEntry {
  id: string;
  created_at: string;
  field_name: string;
  old_value: string;
  new_value: string;
  updated_by_name?: string;
}

interface StatusHistoryEvent {
  status: string;
  timestamp: string;
  userId: string;
  userName: string;
  comment?: string;
}

interface WorkshopTask {
  id: string;
  created_at: string;
  status: string;
  title?: string;
  description: string;
  workshop_comments?: string | null;
  vehicle_id?: string;
  status_history?: StatusHistoryEvent[] | null;
  workshop_task_categories?: { 
    id: string;
    name: string;
    completion_updates?: CompletionUpdatesArray | null;
  } | null;
  profiles?: { full_name: string | null } | null;
}

export function MaintenanceOverview({ vehicles, summary, onVehicleClick }: MaintenanceOverviewProps) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [expandedVehicles, setExpandedVehicles] = useState<Set<string>>(new Set());
  const [vehicleHistory, setVehicleHistory] = useState<Record<string, { history: HistoryEntry[], workshopTasks: WorkshopTask[], loading: boolean }>>({});
  
  // Track which vehicles we've started fetching (prevents duplicate requests)
  const fetchingVehicles = useRef<Set<string>>(new Set());
  
  // Create Workshop Task Dialog state
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [createTaskVehicleId, setCreateTaskVehicleId] = useState<string | undefined>();
  const [createTaskCategoryId, setCreateTaskCategoryId] = useState<string | undefined>();
  const [createTaskAlertType, setCreateTaskAlertType] = useState<'Tax' | 'MOT' | 'Service' | 'Cambelt' | 'First Aid Kit' | undefined>();
  const [maintenanceCategoryId, setMaintenanceCategoryId] = useState<string | undefined>();
  
  // Task Action Modals state
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WorkshopTask | null>(null);
  const [loggedComment, setLoggedComment] = useState('');
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completingTask, setCompletingTask] = useState<WorkshopTask | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<Set<string>>(new Set());
  const [showOnHoldModal, setShowOnHoldModal] = useState(false);
  const [onHoldingTask, setOnHoldingTask] = useState<WorkshopTask | null>(null);
  const [onHoldComment, setOnHoldComment] = useState('');
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumingTask, setResumingTask] = useState<WorkshopTask | null>(null);
  const [resumeComment, setResumeComment] = useState('');
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false);
  const [commentsTask, setCommentsTask] = useState<WorkshopTask | null>(null);
  
  // Maintenance categories (for checking responsibility)
  const [maintenanceCategories, setMaintenanceCategories] = useState<MaintenanceCategory[]>([]);
  
  // Office Action Dialog state
  const [showOfficeActionDialog, setShowOfficeActionDialog] = useState(false);
  const [officeActionVehicle, setOfficeActionVehicle] = useState<{
    vehicleId: string;
    vehicleReg: string;
    vehicleNickname?: string | null;
    alertType: 'Tax' | 'MOT' | 'Service' | 'Cambelt' | 'First Aid Kit';
    dueInfo: string;
    currentDueDate?: string | null;
  } | null>(null);
  
  // Helper to get category responsibility
  const getCategoryResponsibility = (alertType: string): CategoryResponsibility => {
    const categoryName = ALERT_TO_CATEGORY_NAME[alertType]?.toLowerCase();
    const category = maintenanceCategories.find(
      c => c.name.toLowerCase() === categoryName
    );
    return category?.responsibility || 'workshop';
  };
  
  // Fetch maintenance categories on mount
  useEffect(() => {
    const fetchMaintenanceCategories = async () => {
      const supabase = createClient();
      try {
        const { data: categories } = await supabase
          .from('maintenance_categories')
          .select('*')
          .eq('is_active', true);
        
        if (categories) {
          setMaintenanceCategories(categories);
        }
      } catch (error) {
        console.error('Error fetching maintenance categories:', error);
      }
    };
    
    fetchMaintenanceCategories();
  }, []);
  
  // Fetch Service category on mount (for pre-filling create task dialog)
  useEffect(() => {
    const fetchServiceCategory = async () => {
      const supabase = createClient();
      try {
        const { data: categories } = await supabase
          .from('workshop_task_categories')
          .select('id, name')
          .ilike('name', '%service%')
          .eq('is_active', true)
          .limit(1);
        
        if (categories && categories.length > 0) {
          setMaintenanceCategoryId(categories[0].id);
        }
      } catch (error) {
        console.error('Error fetching service category:', error);
      }
    };
    
    fetchServiceCategory();
  }, []);
  
  const fetchVehicleHistory = useCallback(async (vehicleId: string, force: boolean = false) => {
    // Check if already fetching or already have data (unless forced)
    if (!force && (fetchingVehicles.current.has(vehicleId) || vehicleHistory[vehicleId])) {
      return; // Already fetching or already fetched
    }
    
    // Mark as fetching
    fetchingVehicles.current.add(vehicleId);
    
    setVehicleHistory(prev => ({ ...prev, [vehicleId]: { history: [], workshopTasks: [], loading: true } }));
    
    try {
      const response = await fetch(`/api/maintenance/history/${vehicleId}`);
      if (!response.ok) throw new Error('Failed to fetch history');
      
      const data = await response.json();
      
      setVehicleHistory(prev => ({
        ...prev,
        [vehicleId]: {
          history: data.history || [],
          workshopTasks: data.workshopTasks || [],
          loading: false
        }
      }));
    } catch (error) {
      console.error('Error fetching vehicle history:', error);
      setVehicleHistory(prev => ({
        ...prev,
        [vehicleId]: { history: [], workshopTasks: [], loading: false }
      }));
    } finally {
      // Always remove from fetching set after completion
      fetchingVehicles.current.delete(vehicleId);
    }
  }, [vehicleHistory]);
  
  // Auto-fetch history for vehicles with alerts on mount
  useEffect(() => {
    const vehiclesWithAlerts = vehicles.filter(v => {
      // Check if vehicle has any overdue or due soon status
      return v.tax_status?.status === 'overdue' || v.tax_status?.status === 'due_soon' ||
        v.mot_status?.status === 'overdue' || v.mot_status?.status === 'due_soon' ||
        v.service_status?.status === 'overdue' || v.service_status?.status === 'due_soon' ||
        v.cambelt_status?.status === 'overdue' || v.cambelt_status?.status === 'due_soon' ||
        v.first_aid_status?.status === 'overdue' || v.first_aid_status?.status === 'due_soon';
    });
    
    vehiclesWithAlerts.forEach(vehicle => {
      const vehicleId = vehicle.vehicle_id || vehicle.id;
      if (vehicleId) {
        fetchVehicleHistory(vehicleId);
      }
    });
  }, [vehicles, fetchVehicleHistory]);
  
  // Group vehicles by their most severe alert status
  const vehiclesWithAlerts: VehicleWithAlerts[] = vehicles.map(vehicle => {
    const alerts: Alert[] = [];
    
    // Check Tax
    if (vehicle.tax_status?.status === 'overdue') {
      alerts.push({
        type: 'Tax',
        detail: formatDaysUntil(vehicle.tax_status.days_until),
        severity: 'overdue',
        sortValue: vehicle.tax_status.days_until ?? 0
      });
    } else if (vehicle.tax_status?.status === 'due_soon') {
      alerts.push({
        type: 'Tax',
        detail: formatDaysUntil(vehicle.tax_status.days_until),
        severity: 'due_soon',
        sortValue: vehicle.tax_status.days_until ?? 0
      });
    }
    
    // Check MOT
    if (vehicle.mot_status?.status === 'overdue') {
      alerts.push({
        type: 'MOT',
        detail: formatDaysUntil(vehicle.mot_status.days_until),
        severity: 'overdue',
        sortValue: vehicle.mot_status.days_until ?? 0
      });
    } else if (vehicle.mot_status?.status === 'due_soon') {
      alerts.push({
        type: 'MOT',
        detail: formatDaysUntil(vehicle.mot_status.days_until),
        severity: 'due_soon',
        sortValue: vehicle.mot_status.days_until ?? 0
      });
    }
    
    // Check Service (normalize miles to days equivalent for sorting)
    if (vehicle.service_status?.status === 'overdue') {
      const milesUntil = vehicle.service_status.miles_until ?? 0;
      alerts.push({
        type: 'Service',
        detail: formatMilesUntil(milesUntil),
        severity: 'overdue',
        sortValue: Math.round(milesUntil / ESTIMATED_DAILY_MILES) // Convert miles to days equivalent
      });
    } else if (vehicle.service_status?.status === 'due_soon') {
      const milesUntil = vehicle.service_status.miles_until ?? 0;
      alerts.push({
        type: 'Service',
        detail: formatMilesUntil(milesUntil),
        severity: 'due_soon',
        sortValue: Math.round(milesUntil / ESTIMATED_DAILY_MILES) // Convert miles to days equivalent
      });
    }
    
    // Check Cambelt (normalize miles to days equivalent for sorting)
    if (vehicle.cambelt_status?.status === 'overdue') {
      const milesUntil = vehicle.cambelt_status.miles_until ?? 0;
      alerts.push({
        type: 'Cambelt',
        detail: formatMilesUntil(milesUntil),
        severity: 'overdue',
        sortValue: Math.round(milesUntil / ESTIMATED_DAILY_MILES) // Convert miles to days equivalent
      });
    } else if (vehicle.cambelt_status?.status === 'due_soon') {
      const milesUntil = vehicle.cambelt_status.miles_until ?? 0;
      alerts.push({
        type: 'Cambelt',
        detail: formatMilesUntil(milesUntil),
        severity: 'due_soon',
        sortValue: Math.round(milesUntil / ESTIMATED_DAILY_MILES) // Convert miles to days equivalent
      });
    }
    
    // Check First Aid
    if (vehicle.first_aid_status?.status === 'overdue') {
      alerts.push({
        type: 'First Aid Kit',
        detail: formatDaysUntil(vehicle.first_aid_status.days_until),
        severity: 'overdue',
        sortValue: vehicle.first_aid_status.days_until ?? 0
      });
    } else if (vehicle.first_aid_status?.status === 'due_soon') {
      alerts.push({
        type: 'First Aid Kit',
        detail: formatDaysUntil(vehicle.first_aid_status.days_until),
        severity: 'due_soon',
        sortValue: vehicle.first_aid_status.days_until ?? 0
      });
    }
    
    return {
      ...vehicle,
      alerts
    };
  });

  // Check if any alerts have matching workshop tasks
  const hasMatchingTasks = (vehicle: VehicleWithAlerts, tasks: WorkshopTask[]): boolean => {
    if (!vehicle.alerts || vehicle.alerts.length === 0 || !tasks || tasks.length === 0) {
      return false;
    }
    
    const regNumber = vehicle.vehicle?.reg_number || 'Unknown';
    const activeTasks = tasks.filter(t => t.status !== 'completed');
    
    return vehicle.alerts.some(alert => {
      const { title } = getTaskContent(alert.type, regNumber, '');
      return activeTasks.some(task => task.title === title || task.description?.includes(title));
    });
  };

  const handleCreateTask = (vehicleId: string, vehicle: VehicleWithAlerts) => {
    setCreateTaskVehicleId(vehicleId);
    // Prefill with Service category if available
    setCreateTaskCategoryId(maintenanceCategoryId);
    // Set the alert type from the first alert (prioritize overdue)
    const alertType = vehicle.alerts?.[0]?.type as 'Tax' | 'MOT' | 'Service' | 'Cambelt' | 'First Aid Kit' | undefined;
    setCreateTaskAlertType(alertType);
    
    setShowCreateTaskDialog(true);
  };

  const handleOfficeAction = (vehicleId: string, vehicle: VehicleWithAlerts) => {
    const alert = vehicle.alerts?.[0];
    if (!alert) return;
    
    const alertType = alert.type as 'Tax' | 'MOT' | 'Service' | 'Cambelt' | 'First Aid Kit';
    
    // Get the current due date based on alert type
    let currentDueDate: string | null = null;
    if (alertType === 'Tax') {
      currentDueDate = vehicle.tax_due_date || null;
    } else if (alertType === 'MOT') {
      currentDueDate = vehicle.mot_due_date || null;
    } else if (alertType === 'First Aid Kit') {
      currentDueDate = vehicle.first_aid_kit_expiry || null;
    }
    
    setOfficeActionVehicle({
      vehicleId,
      vehicleReg: vehicle.vehicle?.reg_number || 'Unknown',
      vehicleNickname: vehicle.vehicle?.nickname,
      alertType,
      dueInfo: alert.detail,
      currentDueDate,
    });
    setShowOfficeActionDialog(true);
  };

  const handleOfficeActionSuccess = () => {
    // Trigger a data refresh by invalidating the history cache
    if (officeActionVehicle?.vehicleId) {
      setVehicleHistory(prev => {
        const newHistory = { ...prev };
        delete newHistory[officeActionVehicle.vehicleId];
        return newHistory;
      });
      fetchVehicleHistory(officeActionVehicle.vehicleId, true);
    }
    // Trigger Next.js soft refresh to refetch server data without losing client state
    router.refresh();
  };

  const handleQuickEditSuccess = () => {
    // Trigger Next.js soft refresh to refetch server data without losing client state
    router.refresh();
  };

  const handleTaskCreated = async () => {
    // Refetch history for the vehicle to show the newly created task
    if (createTaskVehicleId) {
      // Clear the cache for this vehicle
      setVehicleHistory(prev => {
        const newHistory = { ...prev };
        delete newHistory[createTaskVehicleId];
        return newHistory;
      });
      
      // Force refetch (bypass cache check since state update is async)
      fetchVehicleHistory(createTaskVehicleId, true);
    }
  };

  // Handler: Mark In Progress
  const handleMarkInProgress = (task: WorkshopTask) => {
    setSelectedTask(task);
    setLoggedComment('');
    setShowStatusModal(true);
  };

  const confirmMarkInProgress = async () => {
    if (!selectedTask) return;

    if (!loggedComment.trim()) {
      toast.error('Please add a comment');
      return;
    }

    if (loggedComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      const supabase = createClient();
      const statusEvent = buildStatusHistoryEvent({
        status: 'logged',
        body: loggedComment.trim(),
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
      });
      const nextHistory = appendStatusHistory(
        selectedTask.status_history,
        statusEvent
      );

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_at: new Date().toISOString(),
          logged_comment: loggedComment.trim(),
          logged_by: user?.id || null,
          status_history: nextHistory,
        })
        .eq('id', selectedTask.id);

      if (error) throw error;

      toast.success('Task marked as in progress');
      setShowStatusModal(false);
      
      // Refetch vehicle history
      const vehicleId = selectedTask.vehicle_id;
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, true);
      }
    } catch (error: unknown) {
      console.error('Error marking task in progress:', error instanceof Error ? error.message : error);
      toast.error('Failed to update task');
    }
  };

  // Handler: Undo (revert to pending)
  const handleUndo = async (task: WorkshopTask) => {
    try {
      const supabase = createClient();
      const statusEvent = buildStatusHistoryEvent({
        status: 'undo',
        body: 'Returned to pending',
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
        meta: { from: 'logged', to: 'pending' },
      });
      const nextHistory = appendStatusHistory(task.status_history, statusEvent);
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'pending',
          logged_at: null,
          logged_comment: null,
          logged_by: null,
          status_history: nextHistory,
        })
        .eq('id', task.id);

      if (error) throw error;

      toast.success('Task reverted to pending');
      
      // Refetch vehicle history
      const vehicleId = task.vehicle_id;
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, true);
      }
    } catch (error: unknown) {
      console.error('Error undoing task:', error instanceof Error ? error.message : error);
      toast.error('Failed to undo task');
    }
  };

  // Handler: Mark Complete
  const handleMarkComplete = (task: WorkshopTask) => {
    setCompletingTask(task);
    setShowCompleteModal(true);
  };

  const confirmMarkComplete = async (data: CompletionData) => {
    if (!completingTask) return;

    const taskId = completingTask.id;
    const vehicleId = completingTask.vehicle_id;
    const requiresIntermediateStep = completingTask.status === 'pending' || completingTask.status === 'on_hold';

    try {
      setUpdatingStatus(prev => new Set(prev).add(taskId));

      const supabase = createClient();
      const now = new Date();

      // Fetch latest status_history from database to ensure we have current state
      const { data: latestTask, error: fetchError } = await supabase
        .from('actions')
        .select('status_history')
        .eq('id', taskId)
        .single();

      if (fetchError) {
        console.error('Error fetching latest task state:', fetchError);
        throw fetchError;
      }

      // Use database status_history (or empty array if null)
      let nextHistory = Array.isArray(latestTask.status_history) 
        ? latestTask.status_history 
        : [];

      let updatePayload: Record<string, any> = {
        status: 'completed',
        actioned_at: now.toISOString(),
        actioned_comment: data.completedComment,
        actioned_by: user?.id || null,
      };

      if (requiresIntermediateStep) {
        const intermediateStatus = completingTask.status === 'on_hold' ? 'resumed' : 'logged';
        const intermediateEvent = buildStatusHistoryEvent({
          status: intermediateStatus,
          body: data.intermediateComment,
          authorId: user?.id || null,
          authorName: profile?.full_name || null,
          createdAt: now.toISOString(),
        });
        nextHistory = appendStatusHistory(nextHistory, intermediateEvent);

        updatePayload = {
          ...updatePayload,
          logged_at: now.toISOString(),
          logged_comment: data.intermediateComment,
          logged_by: user?.id || null,
        };
      }

      const completeEvent = buildStatusHistoryEvent({
        status: 'completed',
        body: data.completedComment,
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
        createdAt: new Date(now.getTime() + 1).toISOString(),
      });
      nextHistory = appendStatusHistory(nextHistory, completeEvent);

      updatePayload.status_history = nextHistory;

      // Mark as complete
      const { error: completeError } = await supabase
        .from('actions')
        .update(updatePayload)
        .eq('id', taskId);

      if (completeError) throw completeError;

      // Update maintenance if there are any updates
      if (data.maintenanceUpdates && vehicleId) {
        try {
          const maintenanceResponse = await fetch(
            `/api/maintenance/by-vehicle/${vehicleId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...data.maintenanceUpdates,
                comment: `Updated from workshop task completion: ${completingTask.title || 'Task'}`,
              }),
            }
          );

          if (!maintenanceResponse.ok) {
            const error = await maintenanceResponse.json();
            console.error('Failed to update maintenance:', error);
            toast.warning('Task completed but maintenance update failed');
          }
        } catch (maintError) {
          console.error('Error updating maintenance:', maintError);
          toast.warning('Task completed but maintenance update failed');
        }
      }

      toast.success('Task marked as complete');
      setShowCompleteModal(false);
      setCompletingTask(null);
      
      // Refetch vehicle history
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, true);
      }

      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    } catch (error: unknown) {
      console.error('Error marking task complete:', error instanceof Error ? error.message : error);
      toast.error('Failed to complete task');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  // Handler: On Hold
  const handleOnHold = (task: WorkshopTask) => {
    setOnHoldingTask(task);
    setOnHoldComment('');
    setShowOnHoldModal(true);
  };

  const confirmOnHold = async () => {
    if (!onHoldingTask) return;

    if (!onHoldComment.trim()) {
      toast.error('Please add a comment explaining why this task is on hold');
      return;
    }

    if (onHoldComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      const supabase = createClient();
      const statusEvent = buildStatusHistoryEvent({
        status: 'on_hold',
        body: onHoldComment.trim(),
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
      });
      const nextHistory = appendStatusHistory(
        onHoldingTask.status_history,
        statusEvent
      );
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'on_hold',
          logged_at: new Date().toISOString(),
          logged_comment: onHoldComment.trim(),
          logged_by: user?.id || null,
          status_history: nextHistory,
        })
        .eq('id', onHoldingTask.id);

      if (error) throw error;

      toast.success('Task marked as on hold');
      setShowOnHoldModal(false);
      
      // Refetch vehicle history
      const vehicleId = onHoldingTask.vehicle_id;
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, true);
      }
    } catch (error: unknown) {
      console.error('Error marking task on hold:', error);
      toast.error('Failed to update task');
    }
  };

  // Handler: Resume
  const handleResume = (task: WorkshopTask) => {
    setResumingTask(task);
    setResumeComment('');
    setShowResumeModal(true);
  };

  const confirmResume = async () => {
    if (!resumingTask) return;

    if (!resumeComment.trim()) {
      toast.error('Please add a comment about resuming this task');
      return;
    }

    if (resumeComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      const supabase = createClient();
      const statusEvent = buildStatusHistoryEvent({
        status: 'resumed',
        body: resumeComment.trim(),
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
      });
      const nextHistory = appendStatusHistory(
        resumingTask.status_history,
        statusEvent
      );
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_at: new Date().toISOString(),
          logged_comment: resumeComment.trim(),
          logged_by: user?.id || null,
          status_history: nextHistory,
        })
        .eq('id', resumingTask.id);

      if (error) throw error;

      toast.success('Task resumed');
      setShowResumeModal(false);
      
      // Refetch vehicle history
      const vehicleId = resumingTask.vehicle_id;
      if (vehicleId) {
        setVehicleHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[vehicleId];
          return newHistory;
        });
        fetchVehicleHistory(vehicleId, true);
      }
    } catch (error: unknown) {
      console.error('Error resuming task:', error instanceof Error ? error.message : error);
      toast.error('Failed to resume task');
    }
  };

  // Handler: Open Comments Drawer
  const handleOpenComments = (task: WorkshopTask) => {
    setCommentsTask(task);
    setShowCommentsDrawer(true);
  };

  const toggleVehicle = async (vehicleId: string, vehicle?: VehicleMaintenanceWithStatus) => {
    const newExpanded = new Set(expandedVehicles);
    if (newExpanded.has(vehicleId)) {
      newExpanded.delete(vehicleId);
    } else {
      newExpanded.add(vehicleId);
      fetchVehicleHistory(vehicleId);
    }
    setExpandedVehicles(newExpanded);
  };

  const handleCardClick = (vehicleId: string, vehicle: VehicleWithAlerts) => {
    // If onVehicleClick is provided, use it for navigation
    if (onVehicleClick) {
      onVehicleClick(vehicle);
    } else {
      // Otherwise, just toggle expansion
      toggleVehicle(vehicleId, vehicle);
    }
  };
  
  // Helper to get the most urgent sortValue for a vehicle (lowest value = most urgent)
  // All sortValues are normalized to "days equivalent" for fair comparison between
  // date-based (Tax, MOT, First Aid) and mileage-based (Service, Cambelt) alerts
  const getMostUrgentSortValue = (vehicle: VehicleWithAlerts): number => {
    if (!vehicle.alerts || vehicle.alerts.length === 0) return Infinity;
    return Math.min(...vehicle.alerts.map(a => a.sortValue));
  };

  // Filter and sort: most overdue first (most negative days equivalent)
  const overdueVehicles = vehiclesWithAlerts
    .filter(v => v.alerts.some(a => a.severity === 'overdue'))
    .sort((a, b) => getMostUrgentSortValue(a) - getMostUrgentSortValue(b));
  
  // Filter and sort: soonest due first (lowest positive days equivalent)
  const dueSoonVehicles = vehiclesWithAlerts
    .filter(v => 
      v.alerts.some(a => a.severity === 'due_soon') && !v.alerts.some(a => a.severity === 'overdue')
    )
    .sort((a, b) => getMostUrgentSortValue(a) - getMostUrgentSortValue(b));
  
  // Don't show panels if no alerts
  if (overdueVehicles.length === 0 && dueSoonVehicles.length === 0) {
    return (
      <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/40">
              <Wrench className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-green-900 dark:text-green-100">
                All Caught Up!
              </h3>
              <p className="text-sm text-green-700 dark:text-green-300">
                No maintenance items are overdue or due soon. {summary.total} vehicle{summary.total !== 1 ? 's' : ''} being monitored.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const renderVehicleCard = (vehicle: VehicleWithAlerts, isOverdue: boolean) => {
    const vehicleId = vehicle.vehicle_id || vehicle.id;
    const isExpanded = expandedVehicles.has(vehicleId);
    const historyData = vehicleHistory[vehicleId];
    
    // Wait for history to load before checking for existing tasks
    // If still loading, assume no tasks (show Loading button)
    // If loaded (not loading), check if tasks exist
    const hasExistingTasks = historyData && !historyData.loading && hasMatchingTasks(vehicle, historyData.workshopTasks);
    
    return (
      <Card 
        key={vehicleId}
        className={`cursor-pointer transition-all ${
          isOverdue 
            ? 'bg-white dark:bg-slate-900 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-slate-800/50' 
            : 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-slate-800/50'
        }`}
        onClick={() => handleCardClick(vehicleId, vehicle)}
      >
        <CardContent className="p-4">
          {/* Collapsed View - Now includes ALL service information */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Vehicle Info and Alerts */}
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg text-white">
                      {vehicle.vehicle?.reg_number || 'Unknown'}
                    </h3>
                    {vehicle.vehicle?.nickname && (
                      <span className="text-sm text-muted-foreground">({vehicle.vehicle.nickname})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {vehicle.alerts.map((alert, idx) => (
                      <QuickEditPopover
                        key={idx}
                        alert={alert}
                        vehicleId={vehicleId}
                        vehicle={vehicle}
                        onSuccess={handleQuickEditSuccess}
                      />
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Status Badge - Top Right Corner (only show if task exists) */}
              {hasExistingTasks && (() => {
                const regNumber = vehicle.vehicle?.reg_number || 'Unknown';
                const relatedTask = historyData?.workshopTasks.find(task => {
                  if (task.status === 'completed') return false;
                  return vehicle.alerts.some(alert => {
                    const { title } = getTaskContent(alert.type, regNumber, '');
                    return task.title === title || task.description?.includes(title);
                  });
                });
                if (!relatedTask) return null;
                return (
                  <Badge 
                    variant="outline" 
                    className={`text-sm px-3 py-1 font-semibold ${
                      relatedTask.status === 'pending' 
                        ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30'
                        : relatedTask.status === 'logged' || relatedTask.status === 'in_progress'
                        ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                        : 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                    }`}
                  >
                    {relatedTask.status === 'logged' || relatedTask.status === 'in_progress' ? 'In Progress' : relatedTask.status === 'pending' ? 'Pending' : 'On Hold'}
                  </Badge>
                );
              })()}
            </div>
            
            {/* Service Information - Horizontal Row with Status Badge and Chevron */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 flex-1">
                {/* Current Mileage */}
                <div className="space-y-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Mileage</div>
                  <div className="text-sm font-medium text-white">
                    {formatMileage(vehicle.current_mileage)}
                  </div>
                </div>

                {/* Cambelt Due */}
                <div className="space-y-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Cambelt</div>
                  <div className={`text-sm font-medium ${vehicle.cambelt_status?.status === 'overdue' || vehicle.cambelt_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {vehicle.cambelt_due_mileage 
                      ? formatMileage(vehicle.cambelt_due_mileage)
                      : 'Not Set'}
                  </div>
                </div>

                {/* Tax Due */}
                <div className="space-y-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Tax Due</div>
                  <div className={`text-sm font-medium ${vehicle.tax_status?.status === 'overdue' || vehicle.tax_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {formatMaintenanceDate(vehicle.tax_due_date)}
                  </div>
                </div>

                {/* First Aid Kit */}
                <div className="space-y-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">First Aid</div>
                  <div className={`text-sm font-medium ${vehicle.first_aid_status?.status === 'overdue' || vehicle.first_aid_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {formatMaintenanceDate(vehicle.first_aid_kit_expiry)}
                  </div>
                </div>

                {/* MOT Due */}
                <div className="space-y-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">MOT Due</div>
                  <div className={`text-sm font-medium ${vehicle.mot_status?.status === 'overdue' || vehicle.mot_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {formatMaintenanceDate(vehicle.mot_due_date)}
                  </div>
                </div>

                {/* Service Due */}
                <div className="space-y-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Service Due</div>
                  <div className={`text-sm font-medium ${vehicle.service_status?.status === 'overdue' || vehicle.service_status?.status === 'due_soon' ? 'text-red-400' : 'text-white'}`}>
                    {vehicle.next_service_mileage 
                      ? formatMileage(vehicle.next_service_mileage)
                      : 'Not Set'}
                  </div>
                </div>

                {/* Last Service */}
                <div className="space-y-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Last Service</div>
                  <div className="text-sm font-medium text-white">
                    {vehicle.last_service_mileage 
                      ? formatMileage(vehicle.last_service_mileage)
                      : 'Not Set'}
                  </div>
                </div>

                {/* Tracker ID */}
                {vehicle.tracker_id && (
                  <div className="space-y-0">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">GPS Tracker</div>
                    <div className="text-sm font-medium text-white">
                      {vehicle.tracker_id}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Action Button - Bottom Right (mutually exclusive: Office Action OR Create Task OR Expand OR Loading) */}
              {historyData?.loading ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-shrink-0 text-muted-foreground"
                  disabled
                >
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Loading...
                </Button>
              ) : !hasExistingTasks ? (
                // Check if the primary alert is an office responsibility
                (() => {
                  const primaryAlertType = vehicle.alerts?.[0]?.type || '';
                  const responsibility = getCategoryResponsibility(primaryAlertType);
                  
                  if (responsibility === 'office') {
                    return (
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-shrink-0 bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOfficeAction(vehicleId, vehicle);
                        }}
                      >
                        <Briefcase className="h-4 w-4 mr-1" />
                        Office Action
                      </Button>
                    );
                  }
                  
                  return (
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-shrink-0 bg-workshop hover:bg-workshop-dark text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateTask(vehicleId, vehicle);
                      }}
                    >
                      <Wrench className="h-4 w-4 mr-1" />
                      Create Task
                    </Button>
                  );
                })()
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-shrink-0 text-muted-foreground hover:text-white hover:bg-slate-800"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleVehicle(vehicleId, vehicle);
                  }}
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-1" />
                      Collapse
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-1" />
                      Expand
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Expanded View - Workshop Tasks */}
          {isExpanded && (
            <div className="mt-4 pt-4 border-t border-border" onClick={(e) => e.stopPropagation()}>
              {historyData?.loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : (() => {
                // Find the related non-completed task that matches the alert
                const regNumber = vehicle.vehicle?.reg_number || 'Unknown';
                const relatedTask = historyData?.workshopTasks.find(task => {
                  if (task.status === 'completed') return false;
                  return vehicle.alerts.some(alert => {
                    const { title } = getTaskContent(alert.type, regNumber, '');
                    return task.title === title || task.description?.includes(title);
                  });
                });
                
                if (!relatedTask) {
                  return <p className="text-sm text-muted-foreground py-4 text-center">No active workshop task found</p>;
                }
                
                // Ensure task has vehicle_id for handlers
                const taskWithVehicleId = { ...relatedTask, vehicle_id: vehicleId };
                
                // Display task details directly
                return (
                  <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <h5 className="font-medium text-white">{relatedTask.title}</h5>
                        {relatedTask.workshop_comments && (
                          <p className="text-sm text-muted-foreground">{relatedTask.workshop_comments}</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Created {formatDistanceToNow(new Date(relatedTask.created_at), { addSuffix: true })}</span>
                      {relatedTask.profiles?.full_name && (
                        <span>by {relatedTask.profiles.full_name}</span>
                      )}
                    </div>
                    
                    {/* Action Buttons - Aligned Right */}
                    <div className="flex justify-end gap-2 pt-2 border-t border-border">
                      {/* Pending Status Buttons: Comments, In Progress, Complete */}
                      {relatedTask.status === 'pending' && (
                        <>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenComments(taskWithVehicleId);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-9 px-3 text-xs border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800"
                          >
                            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                            Comments
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkInProgress(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs bg-blue-600/80 hover:bg-blue-600 text-white border-0"
                          >
                            <Clock className="h-3.5 w-3.5 mr-1.5" />
                            In Progress
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkComplete(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                            Complete
                          </Button>
                        </>
                      )}
                      
                      {/* In Progress (Logged) Status Buttons: Comments, Undo, On Hold, Complete */}
                      {(relatedTask.status === 'logged' || relatedTask.status === 'in_progress') && (
                        <>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenComments(taskWithVehicleId);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-9 px-3 text-xs border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800"
                          >
                            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                            Comments
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUndo(taskWithVehicleId);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-9 px-3 text-xs border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800"
                          >
                            <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                            Undo
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOnHold(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs bg-purple-600/80 hover:bg-purple-600 text-white border-0"
                          >
                            <Pause className="h-3.5 w-3.5 mr-1.5" />
                            On Hold
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkComplete(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                            Complete
                          </Button>
                        </>
                      )}
                      
                      {/* On Hold Status Buttons: Comments, Resume, Complete */}
                      {relatedTask.status === 'on_hold' && (
                        <>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenComments(taskWithVehicleId);
                            }}
                            size="sm"
                            variant="outline"
                            className="h-9 px-3 text-xs border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800"
                          >
                            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                            Comments
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResume(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs transition-all border-0 bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <Play className="h-3.5 w-3.5 mr-1.5" />
                            Resume
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkComplete(taskWithVehicleId);
                            }}
                            size="sm"
                            className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                            Complete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };
  
  return (
    <div className="space-y-6">
      {/* Overdue Tasks */}
      {overdueVehicles.length > 0 && (
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <CardTitle className="text-lg text-red-900 dark:text-red-100">
                Overdue Tasks
              </CardTitle>
            </div>
            <CardDescription className="text-red-700 dark:text-red-300">
              {overdueVehicles.length} vehicle{overdueVehicles.length !== 1 ? 's' : ''} requiring immediate attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {overdueVehicles.map(vehicle => renderVehicleCard(vehicle, true))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Due Soon Tasks */}
      {dueSoonVehicles.length > 0 && (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-lg text-amber-900 dark:text-amber-100">
                Due Soon
              </CardTitle>
            </div>
            <CardDescription className="text-amber-700 dark:text-amber-300">
              {dueSoonVehicles.length} vehicle{dueSoonVehicles.length !== 1 ? 's' : ''} coming up
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dueSoonVehicles.map(vehicle => renderVehicleCard(vehicle, false))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* About Section */}
      <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-semibold mb-2">About Maintenance Alerts</p>
              <p>
                This page shows vehicles with <span className="font-medium text-red-600 dark:text-red-400">Overdue</span> or <span className="font-medium text-amber-600 dark:text-amber-400">Due Soon</span> maintenance items. 
                Items appear here based on the alert thresholds configured in Settings.
              </p>
              
              <div className="mt-4 space-y-3">
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded bg-workshop flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Wrench className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div>
                    <p className="font-medium">Create Task (Workshop)</p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      For maintenance requiring physical workshop work (Service, Cambelt, MOT). Creates a workshop task that can be assigned and tracked.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded bg-avs-yellow flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Briefcase className="h-3.5 w-3.5 text-slate-900" />
                  </div>
                  <div>
                    <p className="font-medium">Office Action</p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      For administrative tasks like Tax renewal. Opens a dialog with three options:
                    </p>
                    <ul className="text-xs text-blue-700 dark:text-blue-300 mt-1 ml-4 list-disc space-y-0.5">
                      <li><Bell className="h-3 w-3 inline mr-1" /><strong>Send Reminder</strong> - Notify configured recipients via in-app and/or email</li>
                      <li><Calendar className="h-3 w-3 inline mr-1" /><strong>Update Date</strong> - Manually update the due date after completing the action</li>
                      <li><RefreshCw className="h-3 w-3 inline mr-1" /><strong>Refresh DVLA</strong> - Sync Tax/MOT dates from DVLA (updates automatically after online renewal)</li>
                    </ul>
                  </div>
                </div>
              </div>
              
              <p className="mt-4 text-xs text-blue-600 dark:text-blue-400">
                <strong>Tip:</strong> Configure which categories are Workshop vs Office responsibilities in the <span className="font-medium">Settings</span> tab.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create Workshop Task Dialog */}
      <CreateWorkshopTaskDialog
        open={showCreateTaskDialog}
        onOpenChange={setShowCreateTaskDialog}
        initialVehicleId={createTaskVehicleId}
        initialCategoryId={createTaskCategoryId}
        alertType={createTaskAlertType}
        onSuccess={handleTaskCreated}
      />

      {/* Office Action Dialog */}
      {officeActionVehicle && (
        <OfficeActionDialog
          open={showOfficeActionDialog}
          onOpenChange={setShowOfficeActionDialog}
          vehicleId={officeActionVehicle.vehicleId}
          vehicleReg={officeActionVehicle.vehicleReg}
          vehicleNickname={officeActionVehicle.vehicleNickname}
          alertType={officeActionVehicle.alertType}
          dueInfo={officeActionVehicle.dueInfo}
          currentDueDate={officeActionVehicle.currentDueDate}
          onSuccess={handleOfficeActionSuccess}
        />
      )}

      {/* Mark In Progress Modal */}
      <Dialog open={showStatusModal} onOpenChange={setShowStatusModal}>
        <DialogContent className="bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Mark Task In Progress</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a short note about starting this work
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="logged-comment" className="text-foreground">
                Comment <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="logged-comment"
                value={loggedComment}
                onChange={(e) => setLoggedComment(e.target.value)}
                placeholder="What are you starting work on?"
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {loggedComment.length}/300 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStatusModal(false)}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMarkInProgress}
              disabled={!loggedComment.trim() || loggedComment.length > 300}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              <Clock className="h-4 w-4 mr-2" />
              Mark In Progress
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Task Complete Modal */}
      <MarkTaskCompleteDialog
        open={showCompleteModal}
        onOpenChange={setShowCompleteModal}
        task={completingTask}
        onConfirm={confirmMarkComplete}
        isSubmitting={completingTask ? updatingStatus.has(completingTask.id) : false}
      />

      {/* On Hold Modal */}
      <Dialog open={showOnHoldModal} onOpenChange={setShowOnHoldModal}>
        <DialogContent className="bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Put Task On Hold</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This task will be marked as &quot;On Hold&quot; and can be resumed later
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <p className="text-sm text-purple-300">
                This task will be marked as &quot;On Hold&quot; and can be resumed later. On hold tasks will still appear in driver inspections.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="onhold-comment" className="text-foreground">
                Reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="onhold-comment"
                value={onHoldComment}
                onChange={(e) => setOnHoldComment(e.target.value)}
                placeholder="Why is this task being put on hold?"
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {onHoldComment.length}/300 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowOnHoldModal(false)}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmOnHold}
              disabled={!onHoldComment.trim() || onHoldComment.length > 300}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Pause className="h-4 w-4 mr-2" />
              Put On Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resume Task Modal */}
      <Dialog open={showResumeModal} onOpenChange={setShowResumeModal}>
        <DialogContent className="bg-white dark:bg-slate-900 border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground text-xl">Resume Task</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This task will be moved back to In Progress
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resume-comment" className="text-foreground">
                Comment <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="resume-comment"
                value={resumeComment}
                onChange={(e) => setResumeComment(e.target.value)}
                placeholder="Note about resuming this task"
                className="bg-white dark:bg-slate-800 border-border text-foreground min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                {resumeComment.length}/300 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResumeModal(false)}
              className="border-border text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmResume}
              disabled={!resumeComment.trim() || resumeComment.length > 300}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Play className="h-4 w-4 mr-2" />
              Resume Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task Comments Drawer */}
      {commentsTask && (
        <TaskCommentsDrawer
          taskId={commentsTask.id}
          open={showCommentsDrawer}
          onOpenChange={setShowCommentsDrawer}
          taskTitle={commentsTask.title || 'Workshop Task'}
        />
      )}
    </div>
  );
}
