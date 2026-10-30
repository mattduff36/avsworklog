export const INVENTORY_REFRESH_COLLECTIONS = [
  'items',
  'retired',
  'fleet',
  'categories',
  'hardware',
  'groups',
  'siteAssignments',
] as const;

export type InventoryRefreshCollection = (typeof INVENTORY_REFRESH_COLLECTIONS)[number];

export type InventoryMutation =
  | 'item_create'
  | 'item_retire'
  | 'item_restore'
  | 'minor_plant_restore'
  | 'move'
  | 'group'
  | 'category'
  | 'hardware'
  | 'user_location'
  | 'site_assignment'
  | 'location';

export interface InventoryRefreshPlan {
  mode: 'full' | 'targeted';
  collections: ReadonlySet<InventoryRefreshCollection>;
}

export interface InventoryAccessScope {
  userId: string;
  roleName: string | null;
  roleClass: string | null;
  teamId: string | null;
  teamName: string | null;
  isManagerOrAdmin: boolean;
  canManageSiteLocations: boolean;
}

interface InventoryAccessContext {
  user_id?: unknown;
  role_name?: unknown;
  role_class?: unknown;
  team_id?: unknown;
  team_name?: unknown;
  is_manager_or_admin?: unknown;
  can_manage_site_locations?: unknown;
}

// Active item totals also appear on enriched location records in these payloads.
const ITEM_MUTATION_COLLECTIONS = ['items', 'retired', 'groups', 'hardware', 'siteAssignments'] as const;

/**
 * Location writes change rows joined into active items, retired items, group
 * members, hardware balances, and site assignments (name, active flag, linked
 * asset, assignees). Category rows and the fleet catalogue do not join them.
 * Context is always revalidated separately, which covers the caller's own
 * location label. The location directory itself reloads via locationSearchVersion.
 */
const LOCATION_LABEL_COLLECTIONS = [
  'items',
  'retired',
  'groups',
  'hardware',
  'siteAssignments',
] as const;

function targetedPlan(
  collections: readonly InventoryRefreshCollection[],
): InventoryRefreshPlan {
  return { mode: 'targeted', collections: new Set(collections) };
}

export function fullInventoryRefreshPlan(): InventoryRefreshPlan {
  return { mode: 'full', collections: new Set(INVENTORY_REFRESH_COLLECTIONS) };
}

export function inventoryRefreshPlanForMutation(
  mutation: InventoryMutation,
): InventoryRefreshPlan {
  switch (mutation) {
    case 'item_create':
      return targetedPlan([...ITEM_MUTATION_COLLECTIONS, 'categories']);
    case 'item_retire':
    case 'item_restore':
      return targetedPlan(ITEM_MUTATION_COLLECTIONS);
    case 'minor_plant_restore':
      // Restoring minor plant sets the linked plant row back to active.
      return targetedPlan([...ITEM_MUTATION_COLLECTIONS, 'fleet']);
    case 'move':
      // Other rows at either location display changed active-item totals too.
      return targetedPlan(LOCATION_LABEL_COLLECTIONS);
    case 'group':
      return targetedPlan(['groups', 'items', 'retired']);
    case 'category':
      return targetedPlan(['categories', 'items', 'retired']);
    case 'hardware':
      return targetedPlan(['hardware']);
    case 'user_location':
    case 'site_assignment':
      // Primary and secondary assignee names are joined into location records.
      return targetedPlan(LOCATION_LABEL_COLLECTIONS);
    case 'location':
      return targetedPlan(LOCATION_LABEL_COLLECTIONS);
    default: {
      const unreachable: never = mutation;
      return unreachable;
    }
  }
}

export function mergeInventoryRefreshPlans(
  current: InventoryRefreshPlan,
  next: InventoryRefreshPlan,
): InventoryRefreshPlan {
  if (current.mode === 'full' || next.mode === 'full') return fullInventoryRefreshPlan();
  return {
    mode: 'targeted',
    collections: new Set([...current.collections, ...next.collections]),
  };
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readInventoryAccessScope(context: InventoryAccessContext): InventoryAccessScope {
  return {
    userId: readOptionalText(context.user_id) || '',
    roleName: readOptionalText(context.role_name),
    roleClass: readOptionalText(context.role_class),
    teamId: readOptionalText(context.team_id),
    teamName: readOptionalText(context.team_name),
    isManagerOrAdmin: context.is_manager_or_admin === true,
    canManageSiteLocations: context.can_manage_site_locations === true,
  };
}

export function inventoryAccessScopeChanged(
  previous: InventoryAccessScope | null,
  next: InventoryAccessScope,
): boolean {
  if (!previous) return true;
  return previous.userId !== next.userId
    || previous.roleName !== next.roleName
    || previous.roleClass !== next.roleClass
    || previous.teamId !== next.teamId
    || previous.teamName !== next.teamName
    || previous.isManagerOrAdmin !== next.isManagerOrAdmin
    || previous.canManageSiteLocations !== next.canManageSiteLocations;
}
