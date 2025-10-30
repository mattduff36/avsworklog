import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

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

// PUT - Update vehicle
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const vehicleId = (await params).id;
    const body = await request.json();
    const { reg_number, category_id, status } = body;

    // Validate required fields
    if (!reg_number) {
      return NextResponse.json(
        { error: 'Registration number is required' },
        { status: 400 }
      );
    }

    // Update vehicle
    const { data, error } = await supabase
      .from('vehicles')
      .update({
        reg_number: reg_number.toUpperCase(),
        category_id: category_id || null,
        status: status || 'active',
      })
      .eq('id', vehicleId)
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
    console.error('Error updating vehicle:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete vehicle
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const vehicleId = (await params).id;

    // Check if vehicle has any inspections
    const { data: inspections } = await supabase
      .from('vehicle_inspections')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .limit(1);

    if (inspections && inspections.length > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot delete vehicle with existing inspections. Set status to inactive instead.',
        },
        { status: 400 }
      );
    }

    // Delete vehicle
    const { error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', vehicleId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

