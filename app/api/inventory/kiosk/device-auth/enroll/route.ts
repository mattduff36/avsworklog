import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getKioskPairingCookie } from '@/lib/server/inventory-kiosk-device-cookies';
import {
  enrollInventoryKioskHardware,
  InventoryKioskHardwareError,
} from '@/lib/server/inventory-kiosk-device-auth';

const enrollmentSchema = z.object({
  challenge_id: z.string().uuid(),
  challenge: z.string().min(40).max(48),
  public_key_spki: z.string().min(80).max(1024),
  certificate_chain: z.array(z.string().min(100).max(16_384)).min(2).max(8),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const body = enrollmentSchema.parse(await request.json());
    const enrollment = await enrollInventoryKioskHardware({
      pairingToken: getKioskPairingCookie(request),
      challengeId: body.challenge_id,
      challenge: body.challenge,
      publicKeySpki: body.public_key_spki,
      certificateChain: body.certificate_chain,
    });
    return NextResponse.json(
      {
        enrolled: true,
        fingerprint: enrollment.fingerprint,
        security_level: enrollment.attestation.security_level,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const status = error instanceof InventoryKioskHardwareError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to enroll kiosk hardware',
        code: error instanceof InventoryKioskHardwareError
          ? error.code
          : 'ANDROID_ENROLLMENT_FAILED',
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
