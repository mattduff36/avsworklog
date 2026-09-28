import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import type { YardKioskDirection } from '@/lib/inventory/kiosk-types';
import {
  InventoryKioskHardwareError,
  verifyInventoryKioskRequestProof,
} from '@/lib/server/inventory-kiosk-device-auth';
import {
  getYardKioskStock,
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
      const response = NextResponse.json({ error: access.error }, { status: access.status });
      applyValidationCookieIfNeeded(response, proof.sessionValidation);
      return response;
    }

    const direction = request.nextUrl.searchParams.get('direction') as YardKioskDirection;
    const counterpartId = request.nextUrl.searchParams.get('counterpart_location_id') || '';
    const unallocated = request.nextUrl.searchParams.get('unallocated') === 'true';
    const response = NextResponse.json(
      await getYardKioskStock(access, direction, counterpartId, { unallocated }),
    );
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
    console.error('Error loading Yard kiosk stock:', error);
    const response = NextResponse.json(
      { error: 'Failed to load stock for this transfer' },
      { status: 500 },
    );
    if (proof) applyValidationCookieIfNeeded(response, proof.sessionValidation);
    return response;
  }
}
