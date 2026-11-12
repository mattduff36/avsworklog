import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkEvidenceDigest } from '@/lib/fixerrors/control';
import { encodePreparedReleaseEvidence, type PreparedReleaseEvidence } from '@/lib/fixerrors/release';
import { reconcilePacketLifecycle, recordPacketCompletion } from '@/scripts/automation/fixerrors-companion-lifecycle';
import { preapprovedFixture } from './fixerrors-preapproval-fixtures';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true }); });

// Disposable filesystem receipts only; not proof of a real worker or deployment.
async function deployedBatch(status: 'deployed' | 'unknown' | 'tested' = 'deployed') {
  const f = await preapprovedFixture();
  await f.ready();
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), 'squires-scope-retirement-'));
  directories.push(directory);
  const batch = f.store.state.jobs[0].privateBatch!;
  const evidence: PreparedReleaseEvidence = {
    repairJobId: f.id, head: f.evidence.head, tree: f.evidence.tree,
    candidateSha256: '8'.repeat(64), allChecksPassed: true, workerResultSha256: '9'.repeat(64),
    preparedChecks: {
      'targeted-tests': { receiptId: '1'.repeat(32), sha256: f.evidence.checks[0].outputSha256 },
      typecheck: { receiptId: '2'.repeat(32), sha256: f.evidence.checks[1].outputSha256 },
      lint: { receiptId: '3'.repeat(32), sha256: f.evidence.checks[2].outputSha256 },
    },
  };
  const checks = { ...f.evidence, release: { candidateSha256: evidence.candidateSha256,
    testEvidenceSha256: createHash('sha256').update(encodePreparedReleaseEvidence(evidence)).digest('hex') } };
  const candidate = { ...f.candidate, checksSha256: checkEvidenceDigest(checks) };
  const result = { status: 'tested' as const, candidate, checks };
  const snapshot = { head: candidate.head, branch: 'main', index_sha256: 'a'.repeat(64), status: '',
    files: {}, candidate_sha256: 'b'.repeat(64) };
  const journal = { jobId: f.id, action: 'repair', packetSha256: batch.delivery.manifestSha256,
    head: f.claimed.job.workspace.head, tree: f.claimed.job.workspace.tree,
    batch: { version: 1, manifestSha256: batch.delivery.manifestSha256, codeSha256: 'c'.repeat(64),
      admissionSha256: 'd'.repeat(64), phase: 'completed', sequence: 1, initial: snapshot, records: [],
      checkpoint: { cursor: 1, outcome: batch.outcome, snapshot, recordsSha256: 'e'.repeat(64) }, result } };
  writeFileSync(path.join(directory, 'active-packet.json'), JSON.stringify(journal));
  writeFileSync(path.join(directory, 'batch-manifest.json'), batch.manifest);
  writeFileSync(path.join(directory, 'prepared-release.json'), JSON.stringify({ candidate, evidence }));
  const scope = path.join(directory, 'batch-check-scope.json');
  const scopeBytes = JSON.stringify({ version: 1, tests: ['tests/unit/example.test.ts'], paths: ['lib/example.ts'] });
  writeFileSync(scope, scopeBytes);
  recordPacketCompletion(directory, f.claimed, result);
  if (status !== 'tested') {
    const deployment = { job: { ...f.claimed.job, id: randomUUID(), action: 'deploy' as const, parentRepairId: f.id } };
    recordPacketCompletion(directory, deployment, status === 'deployed'
      ? { status: 'deployed', candidate } : { status: 'unknown', reason: 'release-unconfirmed' });
  }
  return { directory, scope, scopeBytes, journal, current: { head: candidate.head, tree: candidate.tree, clean: true as const },
    archive: path.join(directory, 'archive', f.id) };
}

describe('deployed batch check-scope retirement', () => {
  it.each(['normal', 'interrupted'] as const)('preserves scope evidence and permits the next exclusive scope: %s', async mode => {
    const f = await deployedBatch();
    if (mode === 'interrupted') {
      mkdirSync(f.archive, { recursive: true });
      renameSync(f.scope, path.join(f.archive, 'batch-check-scope.json'));
    }
    expect(reconcilePacketLifecycle(f.directory, f.current)).toBeNull();
    expect(reconcilePacketLifecycle(f.directory, f.current)).toBeNull();
    expect(readFileSync(path.join(f.archive, 'batch-check-scope.json'), 'utf8')).toBe(f.scopeBytes);
    expect(existsSync(f.scope)).toBe(false);
    expect(() => writeFileSync(f.scope, 'next run scope', { flag: 'wx' })).not.toThrow();
    expect(readFileSync(path.join(f.archive, 'batch-check-scope.json'), 'utf8')).toBe(f.scopeBytes);
  });

  it('holds conflicting archive bytes without retiring the journal or source', async () => {
    const f = await deployedBatch();
    mkdirSync(f.archive, { recursive: true });
    writeFileSync(path.join(f.archive, 'batch-check-scope.json'), 'conflicting retained evidence');
    expect(() => reconcilePacketLifecycle(f.directory, f.current)).toThrow('scope archive conflict');
    expect(readFileSync(f.scope, 'utf8')).toBe(f.scopeBytes);
    expect(existsSync(path.join(f.directory, 'active-packet.json'))).toBe(true);
    expect(existsSync(path.join(f.directory, 'prepared-release.json'))).toBe(true);
  });

  it.each(['tested', 'unknown'] as const)('retains scope until deployment is confirmed: %s', async status => {
    const f = await deployedBatch(status);
    expect(reconcilePacketLifecycle(f.directory, f.current)).toBe('prepared-candidate');
    expect(readFileSync(f.scope, 'utf8')).toBe(f.scopeBytes);
  });
});
