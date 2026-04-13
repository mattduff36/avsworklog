import type { StatusHistoryEvent } from '@/lib/utils/workshopTaskStatusHistory';

type TimelineAuthor = {
  id: string;
  full_name: string;
} | null;

export interface WorkshopTaskTimelineTask {
  id: string;
  created_at: string;
  created_by?: string | null;
  logged_at?: string | null;
  logged_by?: string | null;
  logged_comment?: string | null;
  actioned_at?: string | null;
  actioned_by?: string | null;
  actioned_comment?: string | null;
  actioned_signature_data?: string | null;
  actioned_signed_at?: string | null;
  status_history?: unknown[] | null;
  profiles_created?: {
    full_name: string | null;
  } | null;
  profiles?: {
    full_name: string | null;
  } | null;
}

export interface WorkshopTaskTimelineComment {
  id: string;
  body: string;
  created_at: string;
  updated_at?: string | null;
  author?: TimelineAuthor;
}

export type WorkshopTaskTimelineItem =
  | {
      key: string;
      timelineItemId: 'created';
      type: 'created';
      created_at: string;
      author?: string | null;
      body?: string | null;
    }
  | {
      key: string;
      timelineItemId: string;
      type: 'status';
      created_at: string;
      author?: string | null;
      status: StatusHistoryEvent['status'];
      body?: string | null;
      meta?: StatusHistoryEvent['meta'];
    }
  | {
      key: string;
      timelineItemId: string;
      type: 'comment';
      created_at: string;
      author?: string | null;
      body: string;
      updated_at?: string | null;
    };

const STARTED_EVENT_STATUSES: StatusHistoryEvent['status'][] = ['logged', 'resumed', 'on_hold'];

function isStatusHistoryEvent(value: unknown): value is StatusHistoryEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StatusHistoryEvent>;
  return (
    typeof candidate.id === 'string' &&
    candidate.type === 'status' &&
    typeof candidate.status === 'string' &&
    typeof candidate.created_at === 'string'
  );
}

export function buildFallbackStatusHistory(task: WorkshopTaskTimelineTask): StatusHistoryEvent[] {
  const items: StatusHistoryEvent[] = [];

  if (task.logged_at) {
    items.push({
      id: `status:logged:${task.id}`,
      type: 'status',
      status: 'logged',
      created_at: task.logged_at,
      author_id: task.logged_by || null,
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
      author_id: task.actioned_by || null,
      author_name: null,
      body: task.actioned_comment || 'Marked as complete',
      meta: {
        signature_data: task.actioned_signature_data || undefined,
        signed_at: task.actioned_signed_at || undefined,
      },
    });
  }

  return items;
}

export function getTaskStatusHistory(task: WorkshopTaskTimelineTask): StatusHistoryEvent[] {
  return Array.isArray(task.status_history) && task.status_history.length > 0
    ? task.status_history.filter(isStatusHistoryEvent)
    : buildFallbackStatusHistory(task);
}

export function ensureMilestoneStatusHistory(task: WorkshopTaskTimelineTask): StatusHistoryEvent[] {
  const history = [...getTaskStatusHistory(task)];
  const hasStarted = history.some((event) => STARTED_EVENT_STATUSES.includes(event.status));
  const hasCompleted = history.some((event) => event.status === 'completed');

  if (!hasStarted && task.logged_at) {
    history.push({
      id: `status:logged:${task.id}`,
      type: 'status',
      status: 'logged',
      created_at: task.logged_at,
      author_id: task.logged_by || null,
      author_name: null,
      body: task.logged_comment || 'Marked as in progress',
    });
  }

  if (!hasCompleted && task.actioned_at) {
    history.push({
      id: `status:completed:${task.id}`,
      type: 'status',
      status: 'completed',
      created_at: task.actioned_at,
      author_id: task.actioned_by || null,
      author_name: null,
      body: task.actioned_comment || 'Marked as complete',
      meta: {
        signature_data: task.actioned_signature_data || undefined,
        signed_at: task.actioned_signed_at || undefined,
      },
    });
  }

  return history;
}

export function buildWorkshopTaskTimelineItems(
  task: WorkshopTaskTimelineTask,
  comments: WorkshopTaskTimelineComment[] = []
): WorkshopTaskTimelineItem[] {
  const statusHistory = getTaskStatusHistory(task);
  const createdBy =
    task.profiles_created?.full_name || task.profiles?.full_name || 'Unknown';

  const items: WorkshopTaskTimelineItem[] = [
    {
      key: `created:${task.id}`,
      timelineItemId: 'created',
      type: 'created',
      created_at: task.created_at,
      author: createdBy,
      body: null,
    },
    ...statusHistory.map((event) => ({
      key: event.id,
      timelineItemId: event.id,
      type: 'status' as const,
      created_at: event.created_at,
      author: event.author_name || 'Unknown',
      status: event.status,
      body: event.body || null,
      meta: event.meta,
    })),
    ...comments.map((comment) => ({
      key: comment.id,
      timelineItemId: comment.id,
      type: 'comment' as const,
      created_at: comment.created_at,
      author: comment.author?.full_name || 'Unknown',
      body: comment.body,
      updated_at: comment.updated_at,
    })),
  ];

  items.sort((a, b) => {
    const dateA = new Date(a.created_at).getTime();
    const dateB = new Date(b.created_at).getTime();
    return dateA - dateB;
  });

  return items;
}

export function resolveMilestoneStatusEvent(
  task: WorkshopTaskTimelineTask,
  timelineItemId: string
): StatusHistoryEvent | null {
  const history = ensureMilestoneStatusHistory(task);

  if (timelineItemId === 'started') {
    if (task.logged_at) {
      const byScalarMatch = history.find((event) => event.created_at === task.logged_at);
      if (byScalarMatch) {
        return byScalarMatch;
      }
    }

    const startedEvents = history
      .filter((event) => STARTED_EVENT_STATUSES.includes(event.status))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return startedEvents.at(-1) ?? null;
  }

  if (timelineItemId === 'completed') {
    if (task.actioned_at) {
      const byScalarMatch = history.find((event) => event.created_at === task.actioned_at);
      if (byScalarMatch) {
        return byScalarMatch;
      }
    }

    const completedEvents = history
      .filter((event) => event.status === 'completed')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return completedEvents.at(-1) ?? null;
  }

  return history.find((event) => event.id === timelineItemId) ?? null;
}

export function getLatestStartedEvent(history: StatusHistoryEvent[]): StatusHistoryEvent | null {
  return (
    [...history]
      .filter((event) => STARTED_EVENT_STATUSES.includes(event.status))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .at(-1) ?? null
  );
}

export function getLatestCompletedEvent(history: StatusHistoryEvent[]): StatusHistoryEvent | null {
  return (
    [...history]
      .filter((event) => event.status === 'completed')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .at(-1) ?? null
  );
}
