import type { HgvInspectionSaveBody, HgvInspectionSaveResult } from '@/lib/server/hgv-inspection-save';

export class HgvInspectionSaveRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'HgvInspectionSaveRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function requestHgvInspectionSave(
  body: HgvInspectionSaveBody
): Promise<HgvInspectionSaveResult> {
  const response = await fetch('/api/hgv-inspections/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
  if (!response.ok) {
    throw new HgvInspectionSaveRequestError(
      payload?.error || 'Failed to save HGV inspection',
      response.status,
      payload?.code || 'SAVE_FAILED'
    );
  }

  return payload as HgvInspectionSaveResult;
}

export function isHgvSubmittedConflictError(error: unknown): boolean {
  return error instanceof HgvInspectionSaveRequestError && error.code === 'SUBMITTED_CONFLICT';
}
