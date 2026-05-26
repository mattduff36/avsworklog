import { NextRequest, NextResponse } from 'next/server';
import { clearAllAuthCookies } from '@/lib/server/app-auth/response';
import { revokeAppSession, validateAppSession } from '@/lib/server/app-auth/session';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  let response: NextResponse = NextResponse.json({ success: true });

  try {
    const validation = await validateAppSession();
    if (validation.session) {
      await revokeAppSession(validation.session.id, 'logout');
    } else {
      const supabase = await createClient();
      await supabase.auth.signOut();
    }
  } catch (error) {
    response = NextResponse.json(
      { error: error instanceof Error ? error.message : 'Logout failed' },
      { status: 500 }
    );
  } finally {
    clearAllAuthCookies(request, response);
  }

  return response;
}
