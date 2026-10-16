import { describe, expect, it } from 'vitest';
import type { PgClientLike } from '@/scripts/fixerrors-safety';
import {
  assertFixedLiveApplyConfirmation,
  assertNonPoolingTarget,
  hashManifestBytes,
  parseFixedLiveManifest,
  reconcileFixedLiveExactIds,
  refreshFixedLiveReports,
  type FixedLiveManifest,
} from '@/scripts/fixerrors-reconcile';

const NOW = new Date('2026-10-16T00:00:00.000Z');
const ROW_A = '00000000-0000-4000-8000-000000000001';
const ROW_B = '00000000-0000-4000-8000-000000000002';
const ROW_OTHER = '00000000-0000-4000-8000-000000000003';
const ROW_ALREADY = '00000000-0000-4000-8000-000000000004';
const COMMIT = 'a'.repeat(40);

type StoredRow = {
  id: string;
  error_message: string;
  status: string;
  archived_at: string | null;
  triage_state: string | null;
  triage_incident_id: string | null;
  triage_summary: string | null;
  triage_next_step: string | null;
  triage_local_commit: string | null;
  triage_live_evidence: string | null;
};

function row(id: string, overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    id,
    error_message: `synthetic error ${id}`,
    status: 'active',
    archived_at: null,
    triage_state: 'outstanding',
    triage_incident_id: 'cluster-1',
    triage_summary: 'Employee directory load failed',
    triage_next_step: 'Deploy and verify live.',
    triage_local_commit: null,
    triage_live_evidence: null,
    ...overrides,
  };
}

function manifestDocument(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    commandId: 'fixerrors-fixed-live',
    safetyContract: 'fixerrors-fixed-live-exact-id-v1',
    targetProjectRef: 'project-ref',
    deployedCommit: COMMIT,
    deploymentId: 'dpl_example_not_evidence',
    check: 'npm test usage-events-route passed',
    result: 'passed',
    verifiedAt: '2026-01-15T12:00:00.000Z',
    rows: [
      {
        id: ROW_A,
        expected: {
          status: 'active',
          triageState: 'outstanding',
          triageIncidentId: 'cluster-1',
          triageSummary: 'Employee directory load failed',
          triageNextStep: 'Deploy and verify live.',
          triageLocalCommit: null,
        },
      },
    ],
    ...overrides,
  });
}

class MemoryClient implements PgClientLike {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  committed = false;
  rolledBack = false;
  shortUpdate = false;

  constructor(public rows: StoredRow[]) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queries.push({ text, values });
    if (text.startsWith('BEGIN')) return { rows: [], rowCount: 0 };
    if (text.startsWith('SHOW')) {
      return { rows: [{ transaction_isolation: 'serializable' } as T], rowCount: 1 };
    }
    if (text.startsWith('ROLLBACK')) {
      this.rolledBack = true;
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('COMMIT')) {
      this.committed = true;
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('fixerrors-fixed-live:refresh')) {
      const ids = values[0] as string[];
      const selected = this.rows.filter(entry => ids.includes(entry.id)).map(entry => ({...entry, triage_live_evidence: entry.triage_live_evidence ? JSON.parse(entry.triage_live_evidence) : null}));
      return { rows: selected as unknown as T[], rowCount: selected.length };
    }
    if (text.includes('fixerrors-fixed-live:lock')) {
      const ids = values[0] as string[];
      const locked = this.rows.filter((entry) => ids.includes(entry.id));
      return { rows: locked as unknown as T[], rowCount: locked.length };
    }
    if (text.includes('fixerrors-fixed-live:update')) {
      if (this.shortUpdate) return { rows: [], rowCount: 0 };
      const ids = values[0] as string[];
      const incidents = values[1] as string[];
      const summaries = values[2] as string[];
      const nextSteps = values[3] as string[];
      const commits = values[4] as Array<string | null>;
      const evidence = values[6] as string;
      const updated: StoredRow[] = [];
      this.rows.forEach((entry) => {
        const index = ids.indexOf(entry.id);
        if (index < 0) return;
        if (
          entry.status !== 'active' ||
          entry.triage_state !== 'outstanding' ||
          entry.triage_incident_id !== incidents[index] ||
          entry.triage_summary !== summaries[index] ||
          entry.triage_next_step !== nextSteps[index] ||
          entry.triage_local_commit !== commits[index]
        ) {
          return;
        }
        entry.status = 'archived';
        entry.archived_at = '2026-10-16T00:00:00.000Z';
        entry.triage_state = 'fixed_live';
        entry.triage_next_step = null;
        entry.triage_live_evidence = evidence;
        updated.push(entry);
      });
      return { rows: updated as unknown as T[], rowCount: updated.length };
    }
    if (text.includes('fixerrors:outstanding-summary')) {
      const outstanding = this.rows
        .filter((entry) => entry.status === 'active' && entry.triage_state === 'outstanding')
        .map((entry) => ({
          id: entry.id,
          triage_summary: entry.triage_summary,
          triage_next_step: entry.triage_next_step,
        }));
      return { rows: outstanding as unknown as T[], rowCount: outstanding.length };
    }
    throw new Error('unexpected reconcile sql');
  }
}

