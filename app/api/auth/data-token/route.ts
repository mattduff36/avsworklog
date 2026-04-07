import { NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { validateAppSession } from '@/lib/server/app-auth/session';
import { issueSupabaseDataToken } from '@/lib/server/app-auth/supabase-token';

export async function GET() {
  const validation = await validateAppSession({ includeEmail: true });
  if (!validation.session || validation.status === 'missing' || validation.status === 'invalid') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (validation.status === 'locked') {
    return NextResponse.json({ error: 'Session is locked' }, { status: 423 });
  }

  const token = await issueSupabaseDataToken({
    profileId: validation.session.profile_id,
    email: validation.email,
    sessionId: validation.session.id,
  });

  if (!token) {
    return NextResponse.json(
      { error: 'SUPABASE_JWT_SECRET is not configured' },
      { status: 503 }
    );
  }

  const response = NextResponse.json({
    token: token.token,
    expires_at: token.expiresAt,
  });

  applyValidationCookieIfNeeded(response, validation);
  return response;
}
