import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { FAQArticleWithCategory, CreateFAQArticleRequest } from '@/types/faq';

/**
 * GET /api/admin/faq/articles
 * Get all FAQ articles (including unpublished) for admin management
 * Query params:
 *  - category_id: Filter by category (optional)
 */
export async function GET(request: NextRequest) {
  try {
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

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('category_id');

    // Build query
    // Note: faq_articles table added by migration - types will update after migration runs
    let query = (supabase as any)
      .from('faq_articles')
      .select(`
        *,
        category:faq_categories(*)
      `)
      .order('sort_order', { ascending: true });

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data: articles, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      articles: articles as FAQArticleWithCategory[],
    });

  } catch (error) {
    console.error('Error in GET /api/admin/faq/articles:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/articles',
      additionalData: { endpoint: '/api/admin/faq/articles' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/faq/articles
 * Create a new FAQ article
 */
export async function POST(request: NextRequest) {
  try {
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

    const body: CreateFAQArticleRequest = await request.json();

    // Validate required fields
    if (!body.category_id || !body.title?.trim() || !body.slug?.trim() || !body.content_md?.trim()) {
      return NextResponse.json({ 
        error: 'Category, title, slug, and content are required' 
      }, { status: 400 });
    }

    // Create article
    // Note: faq_articles table added by migration - types will update after migration runs
    const { data: article, error } = await (supabase as any)
      .from('faq_articles')
      .insert({
        category_id: body.category_id,
        title: body.title.trim(),
        slug: body.slug.trim().toLowerCase().replace(/\s+/g, '-'),
        summary: body.summary?.trim() || null,
        content_md: body.content_md.trim(),
        is_published: body.is_published ?? true,
        sort_order: body.sort_order || 0,
        created_by: user.id,
        updated_by: user.id,
      })
      .select(`
        *,
        category:faq_categories(*)
      `)
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation
        return NextResponse.json({ error: 'An article with this slug already exists in this category' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      article,
    }, { status: 201 });

  } catch (error) {
    console.error('Error in POST /api/admin/faq/articles:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/faq/articles',
      additionalData: { endpoint: '/api/admin/faq/articles' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
