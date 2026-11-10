import { execFileSync } from 'child_process';
import type { KeyObject } from 'crypto';
import { lstatSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { checkEvidenceDigest } from '../../lib/fixerrors/control';
import {
  prepareReleaseDeviceProof, preparedReleaseEvidenceSchema,
  type PreparedReleaseEvidence, type ReleaseVerifier,
} from '../../lib/fixerrors/release';
import { sameCandidate, type Candidate, type ExecutionResult, type FixerrorsJob } from '../../lib/fixerrors/protocol';
import { FIXERRORS_WORKSPACE } from './fixerrors-device-admission';
import { unavailableFixerrorsExecutor, type TrustedFixerrorsExecutor } from './fixerrors-companion';

export interface ReleaseFixtureScope {
  root: string;
  gitExe: string;
}

// There is deliberately no generic command/argv loader or installed-runner fallback.
// The lead supplies a reviewed isolated transport; this library does not launch fap.
export interface PairedReleaseFixtureTransport {
  readonly fixtureOnly: true;
  invoke(stdin: Buffer, scope: Readonly<{ checkout: string; remote: string }>, signal: AbortSignal): Promise<{
    approvalId: string; repairJobId: string;
    status: 'released' | 'blocked' | 'failed' | 'unknown';
    deploymentId: string | null;
  }>;
}

export function releaseFixturePaths(scope: ReleaseFixtureScope) {
  const root = path.resolve(scope.root);
  if (process.platform !== 'win32' || !path.isAbsolute(scope.root) || root !== scope.root ||
      path.dirname(root).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() ||
      !/^SquiresSignedReleaseFixture-[a-f0-9-]{36}$/u.test(path.basename(root)) ||
      realpathSync(root) !== root || lstatSync(root).isSymbolicLink()) {
    throw new Error('Signed release requires an isolated temporary fixture root');
  }
  const checkout = path.join(root, 'checkout');
  const remote = path.join(root, 'remote.git');
  for (const item of [checkout, path.join(checkout, '.git'), remote]) {
    if (!lstatSync(item).isDirectory() || lstatSync(item).isSymbolicLink() || realpathSync(item) !== item) {
      throw new Error('Signed release fixture must use ordinary unlinked directories');
    }
  }
  if (checkout.toLowerCase() === FIXERRORS_WORKSPACE.toLowerCase() ||
      !path.isAbsolute(scope.gitExe) || path.basename(scope.gitExe).toLowerCase() !== 'git.exe' ||
      !lstatSync(scope.gitExe).isFile()) {
    throw new Error('Signed release fixture Git or checkout invalid');
  }
  return { checkout, remote };
}

export function inspectReleaseFixture(scope: ReleaseFixtureScope) {
  const paths = releaseFixturePaths(scope);
  const read = (cwd: string, ...args: string[]) => execFileSync(scope.gitExe, [
    '--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false', ...args,
  ], {
    cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 65536, windowsHide: true, shell: false,
    env: {
      NODE_ENV: 'test', SystemRoot: process.env.SystemRoot,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'file',
    },
  }).trimEnd();
  const git = (...args: string[]) => read(paths.checkout, ...args);
  if (realpathSync(git('rev-parse', '--show-toplevel')) !== paths.checkout ||
      realpathSync(git('rev-parse', '--absolute-git-dir')) !== path.join(paths.checkout, '.git') ||
      git('branch', '--show-current') !== 'main' ||
      git('status', '--porcelain=v1', '--untracked-files=all') ||
      git('remote') !== 'origin' ||
      git('remote', 'get-url', '--all', 'origin') !== paths.remote ||
      git('remote', 'get-url', '--push', '--all', 'origin') !== paths.remote ||
      read(paths.remote, 'rev-parse', '--is-bare-repository') !== 'true') {
    throw new Error('Signed release fixture checkout or guarded filesystem remote mismatch');
  }
  return { ...paths, head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') };
}

export interface SignedReleaseFixtureConfig {
  enabled: boolean;
  scope: ReleaseFixtureScope;
  verifier: ReleaseVerifier;
  deviceKey: KeyObject;
  evidence(): PreparedReleaseEvidence;
  testedCandidate(): Candidate;
  transport: PairedReleaseFixtureTransport;
  nowSeconds(): number;
}

export function createSignedReleaseFixtureExecutor(config: SignedReleaseFixtureConfig): TrustedFixerrorsExecutor {
  if (!config.enabled) return unavailableFixerrorsExecutor;
  if (config.transport.fixtureOnly !== true) throw new Error('Isolated fixture transport required');
  // Validate scope before advertising availability. Never inspect the real checkout.
  releaseFixturePaths(config.scope);
  if (config.deviceKey.type !== 'private' || config.deviceKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Fixture device Ed25519 private key required');
  }
  return {
    available: true,
    localTestedCandidate: () => config.testedCandidate(),
    async execute(job: Readonly<FixerrorsJob>, signal, releaseTicket): Promise<ExecutionResult> {
      if (!config.enabled || config.transport.fixtureOnly !== true) return { status: 'blocked', reason: 'local-opt-out' };
      if (job.action !== 'deploy' || !releaseTicket) return { status: 'blocked', reason: 'bridge-unavailable' };
      if (signal.aborted) return { status: 'blocked', reason: 'lease-lost' };
      const evidence = preparedReleaseEvidenceSchema.parse(config.evidence());
      const local = config.testedCandidate();
      const inspected = inspectReleaseFixture(config.scope);
      if (!job.candidate || !job.checks || !sameCandidate(local, job.candidate) ||
          inspected.head !== local.head || inspected.tree !== local.tree ||
          checkEvidenceDigest(job.checks) !== local.checksSha256) {
        return { status: 'blocked', reason: 'checkout-drift' };
      }
      const proof = prepareReleaseDeviceProof(releaseTicket, evidence, job, config.verifier,
        config.deviceKey, config.nowSeconds());
      if (signal.aborted) return { status: 'blocked', reason: 'lease-lost' };
      const result = await config.transport.invoke(proof, inspected, signal);
      if (signal.aborted || result.approvalId !== job.id || result.repairJobId !== job.parentRepairId) {
        return { status: 'unknown', reason: 'release-unconfirmed' };
      }
      if (result.status === 'released' && result.deploymentId &&
          /^[A-Za-z0-9_-]{1,128}$/u.test(result.deploymentId)) {
        return { status: 'deployed', candidate: job.candidate };
      }
      if (result.status === 'blocked') return { status: 'blocked', reason: 'execution-failed' };
      return result.status === 'failed'
        ? { status: 'failed', reason: 'execution-failed' }
        : { status: 'unknown', reason: 'release-unconfirmed' };
    },
  };
}
