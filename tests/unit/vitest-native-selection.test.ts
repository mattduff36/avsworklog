import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_TARGET_TEST_FILES, buildChildTestEnv, buildDatabaseComment, deriveCheckoutIdentity, formatLocalTestDatabaseUrl } from '@/scripts/local-test-postgres';

const nativeOnlyFiles = [
  'tests/db/account-merge-runtime.test.ts',
  'tests/unit/fixerrors-lifecycle-postgres.test.ts',
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function integrationConfig() {
  vi.resetModules();
  const { default: workspace } = await import('../../vitest.workspace');
  const project = workspace[0];
  if (typeof project !== 'object' || !('test' in project) || !project.test) {
    throw new Error('Integration Vitest project missing');
  }
  return project.test;
}

describe('native-only Vitest selection', () => {
  it.each([
    { skipDotenv: undefined, url: undefined },
    { skipDotenv: undefined, url: 'postgresql://untrusted.invalid/database' },
    { skipDotenv: '1', url: undefined },
  ])('excludes native-only suites without a complete runner environment: %j', async ({ skipDotenv, url }) => {
    vi.stubEnv('AVSWORKLOG_TEST_SKIP_DOTENV', skipDotenv);
    vi.stubEnv('TEST_DATABASE_URL', url);
    expect((await integrationConfig()).exclude).toEqual(nativeOnlyFiles);
    for (const file of nativeOnlyFiles) {
      expect(ALLOWED_TARGET_TEST_FILES).toContain(file);
    }
  });

  it('selects native-only suites in the child environment without removing their in-test gates', async () => {
    const identity = deriveCheckoutIdentity(process.cwd());
    const child = buildChildTestEnv({
      parentEnv: {},
      databaseUrl: formatLocalTestDatabaseUrl(identity.hostPort),
      marker: buildDatabaseComment(identity.projectId, 'a'.repeat(64)),
      projectName: identity.projectName,
      hostPort: identity.hostPort,
    });
    vi.stubEnv('AVSWORKLOG_TEST_SKIP_DOTENV', child.AVSWORKLOG_TEST_SKIP_DOTENV);
    vi.stubEnv('TEST_DATABASE_URL', child.TEST_DATABASE_URL);
    const config = await integrationConfig();
    expect(config.exclude).toEqual([]);
    expect(config.include).toContain('tests/db/**/*.test.ts');
    expect(config.include).toContain('tests/unit/**/*.test.ts');
  });
});
