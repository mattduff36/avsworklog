'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle2, Clock, Trash2, Clipboard, Package, FileText, Undo2 } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Database } from '@/types/database';
import { toast } from 'sonner';

type Action = Database['public']['Tables']['actions']['Row'] & {
  vehicle_inspections?: {
    inspection_date: string;
    vehicles?: {
      reg_number: string;
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
  const [activeTab, setActiveTab] = useState('all');
  
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
    }
  }, [authLoading, isManager, router, fetchActions]);

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
    if (!confirm('Are you sure you want to delete this action?')) return;
    
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

  const pendingActions = actions.filter(a => a.status === 'pending');
  const loggedActions = actions.filter(a => a.status === 'logged');
  const completedActions = actions.filter(a => a.status === 'completed');

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Manager Actions</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Track and manage manager tasks
        </p>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
          {error}
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-600 dark:text-slate-400">Pending</CardDescription>
            <CardTitle className="text-3xl text-amber-600 dark:text-amber-400">{pendingActions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-600 dark:text-slate-400">Logged</CardDescription>
            <CardTitle className="text-3xl text-red-600 dark:text-red-400">{loggedActions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-600 dark:text-slate-400">Completed</CardDescription>
            <CardTitle className="text-3xl text-green-600 dark:text-green-400">{completedActions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-600 dark:text-slate-400">Total</CardDescription>
            <CardTitle className="text-3xl text-slate-900 dark:text-white">{actions.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Tabs Navigation */}
      <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-2xl grid-cols-3 h-auto p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <TabsTrigger 
            value="all" 
            className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
            style={activeTab === 'all' ? {
              backgroundColor: 'hsl(0 84% 60%)', // Red for Actions
              color: 'white',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
            } : {}}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm font-medium">All Actions</span>
              {actions.length > 0 && (
                <Badge 
                  variant="secondary" 
                  className={activeTab === 'all' ? "bg-white/20 text-white border-white/30" : ""}
                >
                  {actions.length}
                </Badge>
              )}
            </div>
          </TabsTrigger>
          <TabsTrigger 
            value="inspections" 
            className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
            style={activeTab === 'inspections' ? {
              backgroundColor: 'hsl(30 95% 55%)', // Inspection Orange
              color: 'white',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
            } : {}}
          >
            <div className="flex items-center gap-2">
              <Clipboard className="h-5 w-5" />
              <span className="text-sm font-medium">From Inspections</span>
              {actions.length > 0 && (
                <Badge 
                  variant="secondary"
                  className={activeTab === 'inspections' ? "bg-white/20 text-white border-white/30" : ""}
                >
                  {actions.length}
                </Badge>
              )}
            </div>
          </TabsTrigger>
          <TabsTrigger 
            value="future" 
            className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
            style={activeTab === 'future' ? {
              backgroundColor: '#F1D64A', // AVS Yellow
              color: '#252525',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
            } : {}}
          >
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              <span className="text-sm font-medium">More Sources</span>
            </div>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
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
                    <div className="flex items-start gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
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
                              {action.inspection_items && (
                                <span>
                                  Issue: {action.inspection_items.item_description}
                                </span>
                              )}
                              <span>Created: {formatDate(action.created_at)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteAction(action.id)}
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => handleMarkAsLogged(action.id)}
                              disabled={isCompleting}
                              className="h-16 min-w-[140px] text-base font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                            >
                              <FileText className="h-4 w-4 mr-2" />
                              Logged
                            </Button>
                            <Button
                              onClick={() => handleMarkAsComplete(action.id, action.status)}
                              disabled={isCompleting}
                              className={`h-16 min-w-[140px] text-base font-semibold transition-all ${
                                isCompleting
                                  ? 'bg-green-500 hover:bg-green-500 text-white'
                                  : 'bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900'
                              }`}
                            >
                              {isCompleting ? (
                                <>
                                  <CheckCircle2 className="h-5 w-5 mr-2" />
                                  Complete
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
                    <div className="flex items-start gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
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
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteAction(action.id)}
                              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => handleUndoLogged(action.id)}
                              variant="outline"
                              disabled={isCompleting}
                              className="h-16 min-w-[140px] text-base font-semibold border-slate-600 text-white hover:bg-slate-800"
                            >
                              <Undo2 className="h-4 w-4 mr-2" />
                              Undo Logged
                            </Button>
                            <Button
                              onClick={() => handleMarkAsComplete(action.id, action.status)}
                              disabled={isCompleting}
                              className={`h-16 min-w-[140px] text-base font-semibold transition-all ${
                                isCompleting
                                  ? 'bg-green-500 hover:bg-green-500 text-white'
                                  : 'bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900'
                              }`}
                            >
                              {isCompleting ? (
                                <>
                                  <CheckCircle2 className="h-5 w-5 mr-2" />
                                  Complete
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
                  <div className="flex items-start gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                            <h3 className="font-semibold text-lg text-slate-900 dark:text-white line-through">{action.title}</h3>
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
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteAction(action.id)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => handleUndoComplete(action.id)}
                            variant="outline"
                            className="h-16 min-w-[140px] text-base font-semibold"
                          >
                            <Undo2 className="h-4 w-4 mr-2" />
                            Undo Complete
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
        </TabsContent>

        <TabsContent value="inspections" className="space-y-6">
          {/* Pending Actions */}
          {pendingActions.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Pending Actions from Inspections</h2>
              <div className="space-y-3">
                {pendingActions.map((action) => {
                  const isCompleting = completingActions.has(action.id);
                  return (
                    <Card key={action.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-inspection/50 transition-all duration-200">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
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
                                  {action.inspection_items && (
                                    <span>
                                      Issue: {action.inspection_items.item_description}
                                    </span>
                                  )}
                                  <span>Created: {formatDate(action.created_at)}</span>
                                </div>
                              </div>
                              <div className="flex-shrink-0 flex items-center gap-2">
                                <Button
                                  onClick={() => handleMarkAsLogged(action.id)}
                                  disabled={isCompleting}
                                  className="h-16 min-w-[140px] text-base font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                                >
                                  <FileText className="h-4 w-4 mr-2" />
                                  Logged
                                </Button>
                                <Button
                                  onClick={() => handleMarkAsComplete(action.id, action.status)}
                                  disabled={isCompleting}
                                  className={`h-16 min-w-[140px] text-base font-semibold transition-all ${
                                    isCompleting
                                      ? 'bg-green-500 hover:bg-green-500 text-white'
                                      : 'bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900'
                                  }`}
                                >
                                  {isCompleting ? (
                                    <>
                                      <CheckCircle2 className="h-4 w-4 mr-2" />
                                      Complete
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

          {/* Completed Items */}
          {completedActions.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-slate-600 dark:text-slate-400">Completed Actions from Inspections</h2>
              <div className="space-y-3">
                {completedActions.map((action) => (
                  <Card key={action.id} className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-70 hover:opacity-90 transition-opacity">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                                <h3 className="font-semibold text-lg text-slate-900 dark:text-white line-through">{action.title}</h3>
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
                                {action.vehicle_inspections && (
                                  <span>
                                    Vehicle: {action.vehicle_inspections.vehicles?.reg_number || 'N/A'}
                                  </span>
                                )}
                                {action.inspection_items && (
                                  <span>
                                    Issue: {action.inspection_items.item_description}
                                  </span>
                                )}
                              </div>
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
                <Clipboard className="h-12 w-12 mx-auto text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">No Inspection Actions Yet</h3>
                <p className="text-slate-600 dark:text-slate-400 mb-4">
                  Actions from inspections will appear here when inspection items fail
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="future" className="space-y-6">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardContent className="pt-6 text-center py-16">
              <Package className="h-16 w-16 mx-auto text-slate-400 mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">More Action Sources Coming Soon</h3>
              <p className="text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                In future updates, actions will be created from additional sources including timesheets, maintenance schedules, and more.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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

