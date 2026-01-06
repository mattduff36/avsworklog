'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle2, Clock, Trash2, FileText, Undo2, Wrench, ArrowRight, Info, Settings, Ban } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Database } from '@/types/database';
import { toast } from 'sonner';

type Action = Database['public']['Tables']['actions']['Row'] & {
  vehicle_inspections?: {
    inspection_date: string;
    vehicles?: {
      reg_number: string;
    };
    profiles?: {
      full_name: string;
    };
  };
  inspection_items?: {
    item_description: string;
    status: string;
  };
};

export default function ActionsPage() {
  const router = useRouter();
  const { user, isManager, loading: authLoading } = useAuth();
  const supabase = createClient();
  
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completingActions, setCompletingActions] = useState<Set<string>>(new Set());
  const [maintenanceOverdue, setMaintenanceOverdue] = useState(0);
  const [maintenanceDueSoon, setMaintenanceDueSoon] = useState(0);
  
  // Logged modal states
  const [showLoggedDialog, setShowLoggedDialog] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [loggedComment, setLoggedComment] = useState('');

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('actions')
        .select(`
          *,
          vehicle_inspections (
            inspection_date,
            vehicles (
              reg_number
            ),
            profiles!vehicle_inspections_user_id_fkey (
              full_name
            )
          ),
          inspection_items (
            item_description,
            status
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setActions(data || []);
    } catch (err) {
      console.error('Error fetching actions:', err);
      setError('Failed to load actions');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!authLoading) {
      if (!isManager) {
        router.push('/dashboard');
        return;
      }
      fetchActions();
      fetchMaintenanceCounts();
    }
  }, [authLoading, isManager, router, fetchActions]);

  const fetchMaintenanceCounts = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Count overdue tasks
      const { count: overdueCount, error: overdueError } = await supabase
        .from('vehicle_maintenance')
        .select('*', { count: 'exact', head: true })
        .lt('next_service_date', today)
        .eq('status', 'active');

      if (overdueError) throw overdueError;

      // Count due soon tasks (within 30 days)
      const { count: dueSoonCount, error: dueSoonError } = await supabase
        .from('vehicle_maintenance')
        .select('*', { count: 'exact', head: true })
        .gte('next_service_date', today)
        .lte('next_service_date', thirtyDaysFromNow)
        .eq('status', 'active');

      if (dueSoonError) throw dueSoonError;

      setMaintenanceOverdue(overdueCount || 0);
      setMaintenanceDueSoon(dueSoonCount || 0);
    } catch (err) {
      console.error('Error fetching maintenance counts:', err);
    }
  };

  // Mark as logged - opens modal for comment
  const handleMarkAsLogged = (actionId: string) => {
    setSelectedActionId(actionId);
    setLoggedComment('');
    setShowLoggedDialog(true);
  };

  // Confirm logged with comment
  const handleConfirmLogged = async () => {
    if (!selectedActionId) return;
    
    if (!loggedComment.trim()) {
      toast.error('Comment is required');
      return;
    }

    if (loggedComment.length > 40) {
      toast.error('Comment must be 40 characters or less');
      return;
    }

    try {
      setCompletingActions(prev => new Set(prev).add(selectedActionId));
      
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'logged',
          logged_comment: loggedComment.trim(),
          logged_at: new Date().toISOString(),
          logged_by: user?.id,
        })
        .eq('id', selectedActionId);

      if (error) throw error;
      
      toast.success('Action marked as logged');
      setShowLoggedDialog(false);
      setSelectedActionId(null);
      setLoggedComment('');
      
      setTimeout(() => {
        setCompletingActions(prev => {
          const newSet = new Set(prev);
          newSet.delete(selectedActionId);
          return newSet;
        });
        fetchActions();
      }, 500);
    } catch (err) {
      console.error('Error marking as logged:', err);
      toast.error('Failed to mark as logged');
      setCompletingActions(prev => {
        const newSet = new Set(prev);
        newSet.delete(selectedActionId);
        return newSet;
      });
    }
  };

  // Mark as complete
  const handleMarkAsComplete = async (actionId: string) => {
    try {
      setCompletingActions(prev => new Set(prev).add(actionId));
      
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'completed',
          actioned: true,
          actioned_at: new Date().toISOString(),
          actioned_by: user?.id,
        })
        .eq('id', actionId);

      if (error) throw error;
      
      toast.success('Action marked as complete');
      
      setTimeout(() => {
        setCompletingActions(prev => {
          const newSet = new Set(prev);
          newSet.delete(actionId);
          return newSet;
        });
        fetchActions();
      }, 500);
    } catch (err) {
      console.error('Error marking as complete:', err);
      toast.error('Failed to mark as complete');
      setCompletingActions(prev => {
        const newSet = new Set(prev);
        newSet.delete(actionId);
        return newSet;
      });
    }
  };

  // Undo complete - returns to previous status (logged or pending)
  const handleUndoComplete = async (actionId: string) => {
    try {
      // Find the action to check if it was previously logged
      const action = actions.find(a => a.id === actionId);
      const returnStatus = action?.logged_at ? 'logged' : 'pending';
      
      setCompletingActions(prev => new Set(prev).add(actionId));
      
      const { error } = await supabase
        .from('actions')
        .update({
          status: returnStatus,
          actioned: false,
          actioned_at: null,
          actioned_by: null,
        })
        .eq('id', actionId);

      if (error) throw error;
      
      toast.success(`Action returned to ${returnStatus}`);
      
      setTimeout(() => {
        setCompletingActions(prev => {
          const newSet = new Set(prev);
          newSet.delete(actionId);
          return newSet;
        });
        fetchActions();
      }, 500);
    } catch (err) {
      console.error('Error undoing complete:', err);
      toast.error('Failed to undo complete');
      setCompletingActions(prev => {
        const newSet = new Set(prev);
        newSet.delete(actionId);
        return newSet;
      });
    }
  };

  // Undo logged - returns to pending
  const handleUndoLogged = async (actionId: string) => {
    try {
      setCompletingActions(prev => new Set(prev).add(actionId));
      
      const { error } = await supabase
        .from('actions')
        .update({
          status: 'pending',
          logged_comment: null,
          logged_at: null,
          logged_by: null,
        })
        .eq('id', actionId);

      if (error) throw error;
      
      toast.success('Action returned to pending');
      
      setTimeout(() => {
        setCompletingActions(prev => {
          const newSet = new Set(prev);
          newSet.delete(actionId);
          return newSet;
        });
        fetchActions();
      }, 500);
    } catch (err) {
      console.error('Error undoing logged:', err);
      toast.error('Failed to undo logged');
      setCompletingActions(prev => {
        const newSet = new Set(prev);
        newSet.delete(actionId);
        return newSet;
      });
    }
  };

  const handleDeleteAction = async (actionId: string) => {
    const confirmed = await import('@/lib/services/notification.service').then(m => 
      m.notify.confirm({
        title: 'Delete Action',
        description: 'Are you sure you want to delete this action? This cannot be undone.',
        confirmText: 'Delete',
        destructive: true,
      })
    );
    if (!confirmed) return;
    
    try {
      const { error } = await supabase
        .from('actions')
        .delete()
        .eq('id', actionId);

      if (error) throw error;
      
      // Refresh the list
      fetchActions();
    } catch (err) {
      console.error('Error deleting action:', err);
      setError('Failed to delete action');
    }
  };

  const getPriorityBadge = (priority: string) => {
    const styles = {
      urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
      high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    };
    
    return (
      <Badge variant="outline" className={styles[priority as keyof typeof styles] || styles.medium}>
        {priority.toUpperCase()}
      </Badge>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-400" />;
      case 'logged':
        return <FileText className="h-5 w-5 text-red-400" />;
      case 'in_progress':
        return <Clock className="h-5 w-5 text-blue-400" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-amber-400" />;
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading actions...</p>
      </div>
    );
  }

  // Filter out workshop tasks (they're managed in Workshop Tasks module now)
  const managerActions = actions.filter(a => 
    a.action_type !== 'inspection_defect' && a.action_type !== 'workshop_vehicle_task'
  );
  const workshopActions = actions.filter(a => 
    a.action_type === 'inspection_defect' || a.action_type === 'workshop_vehicle_task'
  );

  const pendingActions = managerActions.filter(a => a.status === 'pending');
  const loggedActions = managerActions.filter(a => a.status === 'logged');
  const completedActions = managerActions.filter(a => a.status === 'completed');

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Manager Actions</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Track and manage action items and manager tasks
        </p>
      </div>

      {/* Action Categories */}
      <div className="space-y-6">
        {/* Workshop Tasks Category */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-workshop/20">
                  <Wrench className="h-5 w-5 text-workshop" />
                </div>
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">Workshop Tasks</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-400">
                    Vehicle repairs and inspection defects
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => router.push('/workshop-tasks')}
                className="bg-workshop hover:bg-workshop-dark text-white"
              >
                <Wrench className="h-4 w-4 mr-2" />
                Open Workshop Tasks
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Pending</p>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                      {workshopActions.filter(a => a.status === 'pending').length}
                    </p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400 opacity-50" />
                </div>
              </div>
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">In Progress</p>
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {workshopActions.filter(a => a.status === 'logged').length}
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-blue-600 dark:text-blue-400 opacity-50" />
                </div>
              </div>
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Completed</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {workshopActions.filter(a => a.status === 'completed').length}
                    </p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400 opacity-50" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Maintenance & Service Category */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-500/20">
                  <Settings className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">Maintenance & Service</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-400">
                    Scheduled vehicle maintenance tracking
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => router.push('/maintenance')}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Settings className="h-4 w-4 mr-2" />
                Open Maintenance
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Overdue Tasks</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {maintenanceOverdue}
                    </p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400 opacity-50" />
                </div>
              </div>
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Due Soon (30 days)</p>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                      {maintenanceDueSoon}
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400 opacity-50" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Site Audit Inspections - Coming Soon */}
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-60">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-slate-500/20">
                  <FileText className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-slate-900 dark:text-white">Site Audit Inspections</CardTitle>
                    <Badge variant="outline" className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30">
                      Coming Soon
                    </Badge>
                  </div>
                  <CardDescription className="text-slate-600 dark:text-slate-400">
                    Site safety audits and compliance checks
                  </CardDescription>
                </div>
              </div>
              <Button
                disabled
                className="bg-slate-600 text-white cursor-not-allowed opacity-50"
              >
                <Ban className="h-4 w-4 mr-2" />
                Coming Soon
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <Info className="h-12 w-12 mx-auto mb-3 opacity-20 text-slate-400" />
              <p className="text-slate-600 dark:text-slate-400">
                Site audit inspection tracking will be available in a future update
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
          {error}
        </div>
      )}

      {/* All Actions Content */}
      <div className="space-y-6">
          {/* Pending Actions */}
          {pendingActions.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Pending Actions</h2>
          <div className="space-y-3">
            {pendingActions.map((action) => {
              const isCompleting = completingActions.has(action.id);
              return (
                <Card key={action.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-red-500/50 transition-all duration-200">
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-start gap-4">
                      <div className="flex-1 space-y-2 w-full">
                        <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                          <div className="flex-1 w-full">
                            <div className="flex items-center gap-2 mb-2">
                              {getStatusIcon(action.status)}
                              <h3 className="font-semibold text-lg text-slate-900 dark:text-white">{action.title}</h3>
                              {getPriorityBadge(action.priority)}
                            </div>
                            {action.description && (
                              <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{action.description}</p>
                            )}
                            <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                              {action.vehicle_inspections && (
                                <span>
                                  Vehicle: {action.vehicle_inspections.vehicles?.reg_number || 'N/A'}
                                </span>
                              )}
                              {action.vehicle_inspections?.profiles?.full_name && (
                                <span>
                                  Submitted by: {action.vehicle_inspections.profiles.full_name}
                                </span>
                              )}
                              {action.inspection_items && (
                                <span>
                                  Issue: {action.inspection_items.item_description}
                                </span>
                              )}
                              <span>Created: {formatDate(action.created_at)}</span>
                            </div>
                          </div>
                          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteAction(action.id)}
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10 md:self-start"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => handleMarkAsLogged(action.id)}
                              disabled={isCompleting}
                              className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                            >
                              <FileText className="h-4 w-4 md:mr-2" />
                              <span className="md:inline">Logged</span>
                            </Button>
                            <Button
                              onClick={() => handleMarkAsComplete(action.id, action.status)}
                              disabled={isCompleting}
                              className={`h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold transition-all ${
                                isCompleting
                                  ? 'bg-green-500 hover:bg-green-500 text-white'
                                  : 'bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900'
                              }`}
                            >
                              {isCompleting ? (
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
        </div>
      )}

      {/* Logged Actions */}
      {loggedActions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="h-5 w-5 text-red-400" />
            Logged Actions
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
              Acknowledged, not fixed yet
            </Badge>
          </h2>
          <div className="space-y-3">
            {loggedActions.map((action) => {
              const isCompleting = completingActions.has(action.id);
              return (
                <Card key={action.id} className="bg-white dark:bg-slate-900 border-red-500/30 dark:border-red-500/30 hover:shadow-lg hover:border-red-500/50 transition-all duration-200">
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-start gap-4">
                      <div className="flex-1 space-y-2 w-full">
                        <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                          <div className="flex-1 w-full">
                            <div className="flex items-center gap-2 mb-2">
                              {getStatusIcon(action.status)}
                              <h3 className="font-semibold text-lg text-slate-900 dark:text-white">{action.title}</h3>
                              {getPriorityBadge(action.priority)}
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                                LOGGED
                              </Badge>
                            </div>
                            {action.description && (
                              <p className="text-sm text-slate-600 dark:text-slate-400 mb-2 whitespace-pre-line">{action.description}</p>
                            )}
                            {action.logged_comment && (
                              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-2">
                                <p className="text-sm text-red-300">
                                  <strong>Manager Note:</strong> {action.logged_comment}
                                </p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                              {action.vehicle_inspections && (
                                <span>
                                  Vehicle: {action.vehicle_inspections.vehicles?.reg_number || 'N/A'}
                                </span>
                              )}
                              {action.vehicle_inspections?.profiles?.full_name && (
                                <span>
                                  Submitted by: {action.vehicle_inspections.profiles.full_name}
                                </span>
                              )}
                              {action.inspection_items && (
                                <span>
                                  Issue: {action.inspection_items.item_description}
                                </span>
                              )}
                              <span>Created: {formatDate(action.created_at)}</span>
                              {action.logged_at && (
                                <span className="text-red-400">
                                  Logged: {formatDate(action.logged_at)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteAction(action.id)}
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10 md:self-start"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => handleUndoLogged(action.id)}
                              variant="outline"
                              disabled={isCompleting}
                              className="h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold border-slate-600 text-white hover:bg-slate-800"
                            >
                              <Undo2 className="h-4 w-4 md:mr-2" />
                              <span className="md:inline">Undo</span>
                            </Button>
                            <Button
                              onClick={() => handleMarkAsComplete(action.id, action.status)}
                              disabled={isCompleting}
                              className={`h-12 md:h-16 min-w-0 md:min-w-[140px] text-sm md:text-base font-semibold transition-all ${
                                isCompleting
                                  ? 'bg-green-500 hover:bg-green-500 text-white'
                                  : 'bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900'
                              }`}
                            >
                              {isCompleting ? (
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
        </div>
      )}

      {/* Completed Actions */}
      {completedActions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-600 dark:text-slate-400">Completed Actions</h2>
          <div className="space-y-3">
            {completedActions.map((action) => (
              <Card key={action.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-70 hover:opacity-90 transition-opacity">
                <CardContent className="pt-6">
                  <div className="flex flex-col items-start gap-4">
                    <div className="flex-1 space-y-2 w-full">
                      <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                        <div className="flex-1 w-full">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="h-5 w-5 text-green-400" />
                            <h3 className="font-semibold text-lg text-white line-through">{action.title}</h3>
                            {getPriorityBadge(action.priority)}
                          </div>
                          {action.description && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{action.description}</p>
                          )}
                          <div className="flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-400">
                            {action.actioned_at && (
                              <span className="text-green-400">
                                Actioned: {formatDate(action.actioned_at)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 w-full md:w-auto">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteAction(action.id)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 md:self-start"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => handleUndoComplete(action.id)}
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
        </div>
      )}

          {actions.length === 0 && !loading && (
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
              <CardContent className="pt-6 text-center py-12">
                <AlertTriangle className="h-12 w-12 mx-auto text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No Actions Yet</h3>
                <p className="text-slate-600 dark:text-slate-400 mb-4">
                  Actions will be automatically created when inspections have failed items
                </p>
              </CardContent>
            </Card>
          )}
      </div>

      {/* Logged Comment Dialog */}
      <Dialog open={showLoggedDialog} onOpenChange={setShowLoggedDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Mark Action as Logged</DialogTitle>
            <DialogDescription className="text-slate-400">
              Add a short comment explaining why this defect is being logged but not fixed immediately
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <p className="text-sm text-amber-200">
                This defect will be automatically marked on future inspections until it&apos;s completed.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logged-comment" className="text-white">
                Comment <span className="text-slate-400">(max 40 chars)</span> *
              </Label>
              <Textarea
                id="logged-comment"
                value={loggedComment}
                onChange={(e) => {
                  if (e.target.value.length <= 40) {
                    setLoggedComment(e.target.value);
                  }
                }}
                placeholder="e.g., Minor cosmetic damage, not urgent"
                className="bg-slate-800 border-slate-600 text-white"
                maxLength={40}
                rows={2}
              />
              <p className="text-xs text-slate-400">
                {loggedComment.length}/40 characters
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowLoggedDialog(false);
                setSelectedActionId(null);
                setLoggedComment('');
              }}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmLogged}
              disabled={!loggedComment.trim() || loggedComment.length > 40}
              className="bg-red-500 hover:bg-red-600"
            >
              <FileText className="h-4 w-4 mr-2" />
              Mark as Logged
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

