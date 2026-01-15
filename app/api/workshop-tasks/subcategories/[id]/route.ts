import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { UUIDSchema } from '@/lib/validation/schemas';

/**
 * GET /api/workshop-tasks/subcategories/:id
 * Get a single subcategory by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const idValidation = UUIDSchema.safeParse(id);
    if (!idValidation.success) {
      return NextResponse.json({ error: 'Invalid subcategory ID' }, { status: 400 });
    }

    const { data: subcategory, error } = await supabase
      .from('workshop_task_subcategories')
      .select(`
        id,
        category_id,
        name,
        slug,
        sort_order,
        is_active,
        ui_color,
        ui_icon,
        ui_badge_style,
        created_at,
        workshop_task_categories (
          id,
          name,
          slug
        )
      `)
      .eq('id', id)
      .single();

    if (error || !subcategory) {
      return NextResponse.json({ error: 'Subcategory not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      subcategory,
    });
  } catch (error) {
    console.error('Error fetching subcategory:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/subcategories/[id]',
      additionalData: {
        endpoint: 'GET /api/workshop-tasks/subcategories/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/workshop-tasks/subcategories/:id
 * Update a subcategory (manager/admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check manager/admin permission
    const isManager = await isManagerOrAdmin(user.id);
    if (!isManager) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const idValidation = UUIDSchema.safeParse(id);
    if (!idValidation.success) {
      return NextResponse.json({ error: 'Invalid subcategory ID' }, { status: 400 });
    }

    const body = await request.json();
    const { name, slug, sort_order, is_active, ui_color, ui_icon, ui_badge_style } = body;

    // Build update object
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug.toLowerCase();
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (is_active !== undefined) updates.is_active = is_active;
    if (ui_color !== undefined) updates.ui_color = ui_color;
    if (ui_icon !== undefined) updates.ui_icon = ui_icon;
    if (ui_badge_style !== undefined) updates.ui_badge_style = ui_badge_style;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Update subcategory
    const { data: subcategory, error: updateError } = await supabase
      .from('workshop_task_subcategories')
      .update(updates)
      .eq('id', id)
      .select(`
        id,
        category_id,
        name,
        slug,
        sort_order,
        is_active,
        ui_color,
        ui_icon,
        ui_badge_style,
        updated_at
      `)
      .single();

    if (updateError) {
      if (updateError.code === '23505') {
        return NextResponse.json(
          { error: 'A subcategory with this slug already exists in this category' },
          { status: 409 }
        );
      }
      throw updateError;
    }

    if (!subcategory) {
      return NextResponse.json({ error: 'Subcategory not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      subcategory,
    });
  } catch (error) {
    console.error('Error updating subcategory:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/subcategories/[id]',
      additionalData: {
        endpoint: 'PATCH /api/workshop-tasks/subcategories/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workshop-tasks/subcategories/:id
 * Delete a subcategory (manager/admin only)
 * Only allowed if no tasks reference this subcategory
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check manager/admin permission
    const isManager = await isManagerOrAdmin(user.id);
    if (!isManager) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const idValidation = UUIDSchema.safeParse(id);
    if (!idValidation.success) {
      return NextResponse.json({ error: 'Invalid subcategory ID' }, { status: 400 });
    }

    // Check if subcategory is in use
    const { count, error: countError } = await supabase
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('workshop_subcategory_id', id);

    if (countError) {
      throw countError;
    }

    if (count && count > 0) {
      return NextResponse.json(
        { 
          error: 'Cannot delete subcategory: it is referenced by existing tasks',
          tasks_count: count,
        },
        { status: 409 }
      );
    }

    // Delete subcategory
    const { error: deleteError } = await supabase
      .from('workshop_task_subcategories')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      success: true,
      message: 'Subcategory deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting subcategory:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/subcategories/[id]',
      additionalData: {
        endpoint: 'DELETE /api/workshop-tasks/subcategories/[id]',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
