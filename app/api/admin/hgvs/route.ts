import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { validateRegistrationNumber, formatRegistrationForStorage } from '@/lib/utils/registration';

// GET - List all HGVs with category info
export async function GET(request: NextRequest) {
  try {
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!effectiveRole.is_manager_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const supabase = await createServerClient();

    const { data: hgvs, error } = await supabase
      .from('hgvs')
      .select(`
        *,
        hgv_categories (
          id,
          name
        )
      `)
      .order('reg_number');

    if (error) throw error;

    return NextResponse.json({ hgvs: hgvs || [] });
  } catch (error) {
    console.error('Error fetching HGVs:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgvs',
      additionalData: {
        endpoint: '/api/admin/hgvs',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create a new HGV
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
    const {
      reg_number,
      category_id,
      nickname,
      status = 'active',
    } = body;

    if (!category_id) {
      return NextResponse.json(
        { error: 'Category is required' },
        { status: 400 }
      );
    }

    if (!reg_number) {
      return NextResponse.json(
        { error: 'Registration number is required' },
        { status: 400 }
      );
    }

    const validationError = validateRegistrationNumber(reg_number);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const cleanReg = formatRegistrationForStorage(reg_number);

    const { data, error } = await supabase
      .from('hgvs')
      .insert({
        reg_number: cleanReg,
        category_id: category_id,
        status: status,
        nickname: nickname?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'HGV with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    console.log(`[INFO] HGV created: ${data.reg_number} (ID: ${data.id})`);

    return NextResponse.json({
      hgv: data,
      message: 'HGV created successfully',
    });
  } catch (error) {
    console.error('Error creating HGV:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgvs',
      additionalData: {
        endpoint: '/api/admin/hgvs',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
