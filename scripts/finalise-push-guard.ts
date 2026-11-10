import { z } from 'zod';

export const GUARDED_PUSH_CONTEXT_ENV = 'SQUIRES_FINALISE_GUARDED_PUSH_CONTEXT';
export const GUARDED_PUSH_REMOTE = 'https://github.com/mattduff36/avsworklog.git';
export const GUARDED_PUSH_REF = 'refs/heads/main';

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/u).refine((value) => !/^0+$/u.test(value));
const contextSchema = z.object({
  head: shaSchema,
  tree: shaSchema,
  remote: z.literal(GUARDED_PUSH_REMOTE),
  ref: z.literal(GUARDED_PUSH_REF),
  expectedRemoteHead: shaSchema,
}).strict();

export type GuardedPushContext = Readonly<z.infer<typeof contextSchema>>;

export interface GuardedPushGit {
  run(args: string[]): { status: number | null; stdout: string };
}

export function resolveGuardedPushContext(
  argv: string[],
  rawContext: string | undefined,
): GuardedPushContext | null {
  const requested = argv.includes('--guarded-push');
  if (argv.some((arg) => arg.startsWith('--guarded-push') && arg !== '--guarded-push')) {
    throw new Error('Invalid guarded push option');
  }
  if (!requested && rawContext === undefined) return null;
  if (!requested || !argv.includes('--push') || !rawContext || rawContext.length > 1024) {
    throw new Error('Guarded push requires --push, --guarded-push and a complete context');
  }
  let input: unknown;
  try {
    input = JSON.parse(rawContext);
  } catch {
    throw new Error('Invalid guarded push context');
  }
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid guarded push context');
  return Object.freeze(parsed.data);
}

function readGit(git: GuardedPushGit, args: string[]): string {
  const result = git.run(args);
  if (result.status !== 0) throw new Error('Guarded push Git verification failed');
  return result.stdout.trim();
}

export function assertGuardedPushCandidate(context: GuardedPushContext, git: GuardedPushGit): void {
  if (!contextSchema.safeParse(context).success) throw new Error('Invalid guarded push context');
  if (readGit(git, ['symbolic-ref', '-q', 'HEAD']) !== GUARDED_PUSH_REF) {
    throw new Error('Guarded push requires main');
  }
  if (readGit(git, ['rev-parse', '--verify', 'HEAD^{commit}']) !== context.head ||
      readGit(git, ['rev-parse', '--verify', 'HEAD^{tree}']) !== context.tree) {
    throw new Error('Guarded push approved HEAD/tree changed; prepare and review a new candidate');
  }
  if (readGit(git, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('Guarded push requires a clean candidate; prepare and review a new candidate');
  }
}

function assertGuardedPushDestination(context: GuardedPushContext, git: GuardedPushGit): void {
  // Also validate callers of the exported helper, not just the CLI boundary.
  if (!contextSchema.safeParse(context).success) throw new Error('Invalid guarded push context');
  const rewrites = git.run(['config', '--get-regexp', '^url\\..*\\.(insteadof|pushinsteadof)$']);
  if (rewrites.status !== 1 || rewrites.stdout.trim()) {
    throw new Error('Guarded push forbids URL rewrites or unreadable Git configuration');
  }
  for (const args of [
    ['remote', 'get-url', '--all', 'origin'],
    ['remote', 'get-url', '--push', '--all', 'origin'],
  ]) {
    if (readGit(git, args) !== GUARDED_PUSH_REMOTE) {
      throw new Error('Guarded push requires the canonical production origin only');
    }
  }
}

const transportArgs = ['-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true'];

export function assertGuardedPushReady(context: GuardedPushContext, git: GuardedPushGit): void {
  assertGuardedPushDestination(context, git);
  assertGuardedPushCandidate(context, git);
  const remote = readGit(git, [
    ...transportArgs, 'ls-remote', '--refs', '--exit-code', GUARDED_PUSH_REMOTE, GUARDED_PUSH_REF,
  ]);
  if (remote !== `${context.expectedRemoteHead}\t${GUARDED_PUSH_REF}`) {
    throw new Error('Guarded push remote base changed');
  }
  // A lease alone permits rewinds: independently prove this exact update is fast-forward.
  readGit(git, ['merge-base', '--is-ancestor', context.expectedRemoteHead, context.head]);
}

export function pushGuardedCandidate(context: GuardedPushContext, git: GuardedPushGit): 'main' {
  assertGuardedPushReady(context, git);
  assertGuardedPushCandidate(context, git);
  const result = git.run([
    ...transportArgs,
    'push',
    '--porcelain',
    '--no-mirror',
    '--no-follow-tags',
    '--recurse-submodules=no',
    '--receive-pack=git-receive-pack',
    `--force-with-lease=${GUARDED_PUSH_REF}:${context.expectedRemoteHead}`,
    '--',
    GUARDED_PUSH_REMOTE,
    `${context.head}:${GUARDED_PUSH_REF}`,
  ]);
  if (result.status !== 0) throw new Error('Guarded exact-candidate push failed (including remote-base lease rejection)');
  return 'main';
}
