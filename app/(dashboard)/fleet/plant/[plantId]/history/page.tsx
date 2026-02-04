'use client';

import { useState, useEffect, use } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Wrench, 
  FileText, 
  MessageSquare,
  Calendar,
  AlertTriangle,
  HardHat,
  Loader2,
  Edit,
  Paperclip
} from 'lucide-react';
import { BackButton } from '@/components/ui/back-button';
import { formatRelativeTime } from '@/lib/utils/date';
import { useAuth } from '@/lib/hooks/useAuth';
import { formatMaintenanceDate } from '@/lib/utils/maintenanceCalculations';
import { usePlantMaintenanceHistory } from '@/lib/hooks/useMaintenance';
import { useWorkshopTaskComments } from '@/lib/hooks/useWorkshopTaskComments';

// Dynamic imports for dialog components
const EditPlantRecordDialog = dynamic(() => import('@/app/(dashboard)/maintenance/components/EditPlantRecordDialog').then(m => ({ default: m.EditPlantRecordDialog })), { ssr: false });
const DeletePlantDialog = dynamic(() => import('@/app/(dashboard)/maintenance/components/DeletePlantDialog').then(m => ({ default: m.DeletePlantDialog })), { ssr: false });
const WorkshopTaskHistoryCard = dynamic(() => import('@/components/workshop-tasks/WorkshopTaskHistoryCard').then(m => ({ default: m.WorkshopTaskHistoryCard })), { ssr: false });

type Plant = {
  id: string;
  plant_id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  year: number | null;
  weight_class: string | null;
  category_id: string;
  loler_due_date: string | null;
  loler_last_inspection_date: string | null;
  loler_certificate_number: string | null;
  loler_inspection_interval_months: number;
  current_hours: number | null;
  status: 'active' | 'inactive' | 'maintenance' | 'retired';
  reg_number: string | null;
  vehicle_categories?: { name: string } | null;
};

type MaintenanceRecord = {
  id: string | null;
  plant_id: string;
  current_hours: number | null;
  last_service_hours: number | null;
  next_service_hours: number | null;
  tracker_id: string | null;
  last_hours_update: string | null;
};

type MaintenanceHistoryEntry = {
  id: string;
  created_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
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
  status_history?: Array<{
    status: string;
    timestamp: string;
    userId: string;
    userName: string;
    comment?: string;
  }> | null;
  created_at: string;
  created_by: string;
  workshop_task_categories: {
    id: string;
    name: string;
    slug: string | null;
    ui_color: string | null;
  } | null;
  profiles_created: {
    full_name: string;
  } | null;
};

type TaskAttachment = {
  id: string;
  task_id: string;
  created_at: string;
  workshop_attachment_templates: {
    name: string;
    description: string | null;
  } | null;
};

