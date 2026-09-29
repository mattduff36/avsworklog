import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

describe('error log triage lifecycle', () => {
  let pg: PGlite | null = null;

  afterEach(async () => {
    await pg?.close();
    pg = null;
  });

  it('FXERR-V5-SCHEMA-001 accepts only the five lifecycle states', async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE public.error_logs (
        id uuid PRIMARY KEY,
        status text NOT NULL DEFAULT 'active',
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT error_logs_status_check CHECK (status IN ('active', 'archived')),
        CONSTRAINT error_logs_status_archived_at_consistency CHECK (
          (status = 'active' AND archived_at IS NULL)
          OR (status = 'archived' AND archived_at IS NOT NULL)
        )
      );
    `);
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260929_error_logs_triage_lifecycle.sql'),
      'utf8'
    );
    await pg.exec(migration);

    await pg.exec(`
      INSERT INTO public.error_logs (id, status)
      VALUES ('00000000-0000-4000-8000-000000000001', 'active');
      INSERT INTO public.error_logs (id, status, archived_at)
      VALUES ('00000000-0000-4000-8000-000000000002', 'archived', now());
      INSERT INTO public.error_logs (
        id, status, triage_state, triaged_at, triage_incident_id, triage_summary, triage_next_step
      ) VALUES (
        '00000000-0000-4000-8000-000000000003',
        'active',
        'outstanding',
        now(),
        'cluster-1',
        'Diagnosed',
        'Deploy and verify live'
      );
    `);

    await expect(pg.exec(`
      INSERT INTO public.error_logs (
        id, status, triage_state, triaged_at, triage_incident_id, triage_summary
      ) VALUES (
        '00000000-0000-4000-8000-000000000004',
        'active',
        'outstanding',
        now(),
        'cluster-2',
        'Missing next step'
      );
    `)).rejects.toThrow();

    await expect(pg.exec(`
      INSERT INTO public.error_logs (
        id, status, archived_at, triage_state, triaged_at, triage_incident_id, triage_summary
      ) VALUES (
        '00000000-0000-4000-8000-000000000005',
        'archived',
        now(),
        'fixed_live',
        now(),
        'cluster-3',
        'Local commit only'
      );
    `)).rejects.toThrow();

    const policies = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy WHERE polrelid = 'public.error_logs'::regclass`
    );
    expect(policies.rows.map((row) => row.polname)).not.toContain('SuperAdmin can update error logs');
  });
});
