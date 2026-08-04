import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

describe('absence historic delete applied database checks', () => {
  it('ABS-DEL-05/06: applied trigger, authorized RPCs, and closed-FY guard coexist', async () => {
    if (!connectionString) {
      throw new Error('Missing POSTGRES_URL_NON_POOLING/POSTGRES_URL for applied DB verification');
    }

    const url = new URL(connectionString);
    const client = new pg.Client({
      host: url.hostname,
      port: parseInt(url.port, 10) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    try {
      const triggers = await client.query(`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = 'public.absences'::regclass
          AND NOT tgisinternal
          AND tgname IN ('trg_guard_absence_historic_delete', 'trg_guard_absence_closed_fy_delete')
        ORDER BY tgname
      `);
      const triggerNames = triggers.rows.map((row: { tgname: string }) => row.tgname);
      expect(triggerNames).toContain('trg_guard_absence_historic_delete');
      expect(triggerNames).toContain('trg_guard_absence_closed_fy_delete');

      const functions = await client.query(`
        SELECT p.proname, pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'guard_absence_historic_delete',
            'can_actor_run_absence_global_delete',
            'delete_absences_for_bulk_batch',
            'delete_latest_generated_financial_year_absences',
            'delete_absences_for_financial_year_undo'
          )
      `);

      const byName = new Map(
        functions.rows.map((row: { proname: string; definition: string }) => [row.proname, row.definition])
      );

      expect(byName.has('delete_absences_for_financial_year_undo')).toBe(false);
      expect(byName.has('guard_absence_historic_delete')).toBe(true);
      expect(byName.get('guard_absence_historic_delete')).toContain('effective_is_admin()');
      expect(byName.get('guard_absence_historic_delete')).not.toContain('OLD.auto_generated');

      expect(byName.get('can_actor_run_absence_global_delete')).toContain('see_manage_overview_all');
      expect(byName.get('can_actor_run_absence_global_delete')).toContain('view_as_role_id()');
      expect(byName.get('delete_absences_for_bulk_batch')).toContain('can_actor_run_absence_global_delete()');
      expect(byName.get('delete_latest_generated_financial_year_absences')).toContain(
        'can_actor_run_absence_global_delete()'
      );
      expect(byName.get('delete_latest_generated_financial_year_absences')).toContain(
        'absence_financial_year_generations'
      );
      expect(byName.get('delete_latest_generated_financial_year_absences')).toContain('FOR UPDATE');
      expect(byName.get('delete_latest_generated_financial_year_absences')).toContain(
        'DELETE FROM public.absence_financial_year_generations'
      );
      expect(byName.get('delete_latest_generated_financial_year_absences')).not.toContain('p_fy_start');
    } finally {
      await client.end();
    }
  });
});
