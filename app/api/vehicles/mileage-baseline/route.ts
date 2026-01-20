import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * GET /api/vehicles/mileage-baseline?vehicleId=xxx
 * 
 * Returns the last known mileage for a vehicle, for sanity-check validation.
 * Uses service role to bypass RLS and ensure consistent data access.
 * 
 * Sources (in priority order):
 * 1. vehicle_maintenance.current_mileage (most reliable, auto-updated from inspections)
 * 2. Latest vehicle_inspections.current_mileage (fallback if no maintenance record)
 * 
 * Returns: { baselineMileage: number | null, baselineSource: string, lastUpdated: string | null }
 */
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get vehicleId from query params
    const { searchParams } = new URL(request.url);
    const vehicleId = searchParams.get('vehicleId');

    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
    }

    // Use service role client to bypass RLS for consistent access
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Try to get mileage from vehicle_maintenance first (most reliable)
    const { data: maintenance, error: maintenanceError } = await supabaseAdmin
      .from('vehicle_maintenance')
      .select('current_mileage, last_mileage_update')
      .eq('vehicle_id', vehicleId)
      .single();

    if (!maintenanceError && maintenance && maintenance.current_mileage !== null) {
      return NextResponse.json({
        baselineMileage: maintenance.current_mileage,
        baselineSource: 'maintenance_record',
        lastUpdated: maintenance.last_mileage_update,
      });
    }

    // Fallback: Get latest inspection mileage
    const { data: inspections, error: inspectionError } = await supabaseAdmin
      .from('vehicle_inspections')
      .select('current_mileage, created_at')
      .eq('vehicle_id', vehicleId)
      .not('current_mileage', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!inspectionError && inspections && inspections.length > 0) {
      return NextResponse.json({
        baselineMileage: inspections[0].current_mileage,
        baselineSource: 'last_inspection',
        lastUpdated: inspections[0].created_at,
      });
    }

    // No mileage data found - this is fine for new vehicles
    return NextResponse.json({
      baselineMileage: null,
      baselineSource: 'none',
      lastUpdated: null,
    });
  } catch (error) {
    console.error('Error in mileage-baseline endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
