import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(request: NextRequest) {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!effectiveRole.is_manager_admin)
      return NextResponse.json({ error: 'Forbidden: Manager or Admin access required' }, { status: 403 });

    const supabase = await createServerClient();
    const body = await request.json();
    const {
      plant_id,
      category_id,
      nickname,
      reg_number,
      serial_number,
      year,
      weight_class,
      status = 'active',
    } = body;

    if (!plant_id) return NextResponse.json({ error: 'Plant ID is required' }, { status: 400 });
    if (!category_id) return NextResponse.json({ error: 'Category is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('plant')
      .insert({
        plant_id: String(plant_id).trim(),
        category_id,
        nickname: nickname?.trim() || null,
        reg_number: reg_number?.trim() || null,
        serial_number: serial_number?.trim() || null,
        year: typeof year === 'number' ? year : null,
        weight_class: weight_class?.trim() || null,
        status,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505')
        return NextResponse.json({ error: 'Plant with this ID already exists' }, { status: 400 });
      throw error;
    }

    return NextResponse.json({ plant: data });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/plant',
      additionalData: { endpoint: '/api/admin/plant' },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

