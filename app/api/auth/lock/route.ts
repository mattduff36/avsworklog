import { NextRequest, NextResponse } from 'next/server';
import { clearLegacySupabaseCookies } from '@/lib/server/app-auth/response';
import { setAppSessionCookieInResponse } from '@/lib/server/app-auth/cookies';
import { lockCurrentAppSession } from '@/lib/server/app-auth/session';

export async function POST(request: NextRequest) {
  try {
    const locked = await lockCurrentAppSession();
    const response = NextResponse.json({ success: true });
    clearLegacySupabaseCookies(request, response);
    setAppSessionCookieInResponse(response, locked.cookieValue, locked.cookieExpiresAt);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to lock session' },
      { status: 401 }
    );
  }
}
