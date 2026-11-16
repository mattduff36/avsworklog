import { NextRequest } from 'next/server';
import { guestError, guestRead, guestResponse, readGuestJson, startGuestSession, submitGuestPlant } from '@/lib/server/guest-plant-checks';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return guestResponse(await guestRead(request)); } catch (e) { return guestError(e); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await readGuestJson(request);
    if (body && typeof body === 'object' && Object.keys(body).length === 1 && 'token' in body && typeof body.token === 'string') return await startGuestSession(request, body.token);
    return guestResponse(await submitGuestPlant(request, body));
  } catch (e) { return guestError(e); }
}
