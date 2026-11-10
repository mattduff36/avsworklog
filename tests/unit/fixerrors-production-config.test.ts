import { rootCertificates } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { getFixerrorsProductionDatabaseSsl } from '@/lib/server/fixerrors/config';

const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production',
  SQUIRES_FIXERRORS_PRODUCTION_ENABLED: '1',
  SQUIRES_FIXERRORS_PRODUCTION_DATABASE_URL:
    'postgresql://squires_fixerrors_queue:fixture-only@db.lrhufzqfzeutgvudcowy.supabase.co/postgres',
};

describe('production queue CA configuration (offline; no database connection)', () => {
  it('uses the system trust store with required hostname verification by default', () => {
    expect(getFixerrorsProductionDatabaseSsl(env)).toEqual({
      rejectUnauthorized: true, servername: 'db.lrhufzqfzeutgvudcowy.supabase.co',
    });
  });
  it('accepts an explicitly trusted public PEM CA bundle without disabling verification', () => {
    const pem = `${rootCertificates[0]}\n${rootCertificates[1]}\n`;
    const options = getFixerrorsProductionDatabaseSsl({ ...env, SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM: pem });
    expect(options).toEqual({ rejectUnauthorized: true, servername: 'db.lrhufzqfzeutgvudcowy.supabase.co', ca: pem });
    expect(options.checkServerIdentity).toBeUndefined();
  });
  it.each([
    '', 'not a certificate', '-----BEGIN CERTIFICATE-----\nbad\n-----END CERTIFICATE-----',
    `${rootCertificates[0]}\n-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----`,
    `${rootCertificates[0]}\nunexpected trailing text`, 'x'.repeat(65_537),
  ])('fails closed on invalid server CA material', (pem) => {
    expect(() => getFixerrorsProductionDatabaseSsl({
      ...env, SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM: pem,
    })).toThrow('Invalid production Fixerrors database CA configuration');
  });
  it('does not permit a CA to bypass production enablement or the pinned database host', () => {
    expect(() => getFixerrorsProductionDatabaseSsl({
      ...env, VERCEL_ENV: 'preview', SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM: rootCertificates[0],
    })).toThrow('disabled');
    expect(() => getFixerrorsProductionDatabaseSsl({
      ...env, SQUIRES_FIXERRORS_PRODUCTION_DATABASE_URL: 'postgresql://queue:fixture@other.invalid/postgres',
    })).toThrow('scoped Squires queue login');
  });
});
