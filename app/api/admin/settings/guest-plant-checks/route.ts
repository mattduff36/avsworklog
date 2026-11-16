import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdminSettingsAccess } from '@/lib/server/admin-settings-access';
import { guestSettings, guestResponse, guestError, readGuestJson, GuestPlantError } from '@/lib/server/guest-plant-checks';
export async function GET() {
  const access = await requireAdminSettingsAccess(); if (access.response) return access.response;
  try { return guestResponse(await guestSettings()); } catch (e) { return guestError(e); }
}
export async function PUT(request: NextRequest) {
  const access = await requireAdminSettingsAccess(); if (access.response) return access.response;
  try {
    const input = z.union([z.object({ enabled: z.boolean() }).strict(), z.object({ rotate: z.literal(true) }).strict()]).safeParse(await readGuestJson(request));
    if (!input.success) throw new GuestPlantError('Choose enable, disable or replace QR.');
    return guestResponse(await guestSettings(access.userId, input.data));
  } catch (e) { return guestError(e); }
}
