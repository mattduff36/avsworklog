import { persistGuestPhoto } from '@/lib/server/guest-plant-photo';
import sharp from 'sharp';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { authorizeGuest, GuestPlantError, guestError, guestResponse, rateLimit, readGuestJson, requireGuestCookie, requireGuestOrigin, withGuestDatabase } from '@/lib/server/guest-plant-checks';
import { GUEST_PHOTO_BYTES } from '@/lib/inspections/guest-plant';
export const runtime = 'nodejs';
export async function DELETE(request: NextRequest) {
  try {
    requireGuestCookie(request);
    const input = z.object({ uploadId: z.string().uuid(), requestId: z.string().uuid() }).strict().safeParse(await readGuestJson(request));
    if (!input.success) throw new GuestPlantError('Invalid photo.');
    return await withGuestDatabase(async client => {
      await client.query('BEGIN');
      try {
        const { session } = await authorizeGuest(client,request,true);
        await client.query('UPDATE private.guest_plant_uploads SET abandoned=true WHERE id=$1 AND request_id=$2 AND session_id=$3 AND NOT claimed',[input.data.uploadId,input.data.requestId,session.id]);
        await client.query('COMMIT'); return guestResponse({discarded:true});
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  } catch (error) { return guestError(error); }
}
export async function POST(request: NextRequest) {
  try {
    requireGuestOrigin(request);
    requireGuestCookie(request);
    await withGuestDatabase(async client => { const { session } = await authorizeGuest(client, request); await rateLimit(client, `photo:${session.id}`, 10); await rateLimit(client, 'photo:global', 100); });
    const reader = request.body?.getReader(); if (!reader) throw new GuestPlantError('Photo required.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length;
      if (size > GUEST_PHOTO_BYTES + 10000) { await reader.cancel(); throw new GuestPlantError('Photos must be smaller than 3 MB.', 413); } chunks.push(value); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    const file = form.get('photo'); const itemNumber = Number(form.get('itemNumber')); const requestId = String(form.get('requestId') || ''); const id = String(form.get('uploadId') || '');
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestId) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new GuestPlantError('Invalid check.');
    if (!(file instanceof File) || file.size > GUEST_PHOTO_BYTES || !Number.isInteger(itemNumber) || itemNumber < 1 || itemNumber > 23) throw new GuestPlantError('Choose a photo and checklist item.');
    // Decode/re-encode strips metadata and rejects SVG, malformed/polyglot images and excessive pixel dimensions.
    let bytes: Buffer;
    try {
      const decoded = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 20000000 });
      if (!['jpeg', 'png', 'webp'].includes((await decoded.metadata()).format || '')) throw new Error('Unsupported image');
      bytes = await decoded.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    }
    catch { throw new GuestPlantError('Use a valid JPEG, PNG or WebP image.'); }
    return await withGuestDatabase(async client => {
      const { session } = await authorizeGuest(client, request);
      const key = `${requestId}/${id}.jpg`;
      const storage = createAdminClient().storage.from('inspection-photos');
      const photoUrl = storage.getPublicUrl(key).data.publicUrl;
      const result = await persistGuestPhoto(client, storage, { id, sessionId: session.id, requestId, itemNumber, bytes, photoUrl }, () => authorizeGuest(client, request, true));
      return guestResponse(result);
    });
  } catch (e) { return guestError(e); }
}
