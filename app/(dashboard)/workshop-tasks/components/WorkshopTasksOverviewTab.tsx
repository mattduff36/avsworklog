import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InspectionPhotoGallery } from '@/components/inspections/InspectionPhotoGallery';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit,
  HardHat,
  MessageSquare,
  Paperclip,
  Pause,
  Plus,
  Trash2,
  Truck,
  Undo2,
  Wrench,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import type { Action, AssetTab, Vehicle } from '../types';
import type { InspectionPhoto } from '@/types/inspection';

interface WorkshopTasksOverviewTabProps {
  assetTab: AssetTab;
  onAssetTabChange: (tab: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  vehicleFilter: string;
  onVehicleFilterChange: (vehicleId: string) => void;
  vehicles: Vehicle[];
  loading: boolean;
  tabFilteredTasks: Action[];
  pendingTasks: Action[];
  highPriorityPendingCount: number;
  inProgressTasks: Action[];
  onHoldTasks: Action[];
  completedTasks: Action[];
  showPending: boolean;
  onShowPendingChange: (show: boolean) => void;
  showInProgress: boolean;
  onShowInProgressChange: (show: boolean) => void;
  showOnHold: boolean;
  onShowOnHoldChange: (show: boolean) => void;
  showCompleted: boolean;
  onShowCompletedChange: (show: boolean) => void;
  updatingStatus: Set<string>;
  taskAttachmentCounts: Map<string, number>;
  taskInspectionPhotos: Record<string, InspectionPhoto[]>;
  getStatusIcon: (status: string, task?: Action) => ReactNode;
  getVehicleReg: (task: Action) => string;
  getSourceLabel: (task: Action) => string;
  getAssetDisplay: (vehicle: Vehicle) => string;
  onCreateTask: () => void;
  onOpenTaskModal: (task: Action) => void;
  onOpenComments: (task: Action) => void;
  onMarkInProgress: (task: Action) => void;
  onMarkComplete: (task: Action) => void;
  onMarkOnHold: (task: Action) => void;
  onResumeTask: (task: Action) => void;
  onUndoLogged: (taskId: string) => void;
  onUndoComplete: (taskId: string) => void;
  onEditTask: (task: Action) => void;
  onDeleteTask: (task: Action) => void;
}

export function WorkshopTasksOverviewTab({
  assetTab,
  onAssetTabChange,
  statusFilter,
  onStatusFilterChange,
  vehicleFilter,
  onVehicleFilterChange,
  vehicles,
  loading,
  tabFilteredTasks,
  pendingTasks,
  highPriorityPendingCount,
  inProgressTasks,
  onHoldTasks,
  completedTasks,
  showPending,
  onShowPendingChange,
  showInProgress,
  onShowInProgressChange,
  showOnHold,
  onShowOnHoldChange,
  showCompleted,
  onShowCompletedChange,
  updatingStatus,
  taskAttachmentCounts,
  taskInspectionPhotos,
  getStatusIcon,
  getVehicleReg,
  getSourceLabel,
  getAssetDisplay,
  onCreateTask,
  onOpenTaskModal,
  onOpenComments,
  onMarkInProgress,
  onMarkComplete,
  onMarkOnHold,
  onResumeTask,
  onUndoLogged,
  onUndoComplete,
  onEditTask,
  onDeleteTask,
}: WorkshopTasksOverviewTabProps) {
  const { tabletModeEnabled } = useTabletMode();
  const hasHighPriorityPending = highPriorityPendingCount > 0;
  const pendingHeaderIconClass = hasHighPriorityPending ? 'text-red-500' : 'text-amber-400';
  const taskActionButtonClass = tabletModeEnabled ? 'min-h-11 px-4 text-base' : 'h-9 px-3 text-xs';
  const taskActionGroupClass = tabletModeEnabled
    ? 'flex flex-wrap items-center gap-1.5 w-full lg:w-auto'
    : 'flex flex-wrap items-center gap-1.5 w-full md:w-auto';
  const getTaskPhotos = (taskId: string) => taskInspectionPhotos[taskId] ?? [];
  const renderInspectionPhotoBadge = (task: Action) => {
    const count = getTaskPhotos(task.id).length;
    if (task.action_type !== 'inspection_defect' || count === 0) {
      return null;
    }

    return (
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-xs">
        <Camera className="h-3 w-3 mr-1" />
        {count}
      </Badge>
    );
  };
  const renderInspectionPhotoPreview = (task: Action) => {
    const photos = getTaskPhotos(task.id);
    if (task.action_type !== 'inspection_defect' || photos.length === 0) {
      return null;
    }

    return (
      <InspectionPhotoGallery
        photos={photos}
        title="Defect Photos"
        description="Uploaded photos linked to this defect."
        maxPreview={1}
        compact
        className="mt-2"
      />
    );
  };

  return (
    <TabsContent value="overview" className="space-y-6 mt-0">
      <div className={`flex ${tabletModeEnabled ? 'justify-start' : 'justify-end'}`}>
        <Tabs value={assetTab} onValueChange={onAssetTabChange}>
          <TabsList className={tabletModeEnabled ? 'h-auto flex-wrap gap-2 p-1.5 justify-start' : undefined}>
            <TabsTrigger value="all" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
              <Wrench className="h-4 w-4" />
              All Assets
            </TabsTrigger>
            <TabsTrigger value="van" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
              <Truck className="h-4 w-4" />
              Vans
            </TabsTrigger>
            <TabsTrigger value="plant" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
              <HardHat className="h-4 w-4" />
              Plant
            </TabsTrigger>
            <TabsTrigger value="hgv" className={tabletModeEnabled ? 'gap-2 min-h-11 text-base px-4' : 'gap-2'}>
              <Truck className="h-4 w-4" />
              HGVs
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className={`grid grid-cols-1 md:grid-cols-2 ${tabletModeEnabled ? 'gap-5' : 'gap-4'}`}>
            <div className="space-y-2">
              <Label>Status Filter</Label>
              <Select value={statusFilter} onValueChange={onStatusFilterChange}>
                <SelectTrigger className={`bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}>
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
              <Label>{assetTab === 'plant' ? 'Plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'van' ? 'Van' : 'Asset'} Filter</Label>
              <Select value={vehicleFilter} onValueChange={onVehicleFilterChange}>
                <SelectTrigger className={`bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {assetTab === 'plant' ? 'All Plant' : assetTab === 'hgv' ? 'All HGVs' : assetTab === 'van' ? 'All Vans' : 'All Assets'}
                  </SelectItem>
                  {vehicles
                    .filter(v => assetTab === 'all' ? true : assetTab === 'plant' ? v.asset_type === 'plant' : assetTab === 'hgv' ? v.asset_type === 'hgv' : v.asset_type === 'van')
                    .map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {getAssetDisplay(vehicle)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className={`grid gap-4 ${tabletModeEnabled ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-4'}`}>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="text-muted-foreground">Pending</CardDescription>
            <CardTitle className="text-3xl text-amber-600 dark:text-amber-400">{pendingTasks.length}</CardTitle>
            <p className="text-xs text-muted-foreground">
              High Priority: <span className="font-medium text-red-500">{highPriorityPendingCount}</span>
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="text-muted-foreground">In Progress</CardDescription>
            <CardTitle className="text-3xl text-blue-600 dark:text-blue-400">{inProgressTasks.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="text-muted-foreground">On Hold</CardDescription>
            <CardTitle className="text-3xl text-purple-600 dark:text-purple-400">{onHoldTasks.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription className="text-muted-foreground">Completed</CardDescription>
            <CardTitle className="text-3xl text-green-600 dark:text-green-400">{completedTasks.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <p className="text-muted-foreground">Loading tasks...</p>
        </div>
      ) : tabFilteredTasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No {assetTab === 'plant' ? 'plant' : assetTab === 'hgv' ? 'HGV' : assetTab === 'van' ? 'van' : ''} workshop tasks yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first workshop task or wait for inspection defects
            </p>
            <Button
              onClick={onCreateTask}
              className="bg-workshop hover:bg-workshop-dark text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Task
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {pendingTasks.length > 0 && (
            <div className="border-2 border-amber-500/30 rounded-lg overflow-hidden bg-amber-500/5">
              <button
                onClick={() => onShowPendingChange(!showPending)}
                className="w-full flex items-center justify-between p-4 bg-amber-500/10 hover:bg-amber-500/20 transition-colors border-b-2 border-amber-500/30"
              >
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className={`h-5 w-5 ${pendingHeaderIconClass}`} />
                  Pending Tasks ({pendingTasks.length})
                </h2>
                {showPending ? (
                  <ChevronUp className={`h-5 w-5 ${pendingHeaderIconClass}`} />
                ) : (
                  <ChevronDown className={`h-5 w-5 ${pendingHeaderIconClass}`} />
                )}
              </button>
              {showPending && (
                <div className="space-y-3 p-4">
                {pendingTasks.map((task) => {
                  const isUpdating = updatingStatus.has(task.id);
                  return (
                    <Card
                      key={task.id}
                      className="bg-white dark:bg-slate-900 border-border hover:shadow-lg hover:border-workshop/50 transition-all duration-200 cursor-pointer"
                      onClick={() => onOpenTaskModal(task)}
                    >
                      <CardContent className="pt-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                            <div className="flex-1 w-full">
                              <div className="flex items-center gap-2 mb-2">
                                {getStatusIcon(task.status, task)}
                                <h3 className="font-semibold text-lg text-foreground">
                                  {getVehicleReg(task)}
                                </h3>
                                <Badge variant="outline" className="text-xs">
                                  {getSourceLabel(task)}
                                </Badge>
                                {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                    <Paperclip className="h-3 w-3 mr-1" />
                                    {taskAttachmentCounts.get(task.id)}
                                  </Badge>
                                )}
                                {renderInspectionPhotoBadge(task)}
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
                                <p className="text-sm text-muted-foreground mb-2">{task.description}</p>
                              )}
                              {renderInspectionPhotoPreview(task)}
                              {task.workshop_comments && (
                                <p className="text-sm text-muted-foreground mb-2">
                                  <strong>Notes:</strong> {task.workshop_comments}
                                </p>
                              )}
                            </div>
                            <div className={taskActionGroupClass}>
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenComments(task);
                                }}
                                disabled={isUpdating}
                                size="sm"
                                variant="outline"
                                className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}
                              >
                                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                Comments
                              </Button>
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMarkInProgress(task);
                                }}
                                disabled={isUpdating}
                                size="sm"
                                className={`${taskActionButtonClass} bg-blue-600/80 hover:bg-blue-600 text-white border-0`}
                              >
                                <Clock className="h-3.5 w-3.5 mr-1.5" />
                                In Progress
                              </Button>
                              <Button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMarkComplete(task);
                                }}
                                disabled={isUpdating}
                                size="sm"
                                className={`${taskActionButtonClass} transition-all border-0 bg-green-600 hover:bg-green-700 text-white`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                Complete
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between w-full">
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <span>Created: {formatDate(task.created_at)}</span>
                            </div>
                            {task.action_type === 'workshop_vehicle_task' && (
                              <div className="flex items-center gap-1">
                                <Button
                                  onClick={(e) => { e.stopPropagation(); onEditTask(task); }}
                                  disabled={isUpdating}
                                  size="sm"
                                  variant="ghost"
                                  className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800`}
                                  title="Edit task"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }}
                                  disabled={isUpdating}
                                  size="sm"
                                  variant="ghost"
                                  className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-red-500 hover:text-red-400 hover:bg-red-950/50`}
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

          {inProgressTasks.length > 0 && (
            <div className="border-2 border-blue-500/30 rounded-lg overflow-hidden bg-blue-500/5">
              <button
                onClick={() => onShowInProgressChange(!showInProgress)}
                className="w-full flex items-center justify-between p-4 bg-blue-500/10 hover:bg-blue-500/20 transition-colors border-b-2 border-blue-500/30"
              >
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
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
                      onClick={() => onOpenTaskModal(task)}
                    >
                      <CardContent className="pt-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                            <div className="flex-1 w-full">
                              <div className="flex items-center gap-2 mb-2">
                                {getStatusIcon(task.status)}
                                <h3 className="font-semibold text-lg text-foreground">{getVehicleReg(task)}</h3>
                                <Badge variant="outline" className="text-xs">{getSourceLabel(task)}</Badge>
                                {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                    <Paperclip className="h-3 w-3 mr-1" />
                                    {taskAttachmentCounts.get(task.id)}
                                  </Badge>
                                )}
                                {renderInspectionPhotoBadge(task)}
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
                                <p className="text-sm text-muted-foreground mb-2">{task.description}</p>
                              )}
                              {renderInspectionPhotoPreview(task)}
                              {task.logged_comment && (
                                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-2">
                                  <p className="text-sm text-blue-300">
                                    <strong>Progress Note:</strong> {task.logged_comment}
                                  </p>
                                </div>
                              )}
                              {task.workshop_comments && (
                                <p className="text-sm text-muted-foreground mb-2">
                                  <strong>Notes:</strong> {task.workshop_comments}
                                </p>
                              )}
                            </div>
                            <div className={taskActionGroupClass}>
                              <Button onClick={(e) => { e.stopPropagation(); onOpenComments(task); }} disabled={isUpdating} size="sm" variant="outline" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                Comments
                              </Button>
                              <Button onClick={(e) => { e.stopPropagation(); onUndoLogged(task.id); }} variant="outline" disabled={isUpdating} size="sm" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                                Undo
                              </Button>
                              {task.status === 'logged' && (
                                <Button onClick={(e) => { e.stopPropagation(); onMarkOnHold(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} bg-purple-600/80 hover:bg-purple-600 text-white border-0`}>
                                  <Pause className="h-3.5 w-3.5 mr-1.5" />
                                  On Hold
                                </Button>
                              )}
                              {task.status === 'on_hold' && (
                                <Button onClick={(e) => { e.stopPropagation(); onResumeTask(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} bg-blue-600/80 hover:bg-blue-600 text-white border-0`}>
                                  <Clock className="h-3.5 w-3.5 mr-1.5" />
                                  Resume
                                </Button>
                              )}
                              <Button onClick={(e) => { e.stopPropagation(); onMarkComplete(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} transition-all border-0 bg-green-600 hover:bg-green-700 text-white`}>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                Complete
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between w-full">
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <span>Created: {formatDate(task.created_at)}</span>
                              {task.logged_at && (
                                <span className="text-blue-400">
                                  Started: {formatDate(task.logged_at)}
                                </span>
                              )}
                            </div>
                            {task.action_type === 'workshop_vehicle_task' && (
                              <div className="flex items-center gap-1">
                                <Button onClick={(e) => { e.stopPropagation(); onEditTask(task); }} disabled={isUpdating} size="sm" variant="ghost" className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800`} title="Edit task">
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

          {onHoldTasks.length > 0 && (
            <div className="border-2 border-purple-500/30 rounded-lg overflow-hidden bg-purple-500/5">
              <button
                onClick={() => onShowOnHoldChange(!showOnHold)}
                className="w-full flex items-center justify-between p-4 bg-purple-500/10 hover:bg-purple-500/20 transition-colors border-b-2 border-purple-500/30"
              >
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
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
                    <Card key={task.id} className="bg-white dark:bg-slate-900 border-purple-500/30 dark:border-purple-500/30 hover:shadow-lg hover:border-purple-500/50 transition-all duration-200 cursor-pointer" onClick={() => onOpenTaskModal(task)}>
                      <CardContent className="pt-6">
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                            <div className="flex-1 w-full">
                              <div className="flex items-center gap-2 mb-2">
                                {getStatusIcon(task.status)}
                                <h3 className="font-semibold text-lg text-foreground">{getVehicleReg(task)}</h3>
                                <Badge variant="outline" className="text-xs">{getSourceLabel(task)}</Badge>
                                {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                    <Paperclip className="h-3 w-3 mr-1" />
                                    {taskAttachmentCounts.get(task.id)}
                                  </Badge>
                                )}
                                {renderInspectionPhotoBadge(task)}
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
                                <p className="text-sm text-muted-foreground mb-2">{task.description}</p>
                              )}
                              {renderInspectionPhotoPreview(task)}
                              {task.logged_comment && (
                                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-2">
                                  <p className="text-sm text-purple-200 font-medium">Progress Note: {task.logged_comment}</p>
                                </div>
                              )}
                              {task.action_type === 'workshop_vehicle_task' && task.workshop_comments && (
                                <p className="text-sm text-muted-foreground">{task.workshop_comments}</p>
                              )}
                            </div>
                            <div className={taskActionGroupClass}>
                              <Button onClick={(e) => { e.stopPropagation(); onOpenComments(task); }} disabled={isUpdating} size="sm" variant="outline" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                Comments
                              </Button>
                              <Button onClick={(e) => { e.stopPropagation(); onResumeTask(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} transition-all border-0 bg-workshop hover:bg-workshop-dark text-white`}>
                                <Clock className="h-3.5 w-3.5 mr-1.5" />
                                Resume
                              </Button>
                              <Button onClick={(e) => { e.stopPropagation(); onMarkComplete(task); }} disabled={isUpdating} size="sm" className={`${taskActionButtonClass} transition-all border-0 bg-green-600 hover:bg-green-700 text-white`}>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                                Complete
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between w-full">
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                              <span>Created: {formatDate(task.created_at)}</span>
                              {task.logged_at && (
                                <span>Placed On Hold: {formatDate(task.logged_at)}</span>
                              )}
                            </div>
                            {task.action_type === 'workshop_vehicle_task' && (
                              <div className="flex items-center gap-1">
                                <Button onClick={(e) => { e.stopPropagation(); onEditTask(task); }} disabled={isUpdating} size="sm" variant="ghost" className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800`} title="Edit task">
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }} disabled={isUpdating} size="sm" variant="ghost" className={`${tabletModeEnabled ? 'h-11 w-11' : 'h-7 w-7'} p-0 text-red-500 hover:text-red-400 hover:bg-red-950/50`} title="Delete task">
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

          {completedTasks.length > 0 && (
            <div className="border-2 border-green-500/30 rounded-lg overflow-hidden bg-green-500/5">
              <button
                onClick={() => onShowCompletedChange(!showCompleted)}
                className="w-full flex items-center justify-between p-4 bg-green-500/10 hover:bg-green-500/20 transition-colors border-b-2 border-green-500/30"
              >
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
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
                    className="bg-white dark:bg-slate-900 border-border opacity-70 hover:opacity-90 transition-opacity cursor-pointer"
                    onClick={() => onOpenTaskModal(task)}
                  >
                    <CardContent className="pt-6">
                      <div className="flex flex-col items-start gap-4">
                        <div className="flex-1 space-y-2 w-full">
                          <div className="flex flex-col lg:flex-row items-start justify-between gap-4">
                            <div className="flex-1 w-full">
                              <div className="flex items-center gap-2 mb-2">
                                <CheckCircle2 className="h-5 w-5 text-green-400" />
                                <h3 className="font-semibold text-lg text-foreground">{getVehicleReg(task)}</h3>
                                <Badge variant="outline" className="text-xs">
                                  {getSourceLabel(task)}
                                </Badge>
                                {taskAttachmentCounts.get(task.id) && taskAttachmentCounts.get(task.id)! > 0 && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30 text-xs">
                                    <Paperclip className="h-3 w-3 mr-1" />
                                    {taskAttachmentCounts.get(task.id)}
                                  </Badge>
                                )}
                                {renderInspectionPhotoBadge(task)}
                              </div>
                              <div className="flex flex-wrap gap-2 mb-1">
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
                                {!task.workshop_task_subcategories && task.workshop_task_categories && (
                                  <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                                    {task.workshop_task_categories.name}
                                  </Badge>
                                )}
                              </div>
                              {task.action_type === 'inspection_defect' && task.description && (
                                <p className="text-sm text-muted-foreground mb-2">{task.description}</p>
                              )}
                              {renderInspectionPhotoPreview(task)}
                              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                {task.actioned_at && (
                                  <span className="text-green-400">
                                    Completed: {formatDate(task.actioned_at)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className={taskActionGroupClass}>
                              <Button onClick={(e) => { e.stopPropagation(); onOpenComments(task); }} size="sm" variant="outline" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
                                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                Comments
                              </Button>
                              <Button onClick={(e) => { e.stopPropagation(); onUndoComplete(task.id); }} size="sm" variant="outline" className={`${taskActionButtonClass} border-slate-600 text-muted-foreground hover:text-white hover:bg-slate-800`}>
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
  );
}
