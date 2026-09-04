import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import type { AppSessionValidationResult } from '@/lib/server/app-auth/session';
import { requireSingleAssetTrackerAccess } from '@/lib/server/fleet-tracker-auth';
import {
  getVelocityfleetLocationByRegistration,
  isVelocityfleetError,
} from '@/lib/services/velocityfleet';
import { enrichTrackerLocationWithVanNickname } from '@/lib/server/fleet-tracker-enrichment';

function jsonWithSession(
  validation: AppSessionValidationResult,
  body: unknown,
  status = 200
): NextResponse {
  const response = NextResponse.json(body, { status });
  applyValidationCookieIfNeeded(response, validation);
  return response;
}

export async function GET(request: NextRequest) {
  const access = await requireSingleAssetTrackerAccess();
  if (!access.ok) {
    return jsonWithSession(
      access.validation,
      { error: access.status === 401 ? 'unauthorized' : 'forbidden' },
      access.status
    );
  }

  if (!process.env.VELOCITYFLEET_API_KEY) {
    return jsonWithSession(
      access.validation,
      { error: 'missing_credentials', message: 'Velocityfleet API token not configured' },
      500
    );
  }

  const { searchParams } = new URL(request.url);
  const regNumber = searchParams.get('regNumber') ?? undefined;

  if (!regNumber) {
    return jsonWithSession(
      access.validation,
      { error: 'bad_request', message: 'Provide regNumber query param' },
      400
    );
  }

  try {
    const location = await getVelocityfleetLocationByRegistration(regNumber);

    if (!location) {
      return jsonWithSession(access.validation, {
        error: 'not_found',
        message: 'Asset not found in Velocityfleet',
      });
    }

    return jsonWithSession(
      access.validation,
      await enrichTrackerLocationWithVanNickname(location)
    );
  } catch (error) {
    if (isVelocityfleetError(error) && error.velocityfleet) {
      return jsonWithSession(
        access.validation,
        { error: error.velocityfleet.code, message: error.velocityfleet.message },
        error.velocityfleet.status
      );
    }

    console.error('[Velocityfleet API] Failed to fetch location');
    return jsonWithSession(
      access.validation,
      { error: 'server_error', message: 'Failed to fetch Velocityfleet data' },
      500
    );
  }
}
