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
  AlertTriangle,
  Wrench,
  FileText,
  User,
  Pause,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

// Types from API
type TimelineItem = {
  id: string;
  type: 'status_event' | 'comment';
  created_at: string;
  author: { id: string; full_name: string } | null;
  body: string;
  can_edit?: boolean;
  can_delete?: boolean;
  meta?: {
    status: string;
  };
  updated_at?: string | null;
};

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
  workshop_task_categories?: {
    name: string;
  };
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
  isUpdating,
}: WorkshopTaskModalProps) {
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch timeline when dialog opens
  useEffect(() => {
    if (open && task) {
      fetchTimeline();
    }
  }, [open, task]);

  const fetchTimeline = async () => {
    if (!task) return;
    
    setLoading(true);
    try {
      const response = await fetch(
        `/api/workshop-tasks/tasks/${task.id}/comments?order=asc`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch timeline');
      }

      const data = await response.json();
      setTimeline(data.items || []);
    } catch (error) {
      console.error('Error fetching timeline:', error);
      toast.error('Failed to load timeline');
    } finally {
      setLoading(false);
    }
  };

  if (!task) return null;

  const getVehicleDisplay = () => {
    if (task.vehicles) {
      return task.vehicles.nickname 
        ? `${task.vehicles.reg_number} (${task.vehicles.nickname})`
        : task.vehicles.reg_number;
    }
    if (task.vehicle_inspections?.vehicles) {
      return task.vehicle_inspections.vehicles.nickname
        ? `${task.vehicle_inspections.vehicles.reg_number} (${task.vehicle_inspections.vehicles.nickname})`
        : task.vehicle_inspections.vehicles.reg_number;
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700">
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
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="pt-4">
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">
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
                    className="bg-workshop hover:bg-workshop-dark text-white border-0"
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
                      onClick={() => onMarkInProgress(task)}
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
                    className="bg-workshop hover:bg-workshop-dark text-white border-0"
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
                    className="text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    onClick={() => onDelete(task)}
                    disabled={isUpdating}
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Timeline Section */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-white mb-4">Activity Timeline</h3>
          
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full bg-slate-800" />
              ))}
            </div>
          ) : timeline.length === 0 ? (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="py-8 text-center">
                <p className="text-slate-400">No activity yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {timeline.map((item) => (
                <Card
                  key={item.id}
                  className={`${
                    item.type === 'status_event'
                      ? 'bg-blue-500/10 border-blue-500/30'
                      : 'bg-slate-800/50 border-slate-700'
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {item.type === 'status_event' ? (
                            <AlertTriangle className="h-4 w-4 text-blue-400" />
                          ) : (
                            <User className="h-4 w-4 text-slate-400" />
                          )}
                          <span className="text-sm font-medium text-white">
                            {item.author?.full_name || 'Unknown User'}
                          </span>
                          {item.type === 'status_event' && item.meta && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-xs bg-blue-500/10 text-blue-400 border-blue-500/30"
                            >
                              {item.meta.status === 'logged'
                                ? 'Marked In Progress'
                                : item.meta.status === 'on_hold'
                                ? 'Put On Hold'
                                : 'Marked Complete'}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-slate-300 mt-2">{item.body}</p>
                      </div>
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {formatDistanceToNow(new Date(item.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Task Metadata */}
        <div className="mt-6 pt-6 border-t border-slate-700">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Created:</span>
              <span className="ml-2 text-slate-300">{formatDate(task.created_at)}</span>
            </div>
            {task.logged_at && (
              <div>
                <span className="text-slate-500">Started:</span>
                <span className="ml-2 text-blue-400">{formatDate(task.logged_at)}</span>
              </div>
            )}
            {task.actioned_at && (
              <div>
                <span className="text-slate-500">Completed:</span>
                <span className="ml-2 text-green-400">{formatDate(task.actioned_at)}</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
