import { PGlite } from '@electric-sql/pglite';
import {
  purgeExpiredArchivedErrorLogs,
  type PgClientLike,
} from '@/scripts/fixerrors-safety';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const IDS = {
  expired: '00000000-0000-4000-8000-000000000001',
  boundary: '00000000-0000-4000-8000-000000000002',
  recent: '00000000-0000-4000-8000-000000000003',
  oldActive: '00000000-0000-4000-8000-000000000004',
  expiredAlert: '00000000-0000-4000-8000-000000000011',
  recentAlert: '00000000-0000-4000-8000-000000000012',
  health: '00000000-0000-4000-8000-000000000021',
  usage: '00000000-0000-4000-8000-000000000031',
} as const;

class PgliteClient implements PgClientLike {
  insertExactCutoffBoundary = false;

  constructor(private readonly pg: PGlite) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const statements = text
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    if (statements.length > 1 && values.length === 0) {
      let last = { rows: [] as T[], rowCount: 0 };
      for (const statement of statements) {
        last = await this.run(statement);
      }
      return last;
    }
    const result = await this.run<T>(text, values);
    if (this.insertExactCutoffBoundary && text.includes('fixerrors:retention-cutoff')) {
      const cutoff = String(result.rows[0]?.cutoff ?? '');
      await this.pg.query(
        `
          INSERT INTO public.error_logs (id, status, archived_at, created_at)
          VALUES ($1::uuid, 'archived', $2::timestamptz, now() - interval '18 months')
        `,
        [IDS.boundary, cutoff]
      );
    }
    return result;
  }

  private async run<T extends Record<string, unknown>>(
    text: string,
    values: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const result = await this.pg.query<T>(text, values);
    return {
      rows: result.rows ?? [],
      rowCount: result.affectedRows ?? result.rows?.length ?? 0,
    };
  }
}

describe('fixerrors 12-month retention on PostgreSQL', () => {
  let pg: PGlite;
  let client: PgliteClient;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE public.error_logs (
        id uuid PRIMARY KEY,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (
          (status = 'active' AND archived_at IS NULL) OR
          (status = 'archived' AND archived_at IS NOT NULL)
        )
      );
      CREATE TABLE public.error_log_alerts (
        id uuid PRIMARY KEY,
        error_log_id uuid NOT NULL REFERENCES public.error_logs(id) ON DELETE CASCADE
      );
      CREATE TABLE public.service_health_events (
        id uuid PRIMARY KEY,
        recovery_error_log_id uuid REFERENCES public.error_logs(id) ON DELETE SET NULL
      );
      CREATE TABLE public.user_usage_events (
        id uuid PRIMARY KEY,
        error_log_id uuid REFERENCES public.error_logs(id) ON DELETE SET NULL
      );
    `);
    client = new PgliteClient(pg);
    client.insertExactCutoffBoundary = true;
  }, 30_000);

  afterAll(async () => {
    await pg?.close();
  });

  it('FE-RETENTION-001 deletes only expired archived rows and preserves FK dependents', async () => {
    await pg.exec(`
      TRUNCATE public.error_log_alerts, public.service_health_events, public.user_usage_events, public.error_logs;
      INSERT INTO public.error_logs (id, status, archived_at, created_at) VALUES
        ('${IDS.expired}', 'archived', now() - interval '13 months', now() - interval '18 months'),
        ('${IDS.recent}', 'archived', now() - interval '1 month', now() - interval '2 months'),
        ('${IDS.oldActive}', 'active', NULL, now() - interval '18 months');
      INSERT INTO public.error_log_alerts (id, error_log_id) VALUES
        ('${IDS.expiredAlert}', '${IDS.expired}'),
        ('${IDS.recentAlert}', '${IDS.recent}');
      INSERT INTO public.service_health_events (id, recovery_error_log_id) VALUES
        ('${IDS.health}', '${IDS.expired}');
      INSERT INTO public.user_usage_events (id, error_log_id) VALUES
        ('${IDS.usage}', '${IDS.expired}');
    `);

    client.insertExactCutoffBoundary = true;
    const purged = await purgeExpiredArchivedErrorLogs(client);

    expect(purged.reconciliationState).toBe('purged');
    expect(purged.eligibleCount).toBe(1);
    expect(purged.purgedCount).toBe(1);
    expect(purged.remainingExpiredCount).toBe(0);
    expect(purged.remainingActiveCount).toBe(1);

    const remaining = await pg.query<{ id: string; status: string }>(
      'SELECT id::text AS id, status FROM public.error_logs ORDER BY id'
    );
    expect(remaining.rows.map((row) => row.id)).toEqual([
      IDS.boundary,
      IDS.recent,
      IDS.oldActive,
    ]);
    expect(remaining.rows.find((row) => row.id === IDS.oldActive)?.status).toBe('active');
    const boundaryCutoff = await pg.query<{ archived_at: string }>(
      `
        SELECT to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS archived_at
        FROM public.error_logs
        WHERE id = $1::uuid
      `,
      [IDS.boundary]
    );
    expect(boundaryCutoff.rows[0]?.archived_at).toBe(purged.cutoffAt);

    const alerts = await pg.query<{ id: string }>(
      'SELECT id::text AS id FROM public.error_log_alerts ORDER BY id'
    );
    expect(alerts.rows.map((row) => row.id)).toEqual([IDS.recentAlert]);

    const health = await pg.query<{ id: string; recovery_error_log_id: string | null }>(
      'SELECT id::text AS id, recovery_error_log_id::text AS recovery_error_log_id FROM public.service_health_events'
    );
    expect(health.rows).toEqual([{ id: IDS.health, recovery_error_log_id: null }]);

    const usage = await pg.query<{ id: string; error_log_id: string | null }>(
      'SELECT id::text AS id, error_log_id::text AS error_log_id FROM public.user_usage_events'
    );
    expect(usage.rows).toEqual([{ id: IDS.usage, error_log_id: null }]);
  });

  it('FE-RETENTION-TXN-002 keeps a committed archive when purge rolls back', async () => {
    const archivedId = IDS.recent;
    await pg.exec(`
      TRUNCATE public.error_log_alerts, public.service_health_events, public.user_usage_events, public.error_logs;
      INSERT INTO public.error_logs (id, status, archived_at, created_at) VALUES
        ('${IDS.expired}', 'archived', now() - interval '13 months', now() - interval '18 months'),
        ('${archivedId}', 'archived', now() - interval '1 month', now() - interval '2 months');
    `);
    const before = await pg.query<{
      id: string;
      status: string;
      archived_at: string;
    }>(
      `
        SELECT
          id::text AS id,
          status,
          to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS archived_at
        FROM public.error_logs
        WHERE id = '${archivedId}'
      `
    );

    const failing = new PgliteClient(pg);
    const originalQuery = failing.query.bind(failing);
    failing.query = async (text, values = []) => {
      if (text.includes('fixerrors:retention-delete-batch')) {
        throw new Error('forced retention delete failure');
      }
      return originalQuery(text, values);
    };

    await expect(purgeExpiredArchivedErrorLogs(failing)).rejects.toMatchObject({
      outcome: 'failed',
    });

    const after = await pg.query<{
      id: string;
      status: string;
      archived_at: string;
    }>(
      `
        SELECT
          id::text AS id,
          status,
          to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS archived_at
        FROM public.error_logs
        ORDER BY id
      `
    );
    expect(after.rows).toHaveLength(2);
    expect(after.rows.find((row) => row.id === archivedId)).toEqual(before.rows[0]);
    expect(after.rows.some((row) => row.id === IDS.expired)).toBe(true);
  });
});
