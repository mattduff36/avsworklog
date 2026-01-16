'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Settings, Plus, CheckCircle2, Clock, AlertTriangle, FileText, Wrench, Undo2, Info, Edit, Trash2, ChevronDown, ChevronUp, MessageSquare, Pause } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { toast } from 'sonner';
import { Database } from '@/types/database';
import { TaskCommentsDrawer } from '@/components/workshop-tasks/TaskCommentsDrawer';
import { WorkshopTaskModal } from '@/components/workshop-tasks/WorkshopTaskModal';
import { SubcategoryDialog } from '@/components/workshop-tasks/SubcategoryDialog';
import { CategoryManagementPanel } from '@/components/workshop-tasks/CategoryManagementPanel';
import { MarkTaskCompleteDialog, type CompletionData } from '@/components/workshop-tasks/MarkTaskCompleteDialog';
import { appendStatusHistory, buildStatusHistoryEvent } from '@/lib/utils/workshopTaskStatusHistory';

type Action = Database['public']['Tables']['actions']['Row'] & {
  vehicle_inspections?: {
    inspection_date: string;
    vehicles?: {
      reg_number: string;
      nickname: string | null;
    };
  };
  vehicles?: {
    reg_number: string;
    nickname: string | null;
  };
  workshop_task_categories?: {
    id: string;
    name: string;
    completion_updates?: any[] | null;
  };
  profiles_created?: {
    full_name: string | null;
  } | null;
};

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

