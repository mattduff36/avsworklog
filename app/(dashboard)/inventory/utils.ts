import { addMonths, differenceInCalendarDays, format } from 'date-fns';
import type {
  InventoryCheckStatus,
  InventoryItem,
  InventoryLocation,
  InventoryLocationType,
} from './types';

const DAYS_PER_INVENTORY_CHECK_MONTH = 30;

export const CHECK_INTERVAL_MONTHS = 1;
export const CHECK_INTERVAL_DAYS = CHECK_INTERVAL_MONTHS * DAYS_PER_INVENTORY_CHECK_MONTH;
export const DUE_SOON_DAYS = 7;
export const INVENTORY_UNKNOWN_LOCATION_NAME = 'Unknown';
export const INVENTORY_YARD_LOCATION_NAME = 'Yard';
export const INVENTORY_WORKSHOP_TEAM_ID = 'workshop_yard';

interface InventoryCheckScheduleItem {
  last_checked_at: string | null;
  check_interval_days?: number | null;
}

interface InventorySpecialStatusItem extends InventoryCheckScheduleItem {
  category?: string | null;
  location?: Pick<InventoryLocation, 'name' | 'location_type'> | null;
  unknown_location_entered_at?: string | null;
  created_at?: string | null;
}

interface InventoryTeamContext {
  teamId?: string | null;
  teamName?: string | null;
}

interface InventoryPrimaryLocationSelectionContext extends InventoryTeamContext {
  currentLocationId?: string | null;
}

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

export function isUnknownInventoryLocationName(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === INVENTORY_UNKNOWN_LOCATION_NAME.toLowerCase();
}

export function isYardInventoryLocationName(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === INVENTORY_YARD_LOCATION_NAME.toLowerCase();
}

export function isInventoryUnknownLocation(
  location: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined
): boolean {
  if (location?.location_type === 'unknown') return true;
  return isUnknownInventoryLocationName(location?.name);
}

export function isInventoryYardLocation(
  location: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined
): boolean {
  if (location?.location_type === 'yard') return true;
  return isYardInventoryLocationName(location?.name);
}

export function isLegacyQuoteInventoryLocation(
  location: Partial<Pick<InventoryLocation, 'source_type'>> | null | undefined
): boolean {
  return location?.source_type === 'legacy_quote';
}

export function isWorkshopInventoryTeam(context: InventoryTeamContext): boolean {
  const teamId = context.teamId?.trim().toLowerCase();
  const teamName = context.teamName?.trim().toLowerCase();

  return teamId === INVENTORY_WORKSHOP_TEAM_ID || teamName?.includes('workshop') === true;
}

export function canShareInventoryPrimaryLocation(
  location: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined,
  context: InventoryTeamContext
): boolean {
  return isWorkshopInventoryTeam(context) && isInventoryYardLocation(location);
}

export function canSelectInventoryPrimaryLocation(
  location: Pick<InventoryLocation, 'id' | 'name' | 'is_active' | 'assigned_user_names'> & Partial<Pick<InventoryLocation, 'location_type'>>,
  context: InventoryPrimaryLocationSelectionContext
): boolean {
  if (location.is_active === false) return false;
  if (location.location_type === 'site') return false;
  if (location.id === context.currentLocationId) return true;
  if (canShareInventoryPrimaryLocation(location, context)) return true;

  return (location.assigned_user_names?.length || 0) === 0;
}

export function isInventoryCheckExempt(item: Partial<InventorySpecialStatusItem>): boolean {
  return isInventoryUnknownLocation(item.location);
}

export function getInventoryNormalCheckStatus(item: InventoryCheckScheduleItem): InventoryCheckStatus {
  if (!item.last_checked_at) return 'needs_check';

  const dueDate = addMonths(new Date(`${item.last_checked_at}T00:00:00`), getInventoryCheckIntervalMonths({
    check_interval_days: item.check_interval_days || null,
  }));
  const daysUntilDue = differenceInCalendarDays(dueDate, new Date());

  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue <= DUE_SOON_DAYS) return 'due_soon';
  return 'ok';
}

