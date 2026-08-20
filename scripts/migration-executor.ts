import {
  decideFinaliseMigrationLedgerAction,
  FINALISE_MIGRATION_LEDGER_SQL,
  stripOuterMigrationTransaction,
  type FinaliseMigrationFile,
  type FinaliseMigrationLedgerDecision,
  type FinaliseMigrationLedgerRow,
} from './finalise-migrations';

export const MIGRATION_LOCK_TIMEOUT = '5s';
export const MIGRATION_LOCK_TIMEOUT_SQL = `SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`;
export const FINALISE_LEDGER_GLOBAL_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended('private.finalise_migration_ledger', 0))";
export const FINALISE_LEDGER_FILENAME_LOCK_SQL =
  'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';
export const FINALISE_LEDGER_INSERT_SQL = `INSERT INTO private.finalise_migration_ledger
             (filename, checksum_sha256, phase)
           VALUES ($1, $2, $3)`;

export type MigrationExecutorErrorCategory =
  | 'lock_timeout'
  | 'ledger_drift'
  | 'apply_failed'
  | 'rollback_failed'
  | 'transaction_failed';

export interface MigrationQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface MigrationQueryClient {
  query<T = Record<string, unknown>>(
    queryText: string,
    values?: unknown[]
  ): Promise<MigrationQueryResult<T>>;
}

export class SanitizedMigrationError extends Error {
  readonly category: MigrationExecutorErrorCategory;

  constructor(category: MigrationExecutorErrorCategory, message: string) {
    super(message);
    this.name = 'SanitizedMigrationError';
    this.category = category;
  }
}

export function sanitizeMigrationExecutorError(error: unknown): SanitizedMigrationError {
  if (error instanceof SanitizedMigrationError) {
    return error;
  }

  const rawMessage = error instanceof Error ? error.message : '';

  if (/lock timeout/iu.test(rawMessage)) {
    return new SanitizedMigrationError(
      'lock_timeout',
      'Migration lock timed out before the ledger could be updated'
    );
  }
  if (/checksum drift/iu.test(rawMessage) || /phase drift/iu.test(rawMessage)) {
    return new SanitizedMigrationError('ledger_drift', 'Migration ledger drift detected');
  }
  if (/unmatched outer BEGIN\/COMMIT/iu.test(rawMessage)) {
    return new SanitizedMigrationError(
      'apply_failed',
      'Migration has an unmatched outer BEGIN/COMMIT transaction'
    );
  }

  return new SanitizedMigrationError('apply_failed', 'Migration apply failed');
}

export async function readMigrationLedgerRows(
  client: MigrationQueryClient,
  migrationFiles: FinaliseMigrationFile[]
): Promise<Map<string, FinaliseMigrationLedgerRow>> {
  if (migrationFiles.length === 0) {
    return new Map();
  }
  const ledgerExists = await client.query<{ ledger: string | null }>(
    'SELECT to_regclass($1) AS ledger',
    ['private.finalise_migration_ledger']
  );
  if (!ledgerExists.rows[0]?.ledger) {
    return new Map();
  }
  const result = await client.query<FinaliseMigrationLedgerRow>(
    `SELECT filename, checksum_sha256, phase, applied_at
     FROM private.finalise_migration_ledger
     WHERE filename = ANY($1::text[])`,
    [migrationFiles.map((migration) => migration.relativePath)]
  );
  return new Map(result.rows.map((row) => [row.filename, row]));
}

export async function applyMigrationWithLedger(
  client: MigrationQueryClient,
  migration: FinaliseMigrationFile,
  options?: {
    onDecision?: (decision: FinaliseMigrationLedgerDecision) => void;
  }
): Promise<{ action: FinaliseMigrationLedgerDecision }> {
  await client.query('BEGIN');
  try {
    await client.query(MIGRATION_LOCK_TIMEOUT_SQL);
    await client.query(FINALISE_LEDGER_GLOBAL_LOCK_SQL);
    await client.query(FINALISE_MIGRATION_LEDGER_SQL);
    await client.query(FINALISE_LEDGER_FILENAME_LOCK_SQL, [migration.relativePath]);
    const ledgerRows = await readMigrationLedgerRows(client, [migration]);
    const decision = decideFinaliseMigrationLedgerAction(
      migration,
      ledgerRows.get(migration.relativePath) ?? null
    );
    options?.onDecision?.(decision);

    if (decision === 'reuse') {
      await client.query('COMMIT');
      return { action: 'reuse' };
    }

    await client.query(stripOuterMigrationTransaction(migration.sql));
    await client.query(FINALISE_LEDGER_INSERT_SQL, [
      migration.relativePath,
      migration.checksumSha256,
      migration.phase,
    ]);
    await client.query('COMMIT');
    return { action: 'apply' };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      throw new SanitizedMigrationError(
        'rollback_failed',
        'Migration transaction rollback failed'
      );
    }
    throw sanitizeMigrationExecutorError(error);
  }
}
