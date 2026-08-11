import { getInventoryCheckStatus, requiresInventoryMoveCheckWarning } from '@/app/(dashboard)/inventory/utils';
import type { InventoryLocation } from '@/app/(dashboard)/inventory/types';
import {
  INVENTORY_CHECK_WARNING_REQUIRED,
  type InventoryMoveCheckConfirmation,
  type InventoryMoveCheckWarningItem,
} from '@/lib/inventory/move-check-warning';
import { logger } from '@/lib/utils/logger';
import type { InventoryAdminClient } from './inventory-locations';

export type InventoryMoveScope = 'single' | 'bulk' | 'group' | 'claim';

export interface MoveInventoryItemsInput {
  itemIds?: string[];
  destinationLocationId: string;
  note?: string | null;
  scope?: InventoryMoveScope;
  groupId?: string | null;
  movedBy: string;
  checkWarningConfirmation?: unknown;
  itemCheckOverrides?: Record<string, Partial<Pick<MoveItemRow, 'category' | 'last_checked_at' | 'check_interval_days'>>>;
}

export interface MoveInventoryItemsResult {
  moved_count: number;
  movement_batch_id: string | null;
}

export class InventoryMoveError extends Error {
  status: number;
  code?: string;
  warningItems?: InventoryMoveCheckWarningItem[];
  moveItemIds?: string[];

  constructor(
    message: string,
    status = 400,
    options?: {
      code?: string;
      warningItems?: InventoryMoveCheckWarningItem[];
      moveItemIds?: string[];
    },
  ) {
    super(message);
    this.name = 'InventoryMoveError';
    this.status = status;
    this.code = options?.code;
    this.warningItems = options?.warningItems;
    this.moveItemIds = options?.moveItemIds;
  }
}

interface GroupMemberRow {
  item_id: string;
}

interface MovedItemRow {
  movement_batch_id: string;
}

interface MoveLocationRow {
  id: string;
  name: string;
  location_type: InventoryLocation['location_type'];
  is_active: boolean;
}

interface MoveItemRow {
  id: string;
  item_number: string;
  name: string;
  category: string | null;
  last_checked_at: string | null;
  check_interval_days: number | null;
  location: Pick<InventoryLocation, 'id' | 'name' | 'location_type'> | Array<Pick<InventoryLocation, 'id' | 'name' | 'location_type'>> | null;
}

export interface PreparedInventoryMove {
  destinationLocationId: string;
  scope: InventoryMoveScope;
  groupId: string | null;
  itemIds: string[];
  destinationLocation: MoveLocationRow;
  warningItems: InventoryMoveCheckWarningItem[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uniqueIds(ids: readonly unknown[] | undefined): string[] {
  return Array.from(new Set(
    (ids || [])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean),
  )).sort();
}

function normalizeMoveItemLocation(
  location: MoveItemRow['location']
): Pick<InventoryLocation, 'id' | 'name' | 'location_type'> | null {
  if (Array.isArray(location)) return location[0] || null;
  return location || null;
}

export function toInventoryMoveErrorResponse(error: InventoryMoveError) {
  return {
    body: {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.warningItems ? { warning_items: error.warningItems } : {}),
      ...(error.moveItemIds ? { move_item_ids: error.moveItemIds } : {}),
    },
    status: error.status,
  };
}

function parseCheckWarningConfirmation(value: unknown): InventoryMoveCheckConfirmation | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object') {
    throw new InventoryMoveError('Invalid inventory check warning confirmation', 400);
  }

  const candidate = value as Partial<InventoryMoveCheckConfirmation>;
  if (!Array.isArray(candidate.warning_item_ids) || !Array.isArray(candidate.move_item_ids)) {
    throw new InventoryMoveError('Invalid inventory check warning confirmation', 400);
  }
  if (
    candidate.warning_item_ids.some((id: unknown) => typeof id !== 'string')
    || candidate.move_item_ids.some((id: unknown) => typeof id !== 'string')
  ) {
    throw new InventoryMoveError('Inventory check warning confirmation contains invalid item ids', 400);
  }

  const warningItemIds = uniqueIds(candidate.warning_item_ids);
  const moveItemIds = uniqueIds(candidate.move_item_ids);
  if (
    warningItemIds.length !== candidate.warning_item_ids.length
    || moveItemIds.length !== candidate.move_item_ids.length
    || warningItemIds.some((id) => !UUID_PATTERN.test(id))
    || moveItemIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    throw new InventoryMoveError('Inventory check warning confirmation contains invalid item ids', 400);
  }

  return {
    warning_item_ids: warningItemIds,
    move_item_ids: moveItemIds,
  };
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function throwCheckWarning(
  warningItems: InventoryMoveCheckWarningItem[],
  moveItemIds: string[],
): never {
  throw new InventoryMoveError(
    warningItems.length === 1
      ? 'This item needs an inventory check. Confirm to move it anyway.'
      : 'These items need inventory checks. Confirm to move them anyway.',
    409,
    {
      code: INVENTORY_CHECK_WARNING_REQUIRED,
      warningItems,
      moveItemIds,
    },
  );
}

