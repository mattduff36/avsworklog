import 'server-only';

import type { Json } from '@/types/database';
import {
  getInventoryCheckStatus,
  isInventoryMoveCheckBlocked,
} from '@/app/(dashboard)/inventory/utils';
import type { InventoryLocation } from '@/app/(dashboard)/inventory/types';
import type {
  YardKioskBootstrapResponse,
  YardKioskDirection,
  YardKioskReceipt,
  YardKioskStockItem,
  YardKioskSubmitPayload,
} from '@/lib/inventory/kiosk-types';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from './inventory-auth';
import type { CheckBlockedMoveItem } from './inventory-move';

type InventoryAdminClient = ReturnType<typeof createAdminClient>;

interface KioskConfigRow {
  kiosk_user_id: string;
  is_enabled: boolean;
}

interface KioskLocationRow {
  id: string;
  name: string;
  description: string | null;
  location_type: InventoryLocation['location_type'];
  source_type: InventoryLocation['source_type'];
  external_reference: string | null;
  is_active: boolean;
}

interface KioskLocationAssigneeRow {
  location_id: string | null;
  user?: { full_name: string | null } | Array<{ full_name: string | null }> | null;
}

interface KioskSerializedRow {
  id: string;
  item_number: string;
  name: string;
  category: string;
  last_checked_at: string | null;
  check_interval_days: number | null;
}

interface KioskHardwareBalanceRow {
  quantity: number;
  item:
    | { id: string; name: string; is_active: boolean }
    | Array<{ id: string; name: string; is_active: boolean }>
    | null;
}

type KioskRpcRow = YardKioskReceipt;
const KIOSK_LOCATION_PAGE_SIZE = 1000;

export interface InventoryKioskAccessResult {
  allowed: boolean;
  status: 200 | 401 | 403 | 503;
  error?: string;
  userId?: string;
  yard?: KioskLocationRow;
}

export class InventoryKioskError extends Error {
  status: number;
  code?: string;
  blockedItems?: CheckBlockedMoveItem[];

