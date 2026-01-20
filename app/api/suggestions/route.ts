import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { CreateSuggestionRequest, Suggestion } from '@/types/faq';

/**
 * GET /api/suggestions
 * Get current user's own suggestions
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's own suggestions
    // Note: suggestions table added by migration - types will update after migration runs
    const { data: suggestions, error } = await (supabase as any)
      .from('suggestions')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      suggestions: suggestions as Suggestion[],
    });

  } catch (error) {
    console.error('Error in GET /api/suggestions:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/suggestions',
      additionalData: { endpoint: '/api/suggestions' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * POST /api/suggestions
 * Create a new suggestion
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CreateSuggestionRequest = await request.json();

    // Validate required fields
    if (!body.title?.trim() || !body.body?.trim()) {
      return NextResponse.json({ 
        error: 'Title and description are required' 
      }, { status: 400 });
    }

    // Create suggestion
    // Note: suggestions table added by migration - types will update after migration runs
    const { data: suggestion, error } = await (supabase as any)
      .from('suggestions')
      .insert({
        created_by: user.id,
        title: body.title.trim(),
        body: body.body.trim(),
        page_hint: body.page_hint?.trim() || null,
        status: 'new',
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      suggestion,
    }, { status: 201 });

  } catch (error) {
    console.error('Error in POST /api/suggestions:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/suggestions',
      additionalData: { endpoint: '/api/suggestions' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
