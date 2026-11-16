import { z } from 'zod';
import type { ErrorLogEntry } from './fixerrors-retrieval';

const REDACTED = '[credential redacted]';
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const secretKey = (key: string) => /^(?:authorization|proxyauthorization|cookie|setcookie|password|passwd|secret|clientsecret|apikey|xapikey|privatekey|token|accesstoken|refreshtoken|idtoken|sessiontoken|sessioncookie|servicerolekey|supabaseservicerolekey|secretkey|supabasesecretkey|xaccesstoken|authtoken|sessionkey)$/u
  .test(key.toLowerCase().replace(/[^a-z]/gu, '')) || /^(?:host)?avsappsession$/u.test(key.toLowerCase().replace(/[^a-z]/gu, ''));

/** Preserve diagnostic prose and identities; remove authentication material only. */
function redactText(value: string): string {
  return value
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.~-]+/giu, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, REDACTED)
    .replace(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}\b/gu, REDACTED)
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu, REDACTED)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, `$1${REDACTED}@`)
    .replace(/([?&](?:access_token|refresh_token|id_token|token|api_key|apikey|password|secret|session_token|service_role_key|supabase_service_role_key|secret_key|supabase_secret_key|auth_token|session_key)=)(?!\[credential redacted\])[^&#\s]*/giu, `$1${REDACTED}`)
    .replace(/((?:cookie|set-cookie)\s*:\s*)(?!\[credential redacted\])\S[^\r\n]*/giu, `$1${REDACTED}`)
    .replace(/((?:authorization|cookie|set-cookie|password|passwd|client[_-]?secret|api[_-]?key|session[_-]?token|(?:supabase[_-]?)?service[_-]?role[_-]?key|(?:supabase[_-]?)?secret[_-]?key|x[_-]?access[_-]?token|auth[_-]?token|session[_-]?key|avs_app_session|__Host-avs_app_session)["']?\s*[:=]\s*)(?!\[credential redacted\])(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu, `$1${REDACTED}`);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new Error('Fixerrors raw evidence exceeds nesting limit');
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, secretKey(key) ? REDACTED : redact(item, depth + 1)]));
  throw new Error('Fixerrors raw evidence must be JSON data');
}

const recordSchema = z.object({
  id: z.string(), timestamp: z.string(), created_at: z.string(),
  error_message: z.string(), error_stack: z.string().nullable(), error_type: z.string(),
  user_id: z.string().nullable(), user_email: z.string().nullable(),
  page_url: z.string(), user_agent: z.string(), component_name: z.string().nullable(),
  additional_data: z.record(z.string(), z.unknown()).nullable(),
}).strict();

/** Private model input only. Raw IDs are evidence, never lifecycle/write authority. */
export const rawErrorEvidenceSchema = recordSchema.superRefine((value, ctx) => {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Fixerrors raw evidence exceeds record limit' });
    return;
  }
  try {
    if (JSON.stringify(redact(value)) !== encoded) ctx.addIssue({ code: 'custom', message: 'Credential-bearing raw evidence rejected' });
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid Fixerrors raw evidence JSON' });
  }
});

export function rawErrorEvidence(row: ErrorLogEntry): z.infer<typeof rawErrorEvidenceSchema> {
  // Select diagnostic fields explicitly: database lifecycle controls stay server-owned.
  const value = { id: row.id, timestamp: row.timestamp, created_at: row.created_at,
    error_message: row.error_message, error_stack: row.error_stack, error_type: row.error_type,
    user_id: row.user_id, user_email: row.user_email, page_url: row.page_url,
    user_agent: row.user_agent, component_name: row.component_name, additional_data: row.additional_data };
  return rawErrorEvidenceSchema.parse(redact(value));
}
