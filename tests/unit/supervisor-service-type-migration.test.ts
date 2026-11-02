import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated'::text $$;
    CREATE FUNCTION effective_is_manager_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION effective_has_module_level(text, integer) RETURNS boolean LANGUAGE sql
      AS $$ SELECT current_setting('test.level')::int >= $2 AND $1 = 'maintenance' $$;
    CREATE TABLE vehicle_maintenance(id int PRIMARY KEY, van_id int, hgv_id int, plant_id int,
      next_service_template_id int, next_service_rotation_step_id int, last_service_template_id int,
      next_service_mileage int, last_service_mileage int, next_service_hours int, last_service_hours int);
    CREATE TABLE service_rotation_steps(id int, maintenance_category_id int, attachment_template_id int);
    CREATE TABLE maintenance_categories(id int, config_key text, workshop_category_id int, is_active boolean);
    CREATE TABLE workshop_attachment_templates(id int, is_active boolean);
    CREATE TABLE workshop_category_attachment_templates(category_id int, template_id int);
    CREATE TABLE workshop_attachment_template_versions(template_id int, status text);
    INSERT INTO maintenance_categories VALUES(1,'service_van',1,true),(2,'service_hgv',2,true);
    INSERT INTO workshop_attachment_templates VALUES(1,true),(2,true),(3,true);
    INSERT INTO service_rotation_steps VALUES(1,1,1),(2,1,2),(3,2,3);
    INSERT INTO workshop_category_attachment_templates VALUES(1,1),(1,2),(2,3);
    INSERT INTO workshop_attachment_template_versions VALUES(1,'published'),(2,'published'),(3,'published');
    INSERT INTO vehicle_maintenance VALUES(1,1,null,null,1,1,1,40000,30000,null,null);
    CREATE ROLE service_editor;
    GRANT USAGE ON SCHEMA public,auth TO service_editor;
    GRANT SELECT,UPDATE,INSERT ON ALL TABLES IN SCHEMA public TO service_editor;
  `);
  await db.exec(readFileSync('supabase/migrations/20261102_supervisor_next_service_type.sql', 'utf8'));
  await db.exec(`CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON vehicle_maintenance
    FOR EACH ROW EXECUTE FUNCTION protect_vehicle_maintenance_service_state();
    SET ROLE service_editor; SET test.level='3';`);
});
afterAll(async () => { await db?.close(); });

it('permits the Supervisor type/cursor pair while preserving due mileage and history', async () => {
  await db.exec('UPDATE vehicle_maintenance SET next_service_template_id=2,next_service_rotation_step_id=2 WHERE id=1');
  expect((await db.query('SELECT next_service_template_id,next_service_rotation_step_id,next_service_mileage,last_service_template_id FROM vehicle_maintenance')).rows[0])
    .toEqual({ next_service_template_id: 2, next_service_rotation_step_id: 2, next_service_mileage: 40000, last_service_template_id: 1 });
});
it('rejects meter/history changes, mismatched cursors and a different asset rotation', async () => {
  for (const assignment of ['next_service_mileage=50000', 'last_service_mileage=35000', 'last_service_template_id=2']) {
    await expect(db.exec(`UPDATE vehicle_maintenance SET ${assignment} WHERE id=1`)).rejects.toThrow(/Manager or admin/);
  }
  await expect(db.exec('UPDATE vehicle_maintenance SET next_service_template_id=1,next_service_rotation_step_id=2 WHERE id=1')).rejects.toThrow(/must match/);
  await expect(db.exec('UPDATE vehicle_maintenance SET next_service_template_id=3,next_service_rotation_step_id=3 WHERE id=1')).rejects.toThrow(/must match/);
});
it('denies below-Supervisor type edits and preserves the insert restriction', async () => {
  await db.exec("SET test.level='2'");
  await expect(db.exec('UPDATE vehicle_maintenance SET next_service_template_id=1,next_service_rotation_step_id=1 WHERE id=1')).rejects.toThrow(/Manager or admin/);
  await db.exec("SET test.level='3'");
  await expect(db.exec('INSERT INTO vehicle_maintenance(id,van_id,next_service_template_id,next_service_rotation_step_id) VALUES(2,2,1,1)')).rejects.toThrow(/Manager or admin/);
});
