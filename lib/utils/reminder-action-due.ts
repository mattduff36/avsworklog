export function getReminderActionDueState(
  dueAt: string | null | undefined,
  now = new Date(),
): {
  label: string;
  overdue: boolean;
  timestamp: number;
} {
  if (!dueAt) {
    return { label: 'No deadline', overdue: false, timestamp: Number.MAX_SAFE_INTEGER };
  }

  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return { label: dueAt, overdue: false, timestamp: 0 };
  }

  const overdue = dueDate.getTime() <= now.getTime();
  const label = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dueDate).replaceAll('/', '-');

  return {
    label: overdue ? `Overdue since ${label}` : `Due ${label}`,
    overdue,
    timestamp: dueDate.getTime(),
  };
}
