import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import type { FleetAssetLinkType } from '@/app/(dashboard)/inventory/types';
import { buildLinkedAssetColumns, getLocationTypeForLinkedAsset } from '@/lib/server/inventory-locations';
import type { Database } from '@/types/database';

export const INVENTORY_LOCATION_SEARCH_MIN_CHARACTERS = 3;
export const INVENTORY_LOCATION_SEARCH_DEFAULT_LIMIT = 50;
const INVENTORY_LOCATION_SEARCH_MAX_LIMIT = 100;

type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];

interface LocationRequestBody {
  name?: string;
  description?: string | null;
  linked_asset_type?: FleetAssetLinkType | 'none';
  linked_asset_id?: string | null;
}

interface InventoryLocationAssigneeRow {
  location_id: string | null;
  user?: { full_name: string | null } | { full_name: string | null }[] | null;
}

function pickAssigneeProfile(
  user: InventoryLocationAssigneeRow['user']
): { full_name: string | null } | null {
  if (!user) return null;
  return Array.isArray(user) ? user[0] ?? null : user;
}

function getAssignedUserNamesByLocationId(...rowGroups: InventoryLocationAssigneeRow[][]): Map<string, string[]> {
  const namesByLocationId = new Map<string, string[]>();

  rowGroups.flat().forEach((row) => {
    const fullName = pickAssigneeProfile(row.user)?.full_name?.trim();
    if (!row.location_id || !fullName) return;

    const names = namesByLocationId.get(row.location_id) || [];
    if (!names.includes(fullName)) names.push(fullName);
    namesByLocationId.set(row.location_id, names);
  });

  namesByLocationId.forEach((names) => names.sort((a, b) => a.localeCompare(b)));
  return namesByLocationId;
}

function normalizeLocationSearchLimit(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return INVENTORY_LOCATION_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), INVENTORY_LOCATION_SEARCH_MAX_LIMIT);
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export async function GET(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    if (searchParams.get('lookup') === 'yard') {
      const { data, error } = await createAdminClient()
        .from('inventory_locations')
        .select('*')
        .eq('name', 'Yard')
        .eq('location_type', 'yard')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(2);

      if (error) throw error;
      const matchingYards = (data || []) as InventoryLocationRow[];
      return NextResponse.json({
        location: matchingYards.length === 1 ? matchingYards[0] : null,
      });
    }

    const search = searchParams.get('search')?.trim() || '';
    if (search.length < INVENTORY_LOCATION_SEARCH_MIN_CHARACTERS) {
      return NextResponse.json({
        locations: [],
        minimum_search_characters: INVENTORY_LOCATION_SEARCH_MIN_CHARACTERS,
      });
    }

    const admin = createAdminClient();
    const limit = normalizeLocationSearchLimit(searchParams.get('limit'));
    const includeLegacyQuotes = searchParams.get('includeLegacyQuotes') === 'true';
    let locationQuery = admin
      .from('inventory_locations')
      .select('*')
      .eq('is_active', true);
    if (!includeLegacyQuotes) {
      locationQuery = locationQuery.neq('source_type', 'legacy_quote');
    }
    const { data: locationData, error: locationsError } = await locationQuery
      .ilike('name', `%${escapeIlikePattern(search)}%`)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);

    if (locationsError) throw locationsError;

    const locationRows = (locationData || []) as InventoryLocationRow[];
    if (locationRows.length === 0) {
      return NextResponse.json({
        locations: [],
        minimum_search_characters: INVENTORY_LOCATION_SEARCH_MIN_CHARACTERS,
      });
    }

    const locationIds = locationRows.map((location) => location.id);
    const vanIds = locationRows.flatMap((location) => location.linked_van_id ? [location.linked_van_id] : []);
    const hgvIds = locationRows.flatMap((location) => location.linked_hgv_id ? [location.linked_hgv_id] : []);
    const plantIds = locationRows.flatMap((location) => location.linked_plant_id ? [location.linked_plant_id] : []);
    const [
      itemLocationsResult,
      vansResult,
      hgvsResult,
      plantResult,
      assignedUsersResult,
      assignedSiteUsersResult,
    ] = await Promise.all([
      admin
        .from('inventory_items')
        .select('location_id')
        .eq('status', 'active')
        .in('location_id', locationIds),
      vanIds.length > 0
        ? admin
          .from('vans')
          .select('id, reg_number, nickname')
          .in('id', vanIds)
        : Promise.resolve({ data: [], error: null }),
      hgvIds.length > 0
        ? admin
          .from('hgvs')
          .select('id, reg_number, nickname')
          .in('id', hgvIds)
        : Promise.resolve({ data: [], error: null }),
      plantIds.length > 0
        ? admin
          .from('plant')
          .select('id, plant_id, reg_number, nickname')
          .in('id', plantIds)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('inventory_user_locations')
        .select(`
          location_id,
          user:profiles!inventory_user_locations_user_id_fkey(full_name)
        `)
        .in('location_id', locationIds),
      admin
        .from('inventory_user_site_locations')
        .select(`
          location_id,
          user:profiles!inventory_user_site_locations_user_id_fkey(full_name)
        `)
        .in('location_id', locationIds),
    ]);

    if (itemLocationsResult.error) throw itemLocationsResult.error;
    if (vansResult.error) throw vansResult.error;
    if (hgvsResult.error) throw hgvsResult.error;
    if (plantResult.error) throw plantResult.error;
    if (assignedUsersResult.error) throw assignedUsersResult.error;
    if (assignedSiteUsersResult.error) throw assignedSiteUsersResult.error;

    const countByLocationId = new Map<string, number>();
    (itemLocationsResult.data || []).forEach((item) => {
      if (!item.location_id) return;
      countByLocationId.set(item.location_id, (countByLocationId.get(item.location_id) || 0) + 1);
    });
    const vanById = new Map((vansResult.data || []).map((van) => [van.id, van]));
    const hgvById = new Map((hgvsResult.data || []).map((hgv) => [hgv.id, hgv]));
    const plantById = new Map((plantResult.data || []).map((asset) => [asset.id, asset]));
    const assignedUserNamesByLocationId = getAssignedUserNamesByLocationId(
      (assignedUsersResult.data || []) as unknown as InventoryLocationAssigneeRow[],
      (assignedSiteUsersResult.data || []) as unknown as InventoryLocationAssigneeRow[]
    );

    const locations = locationRows.map((location) => ({
      ...location,
      item_count: countByLocationId.get(location.id) || 0,
      assigned_user_names: assignedUserNamesByLocationId.get(location.id) || [],
      ...getLinkedAssetDisplay(location, vanById, hgvById, plantById),
    }));

    return NextResponse.json({
      locations,
      minimum_search_characters: INVENTORY_LOCATION_SEARCH_MIN_CHARACTERS,
    });
  } catch (error) {
    console.error('Error fetching inventory locations:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory locations' }, { status: 500 });
  }
}

