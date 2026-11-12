import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertClientRecoveryChange, isGuardedBusinessClient } from './fixerrors-client-recovery';
import {
  assertGuardedPushReady, pushGuardedCandidate, resolveGuardedPushContext,
  type GuardedPushContext, type GuardedPushGit,
} from '../finalise-push-guard';

const metadata = new Set([
  'lib/config/release-version.json', 'lib/config/release-history.json', 'docs_private/release-log.md',
]);
const synthetic = new Set([
  'lib/utils/fixerrors-controlled-acceptance.ts', 'tests/unit/fixerrors-controlled-acceptance.test.ts',
]);
const sensitive = /auth|permission|security|session|token|credential|secret|password|identity|role|access|policy|csrf|cors|xss|admin|debug|enroll|replay|bridge|automation|deploy|database|schema|persist|sql|storage|audit|crypto|encrypt|signing|certificate|rbac|middleware|migration|supabase|fixerrors|release|finalise|workflow|payroll|finance|payment|invoice|quote|billing|sage|kiosk|webauthn|(?:^|[./_-])db(?:[./_-]|$)/iu;

export function assertTargetedReleasePaths(rawDiff: string, readBlob?: (oid: string) => string): void {
  const entries = rawDiff.split('\0');
  if (entries.pop() !== '' || entries.length === 0 || entries.length % 2 !== 0) {
    throw new Error('Targeted release requires a bounded ordinary-file diff');
  }
  let repairs = 0;
  for (let i = 0; i < entries.length; i += 2) {
    const [header, name] = [entries[i], entries[i + 1]];
    if (!/^:100644 100644 [a-f0-9]{40} [a-f0-9]{40} M$/u.test(header) ||
        !/^[A-Za-z0-9_./()[\]-]+$/u.test(name) ||
        name.split('/').some((part) => !part || part.startsWith('.'))) {
      throw new Error('Targeted release forbids additions, deletions, links and mode changes');
    }
    if (metadata.has(name)) continue;
    if (isGuardedBusinessClient(name) && readBlob) {
      const [, , oldOid, newOid] = header.split(' ');
      assertClientRecoveryChange(name, readBlob(oldOid), readBlob(newOid));
      repairs++;
      continue;
    }
    if (!synthetic.has(name) && (
      !/^(?:app|components|lib|hooks|actions|src|tests\/unit|__tests__)\/.+\.(?:ts|tsx|js|jsx|css)$/u.test(name) ||
      /^(?:app\/api|lib\/server|lib\/config)(?:\/|$)/u.test(name) || sensitive.test(name) ||
      /(?:^|\/)(?:[^/]+\.config|setup)\.[^/]+$/u.test(name)
    )) throw new Error('Targeted release blocked for sensitive or release machinery paths; select Full checks');
    repairs++;
  }
  if (!repairs) throw new Error('Targeted release requires an eligible repair');
}

export function pushTargetedRelease(context: GuardedPushContext, git: GuardedPushGit): void {
  assertGuardedPushReady(context, git);
  const diff = git.run(['diff', '--raw', '--no-abbrev', '--no-renames', '-z', context.expectedRemoteHead, context.head, '--']);
  if (diff.status !== 0) throw new Error('Targeted release diff unavailable');
  assertTargetedReleasePaths(diff.stdout, oid => {
    const blob = git.run(['cat-file', 'blob', oid]);
    if (blob.status !== 0) throw new Error('Guarded client recovery source unavailable');
    return blob.stdout;
  });
  pushGuardedCandidate(context, git);
}

function main(): void {
  if (process.platform !== 'win32' || realpathSync(process.cwd()) !== 'D:\\Websites\\avsworklog') {
    throw new Error('Targeted release requires the fixed Windows checkout');
  }
  const context = resolveGuardedPushContext(['--push', '--guarded-push'], process.env.SQUIRES_FINALISE_GUARDED_PUSH_CONTEXT);
  if (!context) throw new Error('Targeted release context required');
  pushTargetedRelease(context, {
    run: (args) => {
      const result = spawnSync('C:\\Program Files\\Git\\cmd\\git.exe', args, {
        cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 120_000,
        windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024,
      });
      return { status: result.status, stdout: result.stdout ?? '' };
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
