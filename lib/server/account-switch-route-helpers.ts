import { NextResponse } from 'next/server';
import { isAccountSwitcherEnabledServer } from '@/lib/account-switch/feature-flag';

export interface AccountSwitchErrorBody {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export function getAccountSwitcherDisabledResponse(): NextResponse | null {
  if (isAccountSwitcherEnabledServer()) return null;
  return buildAccountSwitchErrorResponse('FEATURE_NOT_ENABLED', 'Feature not enabled', 404);
}

export function buildAccountSwitchErrorResponse(
  code: string,
  error: string,
  status: number,
  details?: Record<string, unknown>
): NextResponse<AccountSwitchErrorBody> {
  return NextResponse.json(
    {
      error,
      code,
      ...(details ? { details } : {}),
    },
    { status }
  );
}
