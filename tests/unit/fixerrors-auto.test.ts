import { execFileSync } from 'child_process';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertAutomaticPath, assertCleanLocalMain, continueFixerrorsCapture, createAutoAdapters,
  dispatchFixerrorsWorker, runAutomaticFixerrors, verifyFixerrorsReceipts,
  type AutoAdapters, type AutoRetrieval, type WorkerRequest, type WorkerResult,
} from '@/scripts/fixerrors-auto';
import { type DecisionCluster } from '@/scripts/fixerrors-decision';
import { rejectSensitiveDocument } from '@/scripts/fixerrors-knowledge';

vi.mock('child_process', async original => ({
  ...await original<typeof childProcess>(), spawn: vi.fn(),
}));

const candidate = { baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) };
const source = 'lib/utils/display-label.ts';
const test = 'tests/unit/display-label.test.ts';
const directories: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});
function packet(count = 1): AutoRetrieval {
  return {
    schemaVersion: 1, snapshotId: 'ff912f11-3927-45d4-bf15-8bb467b06697', ...candidate, archiveMeansResolved: false,
    clusters: Array.from({ length: count }, (_, index) => ({
      id: `cluster-${index + 1}`, rootCauseFamily: 'label formatting', advisoryLane: 'fast', advisoryAction: 'fix',
      query: { errorContextId: null, httpStatus: null, route: '/dashboard', component: 'Label', sourceFile: source,
        normalizedMessage: `Invalid label ${index}`, rootCauseFamily: 'label formatting' },
      sourceFiles: [source], patterns: [{ errorType: 'TypeError', component: 'Label', normalizedMessage: 'Invalid label',
        sourceFiles: [source], occurrences: 2 }], priorResolutions: [],
    })),
  };
}
function cluster(id = 'cluster-1', overrides: Partial<DecisionCluster> = {}): DecisionCluster {
  return {
    id, lane: 'fast', action: 'fix', disposition: 'outstanding', nextStep: 'Repair the reproducible label formatter',
    evidencePaths: [source, test], files: [source, test], requiredTestIds: [test],
    forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
    rationale: 'The formatter dereferences a missing label', priorIncidentIds: [], evidenceEnrichmentAttempted: true, ...overrides,
  };
}
function harness(decisions: DecisionCluster[] = [cluster()]) {
  const requests: WorkerRequest[] = [];
  const writes = new Map<string, unknown>();
  const adapters: AutoAdapters = {
    candidate: vi.fn(() => candidate), assertUnchanged: vi.fn(), assertRepairScope: vi.fn(), verifyRepair: vi.fn(),
    write: vi.fn((file, value) => writes.set(file, structuredClone(value))), learn: vi.fn(),
    dispatch: vi.fn(async request => {
      requests.push(request);
      const id = request.task_id.match(/cluster-\d+/u)![0];
      return {
        runDirectory: 'private-runner-receipt', changedFiles: request.mode === 'ask' ? [] : [source, test],
        outcome: request.mode === 'ask' ? {
          schemaVersion: 1, snapshotId: packet().snapshotId, analyst: 'MPDEE Worker', ...candidate,
          clusters: [decisions.find(entry => entry.id === id)],
        } : { schemaVersion: 1, clusterId: id, status: 'fixed', changedFiles: [source, test], checks: ['test-1'], summary: 'Guard label formatting' },
      };
    }),
  };
  return { adapters, requests, writes };
}
const run = (adapters: AutoAdapters, retrieval = packet()) =>
  runAutomaticFixerrors({ retrieval, snapshotChecksum: 'c'.repeat(64), adapters });

