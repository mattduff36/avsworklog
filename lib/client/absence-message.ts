export interface AbsenceMessagePayload {
  message: string | null;
  updatedAt: string | null;
}

export async function fetchAbsenceMessage(): Promise<AbsenceMessagePayload> {
  const response = await fetch('/api/absence/message', {
    cache: 'no-store',
  });
  const payload = (await response.json()) as AbsenceMessagePayload & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load absence message');
  }

  return {
    message: payload.message ?? null,
    updatedAt: payload.updatedAt ?? null,
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
  const payload = (await response.json()) as AbsenceMessagePayload & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || 'Failed to save absence message');
  }

  return {
    message: payload.message ?? null,
    updatedAt: payload.updatedAt ?? null,
  };
}
