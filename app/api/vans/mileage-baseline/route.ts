import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * GET /api/vans/mileage-baseline?vanId=xxx
 * 
 * Returns the last known mileage for a van, for sanity-check validation.
 * Uses service role to bypass RLS and ensure consistent data access.
 * 
 * Sources (in priority order):
 * 1. vehicle_maintenance.current_mileage (most reliable, auto-updated from inspections)
 * 2. Latest van_inspections.current_mileage (fallback if no maintenance record)
 * 
 * Returns: { baselineMileage: number | null, baselineSource: string, lastUpdated: string | null }
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const vanId = searchParams.get('vanId') ?? searchParams.get('vehicleId');

    if (!vanId) {
      return NextResponse.json({ error: 'vanId is required' }, { status: 400 });
    }

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

    const { data: maintenance, error: maintenanceError } = await supabaseAdmin
      .from('vehicle_maintenance')
      .select('current_mileage, last_mileage_update')
      .eq('van_id', vanId)
      .single();

    if (!maintenanceError && maintenance && maintenance.current_mileage !== null) {
      return NextResponse.json({
        baselineMileage: maintenance.current_mileage,
        baselineSource: 'maintenance_record',
        lastUpdated: maintenance.last_mileage_update,
      });
    }

    const { data: inspections, error: inspectionError } = await supabaseAdmin
      .from('van_inspections')
      .select('current_mileage, created_at')
      .eq('van_id', vanId)
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