describe('automatic local fixerrors lifecycle investigation', () => {
  it.each([
    ['Routine', { classes: ['network'], operation: 'usage-analytics', stage: 'record-usage', noncriticalHandled: true, occurrences: 1, frames: [] }, 1, 2],
    ['Important', undefined, 2, 3],
    ['Urgent', { classes: ['service-outage'], operation: 'unknown', noncriticalHandled: false, occurrences: 1, frames: [] }, 3, 4],
  ] as const)('applies %s budgets to the actual analysis and repair requests', async (_label, diagnostics, analysis, repair) => {
    const h = harness();
    const retrieval = packet();
    retrieval.clusters[0].diagnostics = diagnostics ? JSON.parse(JSON.stringify(diagnostics)) : undefined;
    await run(h.adapters, retrieval);
    expect(h.requests.map(request => [request.mode, request.timeout_minutes])).toEqual([
      ['ask', analysis], ['implement', repair],
    ]);
  });
  it('investigates new groups before held cases, reuses only exact new evidence and requires no routine approval', async () => {
    const h = harness([cluster(), cluster('cluster-2', { lane: 'critical' })]);
    const retrieval = packet(3);
    retrieval.clusters[2] = { ...retrieval.clusters[0], id: 'cluster-3', held: true };
    const result = await run(h.adapters, retrieval);
    expect(h.requests.map(request => request.mode)).toEqual(['ask', 'implement', 'ask']);
    expect(result.clusters.map(entry => entry.status)).toEqual(['verified-local', 'held', 'verified-local']);
    expect(result.clusters[2].reusedFrom).toBe('cluster-1');
    expect(h.requests[0].objective).not.toContain('"cluster-2"');
    expect(h.requests[1].workspace).toBe(process.cwd());
    expect(h.requests.every(request => request.acceptance.join(' ').includes('No delegation, worktrees'))).toBe(true);
    expect(h.requests.every(request => request.context.every(file => !file.startsWith('docs_private')))).toBe(true);
    expect(h.requests[1].checks['test-1'].argv).toEqual([
      process.execPath, '--require', path.join(process.cwd(), 'scripts', 'testing', 'fixerrors-test-environment.cjs'),
      path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'), 'run', test,
    ]);
    expect(h.adapters.learn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'cluster-1' }),
      'fix_verified_local', [source, test], [test], 'Guard label formatting');
    expect(h.writes.get('fixerrors-auto-outcome.json')).toMatchObject({ clusters: [
      expect.objectContaining({ attempt: expect.any(String), tests: [test], evidence: expect.any(Array) }),
      expect.objectContaining({ reason: expect.stringContaining('approval'), status: 'held' }),
      expect.objectContaining({ reusedFrom: 'cluster-1' }),
    ] });
  });
  it('revisits held cases on an empty new capture and never treats a related match as new evidence', async () => {
    const h = harness([cluster('cluster-1', { action: 'report-only', disposition: 'no_fix_required', nextStep: null })]);
    const retrieval = packet();
    retrieval.clusters[0].held = true;
    expect((await run(h.adapters, retrieval)).clusters[0].status).toBe('report-only');
    expect(h.requests).toHaveLength(1);
    const empty = harness();
    expect((await run(empty.adapters, packet(0))).clusters).toEqual([]);
    expect(empty.requests).toHaveLength(0);
  });
  it('never reuses a failed unvalidated diagnosis or treats a scoped decision as a final aggregate', async () => {
    const h = harness([cluster('cluster-2', { lane: 'critical' })]);
    const original = h.adapters.dispatch;
    h.adapters.dispatch = vi.fn(async request => {
      if (request.task_id.includes('cluster-1')) throw new Error('Source evidence unavailable');
      return original(request);
    });
    const retrieval = packet(2);
    retrieval.clusters[1] = { ...retrieval.clusters[0], id: 'cluster-2', held: true };
    const result = await run(h.adapters, retrieval);
    expect(h.requests).toHaveLength(1);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[1].reusedFrom).toBeUndefined();
    expect(h.writes.has('error-analysis-decision.json')).toBe(false);
    const decision = [...h.writes.entries()].find(([file]) => file.endsWith('.decision.json'))![1];
    expect(decision).toMatchObject({ analyst: 'MPDEE Worker', ...candidate, clusters: [expect.objectContaining({ id: 'cluster-2' })] });
    expect(decision).not.toHaveProperty('archiveMeansResolved');
  });
  it('continues independent groups after invalid analysis or a clean blocked repair and records failed attempts', async () => {
    const h = harness([cluster(), cluster('cluster-2', {
      action: 'report-only', disposition: 'no_fix_required', nextStep: null,
    })]);
    const original = h.adapters.dispatch;
    h.adapters.dispatch = vi.fn(async request => {
      const result = await original(request);
      if (request.mode === 'implement') return {
        ...result, changedFiles: [],
        outcome: { schemaVersion: 1, clusterId: 'cluster-1', status: 'blocked', changedFiles: [], checks: [], summary: 'Required diagnostic is unavailable' },
      };
      return result;
    });
    const result = await run(h.adapters, packet(2));
    expect(result.clusters.map(entry => entry.status)).toEqual(['failed', 'report-only']);
    expect(result.clusters[0]).toMatchObject({ attempt: 'Bounded local repair attempted', tests: ['test-1: not verified'] });
    expect(h.adapters.learn).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'fix_failed', [], []);
    const invalid = harness([cluster(), cluster('cluster-2', { lane: 'critical' })]);
    const dispatch = invalid.adapters.dispatch;
    invalid.adapters.dispatch = vi.fn(async request => {
      if (request.task_id.includes('cluster-1')) throw new Error('Scoped source evidence unavailable');
      return dispatch(request);
    });
    expect((await run(invalid.adapters, packet(2))).clusters.map(entry => entry.status)).toEqual(['failed', 'held']);
  });
  it('stops on an unverified mutated candidate instead of reusing it for another group', async () => {
    const h = harness([cluster(), cluster('cluster-2')]);
    vi.mocked(h.adapters.verifyRepair).mockImplementation(() => { throw new Error('stale receipt'); });
    vi.mocked(h.adapters.assertUnchanged).mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('unverified candidate drift'); });
    await expect(run(h.adapters, packet(2))).rejects.toThrow('unverified candidate drift');
    expect(h.requests).toHaveLength(2);
    expect(h.writes.get('fixerrors-auto-outcome.json')).toMatchObject({ clusters: [expect.objectContaining({ status: 'failed' })] });
  });
  it('holds critical downgrades, overlapping scope and verified candidates awaiting separate deployment', async () => {
    const h = harness([cluster(), cluster('cluster-2')]);
    expect((await run(h.adapters, packet(2))).clusters.map(entry => entry.status)).toEqual(['verified-local', 'held']);
    const critical = harness();
    const retrieval = packet();
    retrieval.clusters[0].advisoryLane = 'critical';
    expect((await run(critical.adapters, retrieval)).clusters[0].status).toBe('held');
    expect(critical.requests).toHaveLength(1);
    const deployed = harness();
    retrieval.clusters[0].advisoryLane = 'fast';
    retrieval.clusters[0].held = true;
    retrieval.clusters[0].existingState = 'awaiting-deployment';
    const pending = (await run(deployed.adapters, retrieval)).clusters[0];
    expect(pending.reason).toContain('missing or stale');
    expect(pending.timings).toMatchObject({ analysisMs: 0, repairAndChecksMs: 0 });
    expect(deployed.requests).toHaveLength(0);
    expect(deployed.adapters.learn).not.toHaveBeenCalled();
    const contradicted = harness([cluster('cluster-1', {
      action: 'report-only', disposition: 'no_fix_required', nextStep: null,
    })]);
    expect((await run(contradicted.adapters, retrieval)).clusters[0].status).toBe('held');
    expect(contradicted.adapters.learn).not.toHaveBeenCalled();
  });
  it('requires genuine named analysis receipts and reports measured effort without granting repair authority', async () => {
    const h = harness([cluster('cluster-1', { action: 'report-only', disposition: 'no_fix_required', nextStep: null })]);
    h.adapters.analysisChecks = () => ({
      'targeted-tests': { argv: ['node', 'fixed-test', test], timeout_seconds: 120, description: 'Approved regression' },
    });
    expect((await run(h.adapters)).clusters[0]).toMatchObject({
      status: 'held', reason: 'Analysis receipt verifier unavailable',
      triage: { importance: 'Important', effort: 'focused' },
      timings: { analysisMs: expect.any(Number), repairAndChecksMs: 0, totalMs: expect.any(Number) },
    });
    h.adapters.verifyAnalysis = vi.fn();
    const result = await run(h.adapters);
    expect(result.clusters[0].status).toBe('report-only');
    expect(h.adapters.verifyAnalysis).toHaveBeenCalledOnce();
    expect(h.requests.at(-1)?.checks).toHaveProperty('targeted-tests');
    expect(h.requests.at(-1)?.objective).toContain('Related paths are investigation evidence');
  });
  it('does not reuse Urgent or changed diagnostic evidence', async () => {
    for (const classes of [['network'], ['service-outage']] as const) {
      const retrieval = packet(2);
      retrieval.clusters[1] = { ...retrieval.clusters[0], id: 'cluster-2', held: true,
        diagnostics: { classes: [...classes], operation: 'unknown', noncriticalHandled: false, occurrences: 1, frames: [] } };
      const h = harness([cluster('cluster-1', { action: 'report-only', disposition: 'no_fix_required', nextStep: null }),
        cluster('cluster-2', { action: 'report-only', disposition: 'no_fix_required', nextStep: null })]);
      await run(h.adapters, retrieval);
      expect(h.requests).toHaveLength(2);
    }
  });
  it('investigates every new and held cluster without repairing under read-only authority', async () => {
    const h = harness([cluster(), cluster('cluster-2')]);
    const retrieval = packet(2);
    retrieval.clusters[1].held = true;
    const checkpoint = vi.fn();
    h.adapters.checkpoint = checkpoint;
    const result = await runAutomaticFixerrors({
      retrieval, snapshotChecksum: 'c'.repeat(64), mode: 'review', adapters: h.adapters,
    });
    expect(h.requests.map(request => request.mode)).toEqual(['ask', 'ask']);
    expect(result.clusters.map(entry => entry.status)).toEqual(['held', 'held']);
    expect(h.adapters.verifyRepair).not.toHaveBeenCalled();
    expect(checkpoint.mock.calls.map(([value]) => value.clusters.length)).toEqual([1, 2]);
  });
  it('resumes only completed prefixes, skips prior work and restores overlap protection', async () => {
    const first = harness();
    const resume = await runAutomaticFixerrors({
      retrieval: packet(), snapshotChecksum: 'c'.repeat(64), runId: 'fixerrors-resume', adapters: first.adapters,
    });
    const next = harness([cluster('cluster-2')]);
    const result = await runAutomaticFixerrors({
      retrieval: packet(2), snapshotChecksum: 'c'.repeat(64), runId: resume.runId, resume, adapters: next.adapters,
    });
    expect(next.requests.map(request => request.task_id)).toEqual(['fixerrors-resume-cluster-2-analysis']);
    expect(result.clusters.map(entry => entry.status)).toEqual(['verified-local', 'held']);
    const invalid = structuredClone(resume);
    invalid.clusters[0].id = 'cluster-2';
    await expect(runAutomaticFixerrors({
      retrieval: packet(2), snapshotChecksum: 'c'.repeat(64), resume: invalid, adapters: next.adapters,
    })).rejects.toThrow('completed prefix');
    await expect(runAutomaticFixerrors({
      retrieval: packet(2), snapshotChecksum: 'c'.repeat(64), resume: {
        ...resume, candidate: { ...candidate, treeFingerprint: 'd'.repeat(64) },
      }, adapters: next.adapters,
    })).rejects.toThrow('candidate drift');
  });
  it('rejects private packets, unsafe source paths and malformed/live decisions before implementation', async () => {
    const h = harness();
    const retrieval = packet();
    retrieval.clusters[0].query.normalizedMessage = 'person@example.com failed';
    await expect(run(h.adapters, retrieval)).rejects.toThrow('Sensitive knowledge');
    retrieval.clusters[0].query.normalizedMessage = 'Invalid label';
    retrieval.clusters[0].sourceFiles = ['lib/../../.env.local'];
    await expect(run(h.adapters, retrieval)).rejects.toThrow('Unsafe source evidence');
    expect(h.requests).toHaveLength(0);
    const live = harness([cluster('cluster-1', { disposition: 'fixed_live', nextStep: null })]);
    expect((await run(live.adapters)).clusters[0].status).toBe('held');
    expect(live.requests).toHaveLength(1);
  });
  it('continues after blocked retention but never swallows persistence failure', async () => {
    const next = vi.fn(async () => 'continued');
    const record = vi.fn();
    expect(await continueFixerrorsCapture({
      captureOnly: false, retention: async () => { throw new Error('catalog guard'); }, recordRetention: record, continueLocal: next,
    })).toBe('continued');
    expect(record).toHaveBeenCalledWith({ status: 'blocked', error: expect.stringContaining('Retention blocked') });
    await continueFixerrorsCapture({ captureOnly: true, retention: async () => {}, recordRetention: record, continueLocal: next });
    expect(next).toHaveBeenCalledTimes(1);
    await expect(continueFixerrorsCapture({
      captureOnly: false, retention: async () => {}, recordRetention: () => { throw new Error('disk'); }, continueLocal: next,
    })).rejects.toThrow('disk');
  });
  it.each(['app/api/example/route.ts', 'lib/server/example.ts', 'lib/utils/payment.ts',
    'lib/utils/auth-helper.ts', 'lib/utils/concurrent-value.ts', 'scripts/fixerrors.ts', 'lib/../secret.ts',
    'lib\\utils\\label.ts', '.env.local'])('holds sensitive or unsafe path %s', file => {
    expect(() => assertAutomaticPath(file)).toThrow();
  });
  it('keeps typed digest sensitivity exemptions narrow', () => {
    const digits = '02079460958';
    const bindings = { baseHead: `a${digits}${'a'.repeat(28)}`, treeFingerprint: `b${digits}${'b'.repeat(52)}` };
    expect(() => rejectSensitiveDocument(bindings, 'decision')).not.toThrow();
    expect(() => rejectSensitiveDocument({ ...bindings, clusters: [{ diagnosis: bindings.treeFingerprint }] }, 'decision')).toThrow('Sensitive knowledge');
    expect(() => rejectSensitiveDocument({ ...bindings, treeFingerprint: `call ${digits}` }, 'decision')).toThrow('Sensitive knowledge');
  });
});

