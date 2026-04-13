interface DeclineTrainingBookingsParams {
  absenceIds: string[];
}

export async function declineTrainingBookingsClient(
  params: DeclineTrainingBookingsParams
): Promise<void> {
  const response = await fetch('/api/absence/training-decline', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      absenceIds: params.absenceIds,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Failed to remove training booking');
  }
}
