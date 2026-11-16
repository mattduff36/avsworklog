import 'server-only';
import { validGuestSignature } from '@/lib/server/guest-plant-signature';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { NextRequest, NextResponse } from 'next/server';
import { withInspectionDeletionDatabase as withDatabase } from '@/lib/server/inspection-deletion';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadJobCatalogueRecords } from '@/lib/server/job-catalogue';
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';
import { buildInspectionDefectSignature, extractInspectionDefectSignature } from '@/lib/utils/inspectionDefectSignature';
import { buildRecentCompletedDefectMap } from '@/lib/utils/inspectionRecentCompletedDefects';
import { ACTIVE_INSPECTION_DEFECT_STATUSES } from '@/lib/utils/inspectionDefectTaskStatuses';
import { GUEST_PLANT_COOKIE, GuestPlantSubmissionSchema, londonToday, numericJobCode, type GuestPlantSubmission, type GuestPlantDefect } from '@/lib/inspections/guest-plant';

type Client = Pick<pg.Client, 'query'>;
type Settings = { enabled: boolean; qr_secret: string; generation: number; owner_id: string };
type Session = { id: string; generation: number };
export class GuestPlantError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export const guestHash = (value: string) => createHash('sha256').update(value).digest('hex');
const headers = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
export function guestResponse(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }); }
export function guestError(error: unknown) {
  return guestResponse({ error: error instanceof GuestPlantError ? error.message : 'Daily checks are temporarily unavailable. Your answers have been kept; please retry.' }, error instanceof GuestPlantError ? error.status : 503);
}
export function requireGuestOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin !== request.nextUrl.origin) throw new GuestPlantError('Request not allowed.', 403);
}
export async function readGuestJson(request: NextRequest) {
  requireGuestOrigin(request);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new GuestPlantError('JSON required.', 415);
  // Bound streamed input too; Content-Length is optional/untrusted.
  const reader = request.body?.getReader();
  if (!reader) throw new GuestPlantError('Missing form.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length;
    if (size > 400000) { await reader.cancel(); throw new GuestPlantError('Form is too large.', 413); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new GuestPlantError('Invalid form.'); }
}
export async function loadGuestSettings(client: Client, lock = false): Promise<Settings> {
  const result = await client.query<Settings>(`SELECT enabled, qr_secret, generation, owner_id FROM private.guest_plant_settings WHERE id ${lock ? 'FOR SHARE' : ''}`);
  if (!result.rows[0]) throw new GuestPlantError('Guest checks have not been configured.', 503);
  return result.rows[0];
}
export async function guestSettings(actorId?: string, input?: { enabled?: boolean; rotate?: boolean }) {
  return withDatabase(async client => {
    if (!input) { await cleanupGuestUploads(client); const s = await loadGuestSettings(client); return { enabled: s.enabled, token: s.qr_secret }; }
    await client.query('BEGIN');
    try {
      const result = await client.query<Settings>(`UPDATE private.guest_plant_settings SET enabled = COALESCE($1, enabled),
        qr_secret = CASE WHEN $2 THEN $3 ELSE qr_secret END, generation = generation + CASE WHEN $2 OR $1 = false THEN 1 ELSE 0 END,
        updated_at = now(), updated_by = $4 WHERE id RETURNING *`, [input.enabled ?? null, input.rotate === true, randomBytes(32).toString('hex'), actorId]);
      await client.query(`INSERT INTO public.audit_log(table_name, record_id, user_id, action, changes) VALUES
        ('guest_plant_settings', $1, $2, 'guest_plant_settings_changed', $3::jsonb)`, [result.rows[0].owner_id, actorId, JSON.stringify({ enabled: result.rows[0].enabled, qr_replaced: input.rotate === true })]);
      await client.query('COMMIT');
      return { enabled: result.rows[0].enabled, token: result.rows[0].qr_secret };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
  });
}
export async function rateLimit(client: Client, key: string, limit: number) {
  const { rows } = await client.query<{ attempts: number }>(`INSERT INTO private.guest_plant_rate_limits(key, window_start, attempts)
    VALUES($1, now(), 1) ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN guest_plant_rate_limits.window_start < now() - interval '1 minute' THEN 1 ELSE guest_plant_rate_limits.attempts + 1 END,
      window_start = CASE WHEN guest_plant_rate_limits.window_start < now() - interval '1 minute' THEN now() ELSE guest_plant_rate_limits.window_start END RETURNING attempts`, [key]);
  if (rows[0].attempts > limit) throw new GuestPlantError('Too many requests. Please wait a minute and retry.', 429);
}
export async function startGuestSession(request: NextRequest, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new GuestPlantError('This QR code is unavailable. Please contact your supervisor.', 403);
  return withDatabase(async client => {
    // The trusted deployment proxy supplies x-vercel-forwarded-for. Also enforce a global cap so alternate IPs cannot bypass it.
    const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'local';
    await rateLimit(client, `start:${guestHash(ip)}`, 20); await rateLimit(client, 'start:global', 300);
    const settings = await loadGuestSettings(client);
    if (!settings.enabled || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(settings.qr_secret))) throw new GuestPlantError('This QR code is unavailable. Please contact your supervisor.', 403);
    await cleanupGuestUploads(client);
    const existing = request.cookies.get(GUEST_PLANT_COOKIE)?.value;
    if (existing && /^[a-f0-9]{64}$/.test(existing)) {
      const resumed = await client.query('UPDATE private.guest_plant_sessions SET expires_at = now() + interval \'4 hours\' WHERE token_hash = $1 AND generation = $2 RETURNING id', [guestHash(existing), settings.generation]);
      if (resumed.rowCount) return sessionResponse(request, existing);
    }
    const secret = randomBytes(32).toString('hex');
    await client.query('INSERT INTO private.guest_plant_sessions(token_hash, generation) VALUES($1, $2)', [guestHash(secret), settings.generation]);
    return sessionResponse(request, secret);
  });
}
function sessionResponse(request: NextRequest, secret: string) {
  const response = guestResponse({ ready: true });
  // Authorization remains four hours in the database; a longer transport cookie permits receipt-only recovery after expiry.
  response.cookies.set(GUEST_PLANT_COOKIE, secret, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/api/guest-plant-checks', maxAge: 24 * 3600 });
  return response;
}
// Durable staging ledger survives upload/process failures. Bounded cleanup retries on valid QR entry/admin settings access.
export async function cleanupGuestUploads(client: Client) {
  await client.query('BEGIN');
  try {
    // Claiming a photo uses the same row lock: cleanup cannot remove an image concurrently being submitted.
    const { rows } = await client.query<{ id: string; object_key: string }>(`SELECT id, object_key FROM private.guest_plant_uploads WHERE NOT claimed AND created_at < now() - interval '24 hours' ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`);
    if (rows.length) {
      const { error } = await createAdminClient().storage.from('inspection-photos').remove(rows.map(r => r.object_key));
      if (!error) await client.query('DELETE FROM private.guest_plant_uploads WHERE id = ANY($1::uuid[]) AND NOT claimed', [rows.map(r => r.id)]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  await client.query("DELETE FROM private.guest_plant_rate_limits WHERE window_start < now() - interval '1 day'");
}
export async function authorizeGuest(client: Client, request: NextRequest, lock = false): Promise<{ settings: Settings; session: Session }> {
  const token = requireGuestCookie(request);
  const settings = await loadGuestSettings(client, lock);
  const { rows } = await client.query<Session>(`SELECT id, generation FROM private.guest_plant_sessions WHERE token_hash = $1 AND expires_at > now() ${lock ? 'FOR UPDATE' : ''}`, [guestHash(token)]);
  if (!settings.enabled || !rows[0] || rows[0].generation !== settings.generation) throw new GuestPlantError('Guest access expired or was disabled. Scan the current QR code again.', 401);
  return { settings, session: rows[0] };
}
export function requireGuestCookie(request: NextRequest): string {
  const token = request.cookies.get(GUEST_PLANT_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new GuestPlantError('Scan the QR code to start a daily check.', 401);
  return token;
}
type DefectTask = { id: string; status: string; description: string | null; actioned_at: string | null; updated_at: string | null };
export async function loadGuestDefects(client: Client, plantId: string, lock = false) {
  const { rows } = await client.query<DefectTask>(`SELECT id, status, description, actioned_at, updated_at FROM public.actions
    WHERE plant_id = $1 AND action_type = 'inspection_defect' AND
    (status = ANY($2::text[]) OR (status = 'completed' AND COALESCE(actioned_at, updated_at) >= now() - interval '7 days')) ${lock ? 'FOR UPDATE' : ''}`, [plantId, [...ACTIVE_INSPECTION_DEFECT_STATUSES]]);
  const completed = buildRecentCompletedDefectMap(rows.filter(r => r.status === 'completed'));
  const active = new Set(rows.filter(r => r.status !== 'completed').map(r => extractInspectionDefectSignature(r.description)));
  return PLANT_INSPECTION_ITEMS.map((description, index): GuestPlantDefect => {
    const signature = buildInspectionDefectSignature({ item_number: index + 1, item_description: description });
    return { number: index + 1, locked: active.has(signature), recentlyCompleted: completed.has(signature) };
  });
}
export async function guestRead(request: NextRequest) {
  requireGuestCookie(request);
  return withDatabase(async client => {
    const { session } = await authorizeGuest(client, request); await rateLimit(client, `read:${session.id}`, 90);
    const plantId = request.nextUrl.searchParams.get('plantId');
    if (plantId) {
      if (!/^[\da-f-]{36}$/i.test(plantId)) throw new GuestPlantError('Invalid plant.');
      const asset = await client.query('SELECT p.id, m.current_hours FROM public.plant p LEFT JOIN public.vehicle_maintenance m ON m.plant_id = p.id WHERE p.id = $1 AND p.status = $2', [plantId, 'active']);
      if (!asset.rows[0]) throw new GuestPlantError('Plant is unavailable.', 404);
      return { date: londonToday(), currentHours: asset.rows[0].current_hours, defects: await loadGuestDefects(client, plantId) };
    }
    const job = request.nextUrl.searchParams.get('job');
    if (job !== null) {
      await rateLimit(client, 'job-lookup:global', 120);
      if (!/^\d{1,12}$/.test(job)) throw new GuestPlantError('Enter the job number only.');
      const records = await loadJobCatalogueRecords();
      return { jobs: records.filter(r => r.is_active && numericJobCode(r.job_code) === job)
        .map(r => ({ sourceType: r.source_type, sourceId: r.source_id, code: r.job_code, title: r.title })).slice(0, 20) };
    }
    const { rows: assets } = await client.query(`SELECT p.id, p.plant_id, p.nickname, c.name AS category FROM public.plant p LEFT JOIN public.van_categories c ON c.id = p.category_id WHERE p.status = 'active' ORDER BY p.plant_id`);
    return { assets, date: londonToday() };
  });
}

// One database transaction owns every database side effect, including meter triggers and workshop actions.
// Exported for disposable PostgreSQL transaction/concurrency tests. The route authenticates first.
export async function saveGuestPlantCheck(client: Client, sessionId: string, input: GuestPlantSubmission, expectedGeneration: number) {
  if (!await validGuestSignature(input.signature)) throw new GuestPlantError('Draw and save a valid signature before submitting.');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '25s'");
    const settings = await loadGuestSettings(client, true);
    const { rows: sessions } = await client.query(`SELECT id FROM private.guest_plant_sessions WHERE id = $1 AND generation = $2 AND expires_at > now() FOR UPDATE`, [sessionId, expectedGeneration]);
    if (!settings.enabled || settings.generation !== expectedGeneration || !sessions.length) throw new GuestPlantError('Guest access is no longer available.', 401);
    const hash = guestHash(JSON.stringify(input));
    const prior = await client.query<{ payload_hash: string; inspection_id: string }>('SELECT payload_hash, inspection_id FROM private.guest_plant_requests WHERE session_id = $1 AND request_id = $2', [sessionId, input.requestId]);
    if (prior.rows[0]) {
      if (prior.rows[0].payload_hash !== hash) throw new GuestPlantError('This submission was already used. Start another check.', 409);
      await client.query('COMMIT'); return { id: prior.rows[0].inspection_id, date: input.date };
    }
    if (input.date !== londonToday()) throw new GuestPlantError('Guest checks must be submitted for today. Refresh the date and confirm your answers.', 409);
    // Shared meter/deletion lock serializes all guest submissions for this asset.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('daily-check:plant:' || $1::text, 0))", [input.plantId]);
    const { rows: plants } = await client.query(`SELECT id, plant_id FROM public.plant WHERE id = $1 AND status = 'active' FOR UPDATE`, [input.plantId]);
    if (!plants[0]) throw new GuestPlantError('Plant is no longer available.', 409);
    const { rows: meter } = await client.query('SELECT current_hours FROM public.vehicle_maintenance WHERE plant_id = $1', [input.plantId]);
    const previousHours = meter[0]?.current_hours;
    if (previousHours != null && (input.hours < previousHours || String(input.hours).length > String(previousHours).length) && !input.hoursConfirmed) throw new GuestPlantError('Confirm the changed hours reading before submitting.', 409);
    // Database job-field trigger resolves exact source identity and current eligibility atomically with insertion.
    const { rows: jobs } = await client.query<{ job_code: string }>('SELECT job_code FROM private.resolve_allocation_job($1, $2, NULL)', [input.jobSourceType, input.jobSourceId]);
    if (!jobs[0]?.job_code || numericJobCode(jobs[0].job_code) !== input.jobNumber) throw new GuestPlantError('The selected job does not match the entered job number.', 409);
    const defects = await loadGuestDefects(client, input.plantId, true);
    for (const item of input.items) {
      const state = defects[item.number - 1];
      if (state.locked && item.status !== 'logged') throw new GuestPlantError('Existing defects changed. Reload the plant details before submitting.', 409);
      if (!state.locked && item.status === 'logged') throw new GuestPlantError('A logged defect was completed. Recheck that item before submitting.', 409);
      if (!state.locked && state.recentlyCompleted && item.status === 'attention' && !item.repeatConfirmed) throw new GuestPlantError('Confirm that the recently repaired item has a new defect.', 409);
    }
    const { rows: photos } = await client.query<{ id: string; item_number: number; photo_url: string }>(`SELECT id, item_number, photo_url FROM private.guest_plant_uploads WHERE id = ANY($1::uuid[]) AND session_id = $2 AND request_id = $3 AND ready AND NOT claimed AND NOT abandoned FOR UPDATE`, [input.photoIds, sessionId, input.requestId]);
    if (photos.length !== input.photoIds.length) throw new GuestPlantError('A photo is unavailable or belongs to another check.', 409);
    const id = input.requestId;
    await client.query(`INSERT INTO public.plant_inspections(id, plant_id, user_id, guest_name, guest_submission_id, inspection_date, inspection_end_date,
      current_mileage, status, submitted_at, signature_data, signed_at, inspector_comments, is_hired_plant, job_source_type, job_source_id, job_code)
      VALUES($1,$2,$3,$4,$5,$6,$6,$7,'submitted',now(),$8,now(),$9,false,$10,$11,$12)`,
    [id, input.plantId, settings.owner_id, input.name, randomUUID(), input.date, input.hours, input.signature, input.comments || null, input.jobSourceType, input.jobSourceId, jobs[0].job_code]);
    const weekday = ((new Date(`${input.date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const { rows: categories } = await client.query(`SELECT id FROM public.workshop_task_categories WHERE applies_to = 'plant' AND is_active AND name = 'Repair' ORDER BY id LIMIT 1`);
    for (const item of input.items) {
      const itemId = randomUUID(); const description = PLANT_INSPECTION_ITEMS[item.number - 1];
      await client.query(`INSERT INTO public.inspection_items(id, inspection_id, item_number, item_description, day_of_week, status, comments) VALUES($1,$2,$3,$4,$5,$6,$7)`, [itemId, id, item.number, description, weekday, item.status, item.comment || null]);
      if (item.status === 'attention') {
        await client.query(`INSERT INTO public.actions(action_type, plant_id, title, description, status, created_by, inspection_id, inspection_item_id, workshop_category_id, daily_check_source_id, daily_check_source_type)
          VALUES('inspection_defect',$1,$2,$3,'pending',$4,$5,$6,$7,$5,'plant')`, [input.plantId, `Plant ${plants[0].plant_id}: ${description}`,
          `Item ${item.number} - ${description}\nComment: ${item.comment}\nReported by ${input.name} — Temporary staff`, settings.owner_id, id, itemId, categories[0]?.id ?? null]);
      }
    }
    if (input.informWorkshop) await client.query(`INSERT INTO public.actions(action_type, plant_id, title, description, status, created_by, inspection_id, workshop_category_id, daily_check_source_id, daily_check_source_type)
      VALUES('workshop_vehicle_task',$1,$2,$3,'pending',$4,$5,$6,$5,'plant')`, [input.plantId, `Plant ${plants[0].plant_id}: Inspector Comments`, `${input.comments}\nReported by ${input.name} — Temporary staff`, settings.owner_id, id, categories[0]?.id ?? null]);
    for (const photo of photos) await client.query(`INSERT INTO public.inspection_photos(inspection_id, item_number, day_of_week, photo_url) VALUES($1,$2,$3,$4)`, [id, photo.item_number, weekday, photo.photo_url]);
    await client.query('UPDATE private.guest_plant_uploads SET claimed = true WHERE id = ANY($1::uuid[])', [input.photoIds]);
    await client.query('INSERT INTO private.guest_plant_requests(session_id, request_id, payload_hash, inspection_id) VALUES($1,$2,$3,$4)', [sessionId, input.requestId, hash, id]);
    await client.query(`INSERT INTO public.audit_log(table_name, record_id, user_id, action, changes) VALUES('plant_inspections',$1,$2,'guest_plant_submitted',$3::jsonb)`, [id, settings.owner_id, JSON.stringify({ guest_name: input.name, source: 'guest_qr' })]);
    await client.query('COMMIT'); return { id, date: input.date };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
export async function submitGuestPlant(request: NextRequest, body: unknown) {
  requireGuestCookie(request);
  const parsed = GuestPlantSubmissionSchema.safeParse(body);
  if (!parsed.success) throw new GuestPlantError(parsed.error.issues[0]?.message || 'Check your answers.');
  return withDatabase(async client => {
    // A lost success response can be recovered using only this browser's existing secret and exact payload,
    // even after session expiry/revocation. This grants no new write or historical-record access.
    const token = request.cookies.get(GUEST_PLANT_COOKIE)?.value;
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const replay = await client.query<{ inspection_id: string; payload_hash: string }>(`SELECT r.inspection_id, r.payload_hash FROM private.guest_plant_requests r JOIN private.guest_plant_sessions s ON s.id = r.session_id WHERE s.token_hash = $1 AND r.request_id = $2`, [guestHash(token), parsed.data.requestId]);
      if (replay.rows[0]) {
        if (replay.rows[0].payload_hash !== guestHash(JSON.stringify(parsed.data))) throw new GuestPlantError('This submission was already used. Start another check.', 409);
        return { id: replay.rows[0].inspection_id, date: parsed.data.date };
      }
    }
    const { session } = await authorizeGuest(client, request); await rateLimit(client, `submit:${session.id}`, 10);
    return saveGuestPlantCheck(client, session.id, parsed.data, session.generation);
  });
}
export { withDatabase as withGuestDatabase };
