import type {
  ApplyWorkShiftTemplateRequest,
  CreateWorkShiftTemplateRequest,
  CurrentWorkShiftResponse,
  UpdateEmployeeWorkShiftRequest,
  UpdateWorkShiftTemplateRequest,
  WorkShiftMatrixResponse,
} from '@/types/work-shifts';

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

export async function fetchWorkShiftMatrix(): Promise<WorkShiftMatrixResponse> {
  const response = await fetch('/api/absence/work-shifts', { cache: 'no-store' });
  return parseResponse<WorkShiftMatrixResponse>(response);
}

export async function fetchCurrentWorkShift(): Promise<CurrentWorkShiftResponse> {
  const response = await fetch('/api/absence/work-shifts/current', { cache: 'no-store' });
  return parseResponse<CurrentWorkShiftResponse>(response);
}

export async function fetchEmployeeWorkShift(profileId: string): Promise<CurrentWorkShiftResponse> {
  const response = await fetch(`/api/absence/work-shifts/${profileId}`, { cache: 'no-store' });
  return parseResponse<CurrentWorkShiftResponse>(response);
}

export async function updateEmployeeWorkShift(
  profileId: string,
  body: UpdateEmployeeWorkShiftRequest
): Promise<{ success: boolean; row: WorkShiftMatrixResponse['employees'][number]; recalculatedAbsences: number }> {
  const response = await fetch(`/api/absence/work-shifts/${profileId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseResponse(response);
}

export async function createWorkShiftTemplate(body: CreateWorkShiftTemplateRequest) {
  const response = await fetch('/api/absence/work-shift-templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseResponse<{ success: boolean }>(response);
}

export async function updateWorkShiftTemplate(
  templateId: string,
  body: UpdateWorkShiftTemplateRequest
) {
  const response = await fetch(`/api/absence/work-shift-templates/${templateId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseResponse<{ success: boolean }>(response);
}

export async function deleteWorkShiftTemplate(templateId: string) {
  const response = await fetch(`/api/absence/work-shift-templates/${templateId}`, {
    method: 'DELETE',
  });

  return parseResponse<{ success: boolean }>(response);
}

export async function applyWorkShiftTemplate(body: ApplyWorkShiftTemplateRequest) {
  const response = await fetch('/api/absence/work-shifts/apply-template', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseResponse<{ success: boolean; affectedProfiles: number; recalculatedAbsences: number }>(response);
}