  constructor(
    message: string,
    status = 400,
    options?: { code?: string; blockedItems?: CheckBlockedMoveItem[] },
  ) {
    super(message);
    this.name = 'InventoryKioskError';
    this.status = status;
    this.code = options?.code;
    this.blockedItems = options?.blockedItems;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getAssigneeProfile(
  user: KioskLocationAssigneeRow['user'],
): { full_name: string | null } | null {
  if (!user) return null;
  return Array.isArray(user) ? user[0] ?? null : user;
}

function getAssigneeNamesByLocationId(
  rows: KioskLocationAssigneeRow[],
): Map<string, string[]> {
  const namesByLocationId = new Map<string, Map<string, string>>();

  rows.forEach((row) => {
    const fullName = getAssigneeProfile(row.user)?.full_name?.trim();
    if (!row.location_id || !fullName) return;

    const names = namesByLocationId.get(row.location_id) ?? new Map<string, string>();
    const normalizedName = fullName.toLocaleLowerCase();
    if (!names.has(normalizedName)) names.set(normalizedName, fullName);
    namesByLocationId.set(row.location_id, names);
  });

  return new Map(
    Array.from(namesByLocationId.entries(), ([locationId, names]) => [
      locationId,
      Array.from(names.values()).sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

function toKioskLocation(
  row: KioskLocationRow,
  primaryUserNames: string[] = [],
  secondaryUserNames: string[] = [],
) {
  const primaryNames = new Set(primaryUserNames.map((name) => name.toLocaleLowerCase()));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    location_type: row.location_type,
    source_type: row.source_type,
    external_reference: row.external_reference,
    primary_user_names: primaryUserNames,
    secondary_user_names: secondaryUserNames.filter(
      (name) => !primaryNames.has(name.toLocaleLowerCase()),
    ),
  };
}

function normalizeHardwareItem(row: KioskHardwareBalanceRow['item']) {
  if (Array.isArray(row)) return row[0] || null;
  return row;
}

async function loadActiveYard(admin: InventoryAdminClient): Promise<KioskLocationRow | null> {
  const { data, error } = await admin
    .from('inventory_locations')
    .select('id, name, description, location_type, source_type, external_reference, is_active')
    .eq('location_type', 'yard')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(2);

  if (error) throw error;
  const rows = (data || []) as KioskLocationRow[];
  return rows.length === 1 ? rows[0] : null;
}

async function loadKioskLocations(
  admin: InventoryAdminClient,
  yardId: string,
  includeLegacyQuotes: boolean,
): Promise<KioskLocationRow[]> {
  const locations: KioskLocationRow[] = [];

  for (let offset = 0; ; offset += KIOSK_LOCATION_PAGE_SIZE) {
    let query = admin
      .from('inventory_locations')
      .select('id, name, description, location_type, source_type, external_reference, is_active')
      .eq('is_active', true)
      .neq('id', yardId);
    if (!includeLegacyQuotes) {
      query = query.neq('source_type', 'legacy_quote');
    }
    const { data, error } = await query
      .order('location_type', { ascending: true })
      .order('name', { ascending: true })
      .range(offset, offset + KIOSK_LOCATION_PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data || []) as KioskLocationRow[];
    locations.push(...page);
    if (page.length < KIOSK_LOCATION_PAGE_SIZE) break;
  }

  return locations;
}

export async function requireInventoryKioskAccess(): Promise<InventoryKioskAccessResult> {
  const access = await requireInventoryAccess();
  if (!access.allowed || !access.userId) {
    return {
      allowed: false,
      status: access.status,
      error: access.error,
    };
  }

  const admin = createAdminClient();
  const [{ data: config, error: configError }, yard] = await Promise.all([
    admin
      .from('inventory_kiosk_config')
      .select('kiosk_user_id, is_enabled')
      .eq('id', 1)
      .maybeSingle(),
    loadActiveYard(admin),
  ]);

  if (configError) throw configError;
  if (!config || !(config as KioskConfigRow).is_enabled) {
    return {
      allowed: false,
      status: 503,
      error: 'The Yard kiosk has not been configured',
    };
  }
  if ((config as KioskConfigRow).kiosk_user_id !== access.userId) {
    return {
      allowed: false,
      status: 403,
      error: 'This account is not authorised for the Yard kiosk',
    };
  }
  if (!yard) {
    return {
      allowed: false,
      status: 503,
      error: 'Exactly one active Yard location is required',
    };
  }

  return {
    allowed: true,
    status: 200,
    userId: access.userId,
    yard,
  };
}

export async function getInventoryKioskPostLoginPath(
  profileId: string,
): Promise<'/yard-kiosk' | null> {
  if (!profileId) return null;

  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_config')
    .select('id')
    .eq('id', 1)
    .eq('kiosk_user_id', profileId)
    .eq('is_enabled', true)
    .maybeSingle();

  if (error) {
    console.error('Failed to resolve Yard kiosk post-login route:', error);
    return null;
  }
  return data ? '/yard-kiosk' : null;
}

function assertKioskAccess(
  access: InventoryKioskAccessResult,
): asserts access is InventoryKioskAccessResult & { allowed: true; userId: string; yard: KioskLocationRow } {
  if (!access.allowed || !access.userId || !access.yard) {
    throw new InventoryKioskError(access.error || 'Yard kiosk access denied', access.status);
  }
}

export async function getYardKioskBootstrap(
  access: InventoryKioskAccessResult,
  options: { includeLegacyQuotes?: boolean } = {},
): Promise<YardKioskBootstrapResponse> {
  assertKioskAccess(access);
  const admin = createAdminClient();
  const [locationRows, { data: categories, error: categoriesError }] = await Promise.all([
    loadKioskLocations(admin, access.yard.id, options.includeLegacyQuotes === true),
    admin
      .from('inventory_item_categories')
      .select('id, slug, name, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ]);

  if (categoriesError) throw categoriesError;

  const locationIds = locationRows.map((location) => location.id);
  const [primaryAssignmentsResult, secondaryAssignmentsResult] = locationIds.length > 0
    ? await Promise.all([
        admin
          .from('inventory_user_locations')
          .select(`
            location_id,
            user:profiles!inventory_user_locations_user_id_fkey(full_name)
          `)
          .limit(5000),
        admin
          .from('inventory_user_site_locations')
          .select(`
            location_id,
            user:profiles!inventory_user_site_locations_user_id_fkey(full_name)
          `)
          .limit(5000),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (primaryAssignmentsResult.error) throw primaryAssignmentsResult.error;
  if (secondaryAssignmentsResult.error) throw secondaryAssignmentsResult.error;

  const primaryNamesByLocationId = getAssigneeNamesByLocationId(
    (primaryAssignmentsResult.data || []) as unknown as KioskLocationAssigneeRow[],
  );
  const secondaryNamesByLocationId = getAssigneeNamesByLocationId(
    (secondaryAssignmentsResult.data || []) as unknown as KioskLocationAssigneeRow[],
  );

  return {
    configured: true,
    yard: toKioskLocation(access.yard),
    locations: locationRows.map((location) => toKioskLocation(
      location,
      primaryNamesByLocationId.get(location.id) || [],
      secondaryNamesByLocationId.get(location.id) || [],
    )),
    categories: categories || [],
  };
}

async function resolveCounterpart(
  admin: InventoryAdminClient,
  yardId: string,
  counterpartId: string,
): Promise<KioskLocationRow> {
  if (!isUuid(counterpartId) || counterpartId === yardId) {
    throw new InventoryKioskError('Choose an active non-Yard location', 400);
  }

  const { data, error } = await admin
    .from('inventory_locations')
    .select('id, name, description, location_type, source_type, external_reference, is_active')
    .eq('id', counterpartId)
    .eq('is_active', true)
    .neq('location_type', 'yard')
    .single();

  if (error || !data) {
    throw new InventoryKioskError('Counterpart location is no longer available', 409);
  }
  return data as KioskLocationRow;
}

export async function getYardKioskStock(
  access: InventoryKioskAccessResult,
  direction: YardKioskDirection,
  counterpartId: string,
): Promise<{ source_location_id: string; items: YardKioskStockItem[] }> {
  assertKioskAccess(access);
  if (direction !== 'take' && direction !== 'return') {
    throw new InventoryKioskError('Direction must be take or return', 400);
  }

  const admin = createAdminClient();
  const counterpart = await resolveCounterpart(admin, access.yard.id, counterpartId);
  const source = direction === 'take' ? access.yard : counterpart;
  const destination = direction === 'take' ? counterpart : access.yard;

  const [{ data: serialized, error: serializedError }, { data: hardware, error: hardwareError }] = await Promise.all([
    admin
      .from('inventory_items')
      .select('id, item_number, name, category, last_checked_at, check_interval_days')
      .eq('status', 'active')
      .eq('location_id', source.id)
      .order('name', { ascending: true })
      .order('item_number', { ascending: true })
      .limit(1000),
    admin
      .from('inventory_hardware_balances')
      .select('quantity, item:inventory_hardware_items!inner(id, name, is_active)')
      .eq('location_id', source.id)
      .gt('quantity', 0)
      .eq('item.is_active', true)
      .order('quantity', { ascending: false }),
  ]);

  if (serializedError) throw serializedError;
  if (hardwareError) throw hardwareError;

  const sourceLocation = toKioskLocation(source);
  const destinationLocation = toKioskLocation(destination);
  const serializedItems: YardKioskStockItem[] = ((serialized || []) as KioskSerializedRow[]).map((item) => {
    const statusItem = { ...item, location: sourceLocation };
    return {
      kind: 'serialized',
      id: item.id,
      item_number: item.item_number,
      name: item.name,
      category: item.category,
      check_status: getInventoryCheckStatus(statusItem),
      is_check_blocked: isInventoryMoveCheckBlocked(statusItem, destinationLocation),
    };
  });

  const hardwareItems: YardKioskStockItem[] = ((hardware || []) as unknown as KioskHardwareBalanceRow[])
    .flatMap((balance) => {
      const item = normalizeHardwareItem(balance.item);
      if (!item?.is_active) return [];
      return [{
        kind: 'hardware' as const,
        id: item.id,
        name: item.name,
        category: 'hardware' as const,
        available_quantity: balance.quantity,
      }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    source_location_id: source.id,
    items: [...serializedItems, ...hardwareItems],
  };
}

export function validateYardKioskSubmitPayload(input: unknown): YardKioskSubmitPayload {
  if (!input || typeof input !== 'object') {
    throw new InventoryKioskError('Invalid Yard kiosk basket', 400);
  }

  const payload = input as Partial<YardKioskSubmitPayload>;
  if (payload.direction !== 'take' && payload.direction !== 'return') {
    throw new InventoryKioskError('Direction must be take or return', 400);
  }
  if (!isUuid(payload.counterpart_location_id)) {
    throw new InventoryKioskError('Choose a valid counterpart location', 400);
  }

  const serializedIds = Array.isArray(payload.serialized_item_ids)
    ? payload.serialized_item_ids
    : [];
  const hardwareLines = Array.isArray(payload.hardware_lines)
    ? payload.hardware_lines
    : [];

  if (serializedIds.length === 0 && hardwareLines.length === 0) {
    throw new InventoryKioskError('Add at least one item to the basket', 400);
  }
  if (serializedIds.length > 500 || hardwareLines.length > 500) {
    throw new InventoryKioskError('A basket supports at most 500 lines of each type', 400);
  }
  if (serializedIds.some((id) => !isUuid(id)) || new Set(serializedIds).size !== serializedIds.length) {
    throw new InventoryKioskError('Serialized item ids must be valid and unique', 400);
  }

  const seenHardwareIds = new Set<string>();
  for (const line of hardwareLines) {
    if (
      !line
      || !isUuid(line.item_id)
      || !Number.isSafeInteger(line.quantity)
      || line.quantity < 1
      || seenHardwareIds.has(line.item_id)
    ) {
      throw new InventoryKioskError('Hardware lines must have a unique item and positive whole-number quantity', 400);
    }
    seenHardwareIds.add(line.item_id);
  }

  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  if (note.length > 500) {
    throw new InventoryKioskError('The transfer note must be 500 characters or less', 400);
  }

  return {
    direction: payload.direction,
    counterpart_location_id: payload.counterpart_location_id,
    serialized_item_ids: serializedIds,
    hardware_lines: hardwareLines.map((line) => ({
      item_id: line.item_id,
      quantity: line.quantity,
    })),
    ...(note ? { note } : {}),
  };
}

async function getBlockedItems(
  admin: InventoryAdminClient,
  yard: KioskLocationRow,
  counterpart: KioskLocationRow,
  payload: YardKioskSubmitPayload,
): Promise<CheckBlockedMoveItem[]> {
  if (payload.direction !== 'take' || payload.serialized_item_ids.length === 0) return [];

  const { data, error } = await admin
    .from('inventory_items')
    .select('id, item_number, name, last_checked_at, check_interval_days')
    .in('id', payload.serialized_item_ids)
    .eq('status', 'active')
    .eq('location_id', yard.id);

  if (error) throw error;

  return ((data || []) as KioskSerializedRow[]).flatMap((item) => {
    const statusItem = { ...item, location: toKioskLocation(yard) };
    if (!isInventoryMoveCheckBlocked(statusItem, toKioskLocation(counterpart))) return [];
    return [{
      id: item.id,
      item_number: item.item_number,
      name: item.name,
      check_status: getInventoryCheckStatus(statusItem),
    }];
  });
}

export async function submitYardKioskBasket(
  access: InventoryKioskAccessResult,
  input: unknown,
): Promise<YardKioskReceipt> {
  assertKioskAccess(access);
  const payload = validateYardKioskSubmitPayload(input);
  const admin = createAdminClient();
  const counterpart = await resolveCounterpart(
    admin,
    access.yard.id,
    payload.counterpart_location_id,
  );
  const blockedItems = await getBlockedItems(admin, access.yard, counterpart, payload);
  if (blockedItems.length > 0) {
    throw new InventoryKioskError(
      blockedItems.length === 1
        ? 'This item needs an inventory check before leaving Yard.'
        : 'These items need inventory checks before leaving Yard.',
      400,
      { code: 'INVENTORY_CHECK_REQUIRED', blockedItems },
    );
  }

  const { data, error } = await admin.rpc('inventory_kiosk_execute_transfer_basket', {
    p_actor: access.userId,
    p_direction: payload.direction,
    p_counterpart_location_id: payload.counterpart_location_id,
    p_serialized_item_ids: payload.serialized_item_ids,
    p_hardware_lines: payload.hardware_lines as unknown as Json,
    p_note: payload.note || null,
  });

  if (error) {
    if (error.message?.includes('Yard kiosk access denied')) {
      throw new InventoryKioskError('Yard kiosk access denied', 403);
    }
    if (error.message?.includes('Inventory check required')) {
      throw new InventoryKioskError(
        'An item now needs an inventory check before leaving Yard.',
        409,
        { code: 'INVENTORY_CHECK_REQUIRED' },
      );
    }
    if (
      error.message?.includes('unavailable')
      || error.message?.includes('changed before')
      || error.message?.includes('not found')
    ) {
      throw new InventoryKioskError('Stock changed. Refresh the basket and try again.', 409);
    }
    throw new InventoryKioskError(error.message || 'Failed to transfer the Yard kiosk basket', 400);
  }

  const row = (data as KioskRpcRow[] | null)?.[0];
  if (!row) {
    throw new InventoryKioskError('The Yard kiosk transfer did not return a receipt', 500);
  }
  return row;
}

export function toInventoryKioskErrorResponse(error: InventoryKioskError) {
  return {
    body: {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.blockedItems ? { blocked_items: error.blockedItems } : {}),
    },
    status: error.status,
  };
}
