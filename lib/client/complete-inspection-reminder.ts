import type { ReminderAssetType } from '@/types/reminders';

interface CompleteInspectionReminderInput {
  assetType: ReminderAssetType;
  assetId: string;
  assignedTo: string;
}

export async function completeInspectionReminder({
  assetType,
  assetId,
  assignedTo,
}: CompleteInspectionReminderInput): Promise<void> {
  const response = await fetch('/api/reminders/complete-inspection-action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assetType,
      assetId,
      assignedTo,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to complete reminder');
  }
}
