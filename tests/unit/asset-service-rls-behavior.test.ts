import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('SVC-RLS-001 behavioral service-state protection', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE ROLE svc_rls_probe NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated'::text $$;
      CREATE FUNCTION public.effective_is_manager_admin() RETURNS boolean LANGUAGE sql AS
        $$ SELECT current_setting('test.is_manager')::boolean $$;
      CREATE FUNCTION public.effective_has_module_level(text, integer) RETURNS boolean LANGUAGE sql AS
        $$ SELECT $1 = 'maintenance' AND current_setting('test.level')::integer >= $2 $$;
      REVOKE ALL ON FUNCTION public.effective_has_module_level(text, integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.effective_has_module_level(text, integer) TO svc_rls_probe;
      CREATE TABLE public.vehicle_maintenance(
        id integer PRIMARY KEY, van_id integer, hgv_id integer, plant_id integer,
        next_service_template_id integer, next_service_rotation_step_id integer,
        last_service_template_id integer, next_service_mileage integer,
        last_service_mileage integer, next_service_hours integer, last_service_hours integer,
        current_mileage integer
      );
      CREATE TABLE public.service_rotation_steps(id integer, maintenance_category_id integer, attachment_template_id integer);
      CREATE TABLE public.maintenance_categories(id integer, config_key text, workshop_category_id integer, is_active boolean);
      CREATE TABLE public.workshop_attachment_templates(id integer, is_active boolean);
      CREATE TABLE public.workshop_category_attachment_templates(category_id integer, template_id integer);
      CREATE TABLE public.workshop_attachment_template_versions(template_id integer, status text);
      INSERT INTO public.vehicle_maintenance VALUES(1,NULL,1,NULL,1,1,1,40000,30000,NULL,NULL,30000);
      ALTER TABLE public.vehicle_maintenance ENABLE ROW LEVEL SECURITY;
      CREATE POLICY probe_access ON public.vehicle_maintenance TO svc_rls_probe USING (true) WITH CHECK (true);
      GRANT USAGE ON SCHEMA public, auth TO svc_rls_probe;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO svc_rls_probe;
      GRANT INSERT, UPDATE ON public.vehicle_maintenance TO svc_rls_probe;
    `);
    await db.exec(readFileSync('supabase/migrations/20261102_supervisor_next_service_type.sql', 'utf8'));
    const closure = readFileSync('supabase/migrations/20260808_asset_service_closure_fixes.sql', 'utf8');
    const triggerStart = closure.indexOf('DROP TRIGGER IF EXISTS trg_protect_vehicle_maintenance_service_state');
    expect(triggerStart).toBeGreaterThanOrEqual(0);
    await db.exec(closure.slice(triggerStart));
    await db.exec("SET ROLE svc_rls_probe; SET test.is_manager='false'; SET test.level='2'");
  });

  afterAll(async () => {
    await db?.close();
  });

  it.each([
    'next_service_mileage=50000',
    'last_service_mileage=35000',
    'next_service_hours=500',
    'last_service_hours=250',
    'next_service_template_id=2',
    'next_service_rotation_step_id=2',
    'last_service_template_id=2',
  ])('rejects non-manager service-state edits through permissive RLS: %s', async (assignment) => {
    await db.exec('BEGIN');
    try {
      const identity = await db.query('SELECT current_user, public.effective_is_manager_admin() AS is_manager');
      expect(identity.rows[0]).toEqual({ current_user: 'svc_rls_probe', is_manager: false });
      await expect(db.exec(`UPDATE public.vehicle_maintenance SET ${assignment} WHERE id=1`))
        .rejects.toMatchObject({ code: '42501', message: 'Manager or admin required to update service state' });
    } finally {
      await db.exec('ROLLBACK');
    }
    expect((await db.query('SELECT next_service_mileage FROM public.vehicle_maintenance WHERE id=1')).rows[0])
      .toEqual({ next_service_mileage: 40000 });
  });

  it('allows ordinary meter updates without allowing service state on insert', async () => {
    expect((await db.query('UPDATE public.vehicle_maintenance SET current_mileage=31000 WHERE id=1 RETURNING current_mileage')).rows)
      .toEqual([{ current_mileage: 31000 }]);
    await expect(db.exec('INSERT INTO public.vehicle_maintenance(id,hgv_id,next_service_mileage) VALUES(2,2,50000)'))
      .rejects.toMatchObject({ code: '42501', message: 'Manager or admin required to set service state on insert' });
  });

  it('allows manager updates and inserts through the same RLS role', async () => {
    await db.exec("BEGIN; SET LOCAL test.is_manager='true'");
    try {
      expect((await db.query('UPDATE public.vehicle_maintenance SET next_service_mileage=50000 WHERE id=1 RETURNING next_service_mileage')).rows)
        .toEqual([{ next_service_mileage: 50000 }]);
      expect((await db.query('INSERT INTO public.vehicle_maintenance(id,hgv_id,next_service_mileage) VALUES(2,2,60000) RETURNING id')).rows)
        .toEqual([{ id: 2 }]);
    } finally {
      await db.exec('ROLLBACK');
    }
  });
});
