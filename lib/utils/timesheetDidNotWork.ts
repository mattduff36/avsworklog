export type DidNotWorkCategory = 'Holiday' | 'Sick' | 'Off' | 'Other';

export interface DidNotWorkReasonInfo {
  isDidNotWork: boolean;
  category: DidNotWorkCategory | null;
  remarks: string;
  reasonDisplay: string;
  combinedDisplay: string;
}

function normalizeRemark(remarks: string | null | undefined): string {
  return (remarks ?? '').trim();
}

function inferCategoryFromRemarks(remarks: string): DidNotWorkCategory {
  const normalized = remarks.toLowerCase();

  if (normalized === 'annual leave' || normalized === 'holiday') {
    return 'Holiday';
  }

  if (
    normalized === 'sickness leave' ||
    normalized === 'sick leave' ||
    normalized === 'sickness' ||
    normalized === 'sick'
  ) {
    return 'Sick';
  }

  if (normalized === 'not on shift' || normalized === 'off shift' || normalized === 'off') {
    return 'Off';
  }

  return 'Other';
}

export function getDidNotWorkReasonInfo(
  didNotWork: boolean | null | undefined,
  remarks: string | null | undefined
): DidNotWorkReasonInfo {
  if (!didNotWork) {
    return {
      isDidNotWork: false,
      category: null,
      remarks: '',
      reasonDisplay: '',
      combinedDisplay: '',
    };
  }

  const normalizedRemarks = normalizeRemark(remarks);
  const category = inferCategoryFromRemarks(normalizedRemarks);

  const reasonDisplay = normalizedRemarks
    ? `${category} (${normalizedRemarks})`
    : category;

  return {
    isDidNotWork: true,
    category,
    remarks: normalizedRemarks,
    reasonDisplay,
    combinedDisplay: `DID NOT WORK - ${reasonDisplay}`,
  };
}
