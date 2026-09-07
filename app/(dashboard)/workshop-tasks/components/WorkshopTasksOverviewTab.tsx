import { type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PanelLoader } from '@/components/ui/panel-loader';
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
  Loader2,
  Trash2,
  Truck,
  Undo2,
  Wrench,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { cn } from '@/lib/utils/cn';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { WorkshopTaskLocationButton } from '@/components/workshop-tasks/WorkshopTaskLocationButton';
import { WorkshopHistoricalTasksSection } from './WorkshopHistoricalTasksSection';
import type { Action, AssetTab, Vehicle, WorkshopTaskStatusFilter, WorkshopTaskTileFilter } from '../types';
import type { InspectionPhoto } from '@/types/inspection';

interface WorkshopTasksOverviewTabProps {
  assetTab: AssetTab;
  onAssetTabChange: (tab: string) => void;
  statusFilter: WorkshopTaskTileFilter;
  onStatusFilterChange: (status: WorkshopTaskTileFilter) => void;
  vehicleFilter: string;
  onVehicleFilterChange: (vehicleId: string) => void;
  vehicles: Vehicle[];
  loading: boolean;
  tabFilteredTasks: Action[];
  taskCount: number;
  pendingTaskCount: number;
  pendingTasks: Action[];
  highPriorityPendingCount: number;
  inProgressTaskCount: number;
  inProgressTasks: Action[];
  onHoldTaskCount: number;
  onHoldTasks: Action[];
  completedTaskCount: number;
  completedTasks: Action[];
  archivedTaskCount: number;
  archivedTasks: Action[];
  archivedLoading?: boolean;
  showPending: boolean;
  onShowPendingChange: (show: boolean) => void;
  showInProgress: boolean;
  onShowInProgressChange: (show: boolean) => void;
  showOnHold: boolean;
  onShowOnHoldChange: (show: boolean) => void;
  showCompleted: boolean;
  onShowCompletedChange: (show: boolean) => void;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  updatingStatus: Set<string>;
  taskAttachmentCounts: Map<string, number>;
  taskInspectionPhotos: Record<string, InspectionPhoto[]>;
  getStatusIcon: (status: string, task?: Action) => ReactNode;
  getVehicleReg: (task: Action) => string;
  getSourceLabel: (task: Action) => string;
  getAssetDisplay: (vehicle: Vehicle, options?: { forSelect?: boolean }) => string;
  onCreateTask: () => void;
  onOpenTaskModal: (task: Action) => void;
  onOpenComments: (task: Action) => void;
  onOpenWhereabouts: (task: Action) => void;
  onMarkInProgress: (task: Action) => void;
  onMarkComplete: (task: Action) => void;
  onMarkOnHold: (task: Action) => void;
  onResumeTask: (task: Action) => void;
  onUndoLogged: (taskId: string) => void;
  onUndoComplete: (taskId: string) => void;
  canCorrectService?: boolean;
  onCorrectService?: (task: Action) => void;
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
  taskCount,
  pendingTaskCount,
  pendingTasks,
  highPriorityPendingCount,
  inProgressTaskCount,
  inProgressTasks,
  onHoldTaskCount,
  onHoldTasks,
  completedTaskCount,
  completedTasks,
  archivedTaskCount,
  archivedTasks,
  archivedLoading = false,
  showPending,
  onShowPendingChange,
  showInProgress,
  onShowInProgressChange,
  showOnHold,
  onShowOnHoldChange,
  showCompleted,
  onShowCompletedChange,
  showArchived,
  onShowArchivedChange,
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
  onOpenWhereabouts,
  onMarkInProgress,
  onMarkComplete,
  onMarkOnHold,
  onResumeTask,
  onUndoLogged,
  onUndoComplete,
  canCorrectService = false,
  onCorrectService,
  onEditTask,
  onDeleteTask,
}: WorkshopTasksOverviewTabProps) {
  const visibleArchivedCount = statusFilter === 'all' || statusFilter === 'archived' ? archivedTaskCount : 0;
  const showInitialLoading = loading && tabFilteredTasks.length === 0 && archivedTaskCount === 0;
  const { tabletModeEnabled } = useTabletMode();
  const hasHighPriorityPending = highPriorityPendingCount > 0;
  const pendingHeaderIconClass = hasHighPriorityPending ? 'text-red-500' : 'text-amber-400';
  const taskActionButtonClass = tabletModeEnabled ? 'min-h-11 px-4 text-base' : 'h-9 px-3 text-xs';
  const taskActionGroupClass = tabletModeEnabled
    ? 'flex flex-wrap items-center gap-1.5 w-full lg:w-auto'
    : 'flex flex-wrap items-center gap-1.5 w-full md:w-auto';
  const cardIconActionClass = tabletModeEnabled
    ? 'h-11 w-11 p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800'
    : 'h-7 w-7 p-0 text-muted-foreground hover:text-muted-foreground hover:bg-slate-800';
  const cardDeleteActionClass = tabletModeEnabled
    ? 'h-11 w-11 p-0 text-red-500 hover:text-red-400 hover:bg-red-950/50'
    : 'h-7 w-7 p-0 text-red-500 hover:text-red-400 hover:bg-red-950/50';

  const renderCardUtilityActions = (
    task: Action,
    isUpdating: boolean,
    options: { showEdit?: boolean; showDelete?: boolean } = {}
  ) => {
    const canMutateWorkshopTask = task.action_type === 'workshop_vehicle_task';
    return (
      <div className="flex items-center gap-1">
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onOpenComments(task);
          }}
          disabled={isUpdating}
          size="sm"
          variant="ghost"
          className={cardIconActionClass}
          title="Comments"
          aria-label="Comments"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
        <WorkshopTaskLocationButton
          task={task}
          onOpen={() => onOpenWhereabouts(task)}
          disabled={isUpdating}
          iconOnly
          variant="ghost"
          className={cardIconActionClass}
        />
        {options.showEdit && canMutateWorkshopTask ? (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onEditTask(task);
            }}
            disabled={isUpdating}
            size="sm"
            variant="ghost"
            className={cardIconActionClass}
            title="Edit task"
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {options.showDelete && canMutateWorkshopTask ? (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteTask(task);
            }}
            disabled={isUpdating}
            size="sm"
            variant="ghost"
            className={cardDeleteActionClass}
            title="Delete task"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    );
  };
  const getTaskPhotos = (taskId: string) => taskInspectionPhotos[taskId] ?? [];
  const statusSelectValue: WorkshopTaskStatusFilter = statusFilter === 'high_priority' ? 'pending' : statusFilter;
  const visibleTaskCount = pendingTasks.length + inProgressTasks.length + onHoldTasks.length + completedTasks.length + visibleArchivedCount;

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

  const getSourceBadgeClass = (task: Action) => {
    if (task.action_type !== 'inspection_defect') {
      return 'bg-transparent text-workshop border-workshop';
    }

    if (task.hgv_id) {
      return 'bg-transparent text-hgv-inspection border-hgv-inspection';
    }

    if (task.plant_id) {
      return 'bg-transparent text-plant-inspection border-plant-inspection';
    }

    return 'bg-transparent text-inspection border-inspection';
  };

  const renderSourceBadge = (task: Action, label = getSourceLabel(task)) => (
    <Badge variant="outline" className={`text-xs font-semibold shadow-sm ${getSourceBadgeClass(task)}`}>
      {label}
    </Badge>
  );

  const renderInspectionDescription = (task: Action) => (
    task.action_type === 'inspection_defect' && task.description ? (
      <p className="mb-2 whitespace-pre-line text-sm text-muted-foreground">{task.description}</p>
    ) : null
  );

  const historicalSectionProps = {
    taskAttachmentCounts,
    taskInspectionPhotos,
    getVehicleReg,
    getSourceLabel,
    onOpenTaskModal,
    onOpenComments,
    onOpenWhereabouts,
    onUndoComplete,
    canCorrectService,
    onCorrectService,
    onEditTask,
  };

  const renderStatusTile = ({
    filter,
    label,
    count,
    countClassName,
    activeClassName,
    ariaLabel,
  }: {
    filter: WorkshopTaskTileFilter;
    label: string;
    count: number;
    countClassName: string;
    activeClassName: string;
    ariaLabel: string;
  }) => {
    const isActive = statusFilter === filter;

    return (
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isActive}
        onClick={() => onStatusFilterChange(filter)}
        className={cn(
          'rounded-lg border bg-slate-900 text-card-foreground shadow-sm text-left transition-all duration-200',
          'cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isActive ? activeClassName : 'border-border hover:border-workshop/50 hover:bg-slate-800/80'
        )}
      >
        <CardHeader className="pb-3">
          <CardDescription className="text-muted-foreground">{label}</CardDescription>
          <CardTitle className={`text-3xl ${countClassName}`}>{count}</CardTitle>
        </CardHeader>
      </button>
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
              <Select value={statusSelectValue} onValueChange={(value) => onStatusFilterChange(value as WorkshopTaskStatusFilter)}>
                <SelectTrigger className={`bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900 ${tabletModeEnabled ? 'min-h-11 text-base' : ''}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="logged">In Progress</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
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
                      {getAssetDisplay(vehicle, { forSelect: true })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        className={`grid gap-4 ${
          tabletModeEnabled
            ? hasHighPriorityPending
              ? 'grid-cols-2 xl:grid-cols-7'
              : 'grid-cols-2 xl:grid-cols-6'
            : hasHighPriorityPending
              ? 'grid-cols-7'
              : 'grid-cols-6'
        }`}
      >
        {renderStatusTile({
          filter: 'all',
          label: 'All Tasks',
          count: taskCount,
          countClassName: 'text-workshop',
          activeClassName: 'border-workshop bg-[hsl(var(--workshop-primary)/0.28)] hover:bg-[hsl(var(--workshop-primary)/0.34)] ring-1 ring-[hsl(var(--workshop-primary)/0.45)]',
          ariaLabel: 'Show all workshop tasks',
        })}
        {hasHighPriorityPending && (
          renderStatusTile({
            filter: 'high_priority',
            label: 'High Priority',
            count: highPriorityPendingCount,
            countClassName: 'text-red-500',
            activeClassName: 'border-red-500/70 bg-red-500/15 ring-1 ring-red-500/40',
            ariaLabel: 'Show high priority workshop tasks',
          })
        )}
        {renderStatusTile({
          filter: 'pending',
          label: 'Pending',
          count: pendingTaskCount,
          countClassName: 'text-amber-600 dark:text-amber-400',
          activeClassName: 'border-amber-500/70 bg-amber-500/15 ring-1 ring-amber-500/40',
          ariaLabel: 'Show pending workshop tasks',
        })}
        {renderStatusTile({
          filter: 'logged',
          label: 'In Progress',
          count: inProgressTaskCount,
          countClassName: 'text-blue-600 dark:text-blue-400',
          activeClassName: 'border-blue-500/70 bg-blue-500/15 ring-1 ring-blue-500/40',
          ariaLabel: 'Show in progress workshop tasks',
        })}
        {renderStatusTile({
          filter: 'on_hold',
          label: 'On Hold',
          count: onHoldTaskCount,
          countClassName: 'text-purple-600 dark:text-purple-400',
          activeClassName: 'border-purple-500/70 bg-purple-500/15 ring-1 ring-purple-500/40',
          ariaLabel: 'Show on hold workshop tasks',
        })}
        {renderStatusTile({
          filter: 'completed',
          label: 'Completed',
          count: completedTaskCount,
          countClassName: 'text-green-600 dark:text-green-400',
          activeClassName: 'border-green-500/70 bg-green-500/15 ring-1 ring-green-500/40',
          ariaLabel: 'Show completed workshop tasks',
        })}
        {renderStatusTile({
          filter: 'archived',
          label: 'Archived',
          count: archivedTaskCount,
          countClassName: 'text-slate-500 dark:text-slate-400',
          activeClassName: 'border-slate-500/70 bg-slate-500/15 ring-1 ring-slate-500/40',
          ariaLabel: 'Show archived workshop tasks',
        })}
      </div>

      {showInitialLoading ? (
        <PanelLoader message="Loading tasks..." accent="workshop" className="min-h-[400px]" />
      ) : tabFilteredTasks.length === 0 && archivedTaskCount === 0 ? (
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
      ) : visibleTaskCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No tasks match this status filter</h3>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing tasks...
            </div>
          )}
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
                                {getStatusIcon(task.status ?? 'pending', task)}
                                <h3 className="font-semibold text-lg text-foreground">
                                  {getVehicleReg(task)}
                                </h3>
                                {renderSourceBadge(task)}
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
                              {renderInspectionDescription(task)}
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
                                  onMarkOnHold(task);
                                }}
                                disabled={isUpdating}
                                size="sm"
                                className={`${taskActionButtonClass} bg-purple-600/80 hover:bg-purple-600 text-white border-0`}
                              >
                                <Pause className="h-3.5 w-3.5 mr-1.5" />
                                On Hold
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
                            {renderCardUtilityActions(task, isUpdating, { showEdit: true, showDelete: true })}
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
                                {getStatusIcon(task.status ?? 'pending')}
                                <h3 className="font-semibold text-lg text-foreground">{getVehicleReg(task)}</h3>
                                {renderSourceBadge(task)}
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
                              {renderInspectionDescription(task)}
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
                            {renderCardUtilityActions(task, isUpdating, { showEdit: true })}
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
                                {getStatusIcon(task.status ?? 'pending')}
                                <h3 className="font-semibold text-lg text-foreground">{getVehicleReg(task)}</h3>
                                {renderSourceBadge(task)}
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
                              {renderInspectionDescription(task)}
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
                            {renderCardUtilityActions(task, isUpdating, { showEdit: true, showDelete: true })}
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

          <WorkshopHistoricalTasksSection
            variant="completed"
            tasks={completedTasks}
            displayCount={completedTasks.length}
            show={showCompleted}
            onShowChange={onShowCompletedChange}
            {...historicalSectionProps}
          />
          <WorkshopHistoricalTasksSection
            variant="archived"
            tasks={archivedTasks}
            displayCount={visibleArchivedCount}
            show={showArchived}
            onShowChange={onShowArchivedChange}
            loading={archivedLoading}
            viewOnly
            {...historicalSectionProps}
          />
        </div>
      )}
    </TabsContent>
  );
}
