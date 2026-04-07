import { createStatusError } from '@/lib/utils/http-error';

export interface AbsenceMessagePayload {
  message: string | null;
  updatedAt: string | null;
}

function parseAbsenceMessagePayload(
  rawPayload: string,
  response: Response
): (AbsenceMessagePayload & { error?: string }) | null {
  if (!rawPayload) {
    return null;
  }

  try {
    return JSON.parse(rawPayload) as AbsenceMessagePayload & { error?: string };
  } catch (error) {
    throw createStatusError('Invalid absence message response payload', response.status, error);
  }
}

export async function fetchAbsenceMessage(): Promise<AbsenceMessagePayload> {
  const response = await fetch('/api/absence/message', {
    cache: 'no-store',
  });
  const payload = parseAbsenceMessagePayload(await response.text(), response);

  if (!response.ok) {
    throw createStatusError(payload?.error || 'Failed to load absence message', response.status);
  }

  return {
    message: payload?.message ?? null,
    updatedAt: payload?.updatedAt ?? null,
  };
}

export async function updateAbsenceMessage(message: string | null): Promise<AbsenceMessagePayload> {
  const response = await fetch('/api/absence/message', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
  const payload = parseAbsenceMessagePayload(await response.text(), response);

  if (!response.ok) {
    throw createStatusError(payload?.error || 'Failed to save absence message', response.status);
  }

  return {
    message: payload?.message ?? null,
    updatedAt: payload?.updatedAt ?? null,
  };
}
