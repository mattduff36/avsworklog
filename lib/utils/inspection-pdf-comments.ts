import type { InspectionItem } from '@/types/inspection';

interface InspectionPdfCommentItem extends InspectionItem {
  day_of_week?: number | null;
}

interface BuildInspectionPdfCommentsOptions {
  inspectorComments?: string | null;
  items: InspectionPdfCommentItem[];
  resolveItemName?: (item: InspectionPdfCommentItem) => string;
}

const INSPECTION_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getInspectionStatusLabel(status: InspectionItem['status']): 'PASS' | 'FAIL' | 'N/A' {
  if (status === 'attention' || status === 'defect') {
    return 'FAIL';
  }

  if (status === 'na') {
    return 'N/A';
  }

  return 'PASS';
}

export function buildInspectionPdfCommentsText({
  inspectorComments,
  items,
  resolveItemName,
}: BuildInspectionPdfCommentsOptions): string {
  const trimmedInspectorComments = inspectorComments?.trim() || '';

  const itemCommentLines = items
    .filter((item) => item.status === 'attention' || item.status === 'defect' || (item.comments?.trim() ?? '').length > 0)
    .map((item) => {
      const itemName = (resolveItemName?.(item) || item.item_description || `Item ${item.item_number}`).trim();
      const itemComment = item.comments?.trim();
      const status = getInspectionStatusLabel(item.status);
      const dayIndex = Math.max(0, Math.min(INSPECTION_DAY_LABELS.length - 1, Number(item.day_of_week ?? 1) - 1));
      const dayLabel = INSPECTION_DAY_LABELS[dayIndex];

      return `${item.item_number}. ${itemName} (${dayLabel}) [${status}]${itemComment ? `: ${itemComment}` : ''}`;
    });

  if (trimmedInspectorComments && itemCommentLines.length > 0) {
    return `Inspector comment: ${trimmedInspectorComments}\n\n${itemCommentLines.join('\n')}`;
  }

  if (trimmedInspectorComments) {
    return `Inspector comment: ${trimmedInspectorComments}`;
  }

  return itemCommentLines.join('\n');
}
