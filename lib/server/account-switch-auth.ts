import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { buildAccountSwitchErrorResponse } from '@/lib/server/account-switch-route-helpers';

export interface AccountSwitchActorAccess {
  userId: string;
  email: string | null;
}

export async function getAccountSwitchActorAccess(): Promise<{
  access: AccountSwitchActorAccess | null;
  errorResponse: NextResponse | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      access: null,
      errorResponse: buildAccountSwitchErrorResponse('UNAUTHORIZED', 'Unauthorized', 401),
    };
  }

  return {
    access: {
      userId: user.id,
      email: user.email || null,
    },
    errorResponse: null,
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
