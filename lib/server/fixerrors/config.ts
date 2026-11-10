import 'server-only';
import { X509Certificate } from 'node:crypto';
import type { ConnectionOptions } from 'node:tls';
import { FixerrorsControlError } from '@/lib/fixerrors/control';
import { FIXERRORS_LOCAL_ORIGIN, FIXERRORS_PRODUCTION_ORIGIN } from '@/lib/fixerrors/protocol';
const projectRef = 'lrhufzqfzeutgvudcowy';
const productionQueueUser = 'squires_fixerrors_queue';

export function isFixerrorsLocalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && !env.VERCEL && env.SQUIRES_FIXERRORS_LOCAL_ENABLED === '1';
}

export function isFixerrorsProductionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && env.VERCEL === '1' && env.VERCEL_ENV === 'production' &&
    env.SQUIRES_FIXERRORS_PRODUCTION_ENABLED === '1';
}

export function getFixerrorsOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  if (isFixerrorsLocalEnabled(env)) return FIXERRORS_LOCAL_ORIGIN;
  if (isFixerrorsProductionEnabled(env)) return FIXERRORS_PRODUCTION_ORIGIN;
  return null;
}

export function getFixerrorsProductionDatabaseUrl(env: NodeJS.ProcessEnv = process.env): URL {
  if (!isFixerrorsProductionEnabled(env)) throw new FixerrorsControlError(503, 'Production Fixerrors controls disabled');
  let url: URL;
  try {
    url = new URL(env.SQUIRES_FIXERRORS_PRODUCTION_DATABASE_URL ?? '');
  } catch {
    throw new FixerrorsControlError(503, 'Production Fixerrors database not configured');
  }
  const direct = url.hostname === `db.${projectRef}.supabase.co` && url.username === productionQueueUser;
  const pooled = /^aws-[0-9]+-eu-west-2\.pooler\.supabase\.com$/u.test(url.hostname) &&
    url.username === `${productionQueueUser}.${projectRef}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !(direct || pooled) ||
      url.pathname !== '/postgres' || (url.port && url.port !== '5432') ||
      !url.password || url.search || url.hash) {
    throw new FixerrorsControlError(503, 'Production Fixerrors requires the scoped Squires queue login');
  }
  return url;
}

export function getFixerrorsProductionDatabaseSsl(env: NodeJS.ProcessEnv = process.env): ConnectionOptions {
  const url = getFixerrorsProductionDatabaseUrl(env);
  const pem = env.SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM;
  const ssl: ConnectionOptions = { rejectUnauthorized: true, servername: url.hostname };
  if (pem === undefined) return ssl;
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu);
  try {
    if (Buffer.byteLength(pem, 'utf8') > 65_536 || !certificates?.length ||
        pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu, '').trim()) {
      throw new Error('Invalid CA bundle');
    }
    certificates.forEach((certificate) => { new X509Certificate(certificate); });
  } catch {
    throw new FixerrorsControlError(503, 'Invalid production Fixerrors database CA configuration');
  }
  return { ...ssl, ca: pem };
}

export function getFixerrorsLocalDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (!isFixerrorsLocalEnabled(env)) throw new FixerrorsControlError(503, 'Local Fixerrors controls disabled');
  const value = env.SQUIRES_FIXERRORS_LOCAL_DATABASE_URL;
  if (!value) throw new FixerrorsControlError(503, 'Local Fixerrors database not configured');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FixerrorsControlError(503, 'Invalid local Fixerrors database configuration');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/squires_fixerrors_local' || url.search || url.hash) {
    throw new FixerrorsControlError(503, 'Fixerrors database must be the dedicated loopback database');
  }
  return value;
}
