import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import type { FleetAssetLinkType } from '@/app/(dashboard)/inventory/types';
import {
  buildLinkedAssetColumns,
  enrichInventoryLocations,
  getLocationTypeForLinkedAsset,
  listInventoryLocations,
} from '@/lib/server/inventory-locations';
import type { Database } from '@/types/database';

export const INVENTORY_LOCATION_SEARCH_DEFAULT_LIMIT = 50;
const INVENTORY_LOCATION_SEARCH_MAX_LIMIT = 100;

type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];

interface LocationRequestBody {
  name?: string;
  description?: string | null;
  linked_asset_type?: FleetAssetLinkType | 'none';
  linked_asset_id?: string | null;
}

function normalizeLocationSearchLimit(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return INVENTORY_LOCATION_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), INVENTORY_LOCATION_SEARCH_MAX_LIMIT);
}

function normalizeLocationSearchOffset(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(parsed, 0);
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

    const admin = createAdminClient();
    const search = searchParams.get('search')?.trim() || '';
    const limit = normalizeLocationSearchLimit(searchParams.get('limit'));
    const offset = normalizeLocationSearchOffset(searchParams.get('offset'));
    const includeLegacyQuotes = searchParams.get('includeLegacyQuotes') === 'true';
    const { locations: locationRows, total } = await listInventoryLocations(admin, {
      search,
      includeLegacyQuotes,
      limit,
      offset,
    });
    const locations = await enrichInventoryLocations(admin, locationRows);

    return NextResponse.json({
      locations,
      pagination: {
        offset,
        limit,
        total,
        has_more: offset + locations.length < total,
      },
    });
  } catch (error) {
    console.error('Error fetching inventory locations:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory locations' }, { status: 500 });
  }
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
