import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { buildAccountSwitchErrorResponse } from '@/lib/server/account-switch-route-helpers';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

export interface AccountSwitchActorAccess {
  userId: string;
  email: string | null;
}

export async function getAccountSwitchActorAccess(source = 'unknown'): Promise<{
  access: AccountSwitchActorAccess | null;
  errorResponse: NextResponse | null;
  authErrorMessage?: string | null;
  hasUser?: boolean;
}> {
  void source;
  const current = await getCurrentAuthenticatedProfile({ allowLocked: true, includeEmail: true });
  if (!current) {
    return {
      access: null,
      errorResponse: buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401),
      authErrorMessage: 'No authenticated user',
      hasUser: false,
    };
  }

  return {
    access: {
      userId: current.profile.id,
      email: current.profile.email || null,
    },
    errorResponse: null,
    authErrorMessage: null,
    hasUser: true,
  };
}

export async function verifyUserPassword(
  email: string | null,
  expectedUserId: string,
  password: string
): Promise<boolean> {
  if (!email || !password) return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return false;

  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return false;
  }

  return data.user.id === expectedUserId;
}
