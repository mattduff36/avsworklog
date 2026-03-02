import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { validateRegistrationNumber, formatRegistrationForStorage } from '@/lib/utils/registration';

// PUT - Update an HGV
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const hgvId = (await params).id;
    const body = await request.json();
    const { reg_number, category_id, status, nickname } = body;

    const updates: Record<string, unknown> = {};

    if (reg_number !== undefined) {
      const validationError = validateRegistrationNumber(reg_number);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
      updates.reg_number = formatRegistrationForStorage(reg_number);
    }

    if (category_id !== undefined) {
      updates.category_id = category_id;
    }

    if (status !== undefined) {
      updates.status = status;
    }

    if (nickname !== undefined) {
      updates.nickname = nickname?.trim() || null;
    }

    if ('reg_number' in updates || 'category_id' in updates) {
      const { data: currentHgv } = await supabase
        .from('hgvs')
        .select('reg_number, category_id')
        .eq('id', hgvId)
        .single();

      const finalRegNumber = updates.reg_number || currentHgv?.reg_number;
      const finalCategoryId = updates.category_id || currentHgv?.category_id;

      if (!finalRegNumber) {
        return NextResponse.json(
          { error: 'Registration number is required' },
          { status: 400 }
        );
      }

      if (!finalCategoryId) {
        return NextResponse.json(
          { error: 'Category is required' },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from('hgvs')
      .update(updates)
      .eq('id', hgvId)
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

    return NextResponse.json({ hgv: data });
  } catch (error) {
    console.error('Error updating HGV:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgvs/[id]',
      additionalData: {
        endpoint: '/api/admin/hgvs/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Archive/soft-delete an HGV
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const hgvId = (await params).id;

    const { data: hgv } = await supabase
      .from('hgvs')
      .select('id, reg_number')
      .eq('id', hgvId)
      .single();

    if (!hgv) {
      return NextResponse.json(
        { error: 'HGV not found' },
        { status: 404 }
      );
    }

    const { error: updateError } = await supabase
      .from('hgvs')
      .update({ status: 'archived' })
      .eq('id', hgvId);

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      message: `HGV ${hgv.reg_number} archived`,
    });
  } catch (error) {
    console.error('Error archiving HGV:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgvs/[id]',
      additionalData: {
        endpoint: '/api/admin/hgvs/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