export default function WorkshopTasksPage() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('workshop-tasks');
  
  const { user, profile, isManager, isAdmin } = useAuth();
  const showSettings = isAdmin || isManager;
  const supabase = createClient();
  
  const [tasks, setTasks] = useState<Action[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [vehicleFilter, setVehicleFilter] = useState<string>('all');
  
  // Add Task Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState('');
  const [workshopComments, setWorkshopComments] = useState('');
  const [newMileage, setNewMileage] = useState('');
  const [currentMileage, setCurrentMileage] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  // Status Update Modal (for "Mark In Progress" / logged)
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Action | null>(null);
  const [loggedComment, setLoggedComment] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState<Set<string>>(new Set());
  
  // Complete Task Modal
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completingTask, setCompletingTask] = useState<Action | null>(null);

  // On Hold modal state
  const [showOnHoldModal, setShowOnHoldModal] = useState(false);
  const [onHoldingTask, setOnHoldingTask] = useState<Action | null>(null);
  const [onHoldComment, setOnHoldComment] = useState('');

  // Resume modal state
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumingTask, setResumingTask] = useState<Action | null>(null);
  const [resumeComment, setResumeComment] = useState('');
  
  // Edit Task Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Action | null>(null);
  
  // Delete Task Confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Action | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editVehicleId, setEditVehicleId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editSubcategoryId, setEditSubcategoryId] = useState('');
  const [editComments, setEditComments] = useState('');
  const [editMileage, setEditMileage] = useState('');
  const [editCurrentMileage, setEditCurrentMileage] = useState<number | null>(null);
  
  // Category Management
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [submittingCategory, setSubmittingCategory] = useState(false);

  // Subcategory Management
  const [showSubcategoryModal, setShowSubcategoryModal] = useState(false);
  const [subcategoryMode, setSubcategoryMode] = useState<'create' | 'edit'>('create');
  const [selectedCategoryForSubcategory, setSelectedCategoryForSubcategory] = useState<Category | null>(null);
  const [editingSubcategory, setEditingSubcategory] = useState<Subcategory | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  
  // Expandable sections state (Pending and In Progress open by default, Completed closed)
  const [showPending, setShowPending] = useState(true);
  const [showInProgress, setShowInProgress] = useState(true);
  const [showOnHold, setShowOnHold] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  
  // Comments drawer
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false);
  const [commentsTask, setCommentsTask] = useState<Action | null>(null);
  
  const handleOpenComments = (task: Action) => {
    setCommentsTask(task);
    setShowCommentsDrawer(true);
  };

  // Workshop Task Modal
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [modalTask, setModalTask] = useState<Action | null>(null);

  const handleOpenTaskModal = (task: Action) => {
    setModalTask(task);
    setShowTaskModal(true);
  };

  useEffect(() => {
    if (user) {
      fetchTasks();
      fetchVehicles();
      fetchCategories();
      fetchSubcategories();
    }
  }, [user, statusFilter, vehicleFilter]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('actions')
        .select(`
          *,
          vehicle_inspections (
            inspection_date,
            vehicles (
              reg_number,
              nickname
            )
          ),
          vehicles (
            reg_number,
            nickname
          ),
          workshop_task_categories (
            id,
            name,
            slug,
            ui_color,
            completion_updates
          ),
          workshop_task_subcategories!workshop_subcategory_id (
            id,
            name,
            slug,
            ui_color,
            workshop_task_categories (
              id,
              name,
              slug,
              ui_color,
              completion_updates
            )
          )
        `)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .order('created_at', { ascending: false });

      // Apply filters
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      
      if (vehicleFilter !== 'all') {
        query = query.eq('vehicle_id', vehicleFilter);
      }

      const { data, error } = await query;

      if (error) throw error;

      const createdByIds = Array.from(
        new Set((data || []).map(task => task.created_by).filter(Boolean))
      );
      let profileMap = new Map<string, { full_name: string | null }>();
      if (createdByIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', createdByIds);
        profileMap = new Map(
          (profiles || []).map(profile => [profile.id, { full_name: profile.full_name }])
        );
      }

      const tasksWithProfiles = (data || []).map(task => ({
        ...task,
        profiles_created: task.created_by
          ? profileMap.get(task.created_by) || null
          : null,
      }));

      setTasks(tasksWithProfiles);
    } catch (err) {
      console.error('Error fetching tasks:', err instanceof Error ? err.message : err);
      toast.error('Failed to load workshop tasks');
    } finally {
      setLoading(false);
    }
  };

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
      console.error('Error fetching vehicles:', err instanceof Error ? err.message : err);
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
      console.error('Error fetching categories:', err instanceof Error ? err.message : err);
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
      console.error('Error fetching subcategories:', err instanceof Error ? err.message : err);
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
      console.error('Error fetching current mileage:', err instanceof Error ? err.message : err);
      setCurrentMileage(null);
    }
  };

  // Filter subcategories by selected category
  const filteredSubcategories = selectedCategoryId
    ? subcategories.filter(sub => sub.category_id === selectedCategoryId)
    : [];

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

      // Create the workshop task
      const { error } = await supabase
        .from('actions')
        .insert({
          action_type: 'workshop_vehicle_task',
          vehicle_id: selectedVehicleId,
          workshop_subcategory_id: selectedSubcategoryId,
          workshop_comments: workshopComments,
          title: `Workshop Task - ${vehicles.find(v => v.id === selectedVehicleId)?.reg_number}`,
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

      setShowAddModal(false);
      resetAddForm();
      fetchTasks();
    } catch (err) {
      console.error('Error creating task:', err instanceof Error ? err.message : err);
      toast.error('Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const resetAddForm = () => {
    setSelectedVehicleId('');
    setSelectedCategoryId('');
    setSelectedSubcategoryId('');
    setWorkshopComments('');
    setNewMileage('');
    setCurrentMileage(null);
  };

  // Handle category change (reset subcategory when category changes)
  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId('');  // Reset subcategory
  };

  const handleMarkInProgress = (task: Action) => {
    setSelectedTask(task);
    setLoggedComment('');
    setShowStatusModal(true);
  };

  const confirmMarkInProgress = async () => {
    if (!selectedTask) return;

    if (!loggedComment.trim()) {
      toast.error('Comment is required');
      return;
    }

    if (loggedComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      setUpdatingStatus(prev => new Set(prev).add(selectedTask.id));

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
          logged_comment: loggedComment.trim(),
          logged_at: new Date().toISOString(),
          logged_by: user?.id || null,
          status_history: nextHistory,
        })
        .eq('id', selectedTask.id);

      if (error) throw error;

      toast.success('Task marked as in progress');
      setShowStatusModal(false);
      setSelectedTask(null);
      setLoggedComment('');

      await fetchTasks();
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedTask.id);
        return newSet;
      });
    } catch (err) {
      console.error('Error updating status:', err instanceof Error ? err.message : err);
      toast.error('Failed to update status');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedTask.id);
        return newSet;
      });
    }
  };

  const handleMarkComplete = (task: Action) => {
    setCompletingTask(task);
    setShowCompleteModal(true);
  };

  const handleMarkOnHold = (task: Action) => {
    setOnHoldingTask(task);
    setOnHoldComment('');
    setShowOnHoldModal(true);
  };

  const confirmMarkOnHold = async () => {
    if (!onHoldingTask) return;

    if (!onHoldComment.trim()) {
      toast.error('Comment is required');
      return;
    }

    if (onHoldComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      setUpdatingStatus(prev => new Set(prev).add(onHoldingTask.id));

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
          logged_by: user?.id || null,
          logged_comment: onHoldComment.trim(),
          status_history: nextHistory,
        })
        .eq('id', onHoldingTask.id);

      if (error) {
        console.error('Supabase error placing task on hold:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      toast.success('Task placed on hold');
      setShowOnHoldModal(false);
      await fetchTasks();
    } catch (error: any) {
      console.error('Error updating task:', error);
      toast.error(error?.message || 'Failed to update task');
    } finally {
      setUpdatingStatus(prev => {
        const next = new Set(prev);
        next.delete(onHoldingTask.id);
        return next;
      });
    }
  };

  const handleResumeTask = (task: Action) => {
    setResumingTask(task);
    setResumeComment('');
    setShowResumeModal(true);
  };

  const confirmResumeTask = async () => {
    if (!resumingTask) return;

    if (!resumeComment.trim()) {
      toast.error('Comment is required');
      return;
    }

    if (resumeComment.length > 300) {
      toast.error('Comment must be 300 characters or less');
      return;
    }

    try {
      setUpdatingStatus(prev => new Set(prev).add(resumingTask.id));

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
          logged_by: user?.id || null,
          logged_comment: resumeComment.trim(),
          status_history: nextHistory,
        })
        .eq('id', resumingTask.id);

      if (error) {
        console.error('Supabase error resuming task:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      toast.success('Task resumed');
      setShowResumeModal(false);
      await fetchTasks();
    } catch (error: any) {
      console.error('Error resuming task:', error);
      toast.error(error?.message || 'Failed to resume task');
    } finally {
      setUpdatingStatus(prev => {
        const next = new Set(prev);
        next.delete(resumingTask.id);
        return next;
      });
    }
  };

  const confirmMarkComplete = async (data: CompletionData) => {
    if (!completingTask) return;

    const taskId = completingTask.id;
    const requiresIntermediateStep = completingTask.status === 'pending' || completingTask.status === 'on_hold';

    try {
      setUpdatingStatus(prev => new Set(prev).add(taskId));

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

      // Step 1: If needed, move to In Progress first
      if (requiresIntermediateStep) {
        const intermediateStatus =
          completingTask?.status === 'on_hold' ? 'resumed' : 'logged';
        const intermediateEvent = buildStatusHistoryEvent({
          status: intermediateStatus,
          body: data.intermediateComment,
          authorId: user?.id || null,
          authorName: profile?.full_name || null,
          createdAt: now.toISOString(),
        });
        nextHistory = appendStatusHistory(nextHistory, intermediateEvent);

        const { error: intermediateError } = await supabase
          .from('actions')
          .update({
            status: 'logged',
            logged_at: now.toISOString(),
            logged_by: user?.id || null,
            logged_comment: data.intermediateComment,
            status_history: nextHistory,
          })
          .eq('id', taskId);

        if (intermediateError) {
          console.error('Error in intermediate step:', intermediateError);
          throw intermediateError;
        }
      }

      const completeEvent = buildStatusHistoryEvent({
        status: 'completed',
        body: data.completedComment,
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
        createdAt: new Date(now.getTime() + 1).toISOString(),
      });
      nextHistory = appendStatusHistory(nextHistory, completeEvent);

      // Step 2: Mark as complete (use consistent timestamp)
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'completed',
          actioned: true,
          actioned_at: new Date(now.getTime() + 1).toISOString(),
          actioned_by: user?.id || null,
          actioned_comment: data.completedComment,
          status_history: nextHistory,
        })
        .eq('id', taskId);

      if (error) {
        console.error('Error completing task:', error);
        throw error;
      }

      // Step 3: Update maintenance if there are any updates
      if (data.maintenanceUpdates && completingTask.vehicle_id) {
        try {
          const maintenanceResponse = await fetch(
            `/api/maintenance/by-vehicle/${completingTask.vehicle_id}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...data.maintenanceUpdates,
                comment: `Updated from workshop task completion: ${completingTask.title}`,
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

      await fetchTasks();
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    } catch (err) {
      console.error('Error marking complete:', err instanceof Error ? err.message : err);
      toast.error('Failed to mark complete');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  const handleUndoComplete = async (taskId: string) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      const returnStatus = task?.logged_at ? 'logged' : 'pending';

      setUpdatingStatus(prev => new Set(prev).add(taskId));

      const statusEvent = buildStatusHistoryEvent({
        status: 'undo',
        body: `Returned to ${returnStatus === 'logged' ? 'in progress' : 'pending'}`,
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
        meta: { from: 'completed', to: returnStatus },
      });
      const nextHistory = appendStatusHistory(task?.status_history, statusEvent);

      const { error } = await supabase
        .from('actions')
        .update({
          status: returnStatus,
          actioned: false,
          actioned_at: null,
          actioned_by: null,
          status_history: nextHistory,
        })
        .eq('id', taskId);

      if (error) throw error;

      toast.success(`Task returned to ${returnStatus === 'logged' ? 'in progress' : 'pending'}`);

      await fetchTasks();
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    } catch (err) {
      console.error('Error undoing complete:', err instanceof Error ? err.message : err);
      toast.error('Failed to undo');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  const handleUndoLogged = async (taskId: string) => {
    try {
      setUpdatingStatus(prev => new Set(prev).add(taskId));

      const task = tasks.find(t => t.id === taskId);
      const statusEvent = buildStatusHistoryEvent({
        status: 'undo',
        body: 'Returned to pending',
        authorId: user?.id || null,
        authorName: profile?.full_name || null,
        meta: { from: 'logged', to: 'pending' },
      });
      const nextHistory = appendStatusHistory(task?.status_history, statusEvent);

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'pending',
          logged_comment: null,
          logged_at: null,
          logged_by: null,
          status_history: nextHistory,
        })
        .eq('id', taskId);

      if (error) throw error;

      toast.success('Task returned to pending');

      await fetchTasks();
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    } catch (err) {
      console.error('Error undoing logged:', err instanceof Error ? err.message : err);
      toast.error('Failed to undo');
      setUpdatingStatus(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  const handleEditTask = async (task: Action) => {
    setEditingTask(task);
    setEditVehicleId(task.vehicle_id || '');
    setEditCategoryId(task.workshop_category_id || '');
    setEditSubcategoryId(task.workshop_subcategory_id || '');
    setEditComments(task.workshop_comments || '');
    setEditMileage('');
    
    // Fetch current mileage for the vehicle
    if (task.vehicle_id) {
      try {
        const { data, error } = await supabase
          .from('vehicle_maintenance')
          .select('current_mileage')
          .eq('vehicle_id', task.vehicle_id)
          .single();

        if (error && error.code !== 'PGRST116') throw error;
        setEditCurrentMileage(data?.current_mileage || null);
      } catch (err) {
        console.error('Error fetching mileage:', err instanceof Error ? err.message : err);
        setEditCurrentMileage(null);
      }
    }
    
    setShowEditModal(true);
  };

  const handleDeleteTask = (task: Action) => {
    setTaskToDelete(task);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;

    try {
      setDeleting(true);

      const { error } = await supabase
        .from('actions')
        .delete()
        .eq('id', taskToDelete.id);

      if (error) throw error;

      toast.success('Task deleted successfully');
      setShowDeleteConfirm(false);
      setTaskToDelete(null);
      fetchTasks();
    } catch (err) {
      console.error('Error deleting task:', err instanceof Error ? err.message : err);
      toast.error('Failed to delete task');
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveEdit = async () => {
    // Validate user is authenticated
    if (!user?.id) {
      toast.error('You must be logged in to edit tasks');
      return;
    }

    if (!editVehicleId || !editCategoryId || !editComments.trim() || !editMileage.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    if (editComments.length < 10) {
      toast.error('Comments must be at least 10 characters');
      return;
    }

    const mileageValue = parseInt(editMileage);
    if (isNaN(mileageValue) || mileageValue < 0) {
      toast.error('Please enter a valid mileage');
      return;
    }

    // Validate mileage is >= current mileage
    if (editCurrentMileage !== null && mileageValue < editCurrentMileage) {
      toast.error(`Mileage must be equal to or greater than current mileage (${editCurrentMileage.toLocaleString()} miles)`);
      return;
    }

    if (!editingTask) return;

    try {
      setSubmitting(true);

      // Update the workshop task
      const { error } = await supabase
        .from('actions')
        .update({
          vehicle_id: editVehicleId,
          workshop_category_id: editCategoryId,
          workshop_subcategory_id: editSubcategoryId || null,
          workshop_comments: editComments,
          title: `Workshop Task - ${vehicles.find(v => v.id === editVehicleId)?.reg_number}`,
          description: editComments.substring(0, 200),
        })
        .eq('id', editingTask.id);

      if (error) throw error;

      // Update vehicle mileage
      const { error: mileageError } = await supabase
        .from('vehicle_maintenance')
        .upsert({
          vehicle_id: editVehicleId,
          current_mileage: mileageValue,
          last_mileage_update: new Date().toISOString(),
          last_updated_at: new Date().toISOString(),
          last_updated_by: user.id,
        }, {
          onConflict: 'vehicle_id',
        });

      if (mileageError) {
        console.error('Error updating mileage:', mileageError);
        toast.error('Task updated but failed to update mileage');
      } else {
        toast.success('Workshop task updated successfully');
      }

      setShowEditModal(false);
      setEditingTask(null);
      setEditVehicleId('');
      setEditCategoryId('');
      setEditSubcategoryId('');
      setEditComments('');
      setEditMileage('');
      setEditCurrentMileage(null);
      fetchTasks();
    } catch (err) {
      console.error('Error updating task:', err instanceof Error ? err.message : err);
      toast.error('Failed to update task');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      logged: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      on_hold: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      completed: 'bg-green-500/20 text-green-400 border-green-500/30',
    };

    const labels = {
      pending: 'Pending',
      logged: 'In Progress',
      on_hold: 'On Hold',
      completed: 'Completed',
    };

    return (
      <Badge variant="outline" className={styles[status as keyof typeof styles] || styles.pending}>
        {labels[status as keyof typeof labels] || status}
      </Badge>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-400" />;
      case 'logged':
        return <Clock className="h-5 w-5 text-blue-400" />;
      case 'on_hold':
        return <Pause className="h-5 w-5 text-purple-400" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-amber-400" />;
    }
  };

  const getVehicleReg = (task: Action) => {
    let reg = 'Unknown';
    let nickname = null;
    
    if (task.vehicles) {
      reg = task.vehicles.reg_number;
      nickname = task.vehicles.nickname;
    } else if (task.vehicle_inspections?.vehicles) {
      reg = task.vehicle_inspections.vehicles.reg_number;
      nickname = task.vehicle_inspections.vehicles.nickname;
    }
    
    if (nickname) {
      return `${reg} (${nickname})`;
    }
    return reg;
  };

  const getSourceLabel = (task: Action) => {
    return task.action_type === 'inspection_defect' ? 'Inspection Defect Fix' : 'Workshop Task';
  };

  // Category Management Functions
  const openAddCategoryModal = () => {
    setEditingCategory(null);
    setCategoryName('');
    setShowCategoryModal(true);
  };

  const openEditCategoryModal = (category: Category) => {
    setEditingCategory(category);
    setCategoryName(category.name);
    setShowCategoryModal(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryName.trim()) {
      toast.error('Category name is required');
      return;
    }

    try {
      setSubmittingCategory(true);

      if (editingCategory) {
        // Update existing category (name only, sort order will be recalculated on fetch)
        const { error } = await supabase
          .from('workshop_task_categories')
          .update({
            name: categoryName.trim(),
          })
          .eq('id', editingCategory.id);

        if (error) throw error;
        toast.success('Category updated successfully');
      } else {
        // Create new category - sort_order will be set to 0, actual ordering happens in fetch
        const { error } = await supabase
          .from('workshop_task_categories')
          .insert({
            name: categoryName.trim(),
            applies_to: 'vehicle',
            is_active: true,
            sort_order: 0,
            created_by: user?.id,
          });

        if (error) throw error;
        toast.success('Category created successfully');
      }

      setShowCategoryModal(false);
      fetchCategories();
    } catch (err) {
      console.error('Error saving category:', err instanceof Error ? err.message : err);
      toast.error('Failed to save category');
    } finally {
      setSubmittingCategory(false);
    }
  };


  const handleDeleteCategory = async (category: Category) => {
    if (category.name === 'Uncategorised') {
      toast.error('Cannot delete the default category');
      return;
    }

    // Check if category is in use
    const { data: tasksUsingCategory } = await supabase
      .from('actions')
      .select('id')
      .eq('workshop_category_id', category.id)
      .limit(1);

    if (tasksUsingCategory && tasksUsingCategory.length > 0) {
      toast.error('Cannot delete category that is in use by tasks');
      return;
    }

    try {
      const { error } = await supabase
        .from('workshop_task_categories')
        .delete()
        .eq('id', category.id);

      if (error) throw error;
      toast.success('Category deleted successfully');
      fetchCategories();
    } catch (err) {
      console.error('Error deleting category:', err instanceof Error ? err.message : err);
      toast.error('Failed to delete category');
    }
  };

  // Subcategory Management Handlers
  const openAddSubcategoryModal = (category: Category) => {
    setSelectedCategoryForSubcategory(category);
    setEditingSubcategory(null);
    setSubcategoryMode('create');
    setShowSubcategoryModal(true);
  };

  const openEditSubcategoryModal = (subcategory: Subcategory, category: Category) => {
    setSelectedCategoryForSubcategory(category);
    setEditingSubcategory(subcategory);
    setSubcategoryMode('edit');
    setShowSubcategoryModal(true);
  };

  const handleDeleteSubcategory = async (subcategoryId: string, subcategoryName: string) => {
    if (!confirm(`Delete subcategory "${subcategoryName}"? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/workshop-tasks/subcategories/${subcategoryId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete subcategory');
      }

      toast.success('Subcategory deleted successfully');
      await fetchSubcategories();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete subcategory';
      console.error('Error deleting subcategory:', error);
      toast.error(errorMessage);
    }
  };


  const toggleCategoryExpansion = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'logged');
  const onHoldTasks = tasks.filter(t => t.status === 'on_hold');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  // Show loading state while checking permissions
  if (permissionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-workshop mx-auto mb-4"></div>
          <p className="text-slate-400">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // If no permission, return null and let the hook handle redirect
  if (!hasPermission) {
    return null;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Workshop Tasks</h1>
            <p className="text-slate-600 dark:text-slate-400">
              Track vehicle repairs and workshop work
            </p>
          </div>
          <Button
            onClick={() => setShowAddModal(true)}
            className="bg-workshop hover:bg-workshop-dark text-white transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="vehicle" className="w-full">
        <TabsList className={`grid w-full ${showSettings ? 'grid-cols-4' : 'grid-cols-3'}`}>
          <TabsTrigger value="vehicle">Vehicle Tasks</TabsTrigger>
          <TabsTrigger value="plant" disabled>
            <span className="flex items-center gap-1">
              Plant
              <Info className="h-3 w-3" />
            </span>
          </TabsTrigger>
          <TabsTrigger value="tools" disabled>
            <span className="flex items-center gap-1">
              Tools
              <Info className="h-3 w-3" />
            </span>
          </TabsTrigger>
          {showSettings && (
            <TabsTrigger value="settings">
              <Settings className="h-4 w-4 md:mr-1" />
              <span className="hidden md:inline">Settings</span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="vehicle" className="space-y-6">
          {/* Filters */}
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status Filter</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="logged">In Progress</SelectItem>
                      <SelectItem value="on_hold">On Hold</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Vehicle Filter</Label>
                  <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
                    <SelectTrigger className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Vehicles</SelectItem>
                      {vehicles.map((vehicle) => (
                        <SelectItem key={vehicle.id} value={vehicle.id}>
                          {vehicle.reg_number}{vehicle.nickname ? ` (${vehicle.nickname})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Statistics */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-3">
                <CardDescription className="text-slate-600 dark:text-slate-400">Pending</CardDescription>
                <CardTitle className="text-3xl text-amber-600 dark:text-amber-400">{pendingTasks.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-3">
                <CardDescription className="text-slate-600 dark:text-slate-400">In Progress</CardDescription>
                <CardTitle className="text-3xl text-blue-600 dark:text-blue-400">{inProgressTasks.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-3">
                <CardDescription className="text-slate-600 dark:text-slate-400">On Hold</CardDescription>
                <CardTitle className="text-3xl text-purple-600 dark:text-purple-400">{onHoldTasks.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-3">
                <CardDescription className="text-slate-600 dark:text-slate-400">Completed</CardDescription>
                <CardTitle className="text-3xl text-green-600 dark:text-green-400">{completedTasks.length}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Tasks List */}
          {loading ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <p className="text-slate-600 dark:text-slate-400">Loading tasks...</p>
            </div>
          ) : tasks.length === 0 ? (
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Wrench className="h-16 w-16 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No workshop tasks yet</h3>
                <p className="text-slate-600 dark:text-slate-400 mb-4">
                  Create your first workshop task or wait for inspection defects
                </p>
                <Button
                  onClick={() => setShowAddModal(true)}
                  className="bg-workshop hover:bg-workshop-dark text-white"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Task
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Pending Tasks */}
              {pendingTasks.length > 0 && (
                <div className="border-2 border-amber-500/30 rounded-lg overflow-hidden bg-amber-500/5">
                  <button
                    onClick={() => setShowPending(!showPending)}
                    className="w-full flex items-center justify-between p-4 bg-amber-500/10 hover:bg-amber-500/20 transition-colors border-b-2 border-amber-500/30"
                  >
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-400" />
                      Pending Tasks ({pendingTasks.length})
                    </h2>
                    {showPending ? (
                      <ChevronUp className="h-5 w-5 text-amber-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-amber-400" />
                    )}
                  </button>
                  {showPending && (
                    <div className="space-y-3 p-4">
                    {pendingTasks.map((task) => {
                      const isUpdating = updatingStatus.has(task.id);
                      return (
                        <Card
                          key={task.id}
                          className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-workshop/50 transition-all duration-200 cursor-pointer"
                          onClick={() => handleOpenTaskModal(task)}
                        >
                          <CardContent className="pt-6">
                            <div className="flex flex-col gap-3">
                              {/* Main content row */}
                              <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                                <div className="flex-1 w-full">
                                  <div className="flex items-center gap-2 mb-2">
                                    {getStatusIcon(task.status)}
                                    <h3 className="font-semibold text-lg text-slate-900 dark:text-white">
                                      {getVehicleReg(task)}
                                    </h3>
                                    <Badge variant="outline" className="text-xs">
                                      {getSourceLabel(task)}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    {task.workshop_task_subcategories?.workshop_task_categories && (
                                      <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                        {task.workshop_task_subcategories.workshop_task_categories.name}
                                      </Badge>
                                    )}
                                    {task.workshop_task_subcategories && (
                                      <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                        {task.workshop_task_subcategories.name}
                                      </Badge>
                                    )}
                                  </div>
                                  {task.action_type === 'inspection_defect' && task.description && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{task.description}</p>
                                  )}
                                  {task.workshop_comments && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                                      <strong>Notes:</strong> {task.workshop_comments}
                                    </p>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenComments(task);
                                    }}
                                    disabled={isUpdating}
                                    size="sm"
                                    variant="outline"
                                    className="h-9 px-3 text-xs border-slate-600 text-slate-400 hover:text-white hover:bg-slate-800"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                    Comments
                                  </Button>
                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMarkInProgress(task);
                                    }}
                                    disabled={isUpdating}
                                    size="sm"
                                    className="h-9 px-3 text-xs bg-blue-600/80 hover:bg-blue-600 text-white border-0"
                                  >
                                    <Clock className="h-3.5 w-3.5 mr-1.5" />
                                    In Progress
                                  </Button>
                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMarkComplete(task);
                                    }}
                                    disabled={isUpdating}
                                    size="sm"
                                    className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    {isUpdating ? (
                                      <>
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                        Complete
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                        Complete
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </div>
                              
                              {/* Bottom row: Date on left, Edit/Delete on right */}
                              <div className="flex items-center justify-between w-full">
                                <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                                  <span>Created: {formatDate(task.created_at)}</span>
                                </div>
                                {task.action_type === 'workshop_vehicle_task' && (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      onClick={(e) => { e.stopPropagation(); handleEditTask(task); }}
                                      disabled={isUpdating}
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                                      title="Edit task"
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      onClick={(e) => { e.stopPropagation(); handleDeleteTask(task); }}
                                      disabled={isUpdating}
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-red-500 hover:text-red-400 hover:bg-red-950/50"
                                      title="Delete task"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    </div>
                  )}
                </div>
              )}

              {/* In Progress Tasks */}
              {inProgressTasks.length > 0 && (
                <div className="border-2 border-blue-500/30 rounded-lg overflow-hidden bg-blue-500/5">
                  <button
                    onClick={() => setShowInProgress(!showInProgress)}
                    className="w-full flex items-center justify-between p-4 bg-blue-500/10 hover:bg-blue-500/20 transition-colors border-b-2 border-blue-500/30"
                  >
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <Clock className="h-5 w-5 text-blue-400" />
                      In Progress Tasks ({inProgressTasks.length})
                    </h2>
                    {showInProgress ? (
                      <ChevronUp className="h-5 w-5 text-blue-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-blue-400" />
                    )}
                  </button>
                  {showInProgress && (
                    <div className="space-y-3 p-4">
                    {inProgressTasks.map((task) => {
                      const isUpdating = updatingStatus.has(task.id);
                      return (
                        <Card
                          key={task.id}
                          className="bg-white dark:bg-slate-900 border-blue-500/30 dark:border-blue-500/30 hover:shadow-lg hover:border-blue-500/50 transition-all duration-200 cursor-pointer"
                          onClick={() => handleOpenTaskModal(task)}
                        >
                          <CardContent className="pt-6">
                            <div className="flex flex-col gap-3">
                              {/* Main content row */}
                              <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                                <div className="flex-1 w-full">
                                  <div className="flex items-center gap-2 mb-2">
                                    {getStatusIcon(task.status)}
                                    <h3 className="font-semibold text-lg text-slate-900 dark:text-white">
                                      {getVehicleReg(task)}
                                    </h3>
                                    <Badge variant="outline" className="text-xs">
                                      {getSourceLabel(task)}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    {task.workshop_task_subcategories?.workshop_task_categories && (
                                      <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                        {task.workshop_task_subcategories.workshop_task_categories.name}
                                      </Badge>
                                    )}
                                    {task.workshop_task_subcategories && (
                                      <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                        {task.workshop_task_subcategories.name}
                                      </Badge>
                                    )}
                                  </div>
                                  {task.action_type === 'inspection_defect' && task.description && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{task.description}</p>
                                  )}
                                  {task.logged_comment && (
                                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-2">
                                      <p className="text-sm text-blue-300">
                                        <strong>Progress Note:</strong> {task.logged_comment}
                                      </p>
                                    </div>
                                  )}
                                  {task.workshop_comments && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                                      <strong>Notes:</strong> {task.workshop_comments}
                                    </p>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
                                  <Button
                                    onClick={(e) => { e.stopPropagation(); handleOpenComments(task); }}
                                    disabled={isUpdating}
                                    size="sm"
                                    variant="outline"
                                    className="h-9 px-3 text-xs border-slate-600 text-slate-400 hover:text-white hover:bg-slate-800"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                    Comments
                                  </Button>
                                  <Button
                                    onClick={(e) => { e.stopPropagation(); handleUndoLogged(task.id); }}
                                    variant="outline"
                                    disabled={isUpdating}
                                    size="sm"
                                    className="h-9 px-3 text-xs border-slate-600 text-slate-400 hover:text-white hover:bg-slate-800"
                                  >
                                    <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                                    Undo
                                  </Button>
                                  {task.status === 'logged' && (
                                    <Button
                                      onClick={(e) => { e.stopPropagation(); handleMarkOnHold(task); }}
                                      disabled={isUpdating}
                                      size="sm"
                                      className="h-9 px-3 text-xs bg-purple-600/80 hover:bg-purple-600 text-white border-0"
                                    >
                                      <Pause className="h-3.5 w-3.5 mr-1.5" />
                                      On Hold
                                    </Button>
                                  )}
                                  {task.status === 'on_hold' && (
                                    <Button
                                      onClick={(e) => { e.stopPropagation(); handleResumeTask(task); }}
                                      disabled={isUpdating}
                                      size="sm"
                                      className="h-9 px-3 text-xs bg-blue-600/80 hover:bg-blue-600 text-white border-0"
                                    >
                                      <Clock className="h-3.5 w-3.5 mr-1.5" />
                                      Resume
                                    </Button>
                                  )}
                                  <Button
                                    onClick={(e) => { e.stopPropagation(); handleMarkComplete(task); }}
                                    disabled={isUpdating}
                                    size="sm"
                                    className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    {isUpdating ? (
                                      <>
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                        Complete
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                        Complete
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </div>
                              
                              {/* Bottom row: Dates on left, Edit on right */}
                              <div className="flex items-center justify-between w-full">
                                <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                                  <span>Created: {formatDate(task.created_at)}</span>
                                  {task.logged_at && (
                                    <span className="text-blue-400">
                                      Started: {formatDate(task.logged_at)}
                                    </span>
                                  )}
                                </div>
                                {task.action_type === 'workshop_vehicle_task' && (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      onClick={(e) => { e.stopPropagation(); handleEditTask(task); }}
                                      disabled={isUpdating}
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                                      title="Edit task"
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    </div>
                  )}
                </div>
              )}

              {/* On Hold Tasks */}
              {onHoldTasks.length > 0 && (
                <div className="border-2 border-purple-500/30 rounded-lg overflow-hidden bg-purple-500/5">
                  <button
                    onClick={() => setShowOnHold(!showOnHold)}
                    className="w-full flex items-center justify-between p-4 bg-purple-500/10 hover:bg-purple-500/20 transition-colors border-b-2 border-purple-500/30"
                  >
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <Pause className="h-5 w-5 text-purple-400" />
                      On Hold Tasks ({onHoldTasks.length})
                    </h2>
                    {showOnHold ? (
                      <ChevronUp className="h-5 w-5 text-purple-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-purple-400" />
                    )}
                  </button>
                  {showOnHold && (
                    <div className="space-y-3 p-4">
                    {onHoldTasks.map((task) => {
                      const isUpdating = updatingStatus.has(task.id);
                      return (
                        <Card
                          key={task.id}
                          className="bg-white dark:bg-slate-900 border-purple-500/30 dark:border-purple-500/30 hover:shadow-lg hover:border-purple-500/50 transition-all duration-200 cursor-pointer"
                          onClick={() => handleOpenTaskModal(task)}
                        >
                          <CardContent className="pt-6">
                            <div className="flex flex-col gap-3">
                              {/* Main content row */}
                              <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                                <div className="flex-1 w-full">
                                  <div className="flex items-center gap-2 mb-2">
                                    {getStatusIcon(task.status)}
                                    <h3 className="font-semibold text-lg text-slate-900 dark:text-white">
                                      {getVehicleReg(task)}
                                    </h3>
                                    <Badge variant="outline" className="text-xs">
                                      {getSourceLabel(task)}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    {task.workshop_task_subcategories?.workshop_task_categories && (
                                      <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                        {task.workshop_task_subcategories.workshop_task_categories.name}
                                      </Badge>
                                    )}
                                    {task.workshop_task_subcategories && (
                                      <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                        {task.workshop_task_subcategories.name}
                                      </Badge>
                                    )}
                                  </div>
                                  {task.action_type === 'inspection_defect' && task.description && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{task.description}</p>
                                  )}
                                  {task.logged_comment && (
                                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-2">
                                      <p className="text-sm text-purple-200 font-medium">Progress Note: {task.logged_comment}</p>
                                    </div>
                                  )}
                                  {task.action_type === 'workshop_vehicle_task' && task.workshop_comments && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400">{task.workshop_comments}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCommentsTask(task);
                                      setShowCommentsDrawer(true);
                                    }}
                                    disabled={isUpdating}
                                    size="sm"
                                    variant="outline"
                                    className="h-9 px-3 text-xs border-slate-600 text-slate-400 hover:text-white hover:bg-slate-800"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                    Comments
                                  </Button>
                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleResumeTask(task);
                                    }}
                                    disabled={isUpdating}
                                    size="sm"
                                    className="h-9 px-3 text-xs transition-all border-0 bg-blue-600 hover:bg-blue-700 text-white"
                                  >
                                    <Clock className="h-3.5 w-3.5 mr-1.5" />
                                    Resume
                                  </Button>
                                  <Button
                                    onClick={(e) => { e.stopPropagation(); handleMarkComplete(task); }}
                                    disabled={isUpdating}
                                    size="sm"
                                    className="h-9 px-3 text-xs transition-all border-0 bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                    Complete
                                  </Button>
                                </div>
                              </div>
                              
                              {/* Bottom row: Dates on left, Edit/Delete on right */}
                              <div className="flex items-center justify-between w-full">
                                <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                                  <span>Created: {formatDate(task.created_at)}</span>
                                  {task.logged_at && (
                                    <span>Placed On Hold: {formatDate(task.logged_at)}</span>
                                  )}
                                </div>
                                {task.action_type === 'workshop_vehicle_task' && (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      onClick={(e) => { e.stopPropagation(); handleEditTask(task); }}
                                      disabled={isUpdating}
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                                      title="Edit task"
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      onClick={(e) => { e.stopPropagation(); handleDeleteTask(task); }}
                                      disabled={isUpdating}
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-red-500 hover:text-red-400 hover:bg-red-950/50"
                                      title="Delete task"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    </div>
                  )}
                </div>
              )}

              {/* Completed Tasks */}
              {completedTasks.length > 0 && (
                <div className="border-2 border-green-500/30 rounded-lg overflow-hidden bg-green-500/5">
                  <button
                    onClick={() => setShowCompleted(!showCompleted)}
                    className="w-full flex items-center justify-between p-4 bg-green-500/10 hover:bg-green-500/20 transition-colors border-b-2 border-green-500/30"
                  >
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-400" />
                      Completed Tasks ({completedTasks.length})
                    </h2>
                    {showCompleted ? (
                      <ChevronUp className="h-5 w-5 text-green-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-green-400" />
                    )}
                  </button>
                  {showCompleted && (
                    <div className="space-y-3 p-4">
                    {completedTasks.map((task) => (
                      <Card
                        key={task.id}
                        className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-70 hover:opacity-90 transition-opacity cursor-pointer"
                        onClick={() => handleOpenTaskModal(task)}
                      >
                        <CardContent className="pt-6">
                          <div className="flex flex-col items-start gap-4">
                            <div className="flex-1 space-y-2 w-full">
                              <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                                <div className="flex-1 w-full">
                                  <div className="flex items-center gap-2 mb-2">
                                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                                    <h3 className="font-semibold text-lg text-white">
                                      {getVehicleReg(task)}
                                    </h3>
                                    <Badge variant="outline" className="text-xs">
                                      {getSourceLabel(task)}
                                    </Badge>
                                  </div>
                                  {task.workshop_task_categories && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                      <strong>Category:</strong> {task.workshop_task_categories.name}
                                    </p>
                                  )}
                                  {task.action_type === 'inspection_defect' && task.description && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{task.description}</p>
                                  )}
                                  <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                                    {task.actioned_at && (
                                      <span className="text-green-400">
                                        Completed: {formatDate(task.actioned_at)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
                                  <Button
                                    onClick={(e) => { e.stopPropagation(); handleOpenComments(task); }}
                                    size="sm"
                                    variant="outline"
                                    className="h-9 px-3 text-xs border-slate-600 text-slate-400 hover:text-white hover:bg-slate-800"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                    Comments
                                  </Button>
                                  <Button
                                    onClick={(e) => { e.stopPropagation(); handleUndoComplete(task.id); }}
                                    size="sm"
                                    variant="outline"
                                    className="h-9 px-3 text-xs border-slate-600 text-slate-400 hover:text-white hover:bg-slate-800"
                                  >
                                    <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                                    Undo
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="plant">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Info className="h-16 w-16 text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Coming Soon</h3>
              <p className="text-slate-600 dark:text-slate-400">
                Plant machinery tasks will be available in a future update
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Info className="h-16 w-16 text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Coming Soon</h3>
              <p className="text-slate-600 dark:text-slate-400">
                Tool repair tasks will be available in a future update
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {showSettings && (
          <TabsContent value="settings">
            <CategoryManagementPanel
              categories={categories}
              subcategories={subcategories}
              onAddCategory={openAddCategoryModal}
              onEditCategory={openEditCategoryModal}
              onDeleteCategory={handleDeleteCategory}
              onAddSubcategory={openAddSubcategoryModal}
              onEditSubcategory={openEditSubcategoryModal}
              onDeleteSubcategory={handleDeleteSubcategory}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Add Task Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
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
              onClick={() => {
                setShowAddModal(false);
                resetAddForm();
              }}
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

      {/* Mark In Progress Modal */}
      <Dialog open={showStatusModal} onOpenChange={setShowStatusModal}>
        <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white text-xl">Mark Task In Progress</DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              Add a short note about starting this work
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-sm text-blue-300">
                This task will be marked as "In Progress" and visible in the workshop queue.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logged-comment" className="text-slate-900 dark:text-white">
                Progress Note <span className="text-slate-400">(max 300 chars)</span> <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="logged-comment"
                value={loggedComment}
                onChange={(e) => {
                  if (e.target.value.length <= 300) {
                    setLoggedComment(e.target.value);
                  }
                }}
                placeholder="e.g., Started work on brakes"
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white"
                maxLength={300}
                rows={3}
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {loggedComment.length}/300 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowStatusModal(false);
                setSelectedTask(null);
                setLoggedComment('');
              }}
              className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
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

      {/* Put Task On Hold Modal */}
      <Dialog open={showOnHoldModal} onOpenChange={setShowOnHoldModal}>
        <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white text-xl">Put Task On Hold</DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              Add a note about why this task is being paused
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <p className="text-sm text-purple-300">
                This task will be marked as "On Hold" and can be resumed later. On hold tasks will still appear in driver inspections.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="onhold-comment" className="text-slate-900 dark:text-white">
                On Hold Reason <span className="text-slate-400">(max 300 chars)</span> <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="onhold-comment"
                value={onHoldComment}
                onChange={(e) => {
                  if (e.target.value.length <= 300) {
                    setOnHoldComment(e.target.value);
                  }
                }}
                placeholder="e.g., Awaiting parts delivery, Waiting for customer approval"
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white min-h-[80px]"
                maxLength={300}
                rows={3}
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {onHoldComment.length}/300 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowOnHoldModal(false);
                setOnHoldingTask(null);
                setOnHoldComment('');
              }}
              disabled={onHoldingTask ? updatingStatus.has(onHoldingTask.id) : false}
              className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMarkOnHold}
              disabled={
                !onHoldComment.trim() || 
                onHoldComment.length > 300 || 
                (onHoldingTask ? updatingStatus.has(onHoldingTask.id) : false)
              }
              className="bg-purple-500 hover:bg-purple-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Pause className="h-4 w-4 mr-2" />
              Put On Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resume Task Modal */}
      <Dialog open={showResumeModal} onOpenChange={setShowResumeModal}>
        <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white text-xl">Resume Task</DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              Add a note about resuming work on this task
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-sm text-blue-300">
                This task will be moved back to "In Progress" and work can continue.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resume-comment" className="text-slate-900 dark:text-white">
                Resume Note <span className="text-slate-400">(max 300 chars)</span> <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="resume-comment"
                value={resumeComment}
                onChange={(e) => {
                  if (e.target.value.length <= 300) {
                    setResumeComment(e.target.value);
                  }
                }}
                placeholder="e.g., Parts arrived, ready to continue work"
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white min-h-[80px]"
                maxLength={300}
                rows={3}
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {resumeComment.length}/300 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowResumeModal(false);
                setResumingTask(null);
                setResumeComment('');
              }}
              disabled={resumingTask ? updatingStatus.has(resumingTask.id) : false}
              className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmResumeTask}
              disabled={
                !resumeComment.trim() || 
                resumeComment.length > 300 || 
                (resumingTask ? updatingStatus.has(resumingTask.id) : false)
              }
              className="bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Clock className="h-4 w-4 mr-2" />
              Resume Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Task Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white text-xl">Edit Workshop Task</DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              Update the workshop task details
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-vehicle" className="text-slate-900 dark:text-white">
                Vehicle <span className="text-red-500">*</span>
              </Label>
              <Select value={editVehicleId} onValueChange={(value) => {
                setEditVehicleId(value);
                if (value) {
                  // Fetch current mileage for the new vehicle
                  supabase
                    .from('vehicle_maintenance')
                    .select('current_mileage')
                    .eq('vehicle_id', value)
                    .single()
                    .then(({ data, error }) => {
                      if (error && error.code !== 'PGRST116') {
                        console.error('Error fetching mileage:', error);
                      }
                      setEditCurrentMileage(data?.current_mileage || null);
                    });
                } else {
                  setEditCurrentMileage(null);
                }
              }}>
                <SelectTrigger id="edit-vehicle" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white">
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
              <Label htmlFor="edit-category" className="text-slate-900 dark:text-white">
                Category <span className="text-red-500">*</span>
              </Label>
              <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                <SelectTrigger id="edit-category" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white">
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
              <Label htmlFor="edit-mileage" className="text-slate-900 dark:text-white">
                Current Mileage <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-mileage"
                type="number"
                value={editMileage}
                onChange={(e) => setEditMileage(e.target.value)}
                placeholder="Enter current mileage"
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white"
                min="0"
                step="1"
              />
              {editCurrentMileage !== null && (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Last recorded: {editCurrentMileage.toLocaleString()} miles
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-comments" className="text-slate-900 dark:text-white">
                Task Details <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="edit-comments"
                value={editComments}
                onChange={(e) => setEditComments(e.target.value)}
                placeholder="Describe the work needed (minimum 10 characters)"
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white min-h-[100px]"
                maxLength={300}
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {editComments.length}/300 characters (minimum 10)
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEditModal(false);
                setEditingTask(null);
                setEditVehicleId('');
                setEditCategoryId('');
                setEditComments('');
                setEditMileage('');
                setEditCurrentMileage(null);
              }}
              className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={submitting || !editVehicleId || !editCategoryId || editComments.length < 10 || !editMileage.trim()}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Management Modal */}
      {showSettings && (
        <Dialog open={showCategoryModal} onOpenChange={setShowCategoryModal}>
          <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-slate-900 dark:text-white text-xl">
                {editingCategory ? 'Edit Category' : 'Add Category'}
              </DialogTitle>
              <DialogDescription className="text-slate-600 dark:text-slate-400">
                {editingCategory ? 'Update the category details' : 'Create a new workshop task category'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="category-name" className="text-slate-900 dark:text-white">
                  Category Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="category-name"
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  placeholder="e.g., Brakes, Engine, Electrical"
                  className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white"
                  maxLength={50}
                />
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Categories are automatically organized alphabetically
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCategoryModal(false);
                  setEditingCategory(null);
                  setCategoryName('');
                }}
                className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveCategory}
                disabled={submittingCategory || !categoryName.trim()}
                className="bg-workshop hover:bg-workshop-dark text-white"
              >
                {submittingCategory ? 'Saving...' : (editingCategory ? 'Update' : 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Task Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white text-xl">Delete Workshop Task</DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              Are you sure you want to delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          {taskToDelete && (
            <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg space-y-2">
              <p className="font-semibold text-slate-900 dark:text-white">
                {getVehicleReg(taskToDelete)}
              </p>
              {taskToDelete.workshop_comments && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {taskToDelete.workshop_comments}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteConfirm(false);
                setTaskToDelete(null);
              }}
              disabled={deleting}
              className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDeleteTask}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comments Drawer */}
      {commentsTask && (
        <TaskCommentsDrawer
          open={showCommentsDrawer}
          onOpenChange={setShowCommentsDrawer}
          taskId={commentsTask.id}
          taskTitle={getVehicleReg(commentsTask)}
        />
      )}

      {/* Workshop Task Modal */}
      <WorkshopTaskModal
        open={showTaskModal}
        onOpenChange={setShowTaskModal}
        task={modalTask}
        onEdit={(task) => {
          setShowTaskModal(false);
          handleEditTask(task);
        }}
        onDelete={(task) => {
          setShowTaskModal(false);
          handleDeleteTask(task);
        }}
        onMarkInProgress={(task) => {
          setShowTaskModal(false);
          handleMarkInProgress(task);
        }}
        onMarkComplete={(task) => {
          setShowTaskModal(false);
          handleMarkComplete(task);
        }}
        onMarkOnHold={(task) => {
          setShowTaskModal(false);
          handleMarkOnHold(task);
        }}
        onResume={(task) => {
          setShowTaskModal(false);
          handleResumeTask(task);
        }}
        isUpdating={modalTask ? updatingStatus.has(modalTask.id) : false}
      />

      {/* Subcategory Management Dialog */}
      {selectedCategoryForSubcategory && (
        <SubcategoryDialog
          open={showSubcategoryModal}
          onOpenChange={setShowSubcategoryModal}
          mode={subcategoryMode}
          categoryId={selectedCategoryForSubcategory.id}
          categoryName={selectedCategoryForSubcategory.name}
          subcategory={editingSubcategory}
          onSuccess={fetchSubcategories}
        />
      )}
    </div>
  );
}

