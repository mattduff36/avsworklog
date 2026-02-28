import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

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

    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const categoryId = (await params).id;
    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('hgv_categories')
      .update({
        name: name.trim(),
        description: description?.trim() || null,
      })
      .eq('id', categoryId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'HGV category with this name already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ category: data });
  } catch (error) {
    console.error('Error updating HGV category:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgv-categories/[id]',
      additionalData: { endpoint: '/api/admin/hgv-categories/[id]' },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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

    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const categoryId = (await params).id;

    const { data: hgvs } = await supabase
      .from('hgvs')
      .select('id')
      .eq('category_id', categoryId)
      .limit(1);

    if (hgvs && hgvs.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete category that is assigned to HGVs' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('hgv_categories')
      .delete()
      .eq('id', categoryId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting HGV category:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgv-categories/[id]',
      additionalData: { endpoint: '/api/admin/hgv-categories/[id]' },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
