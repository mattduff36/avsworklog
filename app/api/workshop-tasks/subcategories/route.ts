import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

/**
 * GET /api/workshop-tasks/subcategories
 * List all subcategories (optionally filtered by category_id)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const categoryId = searchParams.get('category_id');
    const includeInactive = searchParams.get('include_inactive') === 'true';

    let query = supabase
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
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data: subcategories, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      subcategories: subcategories || [],
    });
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/subcategories',
      additionalData: {
        endpoint: 'GET /api/workshop-tasks/subcategories',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workshop-tasks/subcategories
 * Create a new subcategory (manager/admin only)
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { category_id, name, slug, sort_order, ui_color, ui_icon, ui_badge_style } = body;

    // Validate required fields
    if (!category_id || !name || !slug) {
      return NextResponse.json(
        { error: 'Missing required fields: category_id, name, slug' },
        { status: 400 }
      );
    }

    // Insert subcategory
    const { data: subcategory, error: insertError } = await supabase
      .from('workshop_task_subcategories')
      .insert({
        category_id,
        name,
        slug: slug.toLowerCase(),
        sort_order: sort_order || 0,
        is_active: true,
        ui_color,
        ui_icon,
        ui_badge_style,
        created_by: user.id,
      })
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
        created_at
      `)
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        // Unique constraint violation
        return NextResponse.json(
          { error: 'A subcategory with this slug already exists in this category' },
          { status: 409 }
        );
      }
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      subcategory,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating subcategory:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/subcategories',
      additionalData: {
        endpoint: 'POST /api/workshop-tasks/subcategories',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
