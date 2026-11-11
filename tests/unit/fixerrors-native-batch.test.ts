import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { preparedReleaseEvidenceSchema, encodePreparedReleaseEvidence } from '@/lib/fixerrors/release';
import { controlledAcceptancePacket } from '@/scripts/automation/fixerrors-controlled-acceptance';
import { parseBatchManifest, verifyBatchContributions } from '@/scripts/automation/fixerrors-batch-engine';
import type { FixerrorsDecision } from '@/scripts/fixerrors-decision';

const candidate = { baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) };
function proof() {
  const manifest = parseBatchManifest(JSON.parse(controlledAcceptancePacket(candidate).toString()));
  const evidence = manifest.retrieval.clusters[0];
  const source = evidence.sourceFiles[0];
  const test = 'tests/unit/fixerrors-controlled-acceptance.test.ts';
  const decision: FixerrorsDecision = {
    schemaVersion: 1, snapshotId: manifest.retrieval.snapshotId, analyst: 'MPDEE Worker', ...candidate,
    clusters: [{
      id: evidence.id, lane: 'fast', action: 'fix', disposition: 'outstanding', nextStep: 'Repair synthetic label',
      evidencePaths: [source, test], files: [source, test], requiredTestIds: [test],
      forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
      rationale: 'Synthetic whitespace regression', priorIncidentIds: [], evidenceEnrichmentAttempted: true,
    }],
  };
  return { manifest, contributions: [{ decision, candidate }], outcome: {
    runId: 'fixerrors-fixture', candidate, decisions: structuredClone(decision.clusters),
    clusters: [{ id: evidence.id, status: 'verified-local' }],
  } };
}

