import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { checkEvidenceDigest } from '@/lib/fixerrors/control';
import { publicQueueState, type ClaimedJob } from '@/lib/fixerrors/protocol';
import { executeCompanionClaim, type TrustedFixerrorsExecutor } from '@/scripts/automation/fixerrors-companion';
import { formatReleaseVersionCommitMessage } from '@/scripts/finalise-summary';
import { checks, FixtureStore, harness, workspace } from './fixerrors-control-fixtures';

it('keeps the disposable remote unchanged until a fresh exact release is approved', async () => {
  const root = mkdtempSync(join(tmpdir(), 'squires-release-fixture-'));
  const checkout = join(root, 'checkout');
  const remote = join(root, 'remote.git');
  const bumpScript = resolve('scripts/bump-release-version.ts');
  const tsx = pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
  const env = {
    Path: process.env.Path ?? process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: root,
    TMP: root,
    HOME: root,
    USERPROFILE: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'empty.gitconfig'),
    GIT_ALLOW_PROTOCOL: 'file',
  };
  const git = (args: string[], cwd = checkout) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  try {
    git(['init', '--bare', '-b', 'main', remote], root);
    git(['init', '-b', 'main', checkout], root);
    git(['config', 'user.name', 'Release fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    git(['remote', 'add', 'origin', remote]);
    const commit = (message: string) => {
      git(['add', '.']);
      git(['commit', '-m', message]);
    };
    writeFileSync(join(checkout, 'sample.txt'), 'before');
    commit('chore: seed disposable release');
    const before = git(['rev-parse', 'HEAD']);
    git(['push', '-u', 'origin', 'HEAD']);
    const remoteHead = () => git(['rev-parse', 'refs/heads/main'], remote);
    const inspect = () => ({
      ...workspace,
      head: git(['rev-parse', 'HEAD']),
      tree: git(['rev-parse', 'HEAD^{tree}']),
      clean: git(['status', '--porcelain']) === '',
    });
    mkdirSync(join(checkout, 'lib/config'), { recursive: true });
    const date = new Date();
    const metadata = 'lib/config/release-version.json';
    const metadataPath = join(checkout, metadata);
    writeFileSync(metadataPath, JSON.stringify({
      mmyy: String(date.getMonth() + 1).padStart(2, '0') + String(date.getFullYear()).slice(-2),
      major: 1, minor: 0, lastProcessedSha: before,
    }));
    commit('chore: seed fixture release metadata');

    const store = new FixtureStore();
    const queue = harness(store);
    const consent = { allowReadOnly: true, allowRepair: true, allowDeploy: true };
    await queue.device({ op: 'heartbeat', workspace: inspect(), bridgeAvailable: true, ...consent });
    let tested: ReturnType<TrustedFixerrorsExecutor['localTestedCandidate']> = null;
    let pushCount = 0;
    let repairSample = true;
    const executor: TrustedFixerrorsExecutor = {
      available: true,
      localTestedCandidate: () => tested,
      async execute(job) {
        if (job.action === 'repair') {
          if (repairSample) {
            writeFileSync(join(checkout, 'sample.txt'), 'fixture repair');
            commit('fix: repair fixture sample');
          }
          const { head, tree } = inspect();
          const evidence = { ...checks, head, tree };
          tested = { head, tree, checksSha256: checkEvidenceDigest(evidence) };
          return { status: 'tested', candidate: tested, checks: evidence };
        }
        if (job.action !== 'deploy' || !job.candidate) throw new Error('Unexpected fixture action');
        // Real version generator used by fap, with no provider credentials.
        const { lastProcessedSha } = JSON.parse(readFileSync(metadataPath, 'utf8'));
        execFileSync(process.execPath, ['--import', tsx, bumpScript, lastProcessedSha, job.candidate.head], { cwd: checkout, env });
        if (git(['status', '--porcelain', '--', metadata])) {
          commit(formatReleaseVersionCommitMessage('fix: repair fixture sample', 'fixture'));
        }
        const current = inspect();
        if (!current.clean || current.head !== job.candidate.head || current.tree !== job.candidate.tree) {
          return { status: 'blocked', reason: 'checkout-drift' };
        }
        // Real Git push to a bare filesystem remote. The executor, test receipts,
        // and queue store are fixtures, and the finalise orchestration is not run.
        git(['push', 'origin', `${job.candidate.head}:refs/heads/main`]);
        pushCount++;
        return { status: 'deployed', candidate: job.candidate };
      },
    };
    const execute = (claim: ClaimedJob) => {
      const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
      return executeCompanionClaim(claim, {
        executor, consent: () => consent, inspect,
        startDeploy: async () => { await queue.device({ op: 'start-deploy', ...lease }); },
        renew: async () => { await queue.device({ op: 'renew', ...lease }); },
        complete: async (result) => { await queue.device({ op: 'complete', ...lease, result }); },
      });
    };
    const repair = async () => {
      const id = await queue.enqueue();
      await execute(await queue.claim());
      if (!tested) throw new Error('Missing fixture test receipt');
      return { id, candidate: tested };
    };
    const approve = ({ id, candidate }: Awaited<ReturnType<typeof repair>>) => queue.admin({
      op: 'approve-deploy', requestId: randomUUID(), repairJobId: id, candidate,
      confirmation: 'DEPLOY EXACT TESTED CANDIDATE',
    });

    const first = await repair();
    expect(publicQueueState(store.state).jobs).toContainEqual(expect.objectContaining({ id: first.id, state: 'tested' }));
    expect(remoteHead()).toBe(before);
    expect(await queue.device({ op: 'claim' })).toMatchObject({ claim: null });
    await approve(first);
    const stale = await queue.claim();

    await execute(stale);
    expect(inspect().head).not.toBe(first.candidate.head);
    expect(publicQueueState(store.state).jobs).toContainEqual(expect.objectContaining({
      id: stale.job.id, state: 'blocked', reason: 'checkout-drift',
    }));
    expect(remoteHead()).toBe(before);
    expect(pushCount).toBe(0);

    await queue.device({ op: 'heartbeat', workspace: inspect(), bridgeAvailable: true, ...consent });
    repairSample = false; // Re-test the prepared metadata commit without another product edit.
    const fresh = await repair();
    await approve(fresh);
    const release = await queue.claim();
    await execute(release);
    expect(remoteHead()).toBe(fresh.candidate.head);
    expect(publicQueueState(store.state).jobs).toContainEqual(expect.objectContaining({
      id: release.job.id, state: 'deployed', candidate: fresh.candidate,
    }));
    await expect(approve(fresh)).rejects.toThrow('Candidate already approved');
    await expect(execute(release)).rejects.toThrow('Lease lost');
    expect(remoteHead()).toBe(fresh.candidate.head);
    expect(pushCount).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
