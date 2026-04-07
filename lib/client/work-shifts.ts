import type {
  ApplyWorkShiftTemplateRequest,
  CreateWorkShiftTemplateRequest,
  CurrentWorkShiftResponse,
  UpdateEmployeeWorkShiftRequest,
  UpdateWorkShiftTemplateRequest,
  WorkShiftMatrixResponse,
} from '@/types/work-shifts';
import { createStatusError } from '@/lib/utils/http-error';

async function parseResponse<T>(response: Response): Promise<T> {
  const rawPayload = await response.text();
  let payload: (T & { error?: string }) | null = null;

  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload) as T & { error?: string };
    } catch (error) {
      throw createStatusError('Invalid work shift response payload', response.status, error);
    }
  }

  if (!response.ok) {
    throw createStatusError(payload?.error || 'Request failed', response.status);
  }

  return payload as T;
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
