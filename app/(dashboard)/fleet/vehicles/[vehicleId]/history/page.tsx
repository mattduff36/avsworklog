'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ArrowLeft, 
  Wrench, 
  ClipboardCheck, 
  FileText, 
  MessageSquare,
  Calendar,
  User,
  Clock,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/date';
import { useAuth } from '@/lib/hooks/useAuth';
import Link from 'next/link';

type Vehicle = {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
};

type MaintenanceHistoryEntry = {
  id: string;
  updated_at: string;
  updated_by_profile: {
    full_name: string;
  } | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  comment: string;
};

type WorkshopTask = {
  id: string;
  action_type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  workshop_comments: string | null;
  logged_at: string | null;
  logged_by: string | null;
  logged_comment: string | null;
  actioned_at: string | null;
  actioned_by: string | null;
  actioned_comment: string | null;
  created_at: string;
  created_by: string;
  workshop_task_categories: {
    id: string;
    name: string;
    slug: string | null;
    ui_color: string | null;
  } | null;
  workshop_task_subcategories: {
    id: string;
    name: string;
    slug: string;
    ui_color: string | null;
    workshop_task_categories: {
      id: string;
      name: string;
      slug: string | null;
      ui_color: string | null;
    };
  } | null;
  profiles_created: {
    full_name: string;
  } | null;
  profiles_logged: {
    full_name: string;
  } | null;
  profiles_actioned: {
    full_name: string;
  } | null;
};

type WorkshopComment = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  author: {
    id: string;
    full_name: string;
  } | null;
};

