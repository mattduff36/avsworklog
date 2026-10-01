import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import {
  getCurrentAuthenticatedProfile,
  revokeOtherAppSessionsForProfile,
  type AppSessionValidationResult,
} from '@/lib/server/app-auth/session';
import { verifyUserPassword } from '@/lib/server/password-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { validatePasswordStrength } from '@/lib/utils/password';

interface ChangePasswordBody {
  currentPassword?: string;
  password?: string;
}

function jsonWithSession(
  body: Record<string, unknown>,
  validation: AppSessionValidationResult,
  status?: number
) {
  const response = NextResponse.json(body, status ? { status } : undefined);
  applyValidationCookieIfNeeded(response, validation);
  return response;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentAuthenticatedProfile({ includeEmail: true });
  if (!current) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ChangePasswordBody | null;
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!currentPassword.trim()) {
    return jsonWithSession({ error: 'Current password is required' }, current.validation, 400);
  }
  if (!password.trim()) {
    return jsonWithSession({ error: 'Password is required' }, current.validation, 400);
  }

  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.valid) {
    return jsonWithSession({ error: passwordStrength.errors[0] }, current.validation, 400);
  }
  if (!current.profile.email) {
    return jsonWithSession(
      { error: 'Current password verification is unavailable for this account' },
      current.validation,
      400
    );
  }

  const isCurrentPasswordValid = await verifyUserPassword(
    current.profile.email,
    current.profile.id,
    currentPassword
  );
  if (!isCurrentPasswordValid) {
    return jsonWithSession({ error: 'Current password is incorrect' }, current.validation, 401);
  }

  const admin = createAdminClient();
  const profileId = current.profile.id;
  const currentSessionId = current.validation.session?.id ?? null;

  async function revokeOtherSessions() {
    await revokeOtherAppSessionsForProfile(
      profileId,
      currentSessionId,
      'password_changed'
    );
  }

  async function restorePreviousPassword() {
    const { error } = await admin.auth.admin.updateUserById(profileId, {
      password: currentPassword,
    });
    return !error;
  }

  // Revoke before the password write so a failed write cannot leave other devices
  // signed in under a new password. Sweep again afterwards so a login that started
  // with the old password cannot keep a session created during the update.
  try {
    await revokeOtherSessions();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to revoke other sessions';
    return jsonWithSession({ error: message }, current.validation, 500);
  }

  const { error: authError } = await admin.auth.admin.updateUserById(profileId, {
    password,
  });
  if (authError) {
    return jsonWithSession({ error: authError.message }, current.validation, 400);
  }

  try {
    await revokeOtherSessions();
  } catch {
    const restored = await restorePreviousPassword();
    return jsonWithSession(
      {
        error: restored
          ? 'Password change could not be completed. Please try again.'
          : 'Password was changed, but other devices could not be signed out. Sign in with the new password.',
      },
      current.validation,
      500
    );
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', profileId);

  if (profileError) {
    const restored = await restorePreviousPassword();
    return jsonWithSession(
      {
        error: restored
          ? 'Password change could not be completed. Please try again.'
          : 'Password was changed, but the account could not be updated. Sign in with the new password.',
      },
      current.validation,
      500
    );
  }

  return jsonWithSession({ success: true }, current.validation);
}
