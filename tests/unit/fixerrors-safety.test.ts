import {
  __testOnlyExecuteVerifiedSnapshotCleanup as executeVerifiedSnapshotCleanup,
  executeVerifiedSnapshotCleanup as executeProductionSnapshotCleanup,
  fetchProductionErrorSnapshot,
  markSnapshotAnalysisCompleted,
  readAndVerifyErrorSnapshot,
  writeAndVerifyErrorSnapshot,
  writeAndVerifyTextArtifactAtomic,
  type ErrorSnapshotExport,
  type PgClientLike,
  type SnapshotIo,
  type SnapshotLock,
} from '@/scripts/fixerrors-safety';
import * as safetyModule from '@/scripts/fixerrors-safety';
import type { ErrorLogEntry } from '@/scripts/fixerrors';
import { describe, expect, it } from 'vitest';

const TARGET_FINGERPRINT = 'a'.repeat(64);
const SNAPSHOT_PATH = '/virtual/error-snapshot.json';
const ANALYSIS_PATH = '/virtual/error-analysis.md';
const EXPORT_TIME = new Date('2026-08-11T06:00:00.000Z');

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function makeError(index: number, overrides: Partial<ErrorLogEntry> = {}): ErrorLogEntry {
  const createdAt = new Date(EXPORT_TIME.getTime() - 60_000 + index).toISOString();
  return {
    id: uuid(index),
    timestamp: createdAt,
    created_at: createdAt,
    error_message: `Error ${index}`,
    error_stack: null,
    error_type: 'Error',
    user_id: null,
    user_email: 'user@example.com',
    page_url: 'https://www.squiresapp.com/example',
    user_agent: 'vitest',
    component_name: 'Example',
    additional_data: null,
    ...overrides,
  };
}

function compareRows(left: ErrorLogEntry, right: ErrorLogEntry): number {
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
}

function result<T extends Record<string, unknown>>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

class ExportClient implements PgClientLike {
  readonly queryLog: string[] = [];
  readonly liveRows: ErrorLogEntry[];
  private transactionRows: ErrorLogEntry[] = [];
  private readonly failTag: string | null;
  private readonly afterBegin?: (rows: ErrorLogEntry[]) => void;
  private readonly countOverride: number | null;