export function getInventoryCheckStatus(item: InventorySpecialStatusItem): InventoryCheckStatus {
  if (isInventoryCheckExempt(item)) return 'not_required';
  return getInventoryNormalCheckStatus(item);
}

export function hasInventoryCheckLapsed(item: InventoryCheckScheduleItem): boolean {
  const status = getInventoryNormalCheckStatus(item);
  return status === 'needs_check' || status === 'overdue';
}

export function isInventoryYardExitBlocked(
  item: InventoryCheckScheduleItem & { location?: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null },
  destinationLocation: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined
): boolean {
  if (!isInventoryYardLocation(item.location)) return false;
  if (isInventoryYardLocation(destinationLocation)) return false;
  return hasInventoryCheckLapsed(item);
}

export function isInventoryMoveCheckBlocked(
  item: InventorySpecialStatusItem,
  destinationLocation: Pick<InventoryLocation, 'name'> & Partial<Pick<InventoryLocation, 'location_type'>> | null | undefined
): boolean {
  if (isInventoryYardExitBlocked(item, destinationLocation)) return true;
  if (isInventoryYardLocation(destinationLocation)) return false;
  return getInventoryCheckStatus(item) === 'overdue';
}

export function shouldMuteInventoryCheckBadge(
  item: Partial<InventorySpecialStatusItem>
): boolean {
  return isInventoryYardLocation(item.location) || isInventoryCheckExempt(item);
}

export function getInventoryDueDate(lastCheckedAt: string | null, intervalMonths = CHECK_INTERVAL_MONTHS): string {
  if (!lastCheckedAt) return 'Not checked';
  return format(addMonths(new Date(`${lastCheckedAt}T00:00:00`), intervalMonths), 'dd MMM yyyy');
}

export function formatInventoryDate(value: string | null): string {
  if (!value) return 'Not checked';
  const parsedDate = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return 'Not checked';
  return format(parsedDate, 'dd MMM yyyy');
}

