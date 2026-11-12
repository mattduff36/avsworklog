import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifySyntheticRepairLive } from '@/lib/server/fixerrors/live-verification';
import * as synthetic from '@/lib/utils/fixerrors-controlled-acceptance';
import { FIXERRORS_PRODUCTION_ORIGIN } from '@/lib/fixerrors/protocol';

const head = 'd'.repeat(40);
beforeEach(() => {
  // Model the future repaired runtime while the separate E2E fixture is rearmed.
  vi.spyOn(synthetic, 'syntheticDisplayLabel').mockImplementation(value => value.trim());
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL', '1'); vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_ENABLED', '1');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', head); vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_Synthetic');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ commit_sha: head, deployment_id: 'dpl_Synthetic' }))));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('approved synthetic live verifier', () => {
  it('executes the imported formatter on fixed cases and confirms the fixed HTTPS live identity', async () => {
    const formatter = vi.spyOn(synthetic, 'syntheticDisplayLabel');
    expect(await verifySyntheticRepairLive(head)).toMatchObject({
      deployedCommit: head, deploymentId: 'dpl_Synthetic', result: 'passed',
    });
    expect(formatter.mock.calls.map(([input]) => input)).toEqual([
      ' \tfixture', 'fixture\t ', ' fixture ', ' \t\n ', 'fixture label', '',
    ]);
    expect(fetch).toHaveBeenCalledWith(`${FIXERRORS_PRODUCTION_ORIGIN}/api/daily-allocation/deployment-identity`,
      expect.objectContaining({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
  });

  it.each(['sha', 'preview', 'disabled'])('refuses a %s runtime before any public request', async mismatch => {
    if (mismatch === 'sha') vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'f'.repeat(40));
    if (mismatch === 'preview') vi.stubEnv('VERCEL_ENV', 'preview');
    if (mismatch === 'disabled') vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_ENABLED', '');
    await expect(verifySyntheticRepairLive(head)).rejects.toMatchObject({ reason: 'server-revision-mismatch' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { commit_sha: 'f'.repeat(40), deployment_id: 'dpl_Synthetic' },
    { commit_sha: head }, { commit_sha: head, deployment_id: 'dpl_Other' },
    { commit_sha: head, deployment_id: 'invalid' },
  ])('refuses missing or mismatched live identity', async identity => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(identity))));
    await expect(verifySyntheticRepairLive(head)).rejects.toMatchObject({ reason: 'deployment-identity-mismatch' });
  });

  it.each(['invalid-json', 'oversize', 'unavailable'])('refuses %s identity responses', async kind => {
    vi.stubGlobal('fetch', vi.fn(async () => kind === 'unavailable' ? new Response('', { status: 503 }) :
      new Response(kind === 'invalid-json' ? 'not json' : 'x'.repeat(4097))));
    await expect(verifySyntheticRepairLive(head)).rejects.toMatchObject({
      reason: kind === 'unavailable' ? 'unavailable' : 'deployment-identity-mismatch',
    });
  });

  it.each(['regression', 'throws'])('refuses a %s in the actual imported runtime function', async kind => {
    vi.spyOn(synthetic, 'syntheticDisplayLabel').mockImplementation(value => {
      if (kind === 'throws') throw new Error('Synthetic failure');
      return value.trimStart();
    });
    await expect(verifySyntheticRepairLive(head)).rejects.toMatchObject({ reason: 'runtime-verification-failed' });
  });
});