export function assertInventoryMoveCheckConfirmation(
  prepared: PreparedInventoryMove,
  value: unknown,
): InventoryMoveCheckConfirmation | null {
  const confirmation = parseCheckWarningConfirmation(value);
  if (prepared.warningItems.length === 0) return confirmation;
  if (!confirmation) throwCheckWarning(prepared.warningItems, prepared.itemIds);

  const currentWarningIds = prepared.warningItems.map((item) => item.id).sort();
  const allCurrentWarningsConfirmed = currentWarningIds.every((id) => (
    confirmation.warning_item_ids.includes(id)
  ));
  const allConfirmedWarningsBelongToMove = confirmation.warning_item_ids.every((id) => (
    prepared.itemIds.includes(id)
  ));
  if (
    !sameIds(confirmation.move_item_ids, prepared.itemIds)
    || !allCurrentWarningsConfirmed
    || !allConfirmedWarningsBelongToMove
  ) {
    throwCheckWarning(prepared.warningItems, prepared.itemIds);
  }

  return confirmation;
}

export async function prepareInventoryMove(
  admin: InventoryAdminClient,
  input: MoveInventoryItemsInput
): Promise<PreparedInventoryMove> {
  const destinationLocationId = input.destinationLocationId.trim();
  const scope = input.scope || 'single';
  const groupId = input.groupId?.trim() || null;

  if (!destinationLocationId) {
    throw new InventoryMoveError('Destination location is required', 400);
  }

  if (
    input.itemIds !== undefined
    && (
      !Array.isArray(input.itemIds)
      || input.itemIds.some((id: unknown) => typeof id !== 'string')
    )
  ) {
    throw new InventoryMoveError('Inventory item ids must be strings', 400);
  }
  let itemIds = uniqueIds(input.itemIds);

  if (scope === 'group') {
    if (!groupId) throw new InventoryMoveError('Group is required for a group move', 400);

    const { data: members, error: membersError } = await admin
      .from('inventory_item_group_members')
      .select('item_id')
      .eq('group_id', groupId);

    if (membersError) throw membersError;
    itemIds = uniqueIds(((members || []) as GroupMemberRow[]).map((member) => member.item_id));
  }

  if (itemIds.length === 0) {
    throw new InventoryMoveError('At least one inventory item is required', 400);
  }

  const [destinationResult, itemsResult] = await Promise.all([
    admin
      .from('inventory_locations')
      .select('id, name, location_type, is_active')
      .eq('id', destinationLocationId)
      .single(),
    admin
      .from('inventory_items')
      .select('id, item_number, name, category, last_checked_at, check_interval_days, location:inventory_locations(id, name, location_type)')
      .in('id', itemIds)
      .eq('status', 'active'),
  ]);

  if (destinationResult.error || !destinationResult.data?.is_active) {
    throw new InventoryMoveError('Destination location not found', 404);
  }
  if (itemsResult.error) throw itemsResult.error;

  const destinationLocation = destinationResult.data as MoveLocationRow;
  const moveItems = ((itemsResult.data || []) as MoveItemRow[])
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));

  if (moveItems.length !== itemIds.length) {
    throw new InventoryMoveError('One or more inventory items could not be found', 404);
  }

  const sameLocationCount = moveItems.filter((item) => normalizeMoveItemLocation(item.location)?.id === destinationLocationId).length;
  if (sameLocationCount === moveItems.length) {
    throw new InventoryMoveError(
      moveItems.length === 1 ? 'Item is already in this location' : 'All selected items are already in this location',
      400
    );
  }

  const warningItems = moveItems.reduce<InventoryMoveCheckWarningItem[]>((acc, item) => {
    const checkOverrides = input.itemCheckOverrides?.[item.id];
    const moveItem = {
      ...item,
      ...checkOverrides,
      location: normalizeMoveItemLocation(item.location),
    };
    if (!requiresInventoryMoveCheckWarning(moveItem, destinationLocation)) return acc;
    acc.push({
      id: item.id,
      item_number: item.item_number,
      name: item.name,
      check_status: getInventoryCheckStatus(moveItem),
    });
    return acc;
  }, []);

  return {
    destinationLocationId,
    scope,
    groupId,
    itemIds,
    destinationLocation,
    warningItems,
  };
}

export async function moveInventoryItems(
  admin: InventoryAdminClient,
  input: MoveInventoryItemsInput
): Promise<MoveInventoryItemsResult> {
  const prepared = await prepareInventoryMove(admin, input);
  const confirmation = assertInventoryMoveCheckConfirmation(prepared, input.checkWarningConfirmation);

  const { data: movedItems, error: moveError } = await admin.rpc('inventory_move_items_with_batch', {
    p_item_ids: prepared.itemIds,
    p_destination_location_id: prepared.destinationLocationId,
    p_note: input.note?.trim() || null,
    p_moved_by: input.movedBy,
    p_move_scope: prepared.scope,
    p_group_id: prepared.scope === 'group' ? prepared.groupId : null,
  });

  if (moveError) {
    if (moveError.code === 'P0001' && moveError.message?.includes('No items were moved')) {
      throw new InventoryMoveError('No items were moved', 400);
    }
    throw moveError;
  }

  const movedCount = Array.isArray(movedItems) ? movedItems.length : 0;
  const movementBatchId = Array.isArray(movedItems)
    ? ((movedItems[0] as MovedItemRow | undefined)?.movement_batch_id || null)
    : null;

  if (movedCount === 0) throw new InventoryMoveError('No items were moved', 400);

  if (confirmation && prepared.warningItems.length > 0) {
    logger.info('Inventory check warning override completed', {
      actor: input.movedBy,
      surface: 'inventory',
      warning_item_ids: prepared.warningItems.map((item) => item.id),
      destination_location_id: prepared.destinationLocationId,
      movement_batch_id: movementBatchId,
    });
  }

  return {
    moved_count: movedCount,
    movement_batch_id: movementBatchId,
  };
}
