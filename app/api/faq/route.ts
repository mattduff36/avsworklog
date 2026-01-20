import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { FAQArticleWithCategory, FAQCategory } from '@/types/faq';

/**
 * GET /api/faq
 * Search and retrieve FAQ articles
 * Query params:
 *  - query: Search text (optional)
 *  - category: Category slug filter (optional)
 *  - limit: Max results (default 50)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query')?.trim() || '';
    const categorySlug = searchParams.get('category');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

    // Build base query
    // Note: faq_articles/faq_categories tables added by migration - types will update after migration runs
    let articlesQuery = (supabase as any)
      .from('faq_articles')
      .select(`
        *,
        category:faq_categories!inner(*)
      `)
      .eq('is_published', true)
      .eq('faq_categories.is_active', true);

    // Apply category filter
    if (categorySlug) {
      articlesQuery = articlesQuery.eq('faq_categories.slug', categorySlug);
    }

    // Apply search filter using full-text search
    if (query) {
      // Use PostgreSQL full-text search
      articlesQuery = articlesQuery.or(
        `title.ilike.%${query}%,summary.ilike.%${query}%,content_md.ilike.%${query}%`
      );
    }

    // Order by category sort, then article sort
    articlesQuery = articlesQuery
      .order('sort_order', { referencedTable: 'faq_categories', ascending: true })
      .order('sort_order', { ascending: true })
      .limit(limit);

    const { data: articles, error: articlesError } = await articlesQuery;

    if (articlesError) {
      throw articlesError;
    }

    // Also fetch all categories for the sidebar/filter
    const { data: categories, error: categoriesError } = await (supabase as any)
      .from('faq_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (categoriesError) {
      throw categoriesError;
    }

    return NextResponse.json({
      success: true,
      articles: articles as FAQArticleWithCategory[],
      categories: categories as FAQCategory[],
      total: articles?.length || 0,
    });

  } catch (error) {
    console.error('Error in GET /api/faq:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/faq',
      additionalData: { endpoint: '/api/faq' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
