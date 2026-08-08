import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

describe('SVC-RLS-001 behavioral service-state protection', () => {
  let client: pg.Client | null = null;
  let sampleMaintenanceId: string | null = null;
  let originalMileage: number | null = null;

  beforeAll(async () => {
    if (!connectionString) return;
    const url = new URL(connectionString);
    client = new pg.Client({
      host: url.hostname,
      port: Number.parseInt(url.port || '5432', 10),
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    const { rows } = await client.query<{ id: string; next_service_mileage: number | null }>(
      `
      SELECT id, next_service_mileage
      FROM public.vehicle_maintenance
      WHERE hgv_id IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
      `,
    );
    sampleMaintenanceId = rows[0]?.id ?? null;
    originalMileage = rows[0]?.next_service_mileage ?? null;
  });

  afterAll(async () => {
    if (!client) return;
    await client.end().catch(() => undefined);
  });

  it('SVC-RLS-001 rejects non-manager authenticated updates to service due mileage', async () => {
    if (!client || !sampleMaintenanceId) {
      expect(connectionString, 'POSTGRES_URL_NON_POOLING is required for SVC-RLS-001').toBeTruthy();
      return;
    }

    await client.query('BEGIN');
    try {
      // Create a non-manager role that can touch the row through RLS,
      // then prove the service-state trigger still rejects the write.
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_rls_probe') THEN
            CREATE ROLE svc_rls_probe NOLOGIN;
          END IF;
        END $$;
      `);
      await client.query(`GRANT svc_rls_probe TO CURRENT_USER`);
      await client.query(`GRANT USAGE ON SCHEMA public TO svc_rls_probe`);
      await client.query(`GRANT USAGE ON SCHEMA auth TO svc_rls_probe`);
      await client.query(`GRANT SELECT, UPDATE ON public.vehicle_maintenance TO svc_rls_probe`);
      await client.query(`
        DROP POLICY IF EXISTS "svc_rls_probe_vehicle_maintenance" ON public.vehicle_maintenance
      `);
      await client.query(`
        CREATE POLICY "svc_rls_probe_vehicle_maintenance"
          ON public.vehicle_maintenance
          FOR ALL
          TO svc_rls_probe
          USING (true)
          WITH CHECK (true)
      `);

      await client.query(`SET LOCAL ROLE svc_rls_probe`);
      const who = await client.query<{ current_user: string; is_mgr: boolean }>(
        `SELECT current_user, public.effective_is_manager_admin() AS is_mgr`,
      );
      expect(who.rows[0]?.current_user).toBe('svc_rls_probe');
      expect(who.rows[0]?.is_mgr).toBe(false);

      let rejected = false;
      try {
        await client.query(
          `
          UPDATE public.vehicle_maintenance
          SET next_service_mileage = COALESCE(next_service_mileage, 0) + 1
          WHERE id = $1
          `,
          [sampleMaintenanceId],
        );
      } catch (error) {
        rejected = true;
        expect(String(error)).toMatch(/Manager or admin required to update service state/i);
      }
      expect(rejected).toBe(true);
    } finally {
      await client.query('ROLLBACK');
    }

    // Privileged connection can still write and restore original value.
    await client.query(
      `
      UPDATE public.vehicle_maintenance
      SET next_service_mileage = $2
      WHERE id = $1
      `,
      [sampleMaintenanceId, originalMileage],
    );
  });
});
