'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CheckCircle2,
  Clock,
  Edit,
  Trash2,
  Wrench,
  FileText,
  Pause,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { WorkshopTaskTimeline } from '@/components/workshop-tasks/WorkshopTaskTimeline';
import { TaskAttachmentsSection } from '@/components/workshop-tasks/TaskAttachmentsSection';
import { useWorkshopTaskComments } from '@/lib/hooks/useWorkshopTaskComments';

type Task = {
  id: string;
  status: string;
  action_type: string;
  created_at: string;
  workshop_comments: string | null;
  logged_at: string | null;
  logged_comment: string | null;
  actioned_at: string | null;
  actioned_comment: string | null;
  status_history?: any[] | null;
  workshop_task_categories?: {
    name: string;
  };
  vehicle_inspections?: {
    inspection_date: string;
    vehicles?: {
      reg_number: string;
      nickname: string | null;
    };
    plant?: {
      plant_id: string;
      nickname: string | null;
    };
  };
  vehicles?: {
    reg_number: string;
    nickname: string | null;
  };
  plant?: {
    plant_id: string;
    nickname: string | null;
  };
};

interface WorkshopTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onMarkInProgress: (task: Task) => void;
  onMarkComplete: (task: Task) => void;
  onMarkOnHold: (task: Task) => void;
  onResume: (task: Task) => void;
  isUpdating: boolean;
}

export function WorkshopTaskModal({
  open,
  onOpenChange,
  task,
  onEdit,
  onDelete,
  onMarkInProgress,
  onMarkComplete,
  onMarkOnHold,
  onResume,
  isUpdating,
}: WorkshopTaskModalProps) {
  const { comments: taskComments, loading } = useWorkshopTaskComments({
    taskIds: task ? [task.id] : [],
    enabled: open && !!task,
  });

  if (!task) return null;

  const getVehicleDisplay = () => {
    const getAssetIdLabel = (asset?: { reg_number?: string | null; plant_id?: string | null }) => {
      if (!asset) return 'Unknown';
      if (asset.plant_id) {
        return asset.plant_id;
      }
      if (asset.reg_number) {
        return asset.reg_number;
      }
      return 'Unknown';
    };

    const getAssetDisplay = (asset?: { reg_number?: string | null; plant_id?: string | null; nickname?: string | null }) => {
      if (!asset) return 'Unknown';
      const idLabel = getAssetIdLabel(asset);
      if (asset.nickname) {
        return `${idLabel} (${asset.nickname})`;
      }
      return idLabel;
    };

    // Check direct vehicle or plant reference
    if (task.vehicles) {
      return getAssetDisplay(task.vehicles);
    } else if (task.plant) {
      return getAssetDisplay(task.plant);
    }
    // Check via inspection
    if (task.vehicle_inspections) {
      if (task.vehicle_inspections.vehicles) {
        return getAssetDisplay(task.vehicle_inspections.vehicles);
      } else if (task.vehicle_inspections.plant) {
        return getAssetDisplay(task.vehicle_inspections.plant);
      }
    }
    return 'Unknown Vehicle';
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: {
        label: 'Pending',
        className: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      },
      logged: {
        label: 'In Progress',
        className: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      },
      on_hold: {
        label: 'On Hold',
        className: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      },
      completed: {
        label: 'Completed',
        className: 'bg-green-500/10 text-green-400 border-green-500/30',
      },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const getTaskTypeIcon = () => {
    if (task.action_type === 'inspection_defect') {
      return <FileText className="h-5 w-5 text-blue-400" />;
    }
    return <Wrench className="h-5 w-5 text-workshop" />;
  };

  const getTaskTypeBadge = () => {
    if (task.action_type === 'inspection_defect') {
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
          Inspection Defect
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-workshop/10 text-workshop border-workshop/30">
        Workshop Task
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto border-border">
        <DialogHeader>
          <div className="space-y-4">
            {/* Header with vehicle */}
            <div className="flex items-center gap-3">
              {getTaskTypeIcon()}
              <DialogTitle className="text-2xl font-bold text-white">
                {getVehicleDisplay()}
              </DialogTitle>
            </div>

            {/* Badges row with status on the right */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                {getTaskTypeBadge()}
                {task.workshop_task_categories && (
                  <Badge variant="outline" className="bg-workshop/10 text-workshop border-workshop/30">
                    {task.workshop_task_categories.name}
                  </Badge>
                )}
              </div>
              <div className="flex-shrink-0">
                {getStatusBadge(task.status)}
              </div>
            </div>

            {/* Task Description */}
            {task.workshop_comments && (
              <Card className="bg-slate-800/50 border-border">
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {task.workshop_comments}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              {task.status === 'pending' && (
                <>
                  <Button
                    onClick={() => onMarkInProgress(task)}
                    disabled={isUpdating}
                    size="sm"
                    className="bg-blue-600/80 hover:bg-blue-600 text-white border-0"
                  >
                    <Clock className="h-4 w-4 mr-2" />
                    Mark In Progress
                  </Button>
                  <Button
                    onClick={() => onMarkOnHold(task)}
                    disabled={isUpdating}
                    size="sm"
                    className="bg-purple-600/80 hover:bg-purple-600 text-white border-0"
                  >
                    <Pause className="h-4 w-4 mr-2" />
                    Put On Hold
                  </Button>
                  <Button
                    onClick={() => onMarkComplete(task)}
                    disabled={isUpdating}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white border-0"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark Complete
                  </Button>
                </>
              )}
              {(task.status === 'logged' || task.status === 'on_hold') && (
                <>
                  {task.status === 'logged' && (
                    <Button
                      onClick={() => onMarkOnHold(task)}
                      disabled={isUpdating}
                      size="sm"
                      className="bg-purple-600/80 hover:bg-purple-600 text-white border-0"
                    >
                      <Pause className="h-4 w-4 mr-2" />
                      Put On Hold
                    </Button>
                  )}
                  {task.status === 'on_hold' && (
                    <Button
                      onClick={() => onResume(task)}
                      disabled={isUpdating}
                      size="sm"
                      className="bg-blue-600/80 hover:bg-blue-600 text-white border-0"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      Resume
                    </Button>
                  )}
                  <Button
                    onClick={() => onMarkComplete(task)}
                    disabled={isUpdating}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white border-0"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark Complete
                  </Button>
                </>
              )}
              {task.action_type === 'workshop_vehicle_task' && task.status !== 'completed' && (
                <>
                  <Button
                    onClick={() => onEdit(task)}
                    disabled={isUpdating}
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    onClick={() => onDelete(task)}
                    disabled={isUpdating}
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300 hover:bg-accent"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Attachments Section */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-white mb-4">Attachments</h3>
          <TaskAttachmentsSection
            taskId={task.id}
            taskStatus={task.status}
          />
        </div>

        {/* Timeline Section */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-white mb-4">Activity Timeline</h3>
          
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full bg-slate-800" />
              ))}
            </div>
          ) : (
            <WorkshopTaskTimeline
              task={task}
              comments={taskComments[task.id] || []}
            />
          )}
        </div>

        {/* Task Metadata */}
        <div className="mt-6 pt-6 border-t border-border">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Created:</span>
              <span className="ml-2 text-muted-foreground">{formatDate(task.created_at)}</span>
            </div>
            {task.logged_at && (
              <div>
                <span className="text-muted-foreground">Started:</span>
                <span className="ml-2 text-blue-400">{formatDate(task.logged_at)}</span>
              </div>
            )}
            {task.actioned_at && (
              <div>
                <span className="text-muted-foreground">Completed:</span>
                <span className="ml-2 text-green-400">{formatDate(task.actioned_at)}</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
