import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

interface ChangePasswordBody {
  password?: string;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ChangePasswordBody | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password.trim()) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { error: authError } = await admin.auth.admin.updateUserById(current.profile.id, {
    password,
  });
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', current.profile.id);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  applyValidationCookieIfNeeded(response, current.validation);
  return response;
}
