import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { FixerrorsControlError, deny } from '@/lib/fixerrors/control';
import { FIXERRORS_LOCAL_ORIGIN, FIXERRORS_PRODUCTION_ORIGIN } from '@/lib/fixerrors/protocol';
import { getFixerrorsOrigin } from './config';

export async function requireFixerrorsSuperAdmin(): Promise<string> {
  const current = await getCurrentAuthenticatedProfile();
  if (!current) deny('Unauthorized', 401);
  const role = await getEffectiveRole();
  if (!role.is_actual_super_admin || role.is_viewing_as || role.user_id !== current.profile.id) deny('Forbidden', 403);
  return current.profile.id;
}

export function assertFixerrorsRequest(request: NextRequest): 'local' | 'production' {
  const origin = getFixerrorsOrigin();
  if (!origin) deny('Fixerrors controls disabled', 503);
  if (origin === FIXERRORS_PRODUCTION_ORIGIN) {
    if (request.nextUrl.origin !== origin) deny('Invalid Squires production host', 403);
    return 'production';
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(request.nextUrl.hostname)) deny('Local requests only', 403);
  return 'local';
}

export function assertFixerrorsBrowserOrigin(request: NextRequest, scope: 'local' | 'production'): void {
  const origin = scope === 'production' ? FIXERRORS_PRODUCTION_ORIGIN : FIXERRORS_LOCAL_ORIGIN;
  if (request.headers.get('origin') !== origin) deny('Invalid request origin', 403);
}

export async function readBoundedJson(request: Request, limit = 16_384): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') deny('JSON required', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit)) deny('Request too large', 413);
  if (!request.body) deny('Request body required', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new FixerrorsControlError(408, 'Request body timed out')), 10_000);
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        deny('Request too large', 413);
      }
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof FixerrorsControlError) throw error;
    deny('Invalid JSON body', 400);
  } finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => {
      console.error('[fixerrors-local] Request stream cancellation failed');
    });
    reader.releaseLock();
  }
}

export function fixerrorsJson(body: unknown, status = 200): NextResponse {
  const json = JSON.stringify(body);
  if (Buffer.byteLength(json, 'utf8') > 512 * 1024) throw new Error('Fixerrors response size exceeded');
  return new NextResponse(json, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export function fixerrorsHttpError(error: unknown): NextResponse {
  if (error instanceof FixerrorsControlError) return fixerrorsJson({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return fixerrorsJson({ error: 'Invalid Fixerrors protocol input' }, 400);
  // Do not forward connection strings, credentials, packets or provider errors to logs.
  console.error('[fixerrors] Control plane transaction failed');
  return fixerrorsJson({ error: 'Fixerrors service unavailable' }, 503);
}
