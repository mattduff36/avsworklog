import {
  buildInspectionDefectSignature,
  extractInspectionDefectSignature,
} from '@/lib/utils/inspectionDefectSignature';

export interface PreviousInspectionItem {
  item_number: number;
  item_description: string;
  status: string;
  day_of_week: number;
}

export interface PreviousDefectSummary {
  item_number: number;
  item_description: string;
  days: number[];
}

export function buildUnresolvedPreviousDefects(
  items: PreviousInspectionItem[],
  completedTaskDescriptions: Array<string | null | undefined>
): Map<string, PreviousDefectSummary> {
  const resolvedSignatures = new Set(
    completedTaskDescriptions
      .map((description) => extractInspectionDefectSignature(description))
      .filter((signature): signature is string => Boolean(signature))
  );

  const defectsMap = new Map<string, PreviousDefectSummary>();

  items.forEach((item) => {
    if (item.status !== 'attention') {
      return;
    }

    const defectKey = `${item.item_number}-${item.item_description}`;
    const defectSignature = buildInspectionDefectSignature(item);

    if (resolvedSignatures.has(defectSignature)) {
      return;
    }

    if (!defectsMap.has(defectKey)) {
      defectsMap.set(defectKey, {
        item_number: item.item_number,
        item_description: item.item_description,
        days: [],
      });
    }

    const defectEntry = defectsMap.get(defectKey);
    if (defectEntry) {
      defectEntry.days.push(item.day_of_week);
    }
  });

  return defectsMap;
}
