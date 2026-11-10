import { describe, expect, it } from 'vitest';
import {
  approvedReleaseContext, pollLiveDeployment, releaseArguments, verifyLiveDeployment,
} from '@/scripts/automation/squires-fap-adapter.mjs';

const head = 'a'.repeat(40);
const base = 'c'.repeat(40);
const ticket = { version: 1, audience: 'squires-windows-fap', job: 'fap', environment: 'squires-production',
  head, tree: 'b'.repeat(40), issuedAt: 1000, expiresAt: 1300 };

describe('mode-specific pinned release adapter (offline)', () => {
  it('runs existing guarded fap for full and historical tickets, never for targeted', () => {
    expect(releaseArguments(ticket, 'npm-cli.js')).toEqual(['npm-cli.js', 'run', 'finalise:push', '--', '--guarded-push']);
    expect(releaseArguments({ ...ticket, releaseMode: 'full' }, 'npm-cli.js')).toEqual(releaseArguments(ticket, 'npm-cli.js'));
    expect(releaseArguments({ ...ticket, releaseMode: 'targeted' }, 'npm-cli.js')).toEqual([
      '--import=tsx', 'scripts\\automation\\fixerrors-targeted-release.ts',
    ]);
    for (const releaseMode of ['fast', '', null, false]) {
      expect(() => releaseArguments({ ...ticket, releaseMode }, 'npm-cli.js')).toThrow('mode');
      expect(() => approvedReleaseContext({ ...ticket, releaseMode }, base, 1000)).toThrow('mode');
    }
  });

  it('retains exclusive five-minute admission, fixed destination and exact candidate/base context', () => {
    expect(approvedReleaseContext(ticket, base, 1000)).toMatchObject({
      head, tree: ticket.tree, expectedRemoteHead: base,
      remote: 'https://github.com/mattduff36/avsworklog.git', ref: 'refs/heads/main',
    });
    for (const changed of [{ expiresAt: 1301 }, { expiresAt: 999 }, { issuedAt: 1001 }, { head: base }, { tree: 'invalid' }]) {
      expect(() => approvedReleaseContext({ ...ticket, ...changed }, base, 1000)).toThrow('approval');
    }
    expect(() => approvedReleaseContext(ticket, base, 1300)).toThrow('approval');
  });

  it('requires both exact hosted commit identity and a real deployment ID', async () => {
    expect(await verifyLiveDeployment(head, async () => ({ commit_sha: head, deployment_id: 'dpl_example' }))).toBe('dpl_example');
    expect(await verifyLiveDeployment(head, async () => ({ commit_sha: base, deployment_id: 'dpl_example' }))).toBeNull();
    expect(await verifyLiveDeployment(head, async () => ({ commit_sha: head, deployment_id: 'not-a-deployment' }))).toBeNull();
  });

  it.each(['full', 'targeted'])('polls actual hosted identity beyond five minutes and up to eight for %s, with injected clock', async () => {
    let now = 0;
    const paths: string[] = [];
    const id = await pollLiveDeployment(head, {
      now: () => now, sleep: async (ms) => { now += ms; },
      read: async (pathname) => {
        paths.push(pathname);
        if (now < 7 * 60_000) throw new Error('Deployment building');
        return { commit_sha: head, deployment_id: 'dpl_exact' };
      },
    });
    expect(id).toBe('dpl_exact');
    expect(now).toBe(7 * 60_000);
    expect(new Set(paths)).toEqual(new Set(['/api/daily-allocation/deployment-identity']));
  });

  it('returns unconfirmed after eight minutes, without a real wait or weakening identity', async () => {
    let now = 0;
    expect(await pollLiveDeployment(head, {
      now: () => now, sleep: async (ms) => { now += ms; },
      read: async () => ({ commit_sha: base, deployment_id: 'dpl_other' }),
    })).toBeNull();
    expect(now).toBe(8 * 60_000);
  });
});
