import { NextResponse } from 'next/server';
import { validateAppSession } from '@/lib/server/app-auth/session';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const appSession = await validateAppSession();
  if (appSession.failureReason === 'kiosk_session_restricted') {
    return NextResponse.json(
      { error: 'Yard kiosk sessions cannot request general data tokens' },
      { status: 403 },
    );
  }
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: 'No active access token' }, { status: 503 });
  }

  return NextResponse.json({
    token: session.access_token,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000),
  });
}
