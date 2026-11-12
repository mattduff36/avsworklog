import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildFixerrorsBatchRetrieval, fetchFixerrorsBatchSnapshot } from '@/scripts/fixerrors-capture';
import { hashLifecycleRecord, type LifecycleRecord } from '@/scripts/fixerrors-lifecycle';
import { clusterErrorPatterns, groupIntoPatterns, lifecycleErrorEntry } from '@/scripts/fixerrors-retrieval';
import { recordIncidentOutcome } from '@/scripts/fixerrors-knowledge';
import { type PgClientLike, verifyErrorSnapshot } from '@/scripts/fixerrors-safety';

const now = new Date('2026-09-10T12:00:00.000Z');
const candidate = { baseHead: 'a'.repeat(40), treeFingerprint: 'b'.repeat(64) };
const knowledge = { version: 1 as const, incidents: [] };
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function sourceFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'fixerrors-batch-capture-'));
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'lib', 'labels.ts'),
    'export function ListingLabel() { throw new Error("Unable to render listing label"); }\n' +
    'export const errorContextId = "listing-label";\nexport const route = "/listings";\n' +
    'export const template = `Could not save ${name}`;\n');
  mkdirSync(join(root, 'app', 'customers', '[customerId]'), { recursive: true });
  writeFileSync(join(root, 'app', 'customers', '[customerId]', 'page.tsx'), 'export default function Page() { return null; }\n');
  roots.push(root);
  return root;
}
function record(index: number, held = false): LifecycleRecord {
  const timestamp = new Date(now.getTime() - 60_000 + index).toISOString().replace(/Z$/u, '000Z');
  return {
    error_message: 'Unable to render listing label', error_stack: 'at renderLabel (/app/lib/labels.ts:1:1)',
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, timestamp, created_at: timestamp,
    error_type: 'TypeError', user_id: null, user_email: 'fixture@example.invalid',
    page_url: 'https://example.invalid/listings', user_agent: 'synthetic',
    component_name: 'ListingLabel', additional_data: { errorContextId: 'listing-label', status: 500 },
    status: 'active', triage_state: held ? 'outstanding' : null, triage_local_commit: null,
  };
}
const compare = (left: LifecycleRecord, right: LifecycleRecord) =>
  String(left.created_at).localeCompare(String(right.created_at)) || left.id.localeCompare(right.id);

class BatchClient implements PgClientLike {
  readonly queries: string[] = [];
  private snapshotRows: LifecycleRecord[] = [];
  batchPages = 0;
  constructor(
    readonly liveRows: LifecycleRecord[],
    private readonly options: {
      afterBegin?: (rows: LifecycleRecord[]) => void;
      failRelated?: boolean;
      countAdjustment?: number;
      duplicatePage?: boolean;
      mismatchedId?: boolean;
      shortPage?: boolean;
    } = {},
  ) {}
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push(text);
    let rows: Record<string, unknown>[] = [];
    if (text.includes('fixerrors:export-begin')) {
      this.snapshotRows = structuredClone(this.liveRows).sort(compare);
      this.options.afterBegin?.(this.liveRows);
    } else if (text.includes('fixerrors:transaction-time')) {
      rows = [{ transaction_started_at: now }];
    } else if (text.includes('fixerrors:snapshot-boundary')) {
      const newest = this.snapshotRows.filter(row => row.status === 'active' && row.triage_state === null).at(-1);
      if (newest) rows = [{ id: newest.id, created_at: newest.created_at }];
    } else if (text.includes('fixerrors:snapshot-count')) {
      rows = [{ count: String(this.snapshotRows.filter(row => row.status === 'active' && row.triage_state === null).length) }];
    } else if (text.includes('fixerrors:snapshot-page')) {
      rows = this.snapshotRows.filter(row => row.status === 'active' && row.triage_state === null &&
        (values[2] === null || compare(row, { created_at: values[2], id: String(values[3]) }) > 0))
        .slice(0, Number(values[4]));
    } else if (text.includes('fixerrors:batch-count')) {
      if (this.options.failRelated) throw new Error('Synthetic related-read failure');
      rows = [{ count: String(this.eligible().length + (this.options.countAdjustment ?? 0)) }];
    } else if (text.includes('fixerrors:batch-page')) {
      this.batchPages++;
      let page = this.eligible().filter(row => values[0] === null ||
        compare(row, { created_at: values[0], id: String(values[1]) }) > 0).slice(0, Number(values[2]));
      if (this.options.duplicatePage && this.batchPages > 1) page = [this.eligible()[0]];
      if (this.options.shortPage && this.batchPages > 1) page = [];
      rows = page.map(row => ({
        id: this.options.mismatchedId ? record(999).id : row.id,
        created_at: row.created_at, record: row,
      }));
    }
    return { rows: rows as T[], rowCount: rows.length };
  }
  private eligible(): LifecycleRecord[] {
    return this.snapshotRows.filter(row => row.status === 'active' &&
      (row.triage_state === null || row.triage_state === 'outstanding'));
  }
}

