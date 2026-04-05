import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeTrackedPath, shouldTrackPageVisit } from '@/lib/profile/quick-links';
import { PROFILE_HUB_PRD_EPIC_ID } from '@/lib/profile/epic';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

const MIN_SECONDS_BETWEEN_DUPLICATE_TRACKS = 45;

interface PageVisitBody {
  path?: string;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = current.profile.id;

  try {
    const body = (await request.json()) as PageVisitBody;
    const rawPath = body.path?.trim();

    if (!rawPath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 });
    }

    const path = normalizeTrackedPath(rawPath);
    if (!shouldTrackPageVisit(path)) {
      return NextResponse.json({ success: true, skipped: true, reason: 'Not trackable path' });
    }

    if (path.length > 300) {
      return NextResponse.json({ error: 'Path is too long' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: recentDuplicate, error: duplicateError } = await admin
      .from('user_page_visits')
      .select('visited_at')
      .eq('user_id', userId)
      .eq('path', path)
      .order('visited_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (duplicateError) throw duplicateError;

    if (recentDuplicate?.visited_at) {
      const secondsSinceLastVisit =
        (Date.now() - new Date(recentDuplicate.visited_at).getTime()) / 1000;
      if (secondsSinceLastVisit < MIN_SECONDS_BETWEEN_DUPLICATE_TRACKS) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: 'Duplicate visit window',
        });
      }
    }

    const { error: insertError } = await admin.from('user_page_visits').insert({
      user_id: userId,
      path,
    });

    if (insertError) throw insertError;

    return NextResponse.json({
      success: true,
      prd_epic_id: PROFILE_HUB_PRD_EPIC_ID,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record page visit' },
      { status: 500 }
    );
  }
}

