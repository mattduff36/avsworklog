import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { getCurrentFleetAssignmentSummary } from '@/lib/server/profile-fleet-assignments';

interface InventoryContextUserLocationRow {
  location_id: string | null;
  location?: { is_active: boolean | null } | { is_active: boolean | null }[] | null;
}

function pickUserLocationRelation(
  location: InventoryContextUserLocationRow['location']
): { is_active: boolean | null } | null {
  if (!location) return null;
  return Array.isArray(location) ? location[0] ?? null : location;
}

export async function GET() {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const [{ data, error }, currentFleetAssignment] = await Promise.all([
      admin
      .from('inventory_user_locations')
      .select(`
        user_id,
        location_id,
        location:inventory_locations(*)
      `)
      .eq('user_id', access.userId)
      .maybeSingle(),
      getCurrentFleetAssignmentSummary(admin, access.userId),
    ]);

    if (error) throw error;
    const userLocation = (data || null) as InventoryContextUserLocationRow | null;
    const location = pickUserLocationRelation(userLocation?.location);
    const isUserLocationValid = Boolean(userLocation?.location_id && location?.is_active !== false);

    return NextResponse.json({
      user_id: access.userId,
      is_manager_or_admin: access.isManagerOrAdmin === true,
      role_name: access.roleName,
      role_class: access.roleClass,
      team_id: access.teamId,
      team_name: access.teamName,
      user_location: userLocation,
      is_user_location_valid: isUserLocationValid,
      current_fleet_assignment: currentFleetAssignment,
    });
  } catch (error) {
    console.error('Error fetching inventory context:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory context' }, { status: 500 });
  }
}
