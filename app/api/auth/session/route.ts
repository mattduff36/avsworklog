import { NextResponse } from 'next/server';
import { canEditOwnBasicProfileFields } from '@/lib/profile/permissions';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

export async function GET() {
  const current = await getCurrentAuthenticatedProfile({ allowLocked: true, includeEmail: true });
  if (!current) {
    return NextResponse.json(
      {
        authenticated: false,
        locked: false,
        user: null,
        profile: null,
        data_token_available: Boolean(process.env.SUPABASE_JWT_SECRET),
      },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    authenticated: true,
    locked: current.validation.status === 'locked',
    user: {
      id: current.profile.id,
      email: current.profile.email,
    },
    profile: current.profile,
    can_edit_basic_fields: canEditOwnBasicProfileFields(current.profile),
    data_token_available: Boolean(process.env.SUPABASE_JWT_SECRET),
  });

  applyValidationCookieIfNeeded(response, current.validation);
  return response;
}
