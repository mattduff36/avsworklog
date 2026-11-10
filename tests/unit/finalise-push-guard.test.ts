import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertGuardedPushCandidate,
  assertGuardedPushReady,
  GUARDED_PUSH_REF,
  GUARDED_PUSH_REMOTE,
  pushGuardedCandidate,
  resolveGuardedPushContext,
  type GuardedPushContext,
  type GuardedPushGit,
} from '@/scripts/finalise-push-guard';

const context: GuardedPushContext = {
  head: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  remote: GUARDED_PUSH_REMOTE,
  ref: GUARDED_PUSH_REF,
  expectedRemoteHead: 'c'.repeat(40),
};

function fixture(overrides: {
  head?: string;
  tree?: string;
  branch?: string;
  status?: string;
  remote?: string;
  pushRemote?: string;
  remoteHead?: string;
  remoteRef?: string;
  rewrites?: string;
  configStatus?: number;
  ancestorStatus?: number;
  pushStatus?: number | null;
} = {}) {
  const run = vi.fn<GuardedPushGit['run']>((args) => {
    const command = args[0] === '-c' ? args[4] : args[0];
    switch (command) {
      case 'symbolic-ref':
        return { status: 0, stdout: overrides.branch ?? GUARDED_PUSH_REF };
      case 'rev-parse':
        return { status: 0, stdout: args[2] === 'HEAD^{commit}'
          ? overrides.head ?? context.head : overrides.tree ?? context.tree };
      case 'status':
        return { status: 0, stdout: overrides.status ?? '' };
      case 'config':
        return { status: overrides.configStatus ?? (overrides.rewrites ? 0 : 1), stdout: overrides.rewrites ?? '' };
      case 'remote':
        return { status: 0, stdout: args.includes('--push')
          ? overrides.pushRemote ?? GUARDED_PUSH_REMOTE : overrides.remote ?? GUARDED_PUSH_REMOTE };
      case 'ls-remote':
        return { status: 0, stdout: `${overrides.remoteHead ?? context.expectedRemoteHead}\t${overrides.remoteRef ?? GUARDED_PUSH_REF}\n` };
      case 'merge-base':
        return { status: overrides.ancestorStatus ?? 0, stdout: '' };
      case 'push':
        return { status: overrides.pushStatus === undefined ? 0 : overrides.pushStatus, stdout: '' };
      default:
        throw new Error(`Unexpected fixture command: ${command}`);
    }
  });
  return { run };
}

function expectNoPush(git: ReturnType<typeof fixture>) {
  expect(git.run.mock.calls.some(([args]) => args.includes('push'))).toBe(false);
}

describe('guarded finalise push context', () => {
  it('leaves manual finalise and fap unguarded when neither guard input is present', () => {
    expect(resolveGuardedPushContext([], undefined)).toBeNull();
    expect(resolveGuardedPushContext(['--push'], undefined)).toBeNull();
    expect(resolveGuardedPushContext(['--full', '--push'], undefined)).toBeNull();
  });

  it('accepts and freezes the complete trusted context', () => {
    const parsed = resolveGuardedPushContext(['--push', '--guarded-push'], JSON.stringify(context));
    expect(parsed).toEqual(context);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    [[], JSON.stringify(context)],
    [['--push'], JSON.stringify(context)],
    [['--guarded-push'], JSON.stringify(context)],
    [['--push', '--guarded-push'], undefined],
    [['--push', '--guarded-push'], ''],
    [['--push', '--guarded-push'], '{'],
    [['--push', '--guarded-push=1'], undefined],
    [['--push', '--guarded-push'], JSON.stringify({ ...context, head: 'HEAD' })],
    [['--push', '--guarded-push'], JSON.stringify({ ...context, tree: undefined })],
    [['--push', '--guarded-push'], JSON.stringify({ ...context, expectedRemoteHead: '0'.repeat(40) })],
    [['--push', '--guarded-push'], JSON.stringify({ ...context, ref: 'refs/heads/other' })],
    [['--push', '--guarded-push'], JSON.stringify({ ...context, remote: 'https://example.com/repo.git' })],
    [['--push', '--guarded-push'], JSON.stringify({ ...context, token: 'DO_NOT_LOG_THIS' })],
    [['--push', '--guarded-push'], 'DO_NOT_LOG_THIS'.repeat(100)],
  ] satisfies [string[], string | undefined][])('rejects partial/malformed inputs without echoing input (%#)', (args, raw) => {
    expect(() => resolveGuardedPushContext(args, raw)).toThrow();
    try {
      resolveGuardedPushContext(args, raw);
    } catch (error) {
      expect(String(error)).not.toContain('DO_NOT_LOG_THIS');
      expect(String(error)).not.toContain('example.com');
    }
  });
});

