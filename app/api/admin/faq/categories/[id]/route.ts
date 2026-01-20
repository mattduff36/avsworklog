import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { UpdateFAQCategoryRequest } from '@/types/faq';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/faq/categories/[id]
 * Get a single FAQ category
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    // Note: faq_categories table added by migration - types will update after migration runs
    const { data: category, error } = await (supabase as any)
      .from('faq_categories')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      category,
    });

  } catch (error) {
    console.error('Error in GET /api/admin/faq/categories/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/categories/[id]',
      additionalData: { endpoint: '/api/admin/faq/categories/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/faq/categories/[id]
 * Update a FAQ category
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    const body: UpdateFAQCategoryRequest = await request.json();

    // Prepare update data
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.slug !== undefined) updateData.slug = body.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.sort_order !== undefined) updateData.sort_order = body.sort_order;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    // Note: faq_categories table added by migration - types will update after migration runs
    const { data: category, error } = await (supabase as any)
      .from('faq_categories')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 });
      }
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A category with this slug already exists' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      category,
    });

  } catch (error) {
    console.error('Error in PATCH /api/admin/faq/categories/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/categories/[id]',
      additionalData: { endpoint: '/api/admin/faq/categories/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/faq/categories/[id]
 * Delete a FAQ category (only if empty)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    // Check if category has articles
    // Note: faq_articles table added by migration - types will update after migration runs
    const { count } = await (supabase as any)
      .from('faq_articles')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', id);

    if (count && count > 0) {
      return NextResponse.json({ 
        error: 'Cannot delete category with existing articles. Move or delete articles first.' 
      }, { status: 400 });
    }

    const { error } = await (supabase as any)
      .from('faq_categories')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'Category deleted',
    });

  } catch (error) {
    console.error('Error in DELETE /api/admin/faq/categories/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/categories/[id]',
      additionalData: { endpoint: '/api/admin/faq/categories/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
