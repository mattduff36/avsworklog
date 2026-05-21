import { addMonths, differenceInCalendarDays, format } from 'date-fns';
import type { InventoryCheckStatus, InventoryItem, InventoryLocation } from './types';

const DAYS_PER_INVENTORY_CHECK_MONTH = 30;

export const CHECK_INTERVAL_MONTHS = 1;
export const CHECK_INTERVAL_DAYS = CHECK_INTERVAL_MONTHS * DAYS_PER_INVENTORY_CHECK_MONTH;
export const DUE_SOON_DAYS = 7;

export function getInventoryCheckIntervalDays(item: Pick<InventoryItem, 'check_interval_days'>): number {
  return checkIntervalMonthsToDays(getInventoryCheckIntervalMonths(item)) || CHECK_INTERVAL_DAYS;
}

export function getInventoryCheckIntervalMonths(item: Pick<InventoryItem, 'check_interval_days'>): number {
  if (!item.check_interval_days) return CHECK_INTERVAL_MONTHS;
  return Math.max(1, Math.round(item.check_interval_days / DAYS_PER_INVENTORY_CHECK_MONTH));
}

export function checkIntervalMonthsToDays(intervalMonths: number | null | undefined): number | null {
  if (!Number.isInteger(intervalMonths) || !intervalMonths || intervalMonths < 1) return null;
  return intervalMonths * DAYS_PER_INVENTORY_CHECK_MONTH;
}

export function formatInventoryCheckIntervalMonths(intervalMonths: number): string {
  return `${intervalMonths} ${intervalMonths === 1 ? 'month' : 'months'}`;
}

export function getInventoryCheckStatus(
  item: Pick<InventoryItem, 'last_checked_at'> & Partial<Pick<InventoryItem, 'check_interval_days'>>
): InventoryCheckStatus {
  if (!item.last_checked_at) return 'needs_check';

  const dueDate = addMonths(new Date(`${item.last_checked_at}T00:00:00`), getInventoryCheckIntervalMonths({
    check_interval_days: item.check_interval_days || null,
  }));
  const daysUntilDue = differenceInCalendarDays(dueDate, new Date());

  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= DUE_SOON_DAYS) return 'due_soon';
  return 'ok';
}

export function getInventoryDueDate(lastCheckedAt: string | null, intervalMonths = CHECK_INTERVAL_MONTHS): string {
  if (!lastCheckedAt) return 'Not checked';
  return format(addMonths(new Date(`${lastCheckedAt}T00:00:00`), intervalMonths), 'dd MMM yyyy');
}

export function formatInventoryDate(value: string | null): string {
  if (!value) return 'Not checked';
  return format(new Date(`${value}T00:00:00`), 'dd MMM yyyy');
}

export function getCheckStatusLabel(status: InventoryCheckStatus): string {
  if (status === 'due_soon') return 'Due Soon';
  if (status === 'needs_check') return 'Needs Check';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function formatInventoryLocationOptionLabel(location: InventoryLocation): string {
  const assignedUserLabel = location.assigned_user_names?.length
    ? location.assigned_user_names.join(', ')
    : 'Unassigned';
  const linkedVanLabel = [location.linked_asset_label, location.linked_asset_nickname]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' - ');
  const locationLabel = location.linked_asset_type === 'van' && linkedVanLabel
    ? `[${linkedVanLabel}]`
    : location.name;

  return `${locationLabel} - ${assignedUserLabel}`;
}
