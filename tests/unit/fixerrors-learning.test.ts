import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureCandidateFingerprint, validateDecision } from '@/scripts/fixerrors-decision';
import {
  applySnapshotAbsence,
  fingerprintIncident,
  loadKnowledgeStore,
  parseKnowledgeStore,
  recordIncidentOutcome,
  retrieveIncidents,
  saveKnowledgeAtomic,
  type IncidentQuery,
  type KnowledgeStore,
  type RecordIncidentInput,
} from '@/scripts/fixerrors-knowledge';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function query(overrides: Partial<IncidentQuery> = {}): IncidentQuery {
  return {
    errorContextId: 'dashboard-load-metrics-error',
    httpStatus: 500,
    route: '/dashboard',
    component: 'Console Error',
    sourceFile: 'app/(dashboard)/dashboard/page.tsx',
    normalizedMessage: 'Failed to load dashboard summary',
    rootCauseFamily: 'source:app/(dashboard)/dashboard/page.tsx',
    ...overrides,
  };
}

function input(overrides: Partial<RecordIncidentInput> = {}): RecordIncidentInput {
  return {
    ...query(),
    diagnosis: 'Summary route throws before metric isolation',
    fixSummary: 'Preserve the server error and add a focused regression',
    changedFiles: ['app/api/dashboard/summary/route.ts'],
    tests: ['tests/integration/api/dashboard-summary-route.test.ts'],
    confidence: 'high',
    outcome: 'fix_verified_local',
    lane: 'fast',
    observedAt: '2026-09-24T21:00:00.000Z',
    ...overrides,
  };
}

function storeWith(entry: RecordIncidentInput, observedAt = entry.observedAt): KnowledgeStore {
  return recordIncidentOutcome({ version: 1, incidents: [] }, { ...entry, observedAt });
}

describe('fixerrors learning knowledge', () => {
  it('FIXERR-KNOW-001 rejects malformed or sensitive committed knowledge', () => {
    expect(() => parseKnowledgeStore({ version: 1, incidents: [], email: 'person@example.com' })).toThrow(
      /allowlisted/u
    );
    expect(() =>
      recordIncidentOutcome({ version: 1, incidents: [] }, input({ diagnosis: 'contact person@example.com' }))
    ).toThrow(/Sensitive knowledge/u);
    expect(() =>
      recordIncidentOutcome(
        { version: 1, incidents: [] },
        input({ diagnosis: 'profile ff912f11-3927-45d4-bf15-8bb467b06697 failed' })
      )
    ).toThrow(/Sensitive knowledge/u);
    expect(() =>
      recordIncidentOutcome({ version: 1, incidents: [] }, input({ diagnosis: 'call +44 7700 900123' }))
    ).toThrow(/Sensitive knowledge/u);
    expect(() =>
      recordIncidentOutcome({ version: 1, incidents: [] }, input({ diagnosis: 'call 07700 900123' }))
    ).toThrow(/Sensitive knowledge/u);
    expect(() =>
      recordIncidentOutcome({ version: 1, incidents: [] }, input({ diagnosis: 'call 020-7946-0958' }))
    ).toThrow(/Sensitive knowledge/u);
    expect(() =>
      recordIncidentOutcome({ version: 1, incidents: [] }, input({ diagnosis: 'call (020) 7946 0958' }))
    ).toThrow(/Sensitive knowledge/u);
    expect(() => parseKnowledgeStore({ version: 2, incidents: [] })).toThrow(/version/u);
  });

  it('FIXERR-KNOW-002 ranks exact matches before related matches and lets a later failure win', () => {
    const first = storeWith(input());
    const failed = recordIncidentOutcome(first, input({
      outcome: 'fix_failed',
      observedAt: '2026-09-25T21:00:00.000Z',
      diagnosis: 'The same summary failure returned',
    }));
    const exact = retrieveIncidents(failed, query());
    expect(exact[0]).toMatchObject({ match: 'exact', outcome: 'fix_failed', contradictsEarlierSuccess: true });
    expect(exact.every((match) => match.advisory === false)).toBe(true);

    const related = retrieveIncidents(first, query({
      errorContextId: 'other-context',
      normalizedMessage: 'Different dashboard summary symptom',
      httpStatus: 502,
    }));
    expect(related[0]).toMatchObject({ match: 'related', advisory: true });
    expect(related.length).toBeLessThanOrEqual(5);
    expect(fingerprintIncident(query())).toHaveLength(64);
  });

  it('FIXERR-KNOW-003 preserves the original store when a locked write fails and reads back success', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fixerrors-knowledge-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'knowledge.json');
    const original = storeWith(input());
    saveKnowledgeAtomic(original, filePath);
    writeFileSync(`${filePath}.lock`, 'held', 'utf8');
    expect(() => saveKnowledgeAtomic(storeWith(input({ observedAt: '2026-09-26T00:00:00.000Z' })), filePath)).toThrow(
      /lock is held/u
    );
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(original);
    rmSync(`${filePath}.lock`);
    const next = storeWith(input({ observedAt: '2026-09-26T00:00:00.000Z' }));
    expect(saveKnowledgeAtomic(next, filePath)).toEqual(next);
    expect(loadKnowledgeStore(filePath)).toEqual(next);
  });

  it('FIXERR-SEM-001 proves archive or snapshot absence never implies resolution', () => {
    const original = storeWith(input());
    expect(applySnapshotAbsence(original)).toEqual(original);
    expect(original.incidents[0]?.outcome).toBe('fix_verified_local');
  });

  it('records an exact recurrence only after a verified local fix', () => {
    const verified = storeWith(input());
    const recurred = recordIncidentOutcome(verified, input({
      outcome: 'report_only',
      observedAt: '2026-09-27T00:00:00.000Z',
    }));
    expect(recurred.incidents[0]).toMatchObject({ outcome: 'recurred', recurrenceCount: 1 });
    expect(() => recordIncidentOutcome({ version: 1, incidents: [] }, input({ outcome: 'recurred' }))).toThrow(
      /previously verified/u
    );
  });
});

