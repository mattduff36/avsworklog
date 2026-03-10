import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

type DefectItemInput = {
  id: string;
  item_number: number;
  item_description: string;
  comments: string | null;
};

type StatusHistoryEvent = {
  id?: string;
  type?: string;
  status?: string;
  created_at?: string;
  author_id?: string | null;
  author_name?: string | null;
  body?: string | null;
  meta?: {
    signature_data?: string;
    signed_at?: string;
  };
};

type CompletedDefectTaskRow = {
  id: string;
  status: string;
  inspection_item_id: string | null;
  actioned_at: string | null;
  actioned_by: string | null;
  actioned_comment: string | null;
  actioned_signature_data: string | null;
  actioned_signed_at: string | null;
  status_history: Json | null;
};

type LinkedInspectionItemRow = {
  id: string;
  item_number: number;
  item_description: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
};

export interface DefectWorkshopTimelineEvent {
  id: string;
  status: string;
  created_at: string;
  author_name: string;
  body: string;
  signature_data?: string;
  signed_at?: string;
}

export interface DefectWorkshopTaskDetails {
  task_id: string;
  task_status: string;
  item_number: number;
  item_description: string;
  completed_at: string | null;
  completed_by: string;
  completed_comment: string | null;
  completion_signature_data: string | null;
  completion_signed_at: string | null;
  timeline: DefectWorkshopTimelineEvent[];
}

export interface EnrichedDefectItem extends DefectItemInput {
  workshop_tasks: DefectWorkshopTaskDetails[];
}

function isStatusEvent(value: unknown): value is StatusHistoryEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as StatusHistoryEvent;
  return event.type === 'status' && typeof event.status === 'string' && typeof event.created_at === 'string';
}

function coerceHistory(value: Json | null): StatusHistoryEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStatusEvent);
}

export async function enrichDefectsWithWorkshopCompletion(
  supabase: SupabaseClient<Database>,
  hgvId: string | null,
  defectItems: DefectItemInput[]
): Promise<EnrichedDefectItem[]> {
  if (!hgvId || defectItems.length === 0) {
    return defectItems.map((item) => ({ ...item, workshop_tasks: [] }));
  }

  const { data: actionsData, error: actionsError } = await supabase
    .from('actions')
    .select('id, status, inspection_item_id, actioned_at, actioned_by, actioned_comment, actioned_signature_data, actioned_signed_at, status_history')
    .eq('action_type', 'inspection_defect')
    .eq('hgv_id', hgvId)
    .eq('status', 'completed');
  const typedActionsData = (actionsData || []) as CompletedDefectTaskRow[];

  if (actionsError || typedActionsData.length === 0) {
    return defectItems.map((item) => ({ ...item, workshop_tasks: [] }));
  }

  const linkedInspectionItemIds = Array.from(new Set(typedActionsData.map((task) => task.inspection_item_id).filter(Boolean))) as string[];
  if (linkedInspectionItemIds.length === 0) {
    return defectItems.map((item) => ({ ...item, workshop_tasks: [] }));
  }

  const { data: linkedItems, error: linkedItemsError } = await supabase
    .from('inspection_items')
    .select('id, item_number, item_description')
    .in('id', linkedInspectionItemIds);
  const typedLinkedItems = (linkedItems || []) as LinkedInspectionItemRow[];

  if (linkedItemsError || typedLinkedItems.length === 0) {
    return defectItems.map((item) => ({ ...item, workshop_tasks: [] }));
  }

  const linkedById = new Map(typedLinkedItems.map((item) => [item.id, item]));
  const profileIds = Array.from(
    new Set(
      typedActionsData
        .flatMap((task) => {
          const history = coerceHistory(task.status_history);
          const historyAuthors = history.map((event) => event.author_id).filter(Boolean) as string[];
          return [task.actioned_by, ...historyAuthors];
        })
        .filter(Boolean)
    )
  ) as string[];

  const profileNameById = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', profileIds);
    const typedProfiles = (profiles || []) as ProfileRow[];
    typedProfiles.forEach((profile) => {
      profileNameById.set(profile.id, profile.full_name || 'Unknown');
    });
  }

  const tasksByItemNumber = new Map<number, DefectWorkshopTaskDetails[]>();

  typedActionsData.forEach((task) => {
    if (!task.inspection_item_id) return;
    const linkedItem = linkedById.get(task.inspection_item_id);
    if (!linkedItem) return;

    const history = coerceHistory(task.status_history);
    const timeline: DefectWorkshopTimelineEvent[] = history
      .map((event, index) => ({
        id: event.id || `${task.id}:${event.status}:${index}`,
        status: event.status || 'pending',
        created_at: event.created_at || task.actioned_at || '',
        author_name: event.author_name || (event.author_id ? profileNameById.get(event.author_id) || 'Unknown' : 'Unknown'),
        body: event.body || 'Status updated',
        signature_data: event.meta?.signature_data,
        signed_at: event.meta?.signed_at,
      }))
      .filter((event) => Boolean(event.created_at))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const detail: DefectWorkshopTaskDetails = {
      task_id: task.id,
      task_status: task.status,
      item_number: linkedItem.item_number,
      item_description: linkedItem.item_description,
      completed_at: task.actioned_at,
      completed_by: task.actioned_by ? profileNameById.get(task.actioned_by) || 'Unknown' : 'Unknown',
      completed_comment: task.actioned_comment,
      completion_signature_data: task.actioned_signature_data,
      completion_signed_at: task.actioned_signed_at,
      timeline,
    };

    const existing = tasksByItemNumber.get(linkedItem.item_number) || [];
    existing.push(detail);
    existing.sort((a, b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime());
    tasksByItemNumber.set(linkedItem.item_number, existing);
  });

  return defectItems.map((item) => ({
    ...item,
    workshop_tasks: tasksByItemNumber.get(item.item_number) || [],
  }));
}
