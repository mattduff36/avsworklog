import 'server-only';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { GUEST_PHOTO_LIMIT } from '@/lib/inspections/guest-plant';
import { GuestPlantError } from './guest-plant-checks';

type Storage = {
  upload(path: string, bytes: Buffer, options: { contentType: string; upsert: boolean }): PromiseLike<{ error: unknown }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function persistGuestPhoto(client: Pick<pg.Client, 'query'>, storage: Storage,
  input: { id: string; sessionId: string; requestId: string; itemNumber: number; bytes: Buffer; photoUrl: string },
  authorize: () => Promise<unknown>) {
  const key = `${input.requestId}/${input.id}.jpg`; const contentHash = hash(input.bytes);
  // Commit the reservation before contacting storage, preserving cleanup evidence for lost provider responses.
  await client.query('BEGIN');
  try {
    await authorize();
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`guest-photo:${input.id}`]);
    const existing = await client.query('SELECT * FROM private.guest_plant_uploads WHERE id=$1', [input.id]);
    const row = existing.rows[0];
    if (row && (row.session_id !== input.sessionId || row.request_id !== input.requestId || row.item_number !== input.itemNumber || row.content_hash !== contentHash || row.claimed || row.abandoned)) throw new GuestPlantError('Photo identity does not match this check.', 409);
    if (!row) {
      const count = await client.query('SELECT count(*) FROM private.guest_plant_uploads WHERE session_id=$1 AND request_id=$2 AND NOT claimed AND NOT abandoned',[input.sessionId,input.requestId]);
      if (Number(count.rows[0].count) >= GUEST_PHOTO_LIMIT) throw new GuestPlantError('A maximum of five photos can be attached. Retry any pending photo.');
      await client.query('INSERT INTO private.guest_plant_uploads(id,session_id,request_id,item_number,object_key,photo_url,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.id,input.sessionId,input.requestId,input.itemNumber,key,input.photoUrl,contentHash]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  await client.query('BEGIN');
  try {
    await authorize();
    const { rows } = await client.query('SELECT ready,claimed,abandoned FROM private.guest_plant_uploads WHERE id=$1 FOR UPDATE',[input.id]);
    if (!rows[0] || rows[0].claimed || rows[0].abandoned) throw new GuestPlantError('Photo is no longer available.',409);
    if (!rows[0].ready) {
      const { error } = await storage.upload(key,input.bytes,{contentType:'image/jpeg',upsert:false});
      if (error) {
        // An upload may have committed before its reply was lost. Recover only the exact immutable bytes.
        const recovered = await storage.download(key);
        if (recovered.error || !recovered.data || hash(Buffer.from(await recovered.data.arrayBuffer())) !== contentHash) throw new GuestPlantError('Photo upload failed. Retry the photo.',503);
      }
      await client.query('UPDATE private.guest_plant_uploads SET ready=true WHERE id=$1',[input.id]);
    }
    await client.query('COMMIT'); return {id:input.id,itemNumber:input.itemNumber};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
