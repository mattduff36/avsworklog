import { NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export function jsonWithWorkshopSession(
  validation: AppSessionValidationResult,
  body: unknown,
  status = 200
): NextResponse {
  const response = NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
  applyValidationCookieIfNeeded(response, validation);
  return response;
}