describe('clean local main only, never a worktree', () => {
  function repository(): string {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fixerrors-gate-'));
    directories.push(cwd);
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    writeFileSync(path.join(cwd, 'tracked.ts'), 'export const value = 1;\n');
    git('add', 'tracked.ts');
    git('-c', 'core.hooksPath=', 'commit', '-m', 'Disposable test fixture');
    return cwd;
  }
  it('accepts a clean local main, rejects dirty/untracked/index changes and a different branch', () => {
    const cwd = repository();
    expect(() => assertCleanLocalMain(cwd)).not.toThrow();
    const adapters = createAutoAdapters(cwd);
    writeFileSync(path.join(cwd, 'untracked.ts'), 'new');
    expect(() => assertCleanLocalMain(cwd)).toThrow('clean local main');
    rmSync(path.join(cwd, 'untracked.ts'));
    writeFileSync(path.join(cwd, 'tracked.ts'), 'changed');
    expect(() => assertCleanLocalMain(cwd)).toThrow('clean local main');
    execFileSync('git', ['add', 'tracked.ts'], { cwd });
    expect(() => adapters.assertUnchanged(adapters.candidate())).toThrow('index');
    execFileSync('git', ['switch', '-c', 'other'], { cwd, stdio: 'pipe' });
    expect(() => assertCleanLocalMain(cwd)).toThrow('clean local main');
  });
  it('contains no worktree creation or patch-import fallback', () => {
    const implementation = readFileSync(path.join(process.cwd(), 'scripts', 'fixerrors-auto.ts'), 'utf8');
    expect(implementation).not.toContain("'worktree', 'add'");
    expect(implementation).not.toContain("'apply', '-'");
  });
  it('rejects a linked git-directory layout without creating a worktree', () => {
    const cwd = repository();
    renameSync(path.join(cwd, '.git'), path.join(cwd, 'metadata'));
    writeFileSync(path.join(cwd, '.git'), `gitdir: ${path.join(cwd, 'metadata')}\n`);
    expect(() => assertCleanLocalMain(cwd)).toThrow('clean local main');
  });
});

function receiptFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fixerrors-receipt-'));
  directories.push(root);
  const cwd = path.join(root, 'workspace');
  const runner = { script: path.join(root, 'run_worker.py'), runs: path.join(root, 'runs') };
  const runDirectory = path.join(runner.runs, 'fixerrors-test-cluster-1', '1');
  for (const directory of [path.join(cwd, 'lib', 'utils'), path.join(runDirectory, 'checks')]) mkdirSync(directory, { recursive: true });
  writeFileSync(runner.script, '# Mock runner; never executed');
  writeFileSync(path.join(cwd, source), 'export const label = "safe";\n');
  const request: WorkerRequest = {
    task_id: 'fixerrors-test-cluster-1', attempt: 1, backend: 'copilot', origin: 'codex', launch_context: 'fixerrors',
    workspace: cwd, mode: 'implement', trusted_workspace: true, show_browser: false, show_terminal: false,
    objective: 'Bounded local repair', acceptance: ['Check label'], context: ['AGENTS.md'], editable_paths: [source],
    checks: { 'test-1': { argv: [process.execPath, 'vitest.mjs', 'run', test], timeout_seconds: 300, description: 'Label regression' } },
  };
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const fingerprint = hash(`{${JSON.stringify(source)}: ${JSON.stringify(hash(readFileSync(path.join(cwd, source))))}}`);
  const write = (file: string, value: unknown) => writeFileSync(path.join(runDirectory, file), JSON.stringify(value, null, 2));
  const summary = {
    task_id: request.task_id, attempt: 1, backend: 'copilot', status: 'review_required', issues: [],
    exit_code: 0, changed_files: [source], out_of_scope_files: [], head: candidate.baseHead,
    branch: 'main', candidate_sha256: 'd'.repeat(64),
  };
  const config = { workspace: cwd, candidate_paths: [source], candidate_scope: 'files', checks: request.checks };
  write('request.json', request);
  write('summary.json', summary);
  write('check-config.json', config);
  const receiptId = 'e'.repeat(32);
  const state = {
    check_id: 'test-1', passed: true, termination_confirmed: true, candidate_stable: true,
    candidate_sha256: fingerprint, last_receipt: receiptId,
  };
  const receipt = {
    ...state, receipt_id: receiptId, exit_code: 0, timed_out: false,
    config_sha256: hash(readFileSync(path.join(runDirectory, 'check-config.json'))),
    argv: request.checks['test-1'].argv, cwd,
  };
  write(path.join('checks', 'test-1.state.json'), state);
  write(path.join('checks', `${receiptId}.json`), receipt);
  writeFileSync(path.join(runDirectory, 'result.md'), JSON.stringify({
    schemaVersion: 1, clusterId: 'cluster-1', status: 'fixed', changedFiles: [source], checks: ['test-1'], summary: 'Local label guard',
  }));
  const result: WorkerResult = { outcome: {}, changedFiles: [source], runDirectory };
  const options = { cwd, expectedDirectory: runDirectory, baseHead: candidate.baseHead, branch: 'main', changed: [source] };
  return { cwd, runner, request, result, options, write, summary, config, state, receipt, receiptId };
}
describe('immutable native worker check receipts', () => {
  it('sets the isolated dotenv skip before starting a native Node check', () => {
    expect(execFileSync(process.execPath, [
      '--require', path.join(process.cwd(), 'scripts', 'testing', 'fixerrors-test-environment.cjs'),
      '-p', 'process.env.AVSWORKLOG_TEST_SKIP_DOTENV',
    ], { encoding: 'utf8', env: { ...process.env, AVSWORKLOG_TEST_SKIP_DOTENV: '0' } }).trim()).toBe('1');
  });
  it('accepts only matching receipts for the final scoped candidate', () => {
    const f = receiptFixture();
    expect(() => verifyFixerrorsReceipts(f.request, f.result, f.options)).not.toThrow();
  });
  it.each(['candidate', 'config', 'check', 'task', 'scope', 'command', 'state', 'request', 'directory', 'issue'])(
    'rejects %s receipt drift', drift => {
      const f = receiptFixture();
      if (drift === 'candidate') writeFileSync(path.join(f.cwd, source), 'changed after verification');
      if (drift === 'config') f.write('check-config.json', { ...f.config, checks: {} });
      if (drift === 'check') f.write(path.join('checks', `${f.receiptId}.json`), { ...f.receipt, passed: false });
      if (drift === 'task') f.write('summary.json', { ...f.summary, task_id: 'other-task' });
      if (drift === 'scope') f.write('check-config.json', { ...f.config, candidate_paths: [] });
      if (drift === 'command') f.write(path.join('checks', `${f.receiptId}.json`), { ...f.receipt, argv: [process.execPath, 'other-command'] });
      if (drift === 'state') f.write(path.join('checks', 'test-1.state.json'), { ...f.state, passed: false });
      if (drift === 'request') f.write('request.json', { ...f.request, launch_context: 'other' });
      if (drift === 'directory') f.result.runDirectory = path.join(f.cwd, 'untrusted');
      if (drift === 'issue') f.write('summary.json', { ...f.summary, issues: ['out-of-scope-file-changes'] });
      expect(() => verifyFixerrorsReceipts(f.request, f.result, f.options)).toThrow();
    });
  it('uses native argv without a shell and task-bound output (mocked process only)', async () => {
    const f = receiptFixture();
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0));
      return child as childProcess.ChildProcess;
    });
    const requestPath = path.join(f.cwd, 'request.json');
    expect((await dispatchFixerrorsWorker(f.request, requestPath, f.runner)).outcome).toMatchObject({ status: 'fixed' });
    expect(childProcess.spawn).toHaveBeenCalledWith('python', [f.runner.script, requestPath], expect.objectContaining({ shell: false, cwd: f.cwd }));
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 2));
      return child as childProcess.ChildProcess;
    });
    await expect(dispatchFixerrorsWorker(f.request, requestPath, f.runner)).rejects.toThrow('Worker failed (2)');
  });
});
