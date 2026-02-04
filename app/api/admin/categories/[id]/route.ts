import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

// PUT - Update category
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
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const categoryId = (await params).id;
    const body = await request.json();
    const { name, description, applies_to } = body;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }

    // Validate applies_to if provided
    if (applies_to !== undefined && (!Array.isArray(applies_to) || applies_to.length === 0)) {
      return NextResponse.json(
        { error: 'applies_to must be a non-empty array' },
        { status: 400 }
      );
    }

    // Build updates object
    const updates: Record<string, any> = {
      name: name.trim(),
      description: description?.trim() || null,
    };

    if (applies_to !== undefined) {
      updates.applies_to = applies_to;
    }

    // Update category
    const { data, error } = await supabase
      .from('vehicle_categories')
      .update(updates)
      .eq('id', categoryId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Category with this name already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ category: data });
  } catch (error) {
    console.error('Error updating category:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/categories/[id]',
      additionalData: {
        endpoint: '/api/admin/categories/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete category
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
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const categoryId = (await params).id;

    // Check if category is in use by any vehicles or plant
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id')
      .eq('category_id', categoryId)
      .limit(1);

    const { data: plant } = await supabase
      .from('plant')
      .select('id')
      .eq('category_id', categoryId)
      .limit(1);

    if ((vehicles && vehicles.length > 0) || (plant && plant.length > 0)) {
      return NextResponse.json(
        {
          error: 'Cannot delete category that is assigned to vehicles or plant',
        },
        { status: 400 }
      );
    }

    // Delete category
    const { error } = await supabase
      .from('vehicle_categories')
      .delete()
      .eq('id', categoryId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/categories/[id]',
      additionalData: {
        endpoint: '/api/admin/categories/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