function getLinkedAssetDisplay(
  location: {
    linked_van_id: string | null;
    linked_hgv_id: string | null;
    linked_plant_id: string | null;
  },
  vanById: Map<string, { reg_number: string; nickname: string | null }>,
  hgvById: Map<string, { reg_number: string; nickname: string | null }>,
  plantById: Map<string, { plant_id: string | null; reg_number: string | null; nickname: string | null }>
) {
  if (location.linked_van_id) {
    const van = vanById.get(location.linked_van_id);
    return {
      linked_asset_type: 'van',
      linked_asset_label: van?.reg_number || null,
      linked_asset_nickname: van?.nickname || null,
    };
  }

  if (location.linked_hgv_id) {
    const hgv = hgvById.get(location.linked_hgv_id);
    return {
      linked_asset_type: 'hgv',
      linked_asset_label: hgv?.reg_number || null,
      linked_asset_nickname: hgv?.nickname || null,
    };
  }

  if (location.linked_plant_id) {
    const asset = plantById.get(location.linked_plant_id);
    return {
      linked_asset_type: 'plant',
      linked_asset_label: asset?.reg_number || asset?.plant_id || null,
      linked_asset_nickname: asset?.nickname || null,
    };
  }

  return {
    linked_asset_type: null,
    linked_asset_label: null,
    linked_asset_nickname: null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as LocationRequestBody;
    const name = body.name?.trim();
    const linkedAssetType = body.linked_asset_type || 'none';
    if (!name) {
      return NextResponse.json({ error: 'Location name is required' }, { status: 400 });
    }

    const { data, error } = await createAdminClient()
      .from('inventory_locations')
      .insert({
        name,
        description: body.description?.trim() || null,
        location_type: getLocationTypeForLinkedAsset(linkedAssetType),
        source_type: linkedAssetType === 'none' ? 'manual' : 'fleet',
        sync_status: linkedAssetType === 'none' ? 'manual' : 'needs_review',
        ...buildLinkedAssetColumns(linkedAssetType, body.linked_asset_id),
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'An active location with this name or linked asset already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ location: { ...data, item_count: 0 } }, { status: 201 });
  } catch (error) {
    console.error('Error creating inventory location:', error);
    return NextResponse.json({ error: 'Failed to create inventory location' }, { status: 500 });
  }
}