export function getCheckStatusLabel(status: InventoryCheckStatus): string {
  if (status === 'not_required') return 'No Check Required';
  if (status === 'due_soon') return 'Due Soon';
  if (status === 'needs_check') return 'Needs Check';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function getInventoryUnknownLocationEnteredAt(
  item: Pick<InventoryItem, 'location' | 'created_at'> & Partial<Pick<InventoryItem, 'unknown_location_entered_at'>>
): string | null {
  if (!isInventoryUnknownLocation(item.location)) return null;
  return item.unknown_location_entered_at || item.created_at || null;
}

export function getInventoryUnknownLocationAgeDays(
  item: Pick<InventoryItem, 'location' | 'created_at'> & Partial<Pick<InventoryItem, 'unknown_location_entered_at'>>,
  now = new Date()
): number | null {
  const enteredAt = getInventoryUnknownLocationEnteredAt(item);
  if (!enteredAt) return null;
  const parsedDate = new Date(enteredAt.includes('T') ? enteredAt : `${enteredAt}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return Math.max(0, differenceInCalendarDays(now, parsedDate));
}

export function formatInventoryUnknownLocationAge(
  item: Pick<InventoryItem, 'location' | 'created_at'> & Partial<Pick<InventoryItem, 'unknown_location_entered_at'>>,
  now = new Date()
): string | null {
  const days = getInventoryUnknownLocationAgeDays(item, now);
  if (days === null) return null;
  if (days === 0) return 'In Unknown today';
  return `In Unknown for ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function formatInventoryLocationLabel(location: InventoryLocation): string {
  const linkedAssetLabel = [location.linked_asset_label, location.linked_asset_nickname]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' - ');

  if (linkedAssetLabel) return `[${linkedAssetLabel}]`;

  if (location.location_type === 'site' && location.external_reference) {
    const titlePrefix = location.source_type === 'legacy_quote'
      ? /^legacy quote\s*-\s*/i
      : /^site\s*-\s*/i;
    const siteTitle = location.name
      .replace(titlePrefix, '')
      .replace(new RegExp(`^${location.external_reference}\\s*-\\s*`, 'i'), '')
      .trim();

    return siteTitle
      ? `[${location.external_reference} - ${siteTitle}]`
      : `[${location.external_reference}]`;
  }

  return location.name;
}

export function formatInventoryLocationAssigneeLabel(location: InventoryLocation): string {
  return location.assigned_user_names?.length
    ? location.assigned_user_names.join(', ')
    : 'Unassigned';
}

export function formatInventoryLocationContextLabel(location: InventoryLocation): string {
  const details = [
    formatInventoryLocationTypeLabel(location),
    location.external_reference,
    location.linked_asset_label,
    location.linked_asset_nickname,
    formatInventoryLocationAssigneeLabel(location),
  ];

  return [...new Set(details.map((detail) => detail?.trim()).filter(Boolean))].join(' · ');
}

export function getInventoryLocationSearchLabel(
  location: InventoryLocation,
  additionalLabels: readonly string[] = [],
): string {
  return [
    formatInventoryLocationLabel(location),
    location.name,
    location.location_type,
    location.external_reference,
    location.linked_asset_label,
    location.linked_asset_nickname,
    formatInventoryLocationAssigneeLabel(location),
    ...additionalLabels,
  ].filter(Boolean).join(' ');
}

export function formatInventoryLocationOptionLabel(location: InventoryLocation): string {
  return `${formatInventoryLocationLabel(location)} - ${formatInventoryLocationAssigneeLabel(location)}`;
}

export interface InventoryLocationTypePresentation {
  surfaceClassName: string;
  optionClassName: string;
  badgeClassName: string;
  iconClassName: string;
}

const INVENTORY_LOCATION_TYPE_PRESENTATION = {
  site: {
    surfaceClassName: 'border-[hsl(var(--avs-yellow)/0.32)] bg-[hsl(var(--avs-yellow)/0.10)] hover:bg-[hsl(var(--avs-yellow)/0.17)]',
    optionClassName: 'border-[hsl(var(--avs-yellow)/0.28)] bg-[hsl(var(--avs-yellow)/0.08)] hover:bg-[hsl(var(--avs-yellow)/0.16)] focus:bg-[hsl(var(--avs-yellow)/0.16)]',
    badgeClassName: 'border-[hsl(var(--avs-yellow)/0.40)] bg-[hsl(var(--avs-yellow)/0.12)] text-avs-yellow',
    iconClassName: 'text-avs-yellow',
  },
  van: {
    surfaceClassName: 'border-[hsl(var(--inspection-primary)/0.32)] bg-[hsl(var(--inspection-primary)/0.10)] hover:bg-[hsl(var(--inspection-primary)/0.17)]',
    optionClassName: 'border-[hsl(var(--inspection-primary)/0.28)] bg-[hsl(var(--inspection-primary)/0.08)] hover:bg-[hsl(var(--inspection-primary)/0.16)] focus:bg-[hsl(var(--inspection-primary)/0.16)]',
    badgeClassName: 'border-[hsl(var(--inspection-primary)/0.40)] bg-[hsl(var(--inspection-primary)/0.12)] text-inspection',
    iconClassName: 'text-inspection',
  },
  hgv: {
    surfaceClassName: 'border-[hsl(var(--hgv-inspection-primary)/0.32)] bg-[hsl(var(--hgv-inspection-primary)/0.10)] hover:bg-[hsl(var(--hgv-inspection-primary)/0.17)]',
    optionClassName: 'border-[hsl(var(--hgv-inspection-primary)/0.28)] bg-[hsl(var(--hgv-inspection-primary)/0.08)] hover:bg-[hsl(var(--hgv-inspection-primary)/0.16)] focus:bg-[hsl(var(--hgv-inspection-primary)/0.16)]',
    badgeClassName: 'border-[hsl(var(--hgv-inspection-primary)/0.40)] bg-[hsl(var(--hgv-inspection-primary)/0.12)] text-[hsl(var(--hgv-inspection-light))]',
    iconClassName: 'text-hgv-inspection',
  },
  plant: {
    surfaceClassName: 'border-[hsl(var(--plant-inspection-primary)/0.32)] bg-[hsl(var(--plant-inspection-primary)/0.10)] hover:bg-[hsl(var(--plant-inspection-primary)/0.17)]',
    optionClassName: 'border-[hsl(var(--plant-inspection-primary)/0.28)] bg-[hsl(var(--plant-inspection-primary)/0.08)] hover:bg-[hsl(var(--plant-inspection-primary)/0.16)] focus:bg-[hsl(var(--plant-inspection-primary)/0.16)]',
    badgeClassName: 'border-[hsl(var(--plant-inspection-primary)/0.40)] bg-[hsl(var(--plant-inspection-primary)/0.12)] text-[hsl(var(--plant-inspection-light))]',
    iconClassName: 'text-plant-inspection',
  },
  yard: {
    surfaceClassName: 'border-[hsl(var(--workshop-primary)/0.32)] bg-[hsl(var(--workshop-primary)/0.10)] hover:bg-[hsl(var(--workshop-primary)/0.17)]',
    optionClassName: 'border-[hsl(var(--workshop-primary)/0.28)] bg-[hsl(var(--workshop-primary)/0.08)] hover:bg-[hsl(var(--workshop-primary)/0.16)] focus:bg-[hsl(var(--workshop-primary)/0.16)]',
    badgeClassName: 'border-[hsl(var(--workshop-primary)/0.40)] bg-[hsl(var(--workshop-primary)/0.12)] text-[hsl(var(--workshop-light))]',
    iconClassName: 'text-workshop',
  },
  manual: {
    surfaceClassName: 'border-[hsl(var(--inventory-primary)/0.32)] bg-[hsl(var(--inventory-primary)/0.12)] hover:bg-[hsl(var(--inventory-primary)/0.20)]',
    optionClassName: 'border-[hsl(var(--inventory-primary)/0.28)] bg-[hsl(var(--inventory-primary)/0.10)] hover:bg-[hsl(var(--inventory-primary)/0.18)] focus:bg-[hsl(var(--inventory-primary)/0.18)]',
    badgeClassName: 'border-inventory/40 bg-inventory-soft text-inventory-light',
    iconClassName: 'text-inventory-light',
  },
  unknown: {
    surfaceClassName: 'border-slate-600/40 bg-slate-700/20 hover:bg-slate-700/35',
    optionClassName: 'border-slate-600/35 bg-slate-700/20 hover:bg-slate-700/35 focus:bg-slate-700/35',
    badgeClassName: 'border-slate-500/40 bg-slate-700/30 text-slate-200',
    iconClassName: 'text-slate-400',
  },
} satisfies Record<InventoryLocationType, InventoryLocationTypePresentation>;

export function getInventoryLocationTypePresentation(
  location: Pick<InventoryLocation, 'location_type'>
): InventoryLocationTypePresentation {
  return INVENTORY_LOCATION_TYPE_PRESENTATION[location.location_type];
}

export function getInventoryLocationsWithYardFirst<TLocation extends Pick<InventoryLocation, 'name'>>(
  locations: readonly TLocation[]
): TLocation[] {
  const yardLocations: TLocation[] = [];
  const otherLocations: TLocation[] = [];

  locations.forEach((location) => {
    if (isInventoryYardLocation(location)) yardLocations.push(location);
    else otherLocations.push(location);
  });

  return [...yardLocations, ...otherLocations];
}

function getInventoryLocationTypeLabel(location: Pick<InventoryLocation, 'location_type'>): string {
  if (location.location_type === 'yard') return 'Yard';
  if (location.location_type === 'unknown') return 'Unknown';
  if (location.location_type === 'van') return 'Van';
  if (location.location_type === 'hgv') return 'HGV';
  if (location.location_type === 'plant') return 'Plant';
  if (location.location_type === 'site') return 'Site';
  return 'Manual';
}

export function formatInventoryLocationTypeLabel(location: Pick<InventoryLocation, 'location_type'>): string {
  return getInventoryLocationTypeLabel(location);
}
