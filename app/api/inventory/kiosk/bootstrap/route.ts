import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import {
  InventoryKioskHardwareError,
  verifyInventoryKioskRequestProof,
} from '@/lib/server/inventory-kiosk-device-auth';
import {
  getYardKioskBootstrap,
  InventoryKioskError,
  requireInventoryKioskAccess,
  toInventoryKioskErrorResponse,
} from '@/lib/server/inventory-kiosk';

export async function GET(request: NextRequest) {
  let proof: Awaited<ReturnType<typeof verifyInventoryKioskRequestProof>> | null = null;
  try {
    proof = await verifyInventoryKioskRequestProof(request);
    const access = await requireInventoryKioskAccess(
      proof.sessionValidation.profileId || undefined,
    );
    if (!access.allowed) {
      const response = NextResponse.json(
        { error: access.error, configured: access.status !== 503 },
        { status: access.status },
      );
      applyValidationCookieIfNeeded(response, proof.sessionValidation);
      return response;
    }

    const response = NextResponse.json(await getYardKioskBootstrap(access, {
      includeLegacyQuotes: request.nextUrl.searchParams.get('includeLegacyQuotes') === 'true',
    }));
    applyValidationCookieIfNeeded(response, proof.sessionValidation);
    return response;
  } catch (error) {
    if (error instanceof InventoryKioskHardwareError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (error instanceof InventoryKioskError) {
      const response = toInventoryKioskErrorResponse(error);
      const nextResponse = NextResponse.json(response.body, { status: response.status });
      if (proof) applyValidationCookieIfNeeded(nextResponse, proof.sessionValidation);
      return nextResponse;
    }
    console.error('Error loading Yard kiosk bootstrap:', error);
    const response = NextResponse.json(
      { error: 'Failed to load the Yard kiosk' },
      { status: 500 },
    );
    if (proof) applyValidationCookieIfNeeded(response, proof.sessionValidation);
    return response;
  }
}
