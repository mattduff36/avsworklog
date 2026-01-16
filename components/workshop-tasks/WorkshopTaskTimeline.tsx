import {
  CheckCircle2,
  Clock,
  MessageSquare,
  Pause,
  Play,
  Undo2,
  User,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/date';
import { StatusHistoryEvent } from '@/lib/utils/workshopTaskStatusHistory';

type WorkshopTaskComment = {
  id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  author: {
    id: string;
    full_name: string;
  } | null;
};

type WorkshopTaskTimelineTask = {
  id: string;
  created_at: string;
  logged_at?: string | null;
  logged_comment?: string | null;
  actioned_at?: string | null;
  actioned_comment?: string | null;
  status_history?: StatusHistoryEvent[] | null;
  profiles_created?: {
    full_name: string;
  } | null;
  profiles?: {
    full_name: string | null;
  } | null;
};

type TimelineItem =
  | {
      id: string;
      type: 'created';
      created_at: string;
      author?: string | null;
      body?: string | null;
    }
  | {
      id: string;
      type: 'status';
      created_at: string;
      author?: string | null;
      status: StatusHistoryEvent['status'];
      body?: string | null;
      meta?: StatusHistoryEvent['meta'];
    }
  | {
      id: string;
      type: 'comment';
      created_at: string;
      author?: string | null;
      body: string;
      updated_at?: string | null;
    };

const getStatusConfig = (status: StatusHistoryEvent['status']) => {
  switch (status) {
    case 'logged':
      return {
        icon: <Clock className="h-4 w-4 text-blue-400 mt-0.5" />,
        dotClass: 'bg-blue-500',
        label: 'marked in progress',
      };
    case 'on_hold':
      return {
        icon: <Pause className="h-4 w-4 text-purple-400 mt-0.5" />,
        dotClass: 'bg-purple-500',
        label: 'placed on hold',
      };
    case 'resumed':
      return {
        icon: <Play className="h-4 w-4 text-blue-400 mt-0.5" />,
        dotClass: 'bg-blue-500',
        label: 'resumed task',
      };
    case 'completed':
      return {
        icon: <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5" />,
        dotClass: 'bg-green-500',
        label: 'marked complete',
      };
    case 'undo':
      return {
        icon: <Undo2 className="h-4 w-4 text-slate-400 mt-0.5" />,
        dotClass: 'bg-slate-500',
        label: 'undid status change',
      };
    case 'pending':
    default:
      return {
        icon: <Clock className="h-4 w-4 text-slate-400 mt-0.5" />,
        dotClass: 'bg-slate-500',
        label: 'set to pending',
      };
  }
};

const buildFallbackStatusHistory = (task: WorkshopTaskTimelineTask): StatusHistoryEvent[] => {
  const items: StatusHistoryEvent[] = [];
  if (task.logged_at) {
    items.push({
      id: `status:logged:${task.id}`,
      type: 'status',
      status: 'logged',
      created_at: task.logged_at,
      author_id: null,
      author_name: null,
      body: task.logged_comment || 'Marked as in progress',
    });
  }
  if (task.actioned_at) {
    items.push({
      id: `status:completed:${task.id}`,
      type: 'status',
      status: 'completed',
      created_at: task.actioned_at,
      author_id: null,
      author_name: null,
      body: task.actioned_comment || 'Marked as complete',
    });
  }
  return items;
};

export function WorkshopTaskTimeline({
  task,
  comments = [],
}: {
  task: WorkshopTaskTimelineTask;
  comments?: WorkshopTaskComment[];
}) {
  const statusHistory =
    Array.isArray(task.status_history) && task.status_history.length > 0
      ? task.status_history
      : buildFallbackStatusHistory(task);

  const createdBy =
    task.profiles_created?.full_name || task.profiles?.full_name || 'Unknown';

  const timelineItems: TimelineItem[] = [
    {
      id: `created:${task.id}`,
      type: 'created',
      created_at: task.created_at,
      author: createdBy,
      body: null,
    },
    ...statusHistory.map((event) => ({
      id: event.id,
      type: 'status' as const,
      created_at: event.created_at,
      author: event.author_name || 'Unknown',
      status: event.status,
      body: event.body || null,
      meta: event.meta,
    })),
    ...comments.map((comment) => ({
      id: comment.id,
      type: 'comment' as const,
      created_at: comment.created_at,
      author: comment.author?.full_name || 'Unknown',
      body: comment.body,
      updated_at: comment.updated_at,
    })),
  ];

  timelineItems.sort((a, b) => {
    const dateA = new Date(a.created_at).getTime();
    const dateB = new Date(b.created_at).getTime();
    return dateA - dateB;
  });

  return (
    <div className="space-y-3 border-l-2 border-slate-700 pl-4 ml-2">
      {timelineItems.map((item) => {
        if (item.type === 'created') {
          return (
            <div key={item.id} className="relative">
              <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-slate-700 border-2 border-slate-900"></div>
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.author || 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">created task</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(item.created_at)}
                  </p>
                </div>
              </div>
            </div>
          );
        }

        if (item.type === 'status') {
          const config = getStatusConfig(item.status);
          const undoSuffix =
            item.status === 'undo' && item.meta?.to
              ? `to ${item.meta.to.replace('_', ' ')}`
              : '';

          return (
            <div key={item.id} className="relative">
              <div
                className={`absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full ${config.dotClass} border-2 border-slate-900`}
              ></div>
              <div className="flex items-start gap-3">
                {config.icon}
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.author || 'Unknown'}</span>
                    <span className="text-xs text-muted-foreground">
                      {config.label} {undoSuffix}
                    </span>
                  </div>
                  {item.body && (
                    <p className="text-sm text-slate-300">{item.body}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(item.created_at)}
                  </p>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={item.id} className="relative">
            <div className="absolute -left-[1.3rem] top-1 h-3 w-3 rounded-full bg-slate-700 border-2 border-slate-900"></div>
            <div className="flex items-start gap-3">
              <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{item.author || 'Unknown'}</span>
                  <span className="text-xs text-muted-foreground">added comment</span>
                </div>
                <p className="text-sm text-slate-300">{item.body}</p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(item.created_at)}
                  {item.updated_at && <span className="ml-1">(edited)</span>}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
