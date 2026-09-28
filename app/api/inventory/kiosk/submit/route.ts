import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import {
  InventoryKioskHardwareError,
  verifyInventoryKioskRequestProof,
} from '@/lib/server/inventory-kiosk-device-auth';
import {
  InventoryKioskError,
  requireInventoryKioskAccess,
  submitYardKioskBasket,
  toInventoryKioskErrorResponse,
} from '@/lib/server/inventory-kiosk';

export async function POST(request: NextRequest) {
  let proof: Awaited<ReturnType<typeof verifyInventoryKioskRequestProof>> | null = null;
  try {
    const bodyText = await request.text();
    proof = await verifyInventoryKioskRequestProof(request, bodyText);
    const access = await requireInventoryKioskAccess(
      proof.sessionValidation.profileId || undefined,
    );
    if (!access.allowed) {
      const response = NextResponse.json({ error: access.error }, { status: access.status });
      applyValidationCookieIfNeeded(response, proof.sessionValidation);
      return response;
    }

    const payload = JSON.parse(bodyText) as unknown;
    const response = NextResponse.json(await submitYardKioskBasket(
      access,
      payload,
      {
        hardwareKioskDeviceId: proof.hardwareProofRequired
          ? proof.device?.id
          : undefined,
      },
    ));
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
    console.error('Error submitting Yard kiosk basket:', error);
    const response = NextResponse.json(
      { error: 'Failed to transfer the Yard kiosk basket' },
      { status: 500 },
    );
    if (proof) applyValidationCookieIfNeeded(response, proof.sessionValidation);
    return response;
  }
}
