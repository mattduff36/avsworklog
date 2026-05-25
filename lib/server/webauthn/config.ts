import { headers } from 'next/headers';

export interface WebAuthnRequestConfig {
  rpName: string;
  rpID: string;
  origin: string;
  expectedOrigins: string[];
}

function getConfiguredOrigins(origin: string): string[] {
  const configured = process.env.WEBAUTHN_EXPECTED_ORIGINS || process.env.WEBAUTHN_ORIGIN;
  if (!configured) return [origin];

  return configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getOriginFromHeaders(host: string | null, protocol: string | null): string {
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN;
  if (configuredOrigin) return configuredOrigin.replace(/\/+$/, '');

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, '');

  const safeHost = host || 'localhost:4000';
  const safeProtocol = protocol || (safeHost.startsWith('localhost') ? 'http' : 'https');
  return `${safeProtocol}://${safeHost}`.replace(/\/+$/, '');
}

export async function getWebAuthnRequestConfig(): Promise<WebAuthnRequestConfig> {
  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') || headerStore.get('host');
  const protocol = headerStore.get('x-forwarded-proto');
  const origin = getOriginFromHeaders(host, protocol);
  const rpID = process.env.WEBAUTHN_RP_ID || new URL(origin).hostname;

  return {
    rpName: process.env.WEBAUTHN_RP_NAME || 'SQUIRES',
    rpID,
    origin,
    expectedOrigins: getConfiguredOrigins(origin),
  };
}
