type InspectionCommentItem = {
  id: string;
  comments: string | null;
  created_at?: string | null;
};

export type InspectionCommentTask = {
  inspection_item_id?: string | null;
  created_at?: string | null;
  logged_comment?: string | null;
  workshop_comments?: string | null;
  status?: string | null;
};

export function getInspectionEnteredComment(
  item: InspectionCommentItem,
  _tasks: InspectionCommentTask[]
): string | null {
  const originalComment = item.comments?.trim() || '';
  return originalComment || null;
}