function artifacts() {
  const files = new Map<string, string>();
  return {
    files,
    writeArtifact(path: string, content: string) {
      files.set(path, content);
    },
  };
}

async function apply(client: MemoryClient, contents = manifestDocument(), confirmed = true) {
  const written = artifacts();
  const manifest = parseFixedLiveManifest(contents, NOW);
  const result = await reconcileFixedLiveExactIds({
    client,
    manifest,
    manifestHash: hashManifestBytes(contents),
    confirmed,
    writeArtifact: written.writeArtifact,
  });
  return { result, written, manifest };
}

describe('fixerrors exact-ID fixed-live reconcile', () => {
  it('rejects empty, duplicate, invalid, and incomplete manifests', () => {
    expect(() => parseFixedLiveManifest(manifestDocument({ rows: [] }), NOW)).toThrow(
      /has no rows/u
    );
    const contents = manifestDocument();
    const parsed = JSON.parse(contents) as { rows: Array<{ id: string }> };
    parsed.rows.push({ ...parsed.rows[0], id: parsed.rows[0].id.toUpperCase() });
    expect(() => parseFixedLiveManifest(JSON.stringify(parsed), NOW)).toThrow(/repeats an exact ID/u);
    parsed.rows[1].id = 'not-a-uuid';
    expect(() => parseFixedLiveManifest(JSON.stringify(parsed), NOW)).toThrow(/not a UUID/u);
    const missing = JSON.parse(contents) as Record<string, unknown>;
    delete missing.check;
    expect(() => parseFixedLiveManifest(JSON.stringify(missing), NOW)).toThrow(/missing evidence/u);
    expect(() => parseFixedLiveManifest(manifestDocument({ check: 'abcdefghijklmno' }), NOW)).toThrow(
      /verification check is missing/u
    );
    expect(() => parseFixedLiveManifest(manifestDocument({ verifiedAt: '2026-01-15T12:00:00.000' }), NOW)).toThrow(
      /timestamp is invalid/u
    );
    expect(() =>
      parseFixedLiveManifest(manifestDocument({ verifiedAt: '2026-12-01T00:00:00.000Z' }), NOW)
    ).toThrow(/timestamp is in the future/u);
    expect(() => parseFixedLiveManifest(manifestDocument({ deployedCommit: 'abc123' }), NOW)).toThrow(
      /full SHA/u
    );
    expect(() => parseFixedLiveManifest(manifestDocument({ result: 'failed' }), NOW)).toThrow(
      /must be passed/u
    );
    expect(() =>
      parseFixedLiveManifest(manifestDocument({ safetyContract: 'fixerrors-exact-snapshot-v5' }), NOW)
    ).toThrow(/registered contract/u);
    expect(() => parseFixedLiveManifest(manifestDocument({ normalizedMessage: 'match me' }), NOW)).toThrow(
      /unknown field/u
    );
    expect(() => parseFixedLiveManifest('{', NOW)).toThrow(/not valid JSON/u);
  });

  it('requires the exact target and manifest byte hash before apply', () => {
    const contents = manifestDocument();
    const manifest = parseFixedLiveManifest(contents, NOW);
    const manifestHash = hashManifestBytes(contents);
    expect(() =>
      assertFixedLiveApplyConfirmation({ manifest, manifestHash, confirmManifest: manifestHash })
    ).toThrow(/exact target confirmation/u);
    expect(() =>
      assertFixedLiveApplyConfirmation({ manifest, manifestHash, confirmTarget: 'project-ref' })
    ).toThrow(/manifest hash confirmation/u);
    expect(() =>
      assertFixedLiveApplyConfirmation({
        manifest,
        manifestHash,
        confirmTarget: 'other-ref',
        confirmManifest: manifestHash,
      })
    ).toThrow(/does not match the manifest target/u);
    expect(() =>
      assertFixedLiveApplyConfirmation({
        manifest,
        manifestHash,
        confirmTarget: 'project-ref',
        confirmManifest: 'b'.repeat(64),
      })
    ).toThrow(/hash does not match/u);
    expect(() =>
      assertFixedLiveApplyConfirmation({
        manifest,
        manifestHash,
        confirmTarget: 'project-ref',
        confirmManifest: manifestHash.toUpperCase(),
      })
    ).not.toThrow();
  });

  it('allows session mode but refuses transaction pooling and non-test loopback', () => {
    expect(() =>
      assertNonPoolingTarget('postgresql://postgres.project-ref@aws.pooler.supabase.com:5432/postgres', {
        confirmTarget: 'project-ref',
        allowLoopback: false,
      })
    ).not.toThrow();
    expect(() =>
      assertNonPoolingTarget('postgresql://postgres.project-ref@db.project-ref.supabase.co:6543/postgres', {
        confirmTarget: 'project-ref',
        allowLoopback: false,
      })
    ).toThrow(/pooled database URL/u);
    expect(() =>
      assertNonPoolingTarget('postgresql://avsworklog_test@127.0.0.1:54321/avsworklog_test', {
        confirmTarget: 'avsworklog_test',
        allowLoopback: false,
      })
    ).toThrow(/loopback outside tests/u);
    expect(
      assertNonPoolingTarget('postgresql://avsworklog_test@127.0.0.1:54321/avsworklog_test', {
        confirmTarget: 'avsworklog_test',
        allowLoopback: true,
      })
    ).toMatchObject({ hostname: '127.0.0.1', projectRef: 'avsworklog_test' });
    expect(() =>
      assertNonPoolingTarget('postgresql://postgres.project-ref@db.project-ref.supabase.co:5432/postgres', {
        confirmTarget: 'other-ref',
        allowLoopback: false,
      })
    ).toThrow(/does not match the configured database/u);
  });

  it('rolls back when confirmation, state, or the update count does not match', async () => {
    const client = new MemoryClient([row(ROW_A)]);
    await expect(apply(client, manifestDocument(), false)).rejects.toThrow(/not a trusted execution/u);
    expect(client.queries).toHaveLength(0);

    const drifted = new MemoryClient([row(ROW_A, { triage_incident_id: 'other-incident' })]);
    const before = JSON.stringify(drifted.rows);
    await expect(apply(drifted)).rejects.toThrow(/state drifted/u);
    expect(drifted.rolledBack).toBe(true);
    expect(drifted.committed).toBe(false);
    expect(drifted.queries.some((query) => query.text.includes('fixerrors-fixed-live:update'))).toBe(false);
    expect(JSON.stringify(drifted.rows)).toBe(before);

    const missing = new MemoryClient([]);
    await expect(apply(missing)).rejects.toThrow(/rows are missing/u);
    expect(missing.rolledBack).toBe(true);
    expect(missing.committed).toBe(false);

    const short = new MemoryClient([row(ROW_A)]);
    short.shortUpdate = true;
    await expect(apply(short)).rejects.toThrow(/update count did not match/u);
    expect(short.rolledBack).toBe(true);
    expect(short.committed).toBe(false);
  });

  it('recovers reports read-only after a committed closure and rejects mismatched evidence', async () => {
    const client = new MemoryClient([row(ROW_A)]);
    const contents = manifestDocument();
    const manifest = parseFixedLiveManifest(contents, NOW);
    const manifestHash = hashManifestBytes(contents);
    await expect(reconcileFixedLiveExactIds({client, manifest, manifestHash, confirmed: true,
      writeArtifact: (path) => { if (path.endsWith('.post.json')) throw new Error('disk unavailable'); },
    })).rejects.toThrow(/closure committed/);
    expect(client.committed).toBe(true);
    const start = client.queries.length;
    const written = artifacts();
    await refreshFixedLiveReports({client, manifest, manifestHash, writeArtifact: written.writeArtifact});
    expect(written.files.get('docs_private/error-run-summary.txt')).toContain('Outstanding work remains: NO');
    expect(client.queries.slice(start).some(query => query.text.includes('UPDATE'))).toBe(false);
    await expect(refreshFixedLiveReports({client, manifest: {...manifest, deploymentId: 'dpl_wrong'}, manifestHash,
      writeArtifact: written.writeArtifact})).rejects.toThrow(/evidence mismatch/);
  });

  it('archives only the exact outstanding rows and refreshes the remaining summary', async () => {
    const contents = manifestDocument({
      rows: [ROW_A, ROW_B].map((id) => ({
        id,
        expected: {
          status: 'active',
          triageState: 'outstanding',
          triageIncidentId: 'cluster-1',
          triageSummary: 'Employee directory load failed',
          triageNextStep: 'Deploy and verify live.',
          triageLocalCommit: null,
        },
      })),
    });
    const client = new MemoryClient([
      row(ROW_A),
      row(ROW_B),
      row(ROW_OTHER, { triage_summary: 'Still outstanding separately' }),
      row(ROW_ALREADY, {
        status: 'archived',
        triage_state: 'fixed_live',
        triage_summary: 'Already closed earlier',
        triage_next_step: null,
      }),
    ]);
    const { result, written } = await apply(client, contents);
    expect(result.transactionIsolation).toBe('serializable');
    expect(result.updatedIds).toEqual([ROW_A, ROW_B].sort());
    expect(client.committed).toBe(true);
    expect(client.rolledBack).toBe(false);
    for (const id of [ROW_A, ROW_B]) {
      const updated = client.rows.find((entry) => entry.id === id);
      expect(updated).toMatchObject({
        status: 'archived',
        triage_state: 'fixed_live',
        triage_next_step: null,
        triage_incident_id: 'cluster-1',
        triage_summary: 'Employee directory load failed',
        error_message: `synthetic error ${id}`,
      });
    }
    expect(client.rows.find((entry) => entry.id === ROW_OTHER)?.triage_state).toBe('outstanding');
    expect(client.rows.find((entry) => entry.id === ROW_ALREADY)?.triage_summary).toBe(
      'Already closed earlier'
    );
    const update = client.queries.find((query) => query.text.includes('fixerrors-fixed-live:update'));
    expect(update?.text.split('RETURNING')[0]).not.toContain('error_message');
    expect(update?.text).not.toContain(ROW_A);
    expect(update?.values?.[0]).toEqual([ROW_A, ROW_B].sort());
    const summary = written.files.get('docs_private/error-run-summary.txt') ?? '';
    expect(summary).toContain('Errors found\n- none');
    expect(summary).toContain(ROW_A);
    expect(summary).toContain(ROW_B);
    expect(summary).toContain(ROW_OTHER);
    expect(summary).toContain('Still outstanding separately');
    expect(summary).not.toContain(ROW_ALREADY);
    expect(summary).toContain('Outstanding work remains: YES');
    const pre = written.files.get('docs_private/fixerrors-fixed-live-receipt.pre.json') ?? '';
    const post = written.files.get('docs_private/fixerrors-fixed-live-receipt.post.json') ?? '';
    expect(pre).toContain(`synthetic error ${ROW_A}`);
    expect(pre).toContain('cluster-1');
    expect(post).toContain('"outcome": "fixed_live"');
    expect(post).toContain(`synthetic error ${ROW_B}`);
  });

  it('does not accept a v5 contract as confirmation for this mode', () => {
    const contents = manifestDocument();
    const manifest: FixedLiveManifest = parseFixedLiveManifest(contents, NOW);
    expect(manifest.safetyContract).toBe('fixerrors-fixed-live-exact-id-v1');
    expect(manifest.commandId).toBe('fixerrors-fixed-live');
  });
});
