import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { SuggestionWithUser, SuggestionStatus } from '@/types/faq';

/**
 * GET /api/management/suggestions
 * Get all suggestions for manager/admin triage
 * Query params:
 *  - status: Filter by status (optional)
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

    // Check if user is manager/admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Manager/Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as SuggestionStatus | null;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

    // Build query — fetch suggestions first, then look up profiles separately
    // (no direct FK from suggestions.created_by → profiles.id)
    let query = (supabase as any)
      .from('suggestions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: rawSuggestions, error } = await query;

    if (error) {
      throw error;
    }

    // Batch-lookup profile names for the creators
    const creatorIds = [...new Set((rawSuggestions || []).map((s: { created_by: string }) => s.created_by).filter(Boolean))];
    let profileMap = new Map<string, { full_name: string | null }>();

    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', creatorIds);

      if (profiles) {
        profileMap = new Map(profiles.map((p: { id: string; full_name: string | null }) => [p.id, { full_name: p.full_name }]));
      }
    }

    const suggestions = (rawSuggestions || []).map((s: Record<string, unknown>) => ({
      ...s,
      user: profileMap.get(s.created_by as string) || null,
    }));

    // Get counts by status
    const { data: countData } = await (supabase as any)
      .from('suggestions')
      .select('status');

    const counts: Record<string, number> = {
      all: countData?.length || 0,
      new: 0,
      under_review: 0,
      planned: 0,
      completed: 0,
      declined: 0,
    };

    countData?.forEach((s: { status: string }) => {
      if (s.status in counts) {
        counts[s.status]++;
      }
    });

    return NextResponse.json({
      success: true,
      suggestions: suggestions as SuggestionWithUser[],
      counts,
    });

  } catch (error) {
    console.error('Error in GET /api/management/suggestions:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/suggestions',
      additionalData: { endpoint: '/api/management/suggestions' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