describe('shared full Fixerrors capture', () => {
  it('retains fixed diagnostics and source labels without copying appended private console values', async () => {
    const row = record(1);
    row.error_message = 'console.error: Unable to render listing label: Error: validation failed person@example.invalid';
    row.additional_data = { stage: 'validation', databaseCode: '23505', status: 400,
      payload: 'person@example.invalid', errorContextId: 'listing-label' };
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient([row]), 'c'.repeat(64), now);
    const root = sourceFixture();
    writeFileSync(join(root, 'lib', 'labels.ts'),
      'import { format } from "./format";\nexport const label = "Unable to render listing label";\n');
    writeFileSync(join(root, 'lib', 'format.ts'), 'export const format = (value: string) => value.trim();\n');
    const cluster = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: root }).retrieval.clusters[0];
    expect(cluster.query.normalizedMessage).toBe('Unable to render listing label [dynamic]');
    expect(cluster.relatedSourceFiles).toEqual(['lib/format.ts']);
    expect(cluster.diagnostics).toMatchObject({
      classes: ['validation', 'runtime'], stage: 'validation', databaseCode: '23505',
      occurrences: 1, frames: [{ file: 'lib/labels.ts', line: 1 }],
      firstDay: '2026-09-10', lastDay: '2026-09-10',
    });
    expect(JSON.stringify(cluster)).not.toMatch(/person@|payload|console\.error/u);
  });
  it('recovers structured evidence for new and held console failures without exposing private arguments', async () => {
    const root = sourceFixture();
    const page = 'app/customers/[customerId]/page.tsx';
    writeFileSync(join(root, page), [
      "const errorContextId = 'customers-fetch-options';",
      "console.error('Error fetching customer options:', error, { errorContextId });",
      "toast.error('Unable to load customer options.', { id: errorContextId });",
      "const button = <button>{loading ? 'Loading...' : 'New Quote'}</button>;",
      "const privateExample = 'Example Person';",
    ].join('\n'));
    const rows = [record(1), record(2, true)];
    for (const row of rows) {
      row.error_type = 'Error';
      row.component_name = 'Console Error';
      row.page_url = 'https://example.invalid/customers/private-customer';
      row.error_stack = 'at load (/app/app/customers/[customerId]/page.tsx:2:1)';
      row.error_message = 'Console Error: Error fetching customer options: Error: sign-in needed for private-account';
      row.additional_data = {
        args: ['Error fetching customer options:', { cause: { error: 'private server message' }, status: 401 },
          { errorContextId: 'customers-fetch-options' }],
        userAction: { actionType: 'click', label: 'New Quote', ageMs: 868, href: '/private-customer' },
        userMessage: 'Unable to load customer options.',
      };
    }
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient(rows), 'c'.repeat(64), now);
    const built = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: root });
    expect(built.retrieval.clusters).toHaveLength(2);
    for (const cluster of built.retrieval.clusters) {
      expect(cluster.query).toMatchObject({ httpStatus: 401, errorContextId: 'customers-fetch-options',
        normalizedMessage: 'Error fetching customer options: [dynamic]' });
      expect(cluster.diagnostics).toMatchObject({ classes: ['authentication'],
        recentAction: { kind: 'click', label: 'New Quote' }, visibleMessage: 'Unable to load customer options.' });
    }
    expect(JSON.stringify(built.retrieval)).not.toMatch(/private-account|private-customer|private server message/u);
  });

  it('keeps conflicting status and context ambiguous and drops unrelated private action and toast labels', async () => {
    const root = sourceFixture();
    const row = record(1, true);
    row.error_type = 'Error';
    row.error_message = 'Console Error: Unable to render listing label';
    row.additional_data = { status: 403, errorContextId: 'listing-label',
      args: ['Unable to render listing label', { status: 401, cause: {} }, { errorContextId: 'other-context' }],
      userAction: { actionType: 'click', label: 'ListingLabel', ageMs: 5 },
      userMessage: 'Unable to render listing label' };
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient([row]), 'c'.repeat(64), now);
    const cluster = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: root }).retrieval.clusters[0];
    expect(cluster.query).toMatchObject({ httpStatus: null, errorContextId: null });
    expect(cluster.diagnostics).not.toHaveProperty('recentAction');
    expect(cluster.diagnostics).not.toHaveProperty('visibleMessage');
  });

  it.each([
    { status: 500, context: 'listing-label', httpStatus: null, errorContextId: 'listing-label' },
    { status: 401, context: 'other-context', httpStatus: 401, errorContextId: null },
    { status: null, context: null, httpStatus: null, errorContextId: null },
  ])('requires all grouped rows to support each HTTP field ($status, $context)', async ({ status, context, httpStatus, errorContextId }) => {
    const rows = [record(1), record(2)];
    rows[0].additional_data = { status: 401, errorContextId: 'listing-label' };
    rows[1].additional_data = { status, errorContextId: context };
    const root = sourceFixture();
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient(rows), 'c'.repeat(64), now);
    const input = { ...capture, candidate, knowledge, repoRoot: root };
    expect(buildFixerrorsBatchRetrieval(input).retrieval.clusters).toHaveLength(2);
    const clusters = clusterErrorPatterns(groupIntoPatterns(rows.map(lifecycleErrorEntry), root));
    const grouped = buildFixerrorsBatchRetrieval({ ...input, clusters }).retrieval.clusters;
    expect(grouped).toHaveLength(1);
    expect(grouped[0].diagnostics?.occurrences).toBe(2);
    expect(grouped[0].query).toMatchObject({ httpStatus, errorContextId });
  });

  it('ignores status from request text, raw customer data and unrecognised or oversized argument lists', async () => {
    const rows = [record(1, true), record(2, true), record(3, true)];
    for (const row of rows) {
      row.error_message = 'Console Error: Unable to render listing label HTTP 401';
      row.additional_data = { args: ['Unable to render listing label', { status: 401, customer: 'private-account' },
        { payload: { cause: {}, status: 500, errorContextId: 'listing-label' } }] };
    }
    rows[1].error_message = 'Error in plain application data';
    rows[1].additional_data = { args: ['Unable to render listing label', { cause: {}, status: 401 }] };
    rows[2].additional_data = { args: ['Unable to render listing label', { cause: {}, status: 401 }, ...Array(16).fill(null)] };
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient(rows), 'c'.repeat(64), now);
    const clusters = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: sourceFixture() }).retrieval.clusters;
    expect(clusters).toHaveLength(3);
    for (const cluster of clusters) expect(cluster.query).toMatchObject({ httpStatus: null, errorContextId: null });
    expect(JSON.stringify(clusters)).not.toContain('private-account');
  });

  it('captures more than one page of new and held rows before the same repeatable-read COMMIT', async () => {
    const input = Array.from({ length: 850 }, (_, i) => record(i + 1, i >= 450));
    const client = new BatchClient(input, { afterBegin: rows => {
      rows.push(record(900));
      rows[0].triage_state = 'outstanding';
      rows[500].status = 'archived';
    } });
    const captured = await fetchFixerrorsBatchSnapshot(client, 'c'.repeat(64), now);
    expect(captured.snapshot.rowCount).toBe(450);
    expect(captured.records.captured).toHaveLength(450);
    expect(captured.records.held).toHaveLength(400);
    expect(client.batchPages).toBe(5);
    expect(verifyErrorSnapshot(captured.snapshot).exactIds).toHaveLength(450);
    expect(captured.records.captured[0].triage_state).toBeNull();
    expect(captured.records.held[50].status).toBe('active');
    expect([...captured.records.captured, ...captured.records.held].some(row => row.id === record(900).id)).toBe(false);
    const commit = client.queries.findIndex(query => query.includes('fixerrors:export-commit'));
    expect(client.queries[0]).toContain('REPEATABLE READ READ ONLY');
    expect(client.queries.findLastIndex(query => query.includes('fixerrors:batch-page'))).toBeLessThan(commit);
    expect(client.queries.filter(query => query.includes('BEGIN'))).toHaveLength(1);
    expect(client.queries.some(query => /\b(?:INSERT|UPDATE|DELETE)\b/u.test(query))).toBe(false);
  });

  it('preserves exact raw lifecycle hashes, coverage and sanitized diagnostic context in new-first order', async () => {
    const input = [record(1, true), record(2), record(3, true), record(4)];
    input[3].page_url = 'http://localhost:4000/listings';
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient(input), 'c'.repeat(64), now);
    expect(hashLifecycleRecord(capture.records.captured[0])).toBe(hashLifecycleRecord(input[1]));
    const built = buildFixerrorsBatchRetrieval({
      ...capture, candidate, knowledge, repoRoot: sourceFixture(),
      records: { ...capture.records, held: [...capture.records.held].reverse() },
    });
    expect(built.retrieval.clusters.map(cluster => Boolean(cluster.held))).toEqual([false, true, true]);
    expect(built.bindings.flatMap(binding => binding.records.map(row => row.id)))
      .toEqual([record(2).id, record(1).id, record(3).id]);
    expect(built.suppressed.map(row => row.id)).toEqual([record(4).id]);
    expect(built.retrieval.clusters[0].query).toMatchObject({
      route: '/listings', component: 'ListingLabel', sourceFile: 'lib/labels.ts',
      normalizedMessage: 'Unable to render listing label', errorContextId: 'listing-label', httpStatus: 500,
    });
    const serialized = JSON.stringify(built.retrieval);
    expect(serialized).not.toContain('fixture@example.invalid');
    expect(serialized).not.toContain('https://example.invalid');
    for (const row of input) expect(serialized).not.toContain(row.id);
  });

  it('keeps every held case when there are no new rows, including an existing local repair hold', async () => {
    const input = Array.from({ length: 205 }, (_, i) => record(i + 1, true));
    input[0].triage_local_commit = 'd'.repeat(40);
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient(input), 'c'.repeat(64), now);
    const built = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: sourceFixture() });
    expect(capture.snapshot.exactIds).toEqual([]);
    expect(built.retrieval.clusters).toHaveLength(205);
    expect(built.retrieval.clusters.every(cluster => cluster.held)).toBe(true);
    expect(built.retrieval.clusters[0].existingState).toBe('awaiting-deployment');
    expect(built.bindings).toHaveLength(205);
    expect(Buffer.byteLength(JSON.stringify(built.retrieval), 'utf8')).toBeGreaterThan(96 * 1024);
  });

  it('reports an empty batch without inventing work or lifecycle bindings', async () => {
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient([]), 'c'.repeat(64), now);
    const built = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: sourceFixture() });
    expect(built.retrieval.clusters).toEqual([]);
    expect(built.bindings).toEqual([]);
    expect(built.suppressed).toEqual([]);
  });

  it('retains the existing knowledge lookup rather than substituting generic diagnostics', async () => {
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient([record(1)]), 'c'.repeat(64), now);
    const input = { ...capture, candidate, knowledge, repoRoot: sourceFixture() };
    const first = buildFixerrorsBatchRetrieval(input).retrieval.clusters[0];
    const learned = recordIncidentOutcome(knowledge, {
      ...first.query, diagnosis: 'Missing listing label', fixSummary: 'Guard optional labels',
      changedFiles: ['lib/labels.ts'], tests: ['tests/unit/labels.test.ts'],
      confidence: 'high', outcome: 'fix_verified_local', lane: 'fast', observedAt: now.toISOString(),
    });

    const repeated = buildFixerrorsBatchRetrieval({ ...input, knowledge: learned }).retrieval.clusters[0];
    expect(repeated.query).toEqual(first.query);
    expect(repeated.priorResolutions).toMatchObject([{
      match: 'exact', diagnosis: 'Missing listing label', fixSummary: 'Guard optional labels',
    }]);
  });

  it('projects source templates and dynamic routes without leaking arbitrary names, slugs or IDs', async () => {
    const input = [record(1), record(2, true)];
    for (const row of input) {
      row.error_message = 'Could not save John Smith';
      row.page_url = 'https://example.invalid/customers/John-Smith';
      row.component_name = 'Jane Doe';
      row.additional_data = { errorContextId: 'private-person-12345', status: 500 };
      row.error_type = 'PrivatePersonFailure';
    }
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient(input), 'c'.repeat(64), now);
    const built = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: sourceFixture() });
    expect(built.retrieval.clusters).toHaveLength(2);
    for (const cluster of built.retrieval.clusters) {
      expect(cluster.query).toMatchObject({
        route: '/customers/[customerId]', normalizedMessage: 'Could not save [dynamic]',
        errorContextId: null, component: 'labels', sourceFile: 'lib/labels.ts',
      });
      expect(cluster.patterns[0].errorType).toBe('Error');
    }
    const serialized = JSON.stringify(built.retrieval);
    for (const text of ['John Smith', 'John-Smith', 'Jane Doe', 'private-person-12345', 'PrivatePersonFailure']) {
      expect(serialized).not.toContain(text);
    }
    expect(built.bindings[0].records[0].error_message).toBe('Could not save John Smith');
  });

  it('orders held records by actual time and microseconds rather than timestamp text or IDs', async () => {
    const capture = await fetchFixerrorsBatchSnapshot(
      new BatchClient([record(1, true), record(2, true), record(3, true)]), 'c'.repeat(64), now,
    );
    capture.records.held[0].created_at = '2026-09-10T12:00:00.123002+01:00';
    capture.records.held[1].created_at = '2026-09-10T11:00:00.123001Z';
    capture.records.held[2].created_at = '2026-09-10T11:30:00.000000Z';
    const built = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: sourceFixture() });
    expect(built.bindings.map(binding => binding.records[0].id))
      .toEqual([record(2).id, record(1).id, record(3).id]);
  });

  it.each([
    { failRelated: true }, { countAdjustment: 1 }, { countAdjustment: -1 },
    { duplicatePage: true }, { mismatchedId: true }, { shortPage: true },
  ])('rolls back a partial or inconsistent capture: %j', async options => {
    const client = new BatchClient(Array.from({ length: 401 }, (_, i) => record(i + 1, i > 100)), options);
    await expect(fetchFixerrorsBatchSnapshot(client, 'c'.repeat(64), now)).rejects.toThrow();
    expect(client.queries.at(-1)).toContain('fixerrors:export-rollback');
    expect(client.queries.some(query => query.includes('fixerrors:export-commit'))).toBe(false);
  });

  it('rejects duplicate private bindings and omitted eligible groups instead of truncating the run', async () => {
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient([record(1), record(2, true)]), 'c'.repeat(64), now);
    const input = { ...capture, candidate, knowledge, repoRoot: sourceFixture() };
    expect(() => buildFixerrorsBatchRetrieval({ ...input, clusters: [] })).toThrow('omit eligible');
    expect(() => buildFixerrorsBatchRetrieval({
      ...input, records: { ...input.records, held: [...input.records.held, ...input.records.held] },
    })).toThrow('Duplicate private');
  });

  it.each([
    ['/customers/new', '/customers/new'],
    ['/customers/synthetic-client', '/customers/[customerId]'],
    ['/reports', '/reports/[[...filters]]'],
    ['/reports/year/2026', '/reports/[[...filters]]'],
  ])('uses the most specific checked-in route template for %s', async (route, expected) => {
    const root = sourceFixture();
    for (const segments of [['customers', 'new'], ['reports', '[[...filters]]']]) {
      const directory = join(root, 'app', ...segments);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'page.tsx'), 'export default function Page() { return null; }\n');
    }
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient([
      { ...record(1), page_url: `https://example.invalid${route}` },
    ]), 'c'.repeat(64), now);
    const built = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: root });
    expect(built.retrieval.clusters[0].query.route).toBe(expected);
  });

  it('rejects source parent junctions and an app root junction instead of reading external templates', async () => {
    const root = sourceFixture(), external = sourceFixture();
    mkdirSync(join(external, 'app', 'synthetic-private-route'));
    writeFileSync(join(external, 'app', 'synthetic-private-route', 'page.tsx'), 'export default function Page() { return null; }\n');
    renameSync(join(root, 'lib'), join(root, 'lib-original'));
    renameSync(join(root, 'app'), join(root, 'app-original'));
    symlinkSync(join(external, 'lib'), join(root, 'lib'), 'junction');
    symlinkSync(join(external, 'app'), join(root, 'app'), 'junction');
    const capture = await fetchFixerrorsBatchSnapshot(new BatchClient([
      { ...record(1), page_url: 'https://example.invalid/synthetic-private-route' },
    ]), 'c'.repeat(64), now);
    const built = buildFixerrorsBatchRetrieval({ ...capture, candidate, knowledge, repoRoot: root });
    expect(built.retrieval.clusters[0]).toMatchObject({ sourceFiles: [], query: { route: 'NoPage' } });
  });
});
