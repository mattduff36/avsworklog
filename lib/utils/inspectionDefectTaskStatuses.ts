export const ACTIVE_INSPECTION_DEFECT_STATUSES = [
  'pending',
  'logged',
  'on_hold',
  'in_progress',
] as const;

export const LOCKED_INSPECTION_DEFECT_STATUSES = ACTIVE_INSPECTION_DEFECT_STATUSES;