  constructor(
    rows: ErrorLogEntry[],
    options: {
      failTag?: string;
      afterBegin?: (rows: ErrorLogEntry[]) => void;
      countOverride?: number;
    } = {}
  ) {
    this.liveRows = [...rows];
    this.failTag = options.failTag ?? null;
    this.afterBegin = options.afterBegin;
    this.countOverride = options.countOverride ?? null;
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queryLog.push(text);
    if (this.failTag && text.includes(this.failTag)) {
      throw new Error(`forced ${this.failTag} failure`);
    }
    if (text.includes('fixerrors:export-begin')) {
      this.transactionRows = [...this.liveRows].sort(compareRows);
      this.afterBegin?.(this.liveRows);
      return result([]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:transaction-time')) {
      return result([{ transaction_started_at: EXPORT_TIME }]) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:snapshot-boundary')) {
      const row = this.transactionRows.at(-1);
      return result(row ? [{ id: row.id, created_at: row.created_at }] : []) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:snapshot-count')) {
      return result([
        { count: String(this.countOverride ?? this.transactionRows.length) },
      ]) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:snapshot-page')) {
      const cursorCreatedAt = values[2] as string | null;
      const cursorId = values[3] as string | null;
      const limit = values[4] as number;
      const rows = this.transactionRows
        .filter(
          (row) =>
            cursorCreatedAt === null ||
            row.created_at > cursorCreatedAt ||
            (row.created_at === cursorCreatedAt && row.id > (cursorId ?? ''))
        )
        .slice(0, limit);
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    return result([]) as { rows: T[]; rowCount: number };
  }
}

const EXPECTED_FOREIGN_KEYS = [
  {
    child_schema: 'public',
    child_table: 'error_log_alerts',
    child_columns: ['error_log_id'],
    parent_columns: ['id'],
    delete_action: 'CASCADE',
  },
  {
    child_schema: 'public',
    child_table: 'service_health_events',
    child_columns: ['recovery_error_log_id'],
    parent_columns: ['id'],
    delete_action: 'SET NULL',
  },
  {
    child_schema: 'public',
    child_table: 'user_usage_events',
    child_columns: ['error_log_id'],
    parent_columns: ['id'],
    delete_action: 'SET NULL',
  },
];

class CleanupClient implements PgClientLike {
  readonly queryLog: string[] = [];
  readonly unrelatedData = new Set(['application-row']);
  readonly errorRows: Map<string, ErrorLogEntry>;
  readonly alerts: Set<string>;
  readonly serviceReferences: Set<string>;
  readonly usageReferences: Set<string>;
  foreignKeys = [...EXPECTED_FOREIGN_KEYS];
  triggerRows: Array<{ trigger_name: string }> = [];
  failDeleteBatch: number | null = null;
  commitThenThrow = false;
  private workingRows = new Map<string, ErrorLogEntry>();
  private workingAlerts = new Set<string>();
  private deleteBatch = 0;

  constructor(options: {
    rows: ErrorLogEntry[];
    alerts?: string[];
    serviceReferences?: string[];
    usageReferences?: string[];
  }) {
    this.errorRows = new Map(options.rows.map((row) => [row.id, row]));
    this.alerts = new Set(options.alerts ?? []);
    this.serviceReferences = new Set(options.serviceReferences ?? []);
    this.usageReferences = new Set(options.usageReferences ?? []);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queryLog.push(text);
    if (text.includes('fixerrors:cleanup-begin')) {
      this.workingRows = new Map(this.errorRows);
      this.workingAlerts = new Set(this.alerts);
      return result([]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:fk-catalog')) {
      return result(this.foreignKeys) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:trigger-catalog')) {
      return result(this.triggerRows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:lock-target-rows')) {
      const ids = values[0] as string[];
      const rows = ids
        .map((id) => this.workingRows.get(id))
        .filter((row): row is ErrorLogEntry => Boolean(row))
        .sort(compareRows);
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:service-reference-check')) {
      const ids = values[0] as string[];
      const id = ids.find((candidate) => this.serviceReferences.has(candidate));
      return result(id ? [{ id: 'service-reference' }] : []) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:usage-reference-check')) {
      const ids = values[0] as string[];
      const id = ids.find((candidate) => this.usageReferences.has(candidate));
      return result(id ? [{ id: 'usage-reference' }] : []) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:alert-reference-check')) {
      const ids = values[0] as string[];
      const rows = ids
        .filter((id) => this.workingAlerts.has(id))
        .sort()
        .map((error_log_id) => ({ error_log_id }));
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:delete-alerts')) {
      const ids = values[0] as string[];
      const rows = ids
        .filter((id) => this.workingAlerts.delete(id))
        .map((error_log_id) => ({ error_log_id }));
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:delete-error-batch')) {
      this.deleteBatch += 1;
      if (this.failDeleteBatch === this.deleteBatch) {
        throw new Error('forced batch failure');
      }
      const ids = values[0] as string[];
      const rows = ids
        .filter((id) => this.workingRows.delete(id))
        .map((id) => ({ id }));
      return result(rows) as unknown as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:remaining-count')) {
      return result([{ count: String(this.workingRows.size) }]) as {
        rows: T[];
        rowCount: number;
      };
    }
    if (text.includes('fixerrors:cleanup-rollback')) {
      this.workingRows = new Map(this.errorRows);
      this.workingAlerts = new Set(this.alerts);
      return result([]) as { rows: T[]; rowCount: number };
    }
    if (text.includes('fixerrors:cleanup-commit')) {
      this.errorRows.clear();
      for (const [id, row] of this.workingRows) this.errorRows.set(id, row);
      this.alerts.clear();
      for (const id of this.workingAlerts) this.alerts.add(id);
      if (this.commitThenThrow) throw new Error('connection lost during commit');
      return result([]) as { rows: T[]; rowCount: number };
    }
    return result([]) as { rows: T[]; rowCount: number };
  }
}

class MemoryIo implements SnapshotIo {
  readonly files = new Map<string, string>();
  failNextWrite = false;
  failNextRead = false;
  failCompletedOutcomeWrite = false;

  writeAtomic(path: string, content: string): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('forced artifact write failure');
    }
    if (
      this.failCompletedOutcomeWrite &&
      (
        JSON.parse(content) as ErrorSnapshotExport
      ).cleanup.status === 'completed'
    ) {
      this.failCompletedOutcomeWrite = false;
      throw new Error('forced post-commit artifact write failure');
    }
    this.files.set(path, content);
  }

  read(path: string): string {
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error('forced artifact read failure');
    }
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }
}

class MemoryLock implements SnapshotLock {
  held = false;