export default function VehicleHistoryPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const supabase = createClient();
  
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [maintenanceHistory, setMaintenanceHistory] = useState<MaintenanceHistoryEntry[]>([]);
  const [workshopTasks, setWorkshopTasks] = useState<WorkshopTask[]>([]);
  const [taskComments, setTaskComments] = useState<Record<string, WorkshopComment[]>>({});
  const [activeTab, setActiveTab] = useState('maintenance');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user && resolvedParams.vehicleId) {
      fetchVehicleData();
      fetchMaintenanceHistory();
      fetchWorkshopTasks();
    }
  }, [user, resolvedParams.vehicleId]);

  const fetchVehicleData = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, reg_number, nickname, status')
        .eq('id', resolvedParams.vehicleId)
        .single();

      if (error) throw error;
      setVehicle(data);
    } catch (error) {
      console.error('Error fetching vehicle:', error);
    }
  };

  const fetchMaintenanceHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('maintenance_history')
        .select(`
          id,
          updated_at,
          field_name,
          old_value,
          new_value,
          comment,
          updated_by_profile:profiles!maintenance_history_updated_by_fkey (
            full_name
          )
        `)
        .eq('vehicle_id', resolvedParams.vehicleId)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setMaintenanceHistory(data || []);
    } catch (error) {
      console.error('Error fetching maintenance history:', error);
    }
  };

  const fetchWorkshopTasks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('actions')
        .select(`
          id,
          action_type,
          title,
          description,
          status,
          priority,
          workshop_comments,
          logged_at,
          logged_by,
          logged_comment,
          actioned_at,
          actioned_by,
          actioned_comment,
          created_at,
          created_by,
          workshop_task_categories (
            id,
            name,
            slug,
            ui_color
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
              ui_color
            )
          ),
          profiles_created:profiles!actions_created_by_fkey (
            full_name
          ),
          profiles_logged:profiles!actions_logged_by_fkey (
            full_name
          ),
          profiles_actioned:profiles!actions_actioned_by_fkey (
            full_name
          )
        `)
        .eq('vehicle_id', resolvedParams.vehicleId)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWorkshopTasks(data || []);

      // Fetch comments for all tasks
      if (data && data.length > 0) {
        await fetchTaskComments(data.map(t => t.id));
      }
    } catch (error) {
      console.error('Error fetching workshop tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTaskComments = async (taskIds: string[]) => {
    try {
      const { data, error } = await supabase
        .from('workshop_task_comments')
        .select(`
          id,
          task_id,
          body,
          created_at,
          updated_at,
          profiles:author_id (
            id,
            full_name
          )
        `)
        .in('task_id', taskIds)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group comments by task_id
      const commentsByTask: Record<string, WorkshopComment[]> = {};
      (data || []).forEach((comment: { task_id: string; id: string; body: string; created_at: string; updated_at: string | null; profiles: { id: string; full_name: string } | null }) => {
        const taskId = comment.task_id;
        if (!commentsByTask[taskId]) {
          commentsByTask[taskId] = [];
        }
        commentsByTask[taskId].push({
          id: comment.id,
          body: comment.body,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          author: comment.profiles ? {
            id: comment.profiles.id,
            full_name: comment.profiles.full_name,
          } : null,
        });
      });

      setTaskComments(commentsByTask);
    } catch (error) {
      console.error('Error fetching task comments:', error);
    }
  };

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      pending: { label: 'Pending', className: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30' },
      in_progress: { label: 'In Progress', className: 'bg-blue-500/10 text-blue-300 border-blue-500/30' },
      logged: { label: 'In Progress', className: 'bg-blue-500/10 text-blue-300 border-blue-500/30' },
      completed: { label: 'Completed', className: 'bg-green-500/10 text-green-300 border-green-500/30' },
    };
    const config = statusMap[status] || statusMap.pending;
    return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
  };

  const getFieldLabel = (fieldName: string): string => {
    const labels: Record<string, string> = {
      mot_expiry_date: 'MOT Expiry',
      tax_due_date: 'Tax Due Date',
      service_due_date: 'Service Due',
      service_due_mileage: 'Service Due Mileage',
      last_service_date: 'Last Service',
      last_service_mileage: 'Last Service Mileage',
      notes: 'Notes',
    };
    return labels[fieldName] || fieldName.replace(/_/g, ' ');
  };

  if (!vehicle && !loading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-16 w-16 text-red-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Vehicle Not Found</h2>
            <p className="text-gray-600 text-center max-w-md mb-4">
              The requested vehicle could not be found.
            </p>
            <Button onClick={() => router.back()} variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {vehicle?.reg_number || <Skeleton className="h-8 w-32" />}
              {vehicle?.nickname && <span className="text-muted-foreground ml-2">({vehicle.nickname})</span>}
            </h1>
            <p className="text-muted-foreground mt-1">Vehicle History & Records</p>
          </div>
        </div>
        <Link href={`/fleet?tab=vehicles`}>
          <Button variant="outline">
            View in Fleet
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="mot" className="gap-2">
            <ClipboardCheck className="h-4 w-4" />
            MOT
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Notes
          </TabsTrigger>
        </TabsList>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Maintenance & Workshop History</CardTitle>
              <CardDescription>
                Complete timeline of maintenance updates and workshop tasks
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-32 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Workshop Tasks */}
                  {workshopTasks.map((task) => (
                    <Card key={task.id} className="border-l-4 border-l-orange-500">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="bg-orange-500/10 text-orange-300 border-orange-500/30">
                                {task.action_type === 'inspection_defect' ? 'Inspection Defect' : 'Workshop Task'}
                              </Badge>
                              {getStatusBadge(task.status)}
                              {/* Feature 3: Category + Subcategory badges */}
                              {task.workshop_task_subcategories?.workshop_task_categories && (
                                <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                  {task.workshop_task_subcategories.workshop_task_categories.name}
                                </Badge>
                              )}
                              {task.workshop_task_subcategories && (
                                <Badge variant="outline" className="bg-purple-500/10 text-purple-300 border-purple-500/30">
                                  {task.workshop_task_subcategories.name}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium">{task.title}</p>
                            {task.workshop_comments && (
                              <p className="text-sm text-muted-foreground">{task.workshop_comments}</p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleTaskExpansion(task.id)}
                          >
                            {expandedTasks.has(task.id) ? 'Collapse' : 'Expand'}
                          </Button>
                        </div>
                      </CardHeader>
                      {expandedTasks.has(task.id) && (
                        <CardContent className="space-y-4 pt-0">
                          {/* Timeline */}
                          <div className="space-y-3 border-l-2 border-slate-700 pl-4 ml-2">
                            {/* Created */}
                            <div className="relative">
                              <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-slate-700 border-2 border-slate-900"></div>
                              <div className="flex items-start gap-3">
                                <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                                <div className="flex-1 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">{task.profiles_created?.full_name || 'Unknown'}</span>
                                    <span className="text-xs text-muted-foreground">created task</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {formatRelativeTime(task.created_at)}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Logged (In Progress) */}
                            {task.logged_at && (
                              <div className="relative">
                                <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-blue-500 border-2 border-slate-900"></div>
                                <div className="flex items-start gap-3">
                                  <Clock className="h-4 w-4 text-blue-400 mt-0.5" />
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{task.profiles_logged?.full_name || 'Unknown'}</span>
                                      <span className="text-xs text-muted-foreground">marked in progress</span>
                                    </div>
                                    {task.logged_comment && (
                                      <p className="text-sm text-slate-300">{task.logged_comment}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                      {formatRelativeTime(task.logged_at)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Feature 1: Comments Timeline */}
                            {taskComments[task.id]?.map((comment) => (
                              <div key={comment.id} className="relative">
                                <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-purple-500 border-2 border-slate-900"></div>
                                <div className="flex items-start gap-3">
                                  <MessageSquare className="h-4 w-4 text-purple-400 mt-0.5" />
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{comment.author?.full_name || 'Unknown'}</span>
                                      <span className="text-xs text-muted-foreground">added comment</span>
                                    </div>
                                    <p className="text-sm text-slate-300">{comment.body}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {formatRelativeTime(comment.created_at)}
                                      {comment.updated_at && <span className="ml-1">(edited)</span>}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}

                            {/* Completed */}
                            {task.actioned_at && (
                              <div className="relative">
                                <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-green-500 border-2 border-slate-900"></div>
                                <div className="flex items-start gap-3">
                                  <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5" />
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{task.profiles_actioned?.full_name || 'Unknown'}</span>
                                      <span className="text-xs text-muted-foreground">marked complete</span>
                                    </div>
                                    {task.actioned_comment && (
                                      <p className="text-sm text-slate-300">{task.actioned_comment}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                      {formatRelativeTime(task.actioned_at)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}

                  {/* Maintenance History Entries */}
                  {maintenanceHistory.map((entry) => (
                    <Card key={entry.id} className="border-l-4 border-l-blue-500">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                          <Calendar className="h-5 w-5 text-blue-400 mt-0.5" />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{entry.updated_by_profile?.full_name || 'System'}</span>
                              <span className="text-xs text-muted-foreground">updated</span>
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                {getFieldLabel(entry.field_name)}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              <span className="line-through">{entry.old_value || 'None'}</span>
                              {' → '}
                              <span className="text-slate-200">{entry.new_value || 'None'}</span>
                            </div>
                            {entry.comment && (
                              <p className="text-sm text-slate-300 italic">&quot;{entry.comment}&quot;</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {formatRelativeTime(entry.updated_at)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {workshopTasks.length === 0 && maintenanceHistory.length === 0 && (
                    <div className="text-center py-12">
                      <Wrench className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">No maintenance history yet</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MOT Tab */}
        <TabsContent value="mot">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <ClipboardCheck className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">MOT History</h3>
                <p className="text-gray-600 mb-4">
                  MOT history integration will be implemented here
                </p>
                <p className="text-sm text-muted-foreground">
                  This will display MOT test history from DVLA data
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Documents</h3>
                <p className="text-gray-600 mb-4">
                  Document management will be implemented here
                </p>
                <p className="text-sm text-muted-foreground">
                  Upload and manage vehicle documents, invoices, and records
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <MessageSquare className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">Notes</h3>
                <p className="text-gray-600 mb-4">
                  Vehicle notes and comments will be implemented here
                </p>
                <p className="text-sm text-muted-foreground">
                  Add and view general notes about this vehicle
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