describe('guarded finalise push verification', () => {
  it('verifies the candidate and remote base before release work', () => {
    const git = fixture();
    assertGuardedPushReady(context, git);
    expect(git.run).toHaveBeenCalledWith(['merge-base', '--is-ancestor', context.expectedRemoteHead, context.head]);
    expectNoPush(git);
  });

  it.each([
    { head: 'd'.repeat(40) },
    { tree: 'd'.repeat(40) },
    { status: ' M lib/config/release-version.json' },
    { status: '?? unexpected.txt' },
    { branch: 'refs/heads/other' },
    { branch: '' },
    { remote: 'https://example.com/repo.git' },
    { pushRemote: 'https://example.com/repo.git' },
    { pushRemote: `${GUARDED_PUSH_REMOTE}\nhttps://example.com/repo.git` },
    { remoteHead: 'd'.repeat(40) },
    { remoteHead: '' },
    { remoteRef: 'refs/heads/other' },
    { ancestorStatus: 1 },
    { ancestorStatus: 128 },
    { rewrites: 'url.https://example.com/.insteadof https://github.com/' },
    { configStatus: 128 },
  ])('refuses drift, unsafe destination, or a non-fast-forward base (%#)', (overrides) => {
    const git = fixture(overrides);
    expect(() => pushGuardedCandidate(context, git)).toThrow();
    expectNoPush(git);
  });

  it('pins source SHA, canonical URL/ref, exact old base and no additional refs', () => {
    const git = fixture();
    expect(pushGuardedCandidate(context, git)).toBe('main');
    expect(git.run.mock.calls.at(-1)?.[0]).toEqual([
      '-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true',
      'push', '--porcelain', '--no-mirror', '--no-follow-tags',
      '--recurse-submodules=no', '--receive-pack=git-receive-pack',
      `--force-with-lease=${GUARDED_PUSH_REF}:${context.expectedRemoteHead}`,
      '--', GUARDED_PUSH_REMOTE, `${context.head}:${GUARDED_PUSH_REF}`,
    ]);
  });

  it('rechecks local identity after remote inspection, immediately before push', () => {
    const git = fixture();
    const original = git.run.getMockImplementation()!;
    let branchReads = 0;
    git.run.mockImplementation((args) => {
      if (args[0] === 'symbolic-ref' && ++branchReads === 2) {
        return { status: 0, stdout: 'refs/heads/drifted' };
      }
      return original(args);
    });
    expect(() => pushGuardedCandidate(context, git)).toThrow('requires main');
    expectNoPush(git);
  });

  it.each([1, null])('fails closed on push/lease rejection or uncertain process result (%s)', (pushStatus) => {
    const git = fixture({ pushStatus });
    expect(() => pushGuardedCandidate(context, git)).toThrow('push failed');
    expect(git.run.mock.calls.filter(([args]) => args.includes('push'))).toHaveLength(1);
  });

  it('does not trust an invalid context passed directly to the helper', () => {
    const git = fixture();
    expect(() => pushGuardedCandidate({ ...context, head: 'HEAD' }, git)).toThrow('Invalid guarded push context');
    expect(git.run).not.toHaveBeenCalled();
  });

  it('detects metadata writes and new commits rather than approving their replacement candidate', () => {
    expect(() => assertGuardedPushCandidate(context, fixture({ status: ' M lib/config/release-version.json' }))).toThrow('clean candidate');
    expect(() => assertGuardedPushCandidate(context, fixture({ head: 'd'.repeat(40) }))).toThrow('HEAD/tree changed');
  });

  it('wires guard entry before workflow mutation, retains release gates and preserves the manual push path', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'scripts', 'finalise.ts'), 'utf8').replace(/\r\n/gu, '\n');
    expect(source.indexOf('assertGuardedPushReady(guardedPushContext, guardedPushGit)'))
      .toBeLessThan(source.indexOf('const run = new AutomationRun', source.indexOf('async function main')));
    expect(source).toContain('assertFinaliseAllowedForProtocol(REPO_ROOT)');
    expect(source).toContain("runCommand('npm', ['run', 'version:bump', '--', releaseBeforeSha, releaseAfterSha]);\n      if (guardedPushContext) assertGuardedPushCandidate(guardedPushContext, guardedPushGit);\n      return commitReleaseVersionChanges");
    expect(source).toContain('guardedPushContext ? pushGuardedCandidate(guardedPushContext, guardedPushGit) : pushCurrentBranch()');
    expect(source).toContain("runCommand('git', ['push']);");
    expect(source).toContain("runCommand('git', ['push', '-u', 'origin', 'HEAD']);");
  });
});