  acquire(): () => void {
    if (this.held) throw new Error('artifact lock is already held');
    this.held = true;
    return () => {
      this.held = false;
    };
  }
}

async function analyzedSnapshot(
  rows: ErrorLogEntry[],
  io = new MemoryIo()
): Promise<{ snapshot: ErrorSnapshotExport; io: MemoryIo; report: string }> {
  const exportClient = new ExportClient(rows);
  let snapshot = await fetchProductionErrorSnapshot(
    exportClient,
    TARGET_FINGERPRINT,
    EXPORT_TIME
  );
  const report = '# verified report\n';
  snapshot = markSnapshotAnalysisCompleted(snapshot, report, { standard: 1 }, EXPORT_TIME);
  io.writeAtomic(ANALYSIS_PATH, report);
  snapshot = writeAndVerifyErrorSnapshot(snapshot, SNAPSHOT_PATH, io);
  return { snapshot, io, report };
}

function confirmation(snapshot: ErrorSnapshotExport) {
  return {
    snapshotId: snapshot.snapshotId,
    checksum: snapshot.checksum,
    rowCount: snapshot.rowCount,
    databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
    expiresAt: snapshot.expiresAt,
    safetyContract: snapshot.safetyContract,
    manifestChecksum: snapshot.manifestChecksum,
  };
}

describe('fixerrors transaction-consistent snapshot export', () => {
  it.each([
    [0, 0],
    [1, 1],
    [199, 1],
    [200, 2],
    [405, 3],
  ])('FXERR-SNAPSHOT-001 exports %i rows completely using %i keyset pages', async (count, pages) => {
    const client = new ExportClient(
      Array.from({ length: count }, (_, index) => makeError(index + 1))
    );
    const snapshot = await fetchProductionErrorSnapshot(
      client,
      TARGET_FINGERPRINT,
      EXPORT_TIME
    );

    expect(snapshot.rowCount).toBe(count);
    expect(snapshot.expectedRowCount).toBe(count);
    expect(new Set(snapshot.exactIds).size).toBe(count);
    expect(
      client.queryLog.filter((query) => query.includes('fixerrors:snapshot-page'))
    ).toHaveLength(pages);
    expect(client.queryLog.some((query) => /\bOFFSET\b/iu.test(query))).toBe(false);
  });

  it('FXERR-CONCURRENCY-002 excludes a concurrent backdated insert from the repeatable-read snapshot', async () => {
    const initial = [makeError(1), makeError(2), makeError(3)];
    const arrivedLater = makeError(4, {
      created_at: '2020-01-01T00:00:00.000Z',
      timestamp: '2020-01-01T00:00:00.000Z',
    });
    const exportClient = new ExportClient(initial, {
      afterBegin: (rows) => rows.push(arrivedLater),
    });
    let snapshot = await fetchProductionErrorSnapshot(
      exportClient,
      TARGET_FINGERPRINT,
      EXPORT_TIME
    );

    expect(snapshot.exactIds).toEqual(initial.map((row) => row.id));
    const io = new MemoryIo();
    const report = '# verified report\n';
    snapshot = markSnapshotAnalysisCompleted(
      snapshot,
      report,
      { standard: 1 },
      EXPORT_TIME
    );
    io.writeAtomic(ANALYSIS_PATH, report);
    snapshot = writeAndVerifyErrorSnapshot(snapshot, SNAPSHOT_PATH, io);
    const cleanupClient = new CleanupClient({ rows: [...initial, arrivedLater] });
    const cleanup = await executeVerifiedSnapshotCleanup({
      client: cleanupClient,
      confirmation: confirmation(snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      latestSnapshotPath: null,
      analysisPath: ANALYSIS_PATH,
      io,
      lock: new MemoryLock(),
      now: EXPORT_TIME,
    });
    expect(cleanup.clearedCount).toBe(3);
    expect([...cleanupClient.errorRows.keys()]).toEqual([arrivedLater.id]);
  });

  it('fails closed on duplicate/invalid rows and page retrieval failure', async () => {
    const duplicate = makeError(1);
    await expect(
      fetchProductionErrorSnapshot(
        new ExportClient([duplicate, { ...duplicate }]),
        TARGET_FINGERPRINT,
        EXPORT_TIME
      )
    ).rejects.toThrow(/duplicate IDs|strictly ordered/u);
    await expect(
      fetchProductionErrorSnapshot(
        new ExportClient([makeError(1, { id: '' })]),
        TARGET_FINGERPRINT,
        EXPORT_TIME
      )
    ).rejects.toThrow('invalid ID');
    const failedPage = new ExportClient([makeError(1)], {
      failTag: 'fixerrors:snapshot-page',
    });
    await expect(
      fetchProductionErrorSnapshot(failedPage, TARGET_FINGERPRINT, EXPORT_TIME)
    ).rejects.toThrow('forced');
    expect(
      failedPage.queryLog.some((query) => query.includes('fixerrors:export-rollback'))
    ).toBe(true);

    await expect(
      fetchProductionErrorSnapshot(
        new ExportClient([makeError(1)], {
          failTag: 'fixerrors:snapshot-count',
        }),
        TARGET_FINGERPRINT,
        EXPORT_TIME
      )
    ).rejects.toThrow('forced');
    await expect(
      fetchProductionErrorSnapshot(
        new ExportClient([makeError(1)], { countOverride: 2 }),
        TARGET_FINGERPRINT,
        EXPORT_TIME
      )
    ).rejects.toThrow('count mismatch');
  });
});

describe('fixerrors exact transactional cleanup', () => {
  it('FXERR-DELETE-004 deletes exact IDs in batches and only registered dependent diagnostics', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => makeError(index + 1));
    const extra = makeError(999);
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({
      rows: [...rows, extra],
      alerts: [rows[0].id, rows[204].id],
    });

    const cleanup = await executeVerifiedSnapshotCleanup({
      client,
      confirmation: confirmation(prepared.snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      latestSnapshotPath: null,
      analysisPath: ANALYSIS_PATH,
      io: prepared.io,
      lock: new MemoryLock(),
      now: EXPORT_TIME,
    });

    expect(cleanup.clearedCount).toBe(205);
    expect(cleanup.clearedAlertCount).toBe(2);
    expect([...client.errorRows.keys()]).toEqual([extra.id]);
    expect(client.alerts.size).toBe(0);
    expect([...client.unrelatedData]).toEqual(['application-row']);
    const batches = client.queryLog.filter((query) =>
      query.includes('fixerrors:delete-error-batch')
    );
    expect(batches).toHaveLength(3);
  });

  it('FXERR-FAILURE-005 rolls back every batch when a later delete fails', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => makeError(index + 1));
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows, alerts: [rows[0].id] });
    client.failDeleteBatch = 2;

