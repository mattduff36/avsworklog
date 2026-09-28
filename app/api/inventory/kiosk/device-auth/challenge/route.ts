import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  InventoryKioskHardwareError,
  issueInventoryKioskAuthenticationChallenge,
} from '@/lib/server/inventory-kiosk-device-auth';

const challengeSchema = z.object({
  device_id: z.string().uuid(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const body = challengeSchema.parse(await request.json());
    const challenge = await issueInventoryKioskAuthenticationChallenge(body.device_id);
    return NextResponse.json(challenge, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof InventoryKioskHardwareError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to create kiosk challenge',
        code: error instanceof InventoryKioskHardwareError
          ? error.code
          : 'HARDWARE_CHALLENGE_FAILED',
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
