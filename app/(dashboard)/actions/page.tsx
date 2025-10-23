'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, AlertTriangle, CheckCircle2, Clock, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { Database } from '@/types/database';

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

  useEffect(() => {
    if (!authLoading) {
      if (!isManager) {
        router.push('/dashboard');
        return;
      }
      fetchActions();
    }
  }, [authLoading, isManager, router]);

  const fetchActions = async () => {
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
  };

  const handleToggleActioned = async (actionId: string, currentState: boolean) => {
    try {
      const { error } = await supabase
        .from('actions')
        .update({
          actioned: !currentState,
          actioned_at: !currentState ? new Date().toISOString() : null,
          actioned_by: !currentState ? user?.id : null,
        })
        .eq('id', actionId);

      if (error) throw error;
      
      // Refresh the list
      fetchActions();
    } catch (err) {
      console.error('Error updating action:', err);
      setError('Failed to update action');
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

  const pendingActions = actions.filter(a => !a.actioned);
  const actionedActions = actions.filter(a => a.actioned);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Actions & Defects</h1>
          <p className="text-muted-foreground mt-1">
            Track and manage issues from vehicle inspections
          </p>
        </div>
        <Button className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900 font-semibold">
          <Plus className="h-4 w-4 mr-2" />
          New Action
        </Button>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg">
          {error}
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Pending</CardDescription>
            <CardTitle className="text-3xl text-amber-400">{pendingActions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Actioned</CardDescription>
            <CardTitle className="text-3xl text-green-400">{actionedActions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Total</CardDescription>
            <CardTitle className="text-3xl">{actions.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Pending Actions */}
      {pendingActions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Pending Actions</h2>
          <div className="space-y-3">
            {pendingActions.map((action) => (
              <Card key={action.id} className="hover:bg-slate-800/30 transition-colors">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <Checkbox
                      id={`action-${action.id}`}
                      checked={action.actioned}
                      onCheckedChange={() => handleToggleActioned(action.id, action.actioned)}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            {getStatusIcon(action.status)}
                            <h3 className="font-semibold text-lg">{action.title}</h3>
                            {getPriorityBadge(action.priority)}
                          </div>
                          {action.description && (
                            <p className="text-sm text-muted-foreground mb-2">{action.description}</p>
                          )}
                          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteAction(action.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Actioned Items */}
      {actionedActions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-muted-foreground">Completed Actions</h2>
          <div className="space-y-3">
            {actionedActions.map((action) => (
              <Card key={action.id} className="opacity-60 hover:opacity-80 transition-opacity">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <Checkbox
                      id={`action-${action.id}`}
                      checked={action.actioned}
                      onCheckedChange={() => handleToggleActioned(action.id, action.actioned)}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="h-5 w-5 text-green-400" />
                            <h3 className="font-semibold text-lg line-through">{action.title}</h3>
                            {getPriorityBadge(action.priority)}
                          </div>
                          {action.description && (
                            <p className="text-sm text-muted-foreground mb-2">{action.description}</p>
                          )}
                          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                            {action.actioned_at && (
                              <span className="text-green-400">
                                Actioned: {formatDate(action.actioned_at)}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteAction(action.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Actions Yet</h3>
            <p className="text-muted-foreground mb-4">
              Actions will be automatically created when inspections have failed items
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

