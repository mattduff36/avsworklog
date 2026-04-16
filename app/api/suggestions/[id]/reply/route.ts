import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ReplySuggestionRequest {
  note?: string;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: ReplySuggestionRequest = await request.json();
    const note = body.note?.trim() || '';
    if (!note) {
      return NextResponse.json({ error: 'Reply text is required' }, { status: 400 });
    }

    const { data: suggestion, error: suggestionError } = await supabase
      .from('suggestions')
      .select('id, created_by, status')
      .eq('id', id)
      .eq('created_by', user.id)
      .single();

    if (suggestionError) {
      if (suggestionError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
      }
      throw suggestionError;
    }

    const now = new Date().toISOString();
    const { error: suggestionTouchError } = await supabase
      .from('suggestions')
      .update({ updated_at: now })
      .eq('id', id)
      .eq('created_by', user.id);

    if (suggestionTouchError) {
      throw suggestionTouchError;
    }

    const { data: update, error: updateError } = await supabase
      .from('suggestion_updates')
      .insert({
        suggestion_id: id,
        created_by: user.id,
        old_status: suggestion.status,
        new_status: suggestion.status,
        note,
      })
      .select('id, suggestion_id, created_by, old_status, new_status, note, created_at')
      .single();

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      update,
    }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/suggestions/[id]/reply:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/suggestions/[id]/reply',
      additionalData: { endpoint: '/api/suggestions/[id]/reply' },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
