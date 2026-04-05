import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { clearAllAuthCookies, clearLegacyLockCookie } from '@/lib/server/app-auth/response';
import {
  setAppSessionCookieInResponse,
} from '@/lib/server/app-auth/cookies';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { issueAppSession, validateAppSession, revokeAppSession } from '@/lib/server/app-auth/session';

interface LoginRequestBody {
  email?: string;
  password?: string;
  rememberMe?: boolean;
  deviceId?: string;
  deviceLabel?: string;
}

async function verifyPasswordLogin(email: string, password: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured');
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  async function attemptPassword(candidate: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: candidate,
    });

    if (error || !data.user) {
      return null;
    }

    return data.user;
  }

  const directMatch = await attemptPassword(password);
  if (directMatch) {
    return directMatch;
  }

  const trimmedPassword = password.trim();
  if (!trimmedPassword || trimmedPassword === password) {
    return null;
  }

  return attemptPassword(trimmedPassword);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LoginRequestBody;
    const email = body.email?.trim() || '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = await verifyPasswordLogin(email, password);
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const existing = await validateAppSession({ allowLocked: true });
    const nextSession = await issueAppSession({
      profileId: user.id,
      source: 'password_login',
      rememberMe: body.rememberMe === true,
      rawDeviceId: body.deviceId || null,
      deviceLabel: body.deviceLabel || null,
      actorProfileId: user.id,
    });

    if (existing.session) {
      await revokeAppSession(existing.session.id, 'replaced_by_password_login', nextSession.row.id);
    }

    const profile = await getAppAuthProfile(user.id, user.email || null);
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email || null,
      },
      profile: {
        id: profile.id,
        must_change_password: profile.must_change_password,
      },
    });

    clearAllAuthCookies(request, response);
    setAppSessionCookieInResponse(response, nextSession.cookieValue, nextSession.cookieExpiresAt);
    clearLegacyLockCookie(response);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Login failed' },
      { status: 500 }
    );
  }
}
