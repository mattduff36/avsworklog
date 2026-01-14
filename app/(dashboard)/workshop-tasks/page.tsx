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
import { Settings, Plus, CheckCircle2, Clock, AlertTriangle, FileText, Wrench, Undo2, Info, Edit, Trash2, Eye, EyeOff, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { toast } from 'sonner';
import { Database } from '@/types/database';
import { TaskCommentsDrawer } from '@/components/workshop-tasks/TaskCommentsDrawer';

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
    name: string;
  };
};

type Vehicle = {
  id: string;
  reg_number: string;
  nickname: string | null;
};

type Category = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export default function WorkshopTasksPage() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('workshop-tasks');
  
  const { user, isManager, isAdmin } = useAuth();
  const showSettings = isAdmin || isManager;
  const supabase = createClient();
  
  const [tasks, setTasks] = useState<Action[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [vehicleFilter, setVehicleFilter] = useState<string>('all');
  
  // Add Task Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
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
  const [completedComment, setCompletedComment] = useState('');
  
  // Edit Task Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Action | null>(null);
  const [editVehicleId, setEditVehicleId] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editComments, setEditComments] = useState('');
  const [editMileage, setEditMileage] = useState('');
  const [editCurrentMileage, setEditCurrentMileage] = useState<number | null>(null);
  
  // Category Management
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categorySortOrder, setCategorySortOrder] = useState('0');
  const [submittingCategory, setSubmittingCategory] = useState(false);
  
  // Expandable sections state (Pending and In Progress open by default, Completed closed)
  const [showPending, setShowPending] = useState(true);
  const [showInProgress, setShowInProgress] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  
  // Comments drawer
  const [showCommentsDrawer, setShowCommentsDrawer] = useState(false);
  const [commentsTask, setCommentsTask] = useState<Action | null>(null);
  
  const handleOpenComments = (task: Action) => {
    setCommentsTask(task);
    setShowCommentsDrawer(true);
  };

  useEffect(() => {
    if (user) {
      fetchTasks();
      fetchVehicles();
      fetchCategories();
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
            name
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
      setTasks(data || []);
    } catch (err) {
      console.error('Error fetching tasks:', err);
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
      console.error('Error fetching vehicles:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('workshop_task_categories')
        .select('*')
        .eq('applies_to', 'vehicle')
        .order('sort_order');

      if (error) throw error;
      setCategories(data || []);
    } catch (err) {
      console.error('Error fetching categories:', err);
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

  const handleAddTask = async () => {
    if (!selectedVehicleId || !selectedCategoryId || !workshopComments.trim() || !newMileage.trim()) {
      toast.error('Please fill in all fields');
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
          workshop_category_id: selectedCategoryId,
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
      console.error('Error creating task:', err);
      toast.error('Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const resetAddForm = () => {
    setSelectedVehicleId('');
    setSelectedCategoryId('');
    setWorkshopComments('');
    setNewMileage('');
    setCurrentMileage(null);
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

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_comment: loggedComment.trim(),
          logged_at: new Date().toISOString(),
          logged_by: user?.id,
        })
        .eq('id', selectedTask.id);

      if (error) throw error;

      toast.success('Task marked as in progress');
      setShowStatusModal(false);
      setSelectedTask(null);
      setLoggedComment('');

      setTimeout(() => {
        setUpdatingStatus(prev => {
          const newSet = new Set(prev);
          newSet.delete(selectedTask.id);
          return newSet;
        });
        fetchTasks();
      }, 500);
    } catch (err) {
      console.error('Error updating status:', err);
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
    setCompletedComment('');
    setShowCompleteModal(true);
  };

  const confirmMarkComplete = async () => {
    if (!completingTask) return;

    // Capture task ID at the beginning for safe access throughout the function
    const taskId = completingTask.id;

    if (!completedComment.trim()) {
      toast.error('Completion note is required');
      return;
    }

    if (completedComment.length > 500) {
      toast.error('Completion note must be 500 characters or less');
      return;
    }

    try {
      setUpdatingStatus(prev => new Set(prev).add(taskId));

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'completed',
          actioned: true,
          actioned_at: new Date().toISOString(),
          actioned_by: user?.id,
          actioned_comment: completedComment.trim(),
        })
        .eq('id', taskId);

      if (error) throw error;

      toast.success('Task marked as complete');
      setShowCompleteModal(false);
      setCompletingTask(null);
      setCompletedComment('');

      setTimeout(() => {
        setUpdatingStatus(prev => {
          const newSet = new Set(prev);
          newSet.delete(taskId);
          return newSet;
        });
        fetchTasks();
      }, 500);
    } catch (err) {
      console.error('Error marking complete:', err);
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

      const { error } = await supabase
        .from('actions')
        .update({
          status: returnStatus,
          actioned: false,
          actioned_at: null,
          actioned_by: null,
        })
        .eq('id', taskId);

      if (error) throw error;

      toast.success(`Task returned to ${returnStatus === 'logged' ? 'in progress' : 'pending'}`);

      setTimeout(() => {
        setUpdatingStatus(prev => {
          const newSet = new Set(prev);
          newSet.delete(taskId);
          return newSet;
        });
        fetchTasks();
      }, 500);
    } catch (err) {
      console.error('Error undoing complete:', err);
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

      const { error } = await supabase
        .from('actions')
        .update({
          status: 'pending',
          logged_comment: null,
          logged_at: null,
          logged_by: null,
        })
        .eq('id', taskId);

      if (error) throw error;

      toast.success('Task returned to pending');

      setTimeout(() => {
        setUpdatingStatus(prev => {
          const newSet = new Set(prev);
          newSet.delete(taskId);
          return newSet;
        });
        fetchTasks();
      }, 500);
    } catch (err) {
      console.error('Error undoing logged:', err);
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
        console.error('Error fetching mileage:', err);
        setEditCurrentMileage(null);
      }
    }
    
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
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
          last_updated_by: user!.id,
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
      setEditComments('');
      setEditMileage('');
      setEditCurrentMileage(null);
      fetchTasks();
    } catch (err) {
      console.error('Error updating task:', err);
      toast.error('Failed to update task');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      logged: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      completed: 'bg-green-500/20 text-green-400 border-green-500/30',
    };

    const labels = {
      pending: 'Pending',
      logged: 'In Progress',
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
    setCategorySortOrder('0');
    setShowCategoryModal(true);
  };

  const openEditCategoryModal = (category: Category) => {
    setEditingCategory(category);
    setCategoryName(category.name);
    setCategorySortOrder(category.sort_order.toString());
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
        // Update existing category
        const { error } = await supabase
          .from('workshop_task_categories')
          .update({
            name: categoryName.trim(),
            sort_order: parseInt(categorySortOrder) || 0,
          })
          .eq('id', editingCategory.id);

        if (error) throw error;
        toast.success('Category updated successfully');
      } else {
        // Create new category
        const { error } = await supabase
          .from('workshop_task_categories')
          .insert({
            name: categoryName.trim(),
            applies_to: 'vehicle',
            is_active: true,
            sort_order: parseInt(categorySortOrder) || 0,
            created_by: user?.id,
          });

        if (error) throw error;
        toast.success('Category created successfully');
      }

      setShowCategoryModal(false);
      fetchCategories();
    } catch (err) {
      console.error('Error saving category:', err);
      toast.error('Failed to save category');
    } finally {
      setSubmittingCategory(false);
    }
  };

  const handleToggleCategoryActive = async (category: Category) => {
    try {
      const { error } = await supabase
        .from('workshop_task_categories')
        .update({ is_active: !category.is_active })
        .eq('id', category.id);

      if (error) throw error;
      toast.success(`Category ${!category.is_active ? 'enabled' : 'disabled'}`);
      fetchCategories();
    } catch (err) {
      console.error('Error toggling category:', err);
      toast.error('Failed to update category');
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
      console.error('Error deleting category:', err);
      toast.error('Failed to delete category');
    }
  };

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'logged');
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
          <div className="grid grid-cols-3 gap-4">
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
                        <Card key={task.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-workshop/50 transition-all duration-200">
                          <CardContent className="pt-6">
                            <div className="flex flex-col items-start gap-4">
                              <div className="flex-1 space-y-2 w-full">
                                <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                                  <div className="flex-1 w-full">
                                    <div className="flex items-center gap-2 mb-2">
                                      {getStatusIcon(task.status)}
                                      <h3 className="font-semibold text-lg text-slate-900 dark:text-white">
                                        {getVehicleReg(task)}
                                      </h3>
                                      {getStatusBadge(task.status)}
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
                                    {task.workshop_comments && (
                                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                                        <strong>Notes:</strong> {task.workshop_comments}
                                      </p>
                                    )}
                                    <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                                      <span>Created: {formatDate(task.created_at)}</span>
                                    </div>
                                  </div>
                                  <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto">
                                    <Button
                                      onClick={() => handleOpenComments(task)}
                                      disabled={isUpdating}
                                      variant="outline"
                                      className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold border-slate-400 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      <MessageSquare className="h-4 w-4 md:mr-2" />
                                      <span className="md:inline">Comments</span>
                                    </Button>
                                    {task.action_type === 'workshop_vehicle_task' && (
                                      <Button
                                        onClick={() => handleEditTask(task)}
                                        disabled={isUpdating}
                                        variant="outline"
                                        className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold border-slate-600 text-white hover:bg-slate-800"
                                      >
                                        <Edit className="h-4 w-4 md:mr-2" />
                                        <span className="md:inline">Edit</span>
                                      </Button>
                                    )}
                                    <Button
                                      onClick={() => handleMarkInProgress(task)}
                                      disabled={isUpdating}
                                      className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30"
                                    >
                                      <Clock className="h-4 w-4 md:mr-2" />
                                      <span className="md:inline">Mark In Progress</span>
                                    </Button>
                                    <Button
                                      onClick={() => handleMarkComplete(task)}
                                      disabled={isUpdating}
                                      className={`h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold transition-all ${
                                        isUpdating
                                          ? 'bg-green-500 hover:bg-green-500 text-white'
                                          : 'bg-workshop hover:bg-workshop-dark text-white'
                                      }`}
                                    >
                                      {isUpdating ? (
                                        <>
                                          <CheckCircle2 className="h-4 md:h-5 w-4 md:w-5 md:mr-2" />
                                          <span className="md:inline">Complete</span>
                                        </>
                                      ) : (
                                        'Complete'
                                      )}
                                    </Button>
                                  </div>
                                </div>
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
                        <Card key={task.id} className="bg-white dark:bg-slate-900 border-blue-500/30 dark:border-blue-500/30 hover:shadow-lg hover:border-blue-500/50 transition-all duration-200">
                          <CardContent className="pt-6">
                            <div className="flex flex-col items-start gap-4">
                              <div className="flex-1 space-y-2 w-full">
                                <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                                  <div className="flex-1 w-full">
                                    <div className="flex items-center gap-2 mb-2">
                                      {getStatusIcon(task.status)}
                                      <h3 className="font-semibold text-lg text-slate-900 dark:text-white">
                                        {getVehicleReg(task)}
                                      </h3>
                                      {getStatusBadge(task.status)}
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
                                    <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                                      <span>Created: {formatDate(task.created_at)}</span>
                                      {task.logged_at && (
                                        <span className="text-blue-400">
                                          Started: {formatDate(task.logged_at)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto">
                                    <Button
                                      onClick={() => handleOpenComments(task)}
                                      disabled={isUpdating}
                                      variant="outline"
                                      className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold border-slate-400 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      <MessageSquare className="h-4 w-4 md:mr-2" />
                                      <span className="md:inline">Comments</span>
                                    </Button>
                                    {task.action_type === 'workshop_vehicle_task' && (
                                      <Button
                                        onClick={() => handleEditTask(task)}
                                        disabled={isUpdating}
                                        variant="outline"
                                        className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold border-slate-600 text-white hover:bg-slate-800"
                                      >
                                        <Edit className="h-4 w-4 md:mr-2" />
                                        <span className="md:inline">Edit</span>
                                      </Button>
                                    )}
                                    <Button
                                      onClick={() => handleUndoLogged(task.id)}
                                      variant="outline"
                                      disabled={isUpdating}
                                      className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold border-slate-600 text-white hover:bg-slate-800"
                                    >
                                      <Undo2 className="h-4 w-4 md:mr-2" />
                                      <span className="md:inline">Undo</span>
                                    </Button>
                                    <Button
                                      onClick={() => handleMarkComplete(task)}
                                      disabled={isUpdating}
                                      className={`h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold transition-all ${
                                        isUpdating
                                          ? 'bg-green-500 hover:bg-green-500 text-white'
                                          : 'bg-workshop hover:bg-workshop-dark text-white'
                                      }`}
                                    >
                                      {isUpdating ? (
                                        <>
                                          <CheckCircle2 className="h-4 md:h-5 w-4 md:w-5 md:mr-2" />
                                          <span className="md:inline">Complete</span>
                                        </>
                                      ) : (
                                        'Complete'
                                      )}
                                    </Button>
                                  </div>
                                </div>
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
                      <Card key={task.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-70 hover:opacity-90 transition-opacity">
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
                                    {getStatusBadge(task.status)}
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
                                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto">
                                  <Button
                                    onClick={() => handleOpenComments(task)}
                                    variant="outline"
                                    className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold border-slate-400 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                  >
                                    <MessageSquare className="h-4 w-4 md:mr-2" />
                                    <span className="md:inline">Comments</span>
                                  </Button>
                                  <Button
                                    onClick={() => handleUndoComplete(task.id)}
                                    variant="outline"
                                    className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold"
                                  >
                                    <Undo2 className="h-4 w-4 md:mr-2" />
                                    <span className="md:inline">Undo</span>
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
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-slate-900 dark:text-white">Category Management</CardTitle>
                    <CardDescription className="text-slate-600 dark:text-slate-400">
                      Manage workshop task categories for vehicle repairs
                    </CardDescription>
                  </div>
                  <Button
                    onClick={openAddCategoryModal}
                    className="bg-workshop hover:bg-workshop-dark text-white"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Category
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {categories.length === 0 ? (
                    <p className="text-slate-600 dark:text-slate-400 text-center py-8">
                      No categories yet. Create your first category to get started.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {categories.map((category) => (
                        <div
                          key={category.id}
                          className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-slate-600 dark:text-slate-400 w-8">
                              #{category.sort_order}
                            </span>
                            <span className="font-medium text-slate-900 dark:text-white">
                              {category.name}
                            </span>
                            {!category.is_active && (
                              <Badge variant="outline" className="bg-slate-500/20 text-slate-400 border-slate-500/30">
                                Disabled
                              </Badge>
                            )}
                            {category.name === 'Uncategorised' && (
                              <Badge variant="outline" className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                                Default
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditCategoryModal(category)}
                              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleCategoryActive(category)}
                              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                            >
                              {category.is_active ? (
                                <Eye className="h-4 w-4" />
                              ) : (
                                <EyeOff className="h-4 w-4" />
                              )}
                            </Button>
                            {category.name !== 'Uncategorised' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteCategory(category)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
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
              <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
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
              disabled={submitting || !selectedVehicleId || !selectedCategoryId || workshopComments.length < 10 || !newMileage.trim()}
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
      <Dialog open={showCompleteModal} onOpenChange={setShowCompleteModal}>
        <DialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white text-xl">Mark Task Complete</DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              Add detailed notes about the work completed
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <p className="text-sm text-green-300">
                This task will be marked as "Completed" and moved to the completed tasks section.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="completed-comment" className="text-slate-900 dark:text-white">
                Completion Note <span className="text-slate-400">(max 500 chars)</span> <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="completed-comment"
                value={completedComment}
                onChange={(e) => {
                  if (e.target.value.length <= 500) {
                    setCompletedComment(e.target.value);
                  }
                }}
                placeholder="e.g., Replaced brake pads and discs on front axle. Tested and working correctly."
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white min-h-[100px]"
                maxLength={500}
                rows={4}
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {completedComment.length}/500 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCompleteModal(false);
                setCompletingTask(null);
                setCompletedComment('');
              }}
              disabled={completingTask ? updatingStatus.has(completingTask.id) : false}
              className="border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMarkComplete}
              disabled={
                !completedComment.trim() || 
                completedComment.length > 500 || 
                (completingTask ? updatingStatus.has(completingTask.id) : false)
              }
              className="bg-green-500 hover:bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark Complete
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="category-sort" className="text-slate-900 dark:text-white">
                  Sort Order
                </Label>
                <Input
                  id="category-sort"
                  type="number"
                  value={categorySortOrder}
                  onChange={(e) => setCategorySortOrder(e.target.value)}
                  placeholder="0"
                  className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white"
                  min="0"
                />
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Lower numbers appear first in the list
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
                  setCategorySortOrder('0');
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

      {/* Comments Drawer */}
      {commentsTask && (
        <TaskCommentsDrawer
          open={showCommentsDrawer}
          onOpenChange={setShowCommentsDrawer}
          taskId={commentsTask.id}
          taskTitle={getVehicleReg(commentsTask)}
        />
      )}
    </div>
  );
}