function DocumentsTabContent({ plantId, workshopTasks }: { plantId: string; workshopTasks: WorkshopTask[] }) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAttachments = async () => {
      try {
        setLoading(true);
        const taskIds = workshopTasks.map(t => t.id);
        
        if (taskIds.length === 0) {
          setAttachments([]);
          return;
        }

        const supabase = createClient();
        const { data, error } = await supabase
          .from('workshop_task_attachments')
          .select(`
            id,
            task_id,
            created_at,
            workshop_attachment_templates (
              name,
              description
            )
          `)
          .in('task_id', taskIds)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setAttachments(data || []);
      } catch (error) {
        console.error('Error fetching attachments:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAttachments();
  }, [workshopTasks]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (attachments.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="h-16 w-16 text-slate-400 mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-white mb-2">No Documents Yet</h3>
        <p className="text-slate-400 mb-4">
          No workshop task attachments found for this plant machinery
        </p>
        <p className="text-sm text-muted-foreground">
          Attachments will appear here when added to workshop tasks
        </p>
      </div>
    );
  }

  // Group attachments by task
  const attachmentsByTask = attachments.reduce((acc, att) => {
    if (!acc[att.task_id]) {
      acc[att.task_id] = [];
    }
    acc[att.task_id].push(att);
    return acc;
  }, {} as Record<string, TaskAttachment[]>);

  return (
    <div className="space-y-4">
      {Object.entries(attachmentsByTask).map(([taskId, taskAttachments]) => {
        const task = workshopTasks.find(t => t.id === taskId);
        if (!task) return null;

        return (
          <Card key={taskId} className="bg-slate-800/30 border-slate-700">
            <CardContent className="pt-6">
              <div className="space-y-3">
                {/* Task Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Wrench className="h-4 w-4 text-workshop" />
                      <h4 className="font-medium text-white">
                        {task.workshop_task_categories?.name || 'Workshop Task'}
                      </h4>
                      <Badge 
                        variant="outline" 
                        className={
                          task.status === 'completed' 
                            ? 'bg-green-500/10 text-green-300 border-green-500/30'
                            : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                        }
                      >
                        {task.status === 'completed' ? 'Completed' : 'In Progress'}
                      </Badge>
                    </div>
                    {task.workshop_comments && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {task.workshop_comments}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                    <Paperclip className="h-3 w-3 mr-1" />
                    {taskAttachments.length}
                  </Badge>
                </div>

                {/* Attachments List */}
                <div className="space-y-2 pl-6 border-l-2 border-slate-700">
                  {taskAttachments.map(attachment => (
                    <div 
                      key={attachment.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-blue-400" />
                        <div>
                          <p className="text-sm font-medium text-white">
                            {attachment.workshop_attachment_templates?.name || 'Attachment'}
                          </p>
                          {attachment.workshop_attachment_templates?.description && (
                            <p className="text-xs text-muted-foreground">
                              {attachment.workshop_attachment_templates.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(attachment.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function PlantHistoryPage({
  params,
}: {
  params: Promise<{ plantId: string }>;
}) {
  const unwrappedParams = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const supabase = createClient();
  
  const [plant, setPlant] = useState<Plant | null>(null);
  const [maintenanceRecord, setMaintenanceRecord] = useState<MaintenanceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('maintenance');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [showWorkshopTasks, setShowWorkshopTasks] = useState(true);
  const [showRecordUpdates, setShowRecordUpdates] = useState(true);

  // Use the plant history hook
  const { data: historyData, refetch: refetchHistory } = usePlantMaintenanceHistory(unwrappedParams.plantId);

  const workshopTasks = historyData?.workshopTasks || [];
  const maintenanceHistory = historyData?.history || [];

  // Fetch comments for all workshop tasks
  const { comments: taskComments } = useWorkshopTaskComments({
    taskIds: workshopTasks.map(t => t.id),
    enabled: workshopTasks.length > 0
  });

  useEffect(() => {
    if (user && unwrappedParams.plantId) {
      fetchPlantData();
      fetchMaintenanceRecord();
    }
  }, [user, unwrappedParams.plantId]);

  const fetchPlantData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('plant')
        .select(`
          *,
          vehicle_categories (
            name
          )
        `)
        .eq('id', unwrappedParams.plantId)
        .single();

      if (error) throw error;
      setPlant(data);
    } catch (err) {
      console.error('Error fetching plant:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMaintenanceRecord = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select('*')
        .eq('plant_id', unwrappedParams.plantId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      setMaintenanceRecord(data);
    } catch (err) {
      console.error('Error fetching maintenance record:', err);
    }
  };

  const getFieldLabel = (fieldName: string): string => {
    const labels: Record<string, string> = {
      nickname: 'Nickname',
      current_hours: 'Current Hours',
      last_service_hours: 'Last Service Hours',
      next_service_hours: 'Next Service Hours',
      loler_due_date: 'LOLER Due Date',
      loler_last_inspection_date: 'LOLER Last Inspection',
      loler_certificate_number: 'LOLER Certificate',
      loler_inspection_interval_months: 'LOLER Interval',
      tracker_id: 'GPS Tracker',
      no_changes: 'Update (No Field Changes)',
    };
    return labels[fieldName] || fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  if (!plant && !loading) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-16 w-16 text-red-400 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Plant Not Found</h2>
            <p className="text-gray-600 text-center max-w-md mb-4">
              The requested plant machinery could not be found.
            </p>
            <BackButton />
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
          <BackButton />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {plant?.plant_id || <Skeleton className="h-8 w-32" />}
              {plant?.nickname && <span className="text-muted-foreground ml-2">({plant.nickname})</span>}
            </h1>
            <p className="text-muted-foreground mt-1">
              Plant Machinery History & Records
            </p>
          </div>
        </div>
        {plant && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditDialogOpen(true)}
            className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white"
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit Plant Record
          </Button>
        )}
      </div>

      {/* Plant Details Section - matching vehicle history layout */}
      {plant && (
        <Card className="bg-gradient-to-r from-amber-900/20 to-amber-800/10 border-amber-700/30">
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
              {/* Registration (if exists) */}
              {plant.reg_number && (
                <div>
                  <span className="text-muted-foreground">Registration:</span>
                  <span className="ml-2 text-white font-medium">{plant.reg_number}</span>
                </div>
              )}
              
              {/* Serial Number */}
              {plant.serial_number && (
                <div>
                  <span className="text-muted-foreground">Serial Number:</span>
                  <span className="ml-2 text-white font-medium">{plant.serial_number}</span>
                </div>
              )}
              
              {/* Year */}
              {plant.year && (
                <div>
                  <span className="text-muted-foreground">Year:</span>
                  <span className="ml-2 text-white font-medium">{plant.year}</span>
                </div>
              )}
              
              {/* Weight Class */}
              {plant.weight_class && (
                <div>
                  <span className="text-muted-foreground">Weight Class:</span>
                  <span className="ml-2 text-white font-medium">{plant.weight_class}</span>
                </div>
              )}
              
              {/* Category */}
              {plant.vehicle_categories?.name && (
                <div>
                  <span className="text-muted-foreground">Category:</span>
                  <span className="ml-2 text-white font-medium">{plant.vehicle_categories.name}</span>
                </div>
              )}
              
              {/* Make */}
              {plant.make && (
                <div>
                  <span className="text-muted-foreground">Make:</span>
                  <span className="ml-2 text-white font-medium">{plant.make}</span>
                </div>
              )}
              
              {/* Model */}
              {plant.model && (
                <div>
                  <span className="text-muted-foreground">Model:</span>
                  <span className="ml-2 text-white font-medium">{plant.model}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            History
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
          {/* Service Information Summary - matching vehicle history */}
          {(maintenanceRecord || plant) && (
            <Card className="bg-slate-800/50 border-border">
              <CardHeader>
                <CardTitle>Service Information</CardTitle>
                <CardDescription>Current maintenance status and schedules</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {/* Current Hours */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Current Hours</span>
                    <p className="text-lg font-semibold text-white">
                      {maintenanceRecord?.current_hours || plant?.current_hours ? `${maintenanceRecord?.current_hours || plant?.current_hours}h` : 'Not Set'}
                    </p>
                  </div>

                  {/* Next Service Hours */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Next Service</span>
                    <p className="text-lg font-semibold text-white">
                      {maintenanceRecord?.next_service_hours 
                        ? `${maintenanceRecord.next_service_hours}h` 
                        : 'Not Set'}
                    </p>
                  </div>

                  {/* Last Service Hours */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Last Service</span>
                    <p className="text-lg font-semibold text-white">
                      {maintenanceRecord?.last_service_hours 
                        ? `${maintenanceRecord.last_service_hours}h` 
                        : 'Not Set'}
                    </p>
                  </div>

                  {/* LOLER Due Date */}
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">LOLER Due</span>
                    <p className="text-lg font-semibold text-white">
                      {formatMaintenanceDate(plant?.loler_due_date)}
                    </p>
                  </div>

                  {/* Tracker ID */}
                  {maintenanceRecord?.tracker_id && (
                    <div className="space-y-1">
                      <span className="text-xs text-slate-400 uppercase tracking-wide">GPS Tracker</span>
                      <p className="text-lg font-semibold text-white">
                        {maintenanceRecord.tracker_id}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-slate-800/50 border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Maintenance & Workshop History</CardTitle>
                  <CardDescription>
                    Complete timeline of maintenance updates and workshop tasks
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowWorkshopTasks(!showWorkshopTasks)}
                    className={`h-8 w-8 p-0 transition-all ${
                      showWorkshopTasks
                        ? 'bg-workshop/20 hover:bg-workshop/30 border-workshop text-workshop'
                        : 'bg-muted/50 hover:bg-muted border-border text-muted-foreground'
                    }`}
                    title="Toggle Workshop Tasks"
                  >
                    <Wrench className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRecordUpdates(!showRecordUpdates)}
                    className={`h-8 w-8 p-0 transition-all ${
                      showRecordUpdates
                        ? 'bg-blue-500/20 hover:bg-blue-500/30 border-blue-500 text-blue-400'
                        : 'bg-muted/50 hover:bg-muted border-border text-muted-foreground'
                    }`}
                    title="Toggle Record Updates"
                  >
                    <Calendar className="h-4 w-4" />
                  </Button>
                </div>
              </div>
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
                  {showWorkshopTasks && workshopTasks.map((task) => (
                    <WorkshopTaskHistoryCard
                      key={task.id}
                      task={task}
                      comments={taskComments[task.id] || []}
                      defaultExpanded={expandedTasks.has(task.id)}
                      onToggle={(taskId, isExpanded) => {
                        setExpandedTasks(prev => {
                          const newSet = new Set(prev);
                          if (isExpanded) {
                            newSet.add(taskId);
                          } else {
                            newSet.delete(taskId);
                          }
                          return newSet;
                        });
                      }}
                    />
                  ))}

                  {/* Maintenance History Entries */}
                  {showRecordUpdates && maintenanceHistory.map((entry) => (
                    <Card key={entry.id} className="bg-slate-800/50 border-slate-700 border-l-4 border-l-blue-500">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                          <Calendar className="h-5 w-5 text-blue-400 mt-0.5" />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{entry.updated_by_name || 'System'}</span>
                              <span className="text-xs text-muted-foreground">updated</span>
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                {getFieldLabel(entry.field_name)}
                              </Badge>
                            </div>
                            {/* Only show before/after if we have actual values (not "no_changes") */}
                            {entry.field_name !== 'no_changes' && (entry.old_value || entry.new_value) && (
                              <div className="text-sm text-muted-foreground">
                                <span className="line-through">{entry.old_value || 'Not set'}</span>
                                {' → '}
                                <span className="text-slate-200 font-medium">{entry.new_value || 'Not set'}</span>
                              </div>
                            )}
                            {entry.comment && (
                              <div className="bg-slate-900/50 rounded p-2 border border-slate-700 mt-2">
                                <p className="text-xs text-muted-foreground mb-1">Comment:</p>
                                <p className="text-sm text-slate-200">&quot;{entry.comment}&quot;</p>
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {formatRelativeTime(entry.created_at)}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {(!showWorkshopTasks || workshopTasks.length === 0) && (!showRecordUpdates || maintenanceHistory.length === 0) && (
                    <div className="text-center py-12">
                      <Wrench className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">
                        {!showWorkshopTasks && !showRecordUpdates 
                          ? 'Enable filters to view history' 
                          : 'No maintenance history yet'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-4">
          <Card className="bg-slate-800/50 border-border">
            <CardHeader>
              <CardTitle>Workshop Task Attachments</CardTitle>
              <CardDescription>Documents and forms attached to workshop tasks for this plant machinery</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : workshopTasks.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-16 w-16 text-slate-400 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-semibold text-white mb-2">No Documents Yet</h3>
                  <p className="text-slate-400 mb-4">
                    No workshop tasks with attachments found for this plant machinery
                  </p>
                </div>
              ) : (
                <DocumentsTabContent plantId={unwrappedParams.plantId} workshopTasks={workshopTasks} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes">
          <Card className="bg-slate-800/50 border-border">
            <CardHeader>
              <CardTitle>Plant Notes</CardTitle>
              <CardDescription>General notes and comments about this plant machinery</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <MessageSquare className="h-16 w-16 text-slate-400 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold text-white mb-2">Coming Soon</h3>
                <p className="text-slate-400 mb-4">
                  Plant notes feature will be implemented in a future update
                </p>
                <p className="text-sm text-muted-foreground">
                  This will allow you to add and view general notes about this plant machinery
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Plant Record Dialog */}
      {plant && (
        <EditPlantRecordDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          plant={plant}
          maintenanceRecord={maintenanceRecord}
          onSuccess={() => {
            setEditDialogOpen(false);
            fetchPlantData();
            fetchMaintenanceRecord();
            refetchHistory();
          }}
          onRetire={() => {
            setDeleteDialogOpen(true);
          }}
        />
      )}

      {/* Delete Plant Dialog */}
      {plant && (
        <DeletePlantDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          plant={{
            id: plant.id,
            plant_id: plant.plant_id,
            nickname: plant.nickname,
            vehicle_categories: plant.vehicle_categories
          }}
          onSuccess={() => {
            router.push('/fleet?tab=plant');
          }}
        />
      )}
    </div>
  );
}