describe('native aggregate batch policy and evidence', () => {
  it('reports sanitized initialization codes while retaining the exclusive lock and no fabricated journal', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'SquiresBatchInitialization-'));
    try {
      writeFileSync(path.join(root, 'squires_repair.py'), readFileSync(path.resolve('scripts\\automation\\squires_repair.py')));
      writeFileSync(path.join(root, 'squires_companion.py'), [
        'import json', 'decode_json = json.loads', 'encoded = lambda v: json.dumps(v).encode()',
        'class Denied(ValueError): pass',
        'def require(ok, reason):', '    if not ok: raise Denied(reason)',
      ].join('\n'));
      const program = [
        'import sys, json', 'from pathlib import Path', 'from unittest.mock import patch',
        'sys.path.insert(0, sys.argv[1])', 'import squires_repair as r',
        'root = Path(sys.argv[1])', '(root / ".git").mkdir()', 'r.s.WORKSPACE = root',
        'r.s.local_runtime = lambda cfg: None', 'r.s.fields = lambda value, keys: value',
        'job = "00000000-0000-4000-8000-000000000001"',
        'r.s.signed_device = lambda *args: {"ticket": "fixture", "manifestSha256": "fixture"}',
        'r.s.signed_ticket = lambda *args: {"jobId": job, "packetSha256": "fixture"}',
        'r.s.sha = lambda raw: "fixture"',
        'for error, code in [(ModuleNotFoundError("PRIVATE_SECRET"), "native-import-unavailable"),',
        '    (r.s.Denied("typecheck_cache_not_ready_parent_warmup_required"), "typecheck-cache-not-ready"),',
        '    (ValueError("PRIVATE_SECRET"), "batch-initialization-refused")]:',
        '    with patch.object(r, "NativeBatchSession", side_effect=error):',
        '        try: r.execute_batch(b"fixture", b"{}", {}, lambda _: None)',
        '        except r.NativeBatchFailure as failure:',
        '            assert failure.job_id == job and failure.diagnostic == code',
        '            assert "PRIVATE_SECRET" not in str(failure)',
        '        else: raise AssertionError("initialization accepted")',
        '    lock = root / ".git/squires-fixerrors/batch-executor.lock"',
        '    assert json.loads(lock.read_bytes())["jobId"] == job',
        '    assert not (lock.parent / "active-packet.json").exists()',
        '    lock.unlink()',
        'failure = r.NativeBatchFailure(job, "native-import-unavailable")',
        'r.s.config = lambda: {}', 'r.s.HOME_DIR = root',
        'r.sys.stdin = __import__("io").TextIOWrapper(__import__("io").BytesIO(b\'{"proof":"fixture","bytes":1,"chunks":1}\\n{"index":0,"data":"eA"}\\n\'))',
        'r.s.unb64 = lambda value, limit: b"x"',
        'r.execute_batch = lambda *args: (_ for _ in ()).throw(failure)',
        'assert r.batch_main() == 2',
      ].join('\n');
      const output = execFileSync('python', ['-I', '-B', '-c', program, root], {
        encoding: 'utf8', windowsHide: true, timeout: 10_000,
      });
      expect(JSON.parse(output)).toEqual({
        jobId: '00000000-0000-4000-8000-000000000001', diagnostic: 'native-import-unavailable',
      });
      expect(output).not.toContain('PRIVATE_SECRET');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('boots an isolated operation from its fixed script directory without reading enrollment', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'SquiresBatchBootstrap-'));
    try {
      const script = path.join(root, 'squires_repair.py');
      writeFileSync(script, readFileSync(path.resolve('scripts\\automation\\squires_repair.py')));
      writeFileSync(path.join(root, 'squires_companion.py'), [
        'import json', 'decode_json = json.loads',
        'def config():',
        '    print(json.dumps(dict(fixtureOnly=True, isolatedBootstrap=True)), flush=True)',
        '    raise SystemExit(0)',
      ].join('\n'));
      const output = execFileSync('python', ['-I', '-B', script, '--batch-operation'], {
        input: '{}\n', encoding: 'utf8', windowsHide: true, timeout: 10_000,
      });
      expect(JSON.parse(output)).toEqual({ fixtureOnly: true, isolatedBootstrap: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the prelaunch handshake outside redirected private worker output', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'SquiresBatchHandshake-'));
    try {
      writeFileSync(path.join(root, 'squires_repair.py'), readFileSync(path.resolve('scripts/automation/squires_repair.py')));
      writeFileSync(path.join(root, 'squires_companion.py'), [
        'import json', 'decode_json = json.loads', 'config = lambda: {}',
        'local_runtime = lambda cfg: None',
        'def require(ok, reason):', '    if not ok: raise RuntimeError(reason)',
      ].join('\n'));
      writeFileSync(path.join(root, 'result.md'), '{}');
      const program = [
        'import sys, io, json', 'from pathlib import Path', 'from contextlib import redirect_stdout',
        'sys.path.insert(0, sys.argv[1])', 'import squires_repair as r',
        'def dispatch(cfg, ticket, request, guard):',
        '    with redirect_stdout(io.StringIO()):',
        '        print("private worker progress")', '        guard()',
        '    return Path(sys.argv[1]), {"changed_files": []}, {}',
        'r.dispatch = dispatch', 'r.batch_operation_main()',
      ].join('\n');
      const output = execFileSync('python', ['-I', '-B', '-c', program, root], {
        input: JSON.stringify({ operation: 'dispatch', payload: { ticket: {}, request: {} } }) + '\n{"ok":true}\n',
        encoding: 'utf8', windowsHide: true, timeout: 10_000,
      });
      const frames = output.trim().split(/\r?\n/u).map(line => JSON.parse(line));
      expect(frames[0]).toEqual({ guard: true });
      expect(frames[1]).toMatchObject({ result: { outcome: {}, changedFiles: [] } });
      expect(output).not.toContain('private worker progress');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lints every path beyond the single-cluster limit and rejects changed aggregate scope', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'SquiresAggregateScope-'));
    const dependencies = path.join(root, 'node_modules');
    symlinkSync(path.resolve('node_modules'), dependencies, 'junction');
    try {
      mkdirSync(path.join(root, '.git', 'squires-fixerrors'), { recursive: true });
      mkdirSync(path.join(root, 'lib'));
      mkdirSync(path.join(root, 'tests', 'unit'), { recursive: true });
      writeFileSync(path.join(root, 'eslint.config.mjs'),
        'export default [{files:["**/*.ts"],rules:{"no-debugger":"error"}}];');
      const paths = Array.from({ length: 41 }, (_, index) => `lib/label-${index}.ts`);
      const test = 'tests/unit/label.test.ts';
      paths.push(test);
      paths.forEach(name => writeFileSync(path.resolve(root, name), 'export const label = "ok";\n'));
      const scope = Buffer.from(JSON.stringify({ version: 1, tests: [test], paths }));
      const scopeFile = path.join(root, '.git', 'squires-fixerrors', 'batch-check-scope.json');
      writeFileSync(scopeFile, scope);
      const script = path.resolve('scripts\\automation\\fixerrors-scoped-check.mjs');
      const run = (args: string[]) => promisify(execFile)(process.execPath, [script, 'lint', ...args], {
        cwd: root, windowsHide: true, timeout: 20_000,
      });
      const reference = ['--aggregate', createHash('sha256').update(scope).digest('hex')];
      await expect(run(reference)).resolves.toBeDefined();
      await expect(run(paths)).rejects.toThrow('Invalid locally scoped check');
      writeFileSync(path.resolve(root, paths[40]), 'debugger;\n');
      await expect(run(reference)).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('no-debugger') });
      writeFileSync(scopeFile, Buffer.concat([scope, Buffer.from(' ')]));
      await expect(run(reference)).rejects.toThrow('Aggregate scope changed');
    } finally {
      unlinkSync(dependencies);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('supports empty manifests but never manufactures an empty prepared proof', () => {
    const value = proof();
    value.manifest.retrieval.clusters = [];
    expect(parseBatchManifest(value.manifest).retrieval.clusters).toEqual([]);
    expect(() => verifyBatchContributions(value)).toThrow('Incomplete');
  });
  it('independently revalidates candidate, critical policy, overlap and complete contributions', () => {
    expect(() => verifyBatchContributions(proof())).not.toThrow();
    const critical = proof();
    critical.manifest.retrieval.clusters[0].advisoryLane = 'critical';
    expect(() => verifyBatchContributions(critical)).toThrow('approval');
    const drift = proof();
    drift.contributions[0].candidate = { ...candidate, treeFingerprint: 'c'.repeat(64) };
    expect(() => verifyBatchContributions(drift)).toThrow('fingerprint');
    const missing = proof();
    missing.outcome.clusters = [];
    expect(() => verifyBatchContributions(missing)).toThrow('Incomplete');
    const changed = proof();
    changed.outcome.decisions = structuredClone(changed.outcome.decisions);
    changed.outcome.decisions[0].rationale = 'Different final diagnosis';
    expect(() => verifyBatchContributions(changed)).toThrow('outcome decision changed');
    const overlap = proof();
    overlap.manifest.retrieval.clusters.push({ ...overlap.manifest.retrieval.clusters[0], id: 'cluster-2' });
    overlap.outcome.clusters.push({ id: 'cluster-2', status: 'verified-local' });
    const second = structuredClone(overlap.contributions[0]);
    second.decision.clusters[0].id = 'cluster-2';
    overlap.contributions.push(second);
    overlap.outcome.decisions.push(second.decision.clusters[0]);
    expect(() => verifyBatchContributions(overlap)).toThrow('independent');
  });

  const installed = 'C:\\Users\\mattd\\.codex\\cursor-worker\\squires-production-bridge';
  it.skipIf(!existsSync(path.join(installed, 'worker_checks.py')))(
    'connects paginated capture, chunk delivery, framed resume and one genuine two-repair aggregate candidate',
    async () => {
      const { stdout } = await promisify(execFile)('python', [
        '-I', '-B', path.resolve('tests\\fixtures\\fixerrors-repair-boundary.py'),
        installed, process.cwd(), process.execPath, '--batch',
      ], { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024, windowsHide: true,
        env: { ...process.env, AVSWORKLOG_TEST_SKIP_DOTENV: '1' } });
      const output = JSON.parse(stdout);
      expect(output).toMatchObject({
        fixtureOnly: true, modelLaunched: false, released: false, preparedCommits: 2, consentFingerprintVerified: true,
        connectedCapture: { pages: 2, rows: 281, newRows: 280, heldRows: 1,
          framed: true, nullCheckoutResume: true, crossLanguageOutcome: true },
        counts: { analysis: 8, repair: 2, preparation: 1, receipts: 12, leaseNegatives: 2, resumeNegatives: 6,
          nonRepairRuns: 3, revocation: 1, cancellation: 1, artifactNegatives: 2, admissionNegatives: 3 },
        result: { status: 'tested', batch: { captured: 4, processed: 4, remaining: 0,
          counts: { 'verified-local': 2, held: 2, 'report-only': 0, failed: 0 } } },
      });
      expect(output.connectedCapture.bytes).toBeGreaterThan(96 * 1024);
      const evidence = preparedReleaseEvidenceSchema.parse(output.evidence);
      expect(evidence.batch).toMatchObject({ version: 1, clusterCount: 4, repairCount: 2 });
      expect(output.result.checks.release.testEvidenceSha256).toBe(
        createHash('sha256').update(encodePreparedReleaseEvidence(evidence)).digest('hex'),
      );
    }, 300_000,
  );
});
