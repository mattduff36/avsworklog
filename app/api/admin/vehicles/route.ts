import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

// Helper to create admin client with service role key
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// GET - List all vehicles with category and last inspector info
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    // Fetch vehicles with category info and last inspection
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select(`
        *,
        vehicle_categories (
          id,
          name
        )
      `)
      .order('reg_number');

    if (error) throw error;

    // For each vehicle, get the last inspector
    const vehiclesWithInspector = await Promise.all(
      (vehicles || []).map(async (vehicle) => {
        const { data: inspections } = await supabase
          .from('vehicle_inspections')
          .select(`
            user_id,
            inspection_date,
            profiles!vehicle_inspections_user_id_fkey (
              full_name
            )
          `)
          .eq('vehicle_id', vehicle.id)
          .order('inspection_date', { ascending: false })
          .limit(1);

        const lastInspection = inspections?.[0] || null;

        return {
          ...vehicle,
          last_inspector: lastInspection?.profiles?.full_name || null,
          last_inspection_date: lastInspection?.inspection_date || null,
        };
      })
    );

    return NextResponse.json({ vehicles: vehiclesWithInspector });
  } catch (error) {
    console.error('Error fetching vehicles:', error);

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/admin/vehicles',
      additionalData: {
        endpoint: '/admin/vehicles',
      },
    );
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create new vehicle
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { reg_number, category_id, nickname } = body;

    // Validate required fields
    if (!reg_number) {
      return NextResponse.json(
        { error: 'Registration number is required' },
        { status: 400 }
      );
    }

    if (!category_id) {
      return NextResponse.json(
        { error: 'Category is required' },
        { status: 400 }
      );
    }

    // Insert vehicle (vehicle_type will auto-sync from category via trigger)
    const { data, error } = await supabase
      .from('vehicles')
      .insert({
        reg_number: reg_number.toUpperCase(),
        category_id: category_id,
        status: 'active',
        nickname: nickname?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Vehicle with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ vehicle: data });
  } catch (error) {
    console.error('Error creating vehicle:', error);

    
    // Log error to database
    await logServerError({
      error: error as Error,
      request,
      componentName: '/admin/vehicles',
      additionalData: {
        endpoint: '/admin/vehicles',
      },
    );
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

