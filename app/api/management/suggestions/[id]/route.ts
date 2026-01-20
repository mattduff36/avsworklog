import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isManagerOrAdmin } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { UpdateSuggestionRequest, Suggestion, SuggestionUpdateWithUser } from '@/types/faq';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/management/suggestions/[id]
 * Get a single suggestion with its update history
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

    // Check if user is manager/admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Manager/Admin access required' }, { status: 403 });
    }

    // Fetch suggestion
    // Note: suggestions table added by migration - types will update after migration runs
    const { data: suggestion, error: suggestionError } = await (supabase as any)
      .from('suggestions')
      .select(`
        *,
        user:profiles!created_by(full_name)
      `)
      .eq('id', id)
      .single();

    if (suggestionError) {
      if (suggestionError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
      }
      throw suggestionError;
    }

    // Fetch update history
    const { data: updates, error: updatesError } = await (supabase as any)
      .from('suggestion_updates')
      .select(`
        *,
        user:profiles!created_by(full_name)
      `)
      .eq('suggestion_id', id)
      .order('created_at', { ascending: false });

    if (updatesError) {
      throw updatesError;
    }

    return NextResponse.json({
      success: true,
      suggestion: suggestion as Suggestion & { user?: { full_name: string | null } },
      updates: updates as SuggestionUpdateWithUser[],
    });

  } catch (error) {
    console.error('Error in GET /api/management/suggestions/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/suggestions/[id]',
      additionalData: { endpoint: '/api/management/suggestions/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/management/suggestions/[id]
 * Update a suggestion (status, admin_notes)
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

    // Check if user is manager/admin
    const isAuthorized = await isManagerOrAdmin(user.id);
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Forbidden - Manager/Admin access required' }, { status: 403 });
    }

    const body: UpdateSuggestionRequest = await request.json();

    // Get current suggestion state
    // Note: suggestions table added by migration - types will update after migration runs
    const { data: currentSuggestion, error: fetchError } = await (supabase as any)
      .from('suggestions')
      .select('status')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
      }
      throw fetchError;
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {};
    if (body.status !== undefined) {
      updateData.status = body.status;
    }
    if (body.admin_notes !== undefined) {
      updateData.admin_notes = body.admin_notes;
    }

    // Update suggestion
    const { data: suggestion, error: updateError } = await (supabase as any)
      .from('suggestions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Create update record if status changed or note provided
    if (body.status !== currentSuggestion?.status || body.note) {
      await (supabase as any)
        .from('suggestion_updates')
        .insert({
          suggestion_id: id,
          created_by: user.id,
          old_status: currentSuggestion?.status,
          new_status: body.status || currentSuggestion?.status,
          note: body.note || null,
        });
    }

    return NextResponse.json({
      success: true,
      suggestion,
    });

  } catch (error) {
    console.error('Error in PATCH /api/management/suggestions/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/suggestions/[id]',
      additionalData: { endpoint: '/api/management/suggestions/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
