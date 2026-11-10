import { describe, expect, it, vi } from 'vitest';
import { assertTargetedReleasePaths, pushTargetedRelease } from '@/scripts/automation/fixerrors-targeted-release';
import { GUARDED_PUSH_REF, GUARDED_PUSH_REMOTE, type GuardedPushGit } from '@/scripts/finalise-push-guard';

const context = { head: 'a'.repeat(40), tree: 'b'.repeat(40), expectedRemoteHead: 'c'.repeat(40),
  remote: GUARDED_PUSH_REMOTE, ref: GUARDED_PUSH_REF };
const diff = (name: string, mode = '100644', change = 'M') =>
  `:100644 ${mode} ${'d'.repeat(40)} ${'e'.repeat(40)} ${change}\0${name}\0`;

function fixture(overrides: Record<string, string | number> = {}) {
  const run = vi.fn<GuardedPushGit['run']>((args) => {
    const command = args[0] === '-c' ? args[4] : args[0];
    if (command === 'config') return { status: Number(overrides.configStatus ?? 1), stdout: String(overrides.config ?? '') };
    if (command === 'symbolic-ref') return { status: 0, stdout: String(overrides.branch ?? GUARDED_PUSH_REF) };
    if (command === 'rev-parse') return { status: 0, stdout: String(args[2] === 'HEAD^{commit}' ? overrides.head ?? context.head : overrides.tree ?? context.tree) };
    if (command === 'status') return { status: 0, stdout: String(overrides.status ?? '') };
    if (command === 'remote') return { status: 0, stdout: String(overrides[args.includes('--push') ? 'pushRemote' : 'remote'] ?? GUARDED_PUSH_REMOTE) };
    if (command === 'ls-remote') return { status: 0, stdout: `${overrides.remoteHead ?? context.expectedRemoteHead}\t${GUARDED_PUSH_REF}` };
    if (command === 'merge-base') return { status: Number(overrides.ancestorStatus ?? 0), stdout: '' };
    if (command === 'diff') return { status: Number(overrides.diffStatus ?? 0), stdout: String(overrides.diff ?? diff('lib/utils/format-label.ts') + diff('tests/unit/format-label.test.ts') + diff('lib/config/release-version.json')) };
    if (command === 'push') return { status: Number(overrides.pushStatus ?? 0), stdout: '' };
    throw new Error('Unexpected Git operation');
  });
  return { run };
}

describe('urgent targeted release (injected Git only; never pushes)', () => {
  it('uses the existing exact guard and expected-base lease, never fap or a build', () => {
    const git = fixture();
    pushTargetedRelease(context, git);
    expect(git.run.mock.calls.at(-1)?.[0]).toContain(`--force-with-lease=${GUARDED_PUSH_REF}:${context.expectedRemoteHead}`);
    expect(git.run.mock.calls.at(-1)?.[0].slice(-2)).toEqual([GUARDED_PUSH_REMOTE, `${context.head}:${GUARDED_PUSH_REF}`]);
    expect(git.run).toHaveBeenCalledWith(['diff', '--raw', '--no-abbrev', '--no-renames', '-z', context.expectedRemoteHead, context.head, '--']);
  });

  it.each([
    { head: 'f'.repeat(40) }, { tree: 'f'.repeat(40) }, { remoteHead: 'f'.repeat(40) },
    { branch: 'refs/heads/other' }, { status: '?? unexpected.ts' },
    { remote: 'https://other.invalid/repo.git' }, { pushRemote: 'https://other.invalid/repo.git' },
    { pushRemote: `${GUARDED_PUSH_REMOTE}\nhttps://other.invalid/repo.git` },
    { configStatus: 0, config: 'url.https://other.invalid.insteadof https://github.com/' },
    { ancestorStatus: 1 }, { diffStatus: 1 }, { diff: diff('scripts/finalise.ts') },
  ])('does not push on candidate/destination/base/path drift (%#)', (overrides) => {
    const git = fixture(overrides);
    expect(() => pushTargetedRelease(context, git)).toThrow();
    expect(git.run.mock.calls.some(([args]) => args.includes('push'))).toBe(false);
  });

  it('rechecks the candidate after reading the path diff', () => {
    const git = fixture();
    const original = git.run.getMockImplementation()!;
    let drift = false;
    git.run.mockImplementation((args) => {
      if (args[0] === 'diff') drift = true;
      if (drift && args[0] === 'status') return { status: 0, stdout: ' M components/example.tsx' };
      return original(args);
    });
    expect(() => pushTargetedRelease(context, git)).toThrow('clean');
    expect(git.run.mock.calls.some(([args]) => args.includes('push'))).toBe(false);
  });

  it('fails closed when the expected-base push is rejected', () => {
    expect(() => pushTargetedRelease(context, fixture({ pushStatus: 1 }))).toThrow('push failed');
  });

  it.each([
    'supabase/migrations/20261110_change.sql', 'scripts/automation/squires_companion.py',
    'scripts/finalise.ts', 'package.json', 'package-lock.json', '.github/workflows/release.yml',
    'app/api/widgets/route.ts', 'lib/server/widgets.ts', 'lib/utils/rbac.ts',
    'components/security/Consent.tsx', 'lib/utils/auth.ts', 'types/roles.ts',
    'lib/config/permission-access-rules.ts', 'lib/fixerrors/release.ts',
    'lib/utils/payment.ts', 'app/(dashboard)/quotes/page.tsx', 'lib/utils/session-helper.ts',
    'tests/unit/auth.test.ts', 'lib/utils/roles.ts', 'components/AccessControl.tsx', 'lib/utils/csrf.ts',
    'lib/db/lookup.ts', 'lib/utils/encrypt.ts', 'app/(dashboard)/debug/components/ErrorLogsDebugPanel.tsx',
    'lib/utils/../format-label.ts', 'lib/utils/setup.ts',
    'lib/config/unrelated-config.ts', 'README.md',
  ])('blocks conservative sensitive/infrastructure path %s', (name) => {
    expect(() => assertTargetedReleasePaths(diff(name))).toThrow();
  });

  it.each(['120000', '100755', '160000'])('blocks symlink/executable/submodule mode %s', (mode) => {
    expect(() => assertTargetedReleasePaths(diff('lib/utils/format-label.ts', mode))).toThrow();
  });

  it.each(['A', 'D', 'R100', 'T'])('blocks non-existing-file repair status %s', (status) => {
    expect(() => assertTargetedReleasePaths(diff('lib/utils/format-label.ts', '100644', status))).toThrow();
  });

  it('allows ordinary generic repairs and only the two explicit synthetic acceptance paths', () => {
    expect(() => assertTargetedReleasePaths(diff('components/widgets/Label.tsx') + diff('tests/unit/label.test.ts'))).not.toThrow();
    expect(() => assertTargetedReleasePaths(diff('lib/utils/fixerrors-controlled-acceptance.ts') +
      diff('tests/unit/fixerrors-controlled-acceptance.test.ts'))).not.toThrow();
    expect(() => assertTargetedReleasePaths(diff('lib/config/release-version.json'))).toThrow('eligible repair');
    expect(() => assertTargetedReleasePaths('')).toThrow();
    expect(() => assertTargetedReleasePaths(diff('lib/utils/example.ts').trimEnd().slice(0, -1))).toThrow();
  });
});