    await expect(
      executeVerifiedSnapshotCleanup({
        client,
        confirmation: confirmation(prepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: prepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({
      outcome: 'failed',
      attemptedErrorLogIds: rows.slice(0, 200).map((row) => row.id),
    });
    expect(client.errorRows.size).toBe(205);
    expect(client.alerts).toContain(rows[0].id);
    expect([...client.unrelatedData]).toEqual(['application-row']);
  });

  it('FXERR-COLLATERAL-006 / FXERR-SCHEMA-012 blocks application references and unknown schema scope', async () => {
    const rows = [makeError(1)];
    const applicationPrepared = await analyzedSnapshot(rows);
    const applicationReference = new CleanupClient({
      rows,
      serviceReferences: [rows[0].id],
    });
    await expect(
      executeVerifiedSnapshotCleanup({
        client: applicationReference,
        confirmation: confirmation(applicationPrepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: applicationPrepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('Application data references');
    expect(applicationReference.errorRows.size).toBe(1);

    const unknownPrepared = await analyzedSnapshot(rows);
    const unknownForeignKey = new CleanupClient({ rows });
    unknownForeignKey.foreignKeys.push({
      child_schema: 'public',
      child_table: 'unexpected_table',
      child_columns: ['error_id', 'error_created_at'],
      parent_columns: ['id', 'created_at'],
      delete_action: 'CASCADE',
    });
    await expect(
      executeVerifiedSnapshotCleanup({
        client: unknownForeignKey,
        confirmation: confirmation(unknownPrepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: unknownPrepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('foreign-key safety contract changed');
    expect(
      unknownForeignKey.queryLog.some((query) =>
        query.includes('fixerrors:delete-error-batch')
      )
    ).toBe(false);

    const triggerPrepared = await analyzedSnapshot(rows);
    const unexpectedTrigger = new CleanupClient({ rows });
    unexpectedTrigger.triggerRows = [{ trigger_name: 'mutate_other_data' }];
    await expect(
      executeVerifiedSnapshotCleanup({
        client: unexpectedTrigger,
        confirmation: confirmation(triggerPrepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: triggerPrepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('trigger safety contract changed');
    expect(
      unexpectedTrigger.queryLog.some((query) =>
        query.includes('fixerrors:delete-error-batch')
      )
    ).toBe(false);
  });
});

describe('fixerrors artifact and confirmation gate', () => {
  it('production cleanup reconstructs fixed options and ignores injected runtime extras', async () => {
    const rows = [makeError(1)];
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows });
    let injectedLockCalls = 0;
    const injectedOptions = {
      client,
      confirmation: confirmation(prepared.snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      analysisPath: ANALYSIS_PATH,
      io: prepared.io,
      lock: {
        acquire() {
          injectedLockCalls += 1;
          throw new Error('injected lock used');
        },
      },
      now: EXPORT_TIME,
    };

    await expect(
      executeProductionSnapshotCleanup(injectedOptions)
    ).rejects.not.toThrow('injected lock used');
    expect(injectedLockCalls).toBe(0);
    expect(client.queryLog).toHaveLength(0);
  });

  it('atomically writes and read-verifies the analysis report', () => {
    const io = new MemoryIo();
    writeAndVerifyTextArtifactAtomic(ANALYSIS_PATH, '# report\n', io);
    expect(io.files.get(ANALYSIS_PATH)).toBe('# report\n');

    const mismatchedRead: SnapshotIo = {
      writeAtomic() {
        // Simulate a completed atomic write whose readback differs.
      },
      read() {
        return 'different';
      },
    };
    expect(() =>
      writeAndVerifyTextArtifactAtomic(
        ANALYSIS_PATH,
        '# report\n',
        mismatchedRead
      )
    ).toThrow('Text artifact readback mismatch');
  });

  it('does not export the low-level transactional deletion helper', () => {
    expect('clearProductionErrorLogs' in safetyModule).toBe(false);
  });

  it('blocks a concurrent cleanup while the artifact lock is held', async () => {
    const rows = [makeError(1)];
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows });
    const lock = new MemoryLock();
    const release = lock.acquire();
    try {
      await expect(
        executeVerifiedSnapshotCleanup({
          client,
          confirmation: confirmation(prepared.snapshot),
          databaseTargetFingerprint: TARGET_FINGERPRINT,
          snapshotPath: SNAPSHOT_PATH,
          latestSnapshotPath: null,
          analysisPath: ANALYSIS_PATH,
          io: prepared.io,
          lock,
          now: EXPORT_TIME,
        })
      ).rejects.toThrow('artifact lock is already held');
      expect(client.queryLog).toHaveLength(0);
    } finally {
      release();
    }
  });

  it('FXERR-ARTIFACT-003 performs zero database work when artifact write or readback fails', async () => {
    const rows = [makeError(1)];
    const preparedWrite = await analyzedSnapshot(rows);
    const writeClient = new CleanupClient({ rows });
    preparedWrite.io.failNextWrite = true;
    await expect(
      executeVerifiedSnapshotCleanup({
        client: writeClient,
        confirmation: confirmation(preparedWrite.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: preparedWrite.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('artifact write failure');
    expect(writeClient.queryLog).toHaveLength(0);

    const preparedRead = await analyzedSnapshot(rows);
    const readClient = new CleanupClient({ rows });
    preparedRead.io.failNextRead = true;
    await expect(
      executeVerifiedSnapshotCleanup({
        client: readClient,
        confirmation: confirmation(preparedRead.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: preparedRead.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('artifact read failure');
    expect(readClient.queryLog).toHaveLength(0);

    const corrupted = await analyzedSnapshot(rows);
    const corruptedClient = new CleanupClient({ rows });
    const corruptedJson = JSON.parse(
      corrupted.io.files.get(SNAPSHOT_PATH) ?? '{}'
    ) as ErrorSnapshotExport;
    corruptedJson.checksum = 'f'.repeat(64);
    corrupted.io.files.set(SNAPSHOT_PATH, JSON.stringify(corruptedJson));
    await expect(
      executeVerifiedSnapshotCleanup({
        client: corruptedClient,
        confirmation: confirmation(corrupted.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: corrupted.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('snapshot verification failed');
    expect(corruptedClient.queryLog).toHaveLength(0);
  });

  it('FXERR-CONFIRM-013 blocks mismatched, stale, and report-corrupted confirmations', async () => {
    const rows = [makeError(1)];
    const mismatched = await analyzedSnapshot(rows);
    const mismatchClient = new CleanupClient({ rows });
    await expect(
      executeVerifiedSnapshotCleanup({
        client: mismatchClient,
        confirmation: { ...confirmation(mismatched.snapshot), rowCount: 2 },
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: mismatched.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('confirmation does not match');
    expect(mismatchClient.queryLog).toHaveLength(0);

    const targetTampered = await analyzedSnapshot(rows);
    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: {
          ...confirmation(targetTampered.snapshot),
          databaseTargetFingerprint: 'b'.repeat(64),
        },
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: targetTampered.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('confirmation does not match');

    const expiryTampered = await analyzedSnapshot(rows);
    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: {
          ...confirmation(expiryTampered.snapshot),
          expiresAt: new Date(EXPORT_TIME.getTime() + 10 * 60 * 1000).toISOString(),
        },
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: expiryTampered.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('confirmation does not match');

    const stale = await analyzedSnapshot(rows);
    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: confirmation(stale.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: stale.io,
        lock: new MemoryLock(),
        now: new Date(EXPORT_TIME.getTime() + 31 * 60 * 1000),
      })
    ).rejects.toThrow('expired');

    const invalidExpiry = await analyzedSnapshot(rows);
    const invalidExpiryJson = JSON.parse(
      invalidExpiry.io.files.get(SNAPSHOT_PATH) ?? '{}'
    ) as ErrorSnapshotExport;
    invalidExpiryJson.expiresAt = 'not-a-date';
    invalidExpiry.io.files.set(
      SNAPSHOT_PATH,
      JSON.stringify(invalidExpiryJson)
    );
    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: confirmation(invalidExpiry.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: invalidExpiry.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('snapshot verification failed');

    const corruptedReport = await analyzedSnapshot(rows);
    corruptedReport.io.files.set(ANALYSIS_PATH, 'corrupted');
    await expect(
      executeVerifiedSnapshotCleanup({
        client: new CleanupClient({ rows }),
        confirmation: confirmation(corruptedReport.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: corruptedReport.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('analysis artifact verification failed');
  });

  it('rejects malformed analysis and cleanup state transitions before database work', async () => {
    const rows = [makeError(1)];
    const malformed = await analyzedSnapshot(rows);
    const malformedJson = JSON.parse(
      malformed.io.files.get(SNAPSHOT_PATH) ?? '{}'
    ) as ErrorSnapshotExport;
    malformedJson.cleanup = {
      ...malformedJson.cleanup,
      status: 'failed',
      attemptedAt: null,
      error: null,
    };
    malformed.io.files.set(SNAPSHOT_PATH, JSON.stringify(malformedJson));
    const client = new CleanupClient({ rows });
    await expect(
      executeVerifiedSnapshotCleanup({
        client,
        confirmation: confirmation(malformed.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: malformed.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('snapshot verification failed');
    expect(client.queryLog).toHaveLength(0);
  });

  it('FXERR-TARGET-014 blocks a snapshot from another database target', async () => {
    const rows = [makeError(1)];
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows });
    await expect(
      executeVerifiedSnapshotCleanup({
        client,
        confirmation: confirmation(prepared.snapshot),
        databaseTargetFingerprint: 'b'.repeat(64),
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: prepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('database target does not match');
    expect(client.queryLog).toHaveLength(0);
  });

  it('records a successful cleanup and treats post-commit artifact failure as indeterminate', async () => {
    const rows = [makeError(1)];
    const successful = await analyzedSnapshot(rows);
    const successClient = new CleanupClient({ rows });
    await executeVerifiedSnapshotCleanup({
      client: successClient,
      confirmation: confirmation(successful.snapshot),
      databaseTargetFingerprint: TARGET_FINGERPRINT,
      snapshotPath: SNAPSHOT_PATH,
      latestSnapshotPath: null,
      analysisPath: ANALYSIS_PATH,
      io: successful.io,
      lock: new MemoryLock(),
      now: EXPORT_TIME,
    });
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, successful.io).cleanup.status).toBe(
      'completed'
    );

    const uncertain = await analyzedSnapshot(rows);
    uncertain.io.failCompletedOutcomeWrite = true;
    const uncertainClient = new CleanupClient({ rows });
    await expect(
      executeVerifiedSnapshotCleanup({
        client: uncertainClient,
        confirmation: confirmation(uncertain.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: uncertain.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toThrow('audit outcome is indeterminate');
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, uncertain.io).cleanup.status).toBe(
      'indeterminate'
    );
  });

  it('FXERR-TXN-011 records an unknown commit outcome as indeterminate and blocks retry', async () => {
    const rows = [makeError(1)];
    const prepared = await analyzedSnapshot(rows);
    const client = new CleanupClient({ rows });
    client.commitThenThrow = true;

    await expect(
      executeVerifiedSnapshotCleanup({
        client,
        confirmation: confirmation(prepared.snapshot),
        databaseTargetFingerprint: TARGET_FINGERPRINT,
        snapshotPath: SNAPSHOT_PATH,
        latestSnapshotPath: null,
        analysisPath: ANALYSIS_PATH,
        io: prepared.io,
        lock: new MemoryLock(),
        now: EXPORT_TIME,
      })
    ).rejects.toMatchObject({ outcome: 'indeterminate' });
    expect(client.errorRows.size).toBe(0);
    expect(readAndVerifyErrorSnapshot(SNAPSHOT_PATH, prepared.io).cleanup.status).toBe(
      'indeterminate'
    );
  });
});