describe('fixerrors learning decisions', () => {
  const candidate = {
    baseHead: 'a'.repeat(40),
    treeFingerprint: 'b'.repeat(64),
  };

  const retrieval = {
    snapshotId: 'snapshot-1',
    baseHead: candidate.baseHead,
    treeFingerprint: candidate.treeFingerprint,
    clusters: [{ id: 'cluster-1' }],
  };
  const checksum = 'c'.repeat(64);

  function decision(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      analyst: 'generalPurpose / gpt-5.6-sol-high',
      baseHead: candidate.baseHead,
      treeFingerprint: candidate.treeFingerprint,
      clusters: [
        {
          id: 'cluster-1',
          lane: 'fast',
          action: 'fix',
          evidencePaths: ['app/(dashboard)/dashboard/page.tsx'],
          files: ['app/api/dashboard/summary/route.ts'],
          requiredTestIds: ['tests/integration/api/dashboard-summary-route.test.ts'],
          forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
          rationale: 'The summary failure is reproducible in the route.',
          priorIncidentIds: [],
          evidenceEnrichmentAttempted: true,
        },
      ],
      ...overrides,
    };
  }

  it('FIXERR-DEC-001 rejects snapshot, cluster, HEAD, fingerprint, path, lane, action, or test mismatches', () => {
    expect(validateDecision({
      decision: decision(),
      snapshotId: 'snapshot-1',
      snapshotChecksum: checksum,
      retrieval,
      candidate,
    }).clusters[0]?.action).toBe('fix');

    expect(() => validateDecision({
      decision: decision(),
      snapshotId: 'other',
      snapshotChecksum: checksum,
      retrieval,
      candidate,
    })).toThrow(/snapshot/u);
    expect(() => validateDecision({
      decision: decision(),
      snapshotId: 'snapshot-1',
      snapshotChecksum: checksum,
      retrieval: { ...retrieval, clusters: [{ id: 'cluster-2' }] },
      candidate,
    })).toThrow(/cluster/u);
    expect(() => validateDecision({
      decision: decision({ baseHead: 'c'.repeat(40) }),
      snapshotId: 'snapshot-1',
      snapshotChecksum: checksum,
      retrieval,
      candidate,
    })).toThrow(/HEAD/u);
    expect(() => validateDecision({
      decision: decision(),
      snapshotId: 'snapshot-1',
      snapshotChecksum: checksum,
      retrieval: { ...retrieval, treeFingerprint: 'd'.repeat(64) },
      candidate,
    })).toThrow(/Retrieval candidate/u);
    expect(() => validateDecision({
      decision: decision({
        clusters: [{
          ...(decision().clusters[0] as object),
          files: ['../secrets.env'],
        }],
      }),
      snapshotId: 'snapshot-1',
      snapshotChecksum: checksum,
      retrieval,
      candidate,
    })).toThrow(/unsafe path/u);
    expect(() => validateDecision({
      decision: decision({
        clusters: [{
          ...(decision().clusters[0] as object),
          requiredTestIds: [],
        }],
      }),
      snapshotId: 'snapshot-1',
      snapshotChecksum: checksum,
      retrieval,
      candidate,
    })).toThrow(/requires files and tests/u);
  });

  it('changes the candidate fingerprint when untracked file contents change', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fixerrors-candidate-'));
    temporaryDirectories.push(directory);
    execFileSync('git', ['init'], { cwd: directory });
    writeFileSync(path.join(directory, 'tracked.txt'), 'base', 'utf8');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: directory });
    execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'base'], {
      cwd: directory,
    });
    writeFileSync(path.join(directory, 'notes.txt'), 'first', 'utf8');
    const first = captureCandidateFingerprint(directory);
    writeFileSync(path.join(directory, 'notes.txt'), 'second', 'utf8');
    const second = captureCandidateFingerprint(directory);
    expect(first.baseHead).toBe(second.baseHead);
    expect(first.treeFingerprint).not.toBe(second.treeFingerprint);
  });
});
