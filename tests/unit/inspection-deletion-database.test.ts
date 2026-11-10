import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rootCertificates } from 'node:tls';

const mocks = vi.hoisted(() => ({
  client: vi.fn(), connect: vi.fn(), end: vi.fn(), readFile: vi.fn(),
}));
vi.mock('pg', () => ({ default: { Client: mocks.client } }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
import { withInspectionDeletionDatabase } from '@/lib/server/inspection-deletion';

describe('Daily Check privileged deletion connection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('POSTGRES_URL_NON_POOLING', 'postgresql://fixture:synthetic@database.fixture.test:5432/fixture');
    vi.stubEnv('PGSSLROOTCERT', '');
    vi.stubEnv('POSTGRES_SSL_CA_PEM', undefined);
    vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM', undefined);
    mocks.client.mockImplementation(function () { return { connect: mocks.connect, end: mocks.end }; });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('verifies PostgreSQL TLS using the expected server identity', async () => {
    expect(await withInspectionDeletionDatabase(async () => 'result')).toBe('result');
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({
      host: 'database.fixture.test', port: 5432,
      ssl: { rejectUnauthorized: true, servername: 'database.fixture.test' },
    }));
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
  it('uses an explicit trusted CA without disabling certificate verification', async () => {
    vi.stubEnv('PGSSLROOTCERT', 'D:\\fixture\\root.crt');
    mocks.readFile.mockResolvedValue(rootCertificates[0]);
    await withInspectionDeletionDatabase(async () => undefined);
    expect(mocks.readFile).toHaveBeenCalledWith('D:\\fixture\\root.crt', 'utf8');
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({
      ssl: { rejectUnauthorized: true, servername: 'database.fixture.test', ca: rootCertificates[0] },
    }));
  });
  it.each(['POSTGRES_SSL_CA_PEM', 'SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM'])(
    'supports hosted trusted PEM from %s without a local CA file or queue connection', async key => {
      vi.stubEnv(key, rootCertificates[0]);
      vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_DATABASE_URL', 'not-an-approved-deletion-database');
      await withInspectionDeletionDatabase(async () => undefined);
      expect(mocks.readFile).not.toHaveBeenCalled();
      expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({
        host: 'database.fixture.test',
        ssl: { rejectUnauthorized: true, servername: 'database.fixture.test', ca: rootCertificates[0] },
      }));
    });
  it.each(['', 'invalid', '-----BEGIN CERTIFICATE-----\nbad\n-----END CERTIFICATE-----',
    `${rootCertificates[0]}\nunexpected text`, 'x'.repeat(65_537)])('rejects malformed hosted CA material', async ca => {
    vi.stubEnv('POSTGRES_SSL_CA_PEM', ca);
    await expect(withInspectionDeletionDatabase(async () => undefined)).rejects.toMatchObject({ status: 503 });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('prefers the generic hosted CA and does not weaken hostname verification', async () => {
    vi.stubEnv('POSTGRES_SSL_CA_PEM', rootCertificates[0]);
    vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_DATABASE_CA_PEM', 'invalid fallback must not be used');
    vi.stubEnv('PGSSLROOTCERT', 'missing-local-file');
    await withInspectionDeletionDatabase(async () => undefined);
    expect(mocks.client.mock.calls[0][0].ssl).toEqual({
      rejectUnauthorized: true, servername: 'database.fixture.test', ca: rootCertificates[0],
    });
  });
  it('fails closed on connection or certificate rejection and closes its client', async () => {
    mocks.connect.mockRejectedValue(new Error('synthetic certificate rejection'));
    const work = vi.fn();
    await expect(withInspectionDeletionDatabase(work)).rejects.toThrow('synthetic certificate rejection');
    expect(work).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
  it('does not fall back to a different database URL when the approved connection is absent', async () => {
    vi.stubEnv('POSTGRES_URL_NON_POOLING', '');
    vi.stubEnv('POSTGRES_URL', 'postgresql://fixture:synthetic@other.fixture.test:6543/fixture');
    await expect(withInspectionDeletionDatabase(async () => undefined)).rejects.toMatchObject({ status: 503 });
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
