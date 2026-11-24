import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('[swap-parent-rls] exposes a signed swap only while its parent inspection is visible', async () => {
  const db = new PGlite();
  const migration = readFileSync('supabase/migrations/20261124000200_hgv_trailer_checks.sql', 'utf8');
  const policy = migration.match(/CREATE POLICY hgv_swap_parent_visibility[^;]+;/)?.[0];
  try {
    if (!policy) throw new Error('Missing trailer swap read policy');
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE TABLE hgv_inspections (id int PRIMARY KEY, parent_check_id int, visible boolean);
      CREATE TABLE hgv_trailer_swaps (id int PRIMARY KEY, parent_check_id int);
      INSERT INTO hgv_inspections VALUES (1,NULL,true),(2,NULL,false);
      INSERT INTO hgv_trailer_swaps VALUES (11,1),(12,2);
      ALTER TABLE hgv_inspections ENABLE ROW LEVEL SECURITY;
      ALTER TABLE hgv_trailer_swaps ENABLE ROW LEVEL SECURITY;
      CREATE POLICY read_visible ON hgv_inspections FOR SELECT TO authenticated USING (visible);
      ${policy}
      GRANT SELECT ON hgv_inspections,hgv_trailer_swaps TO authenticated;
      SET ROLE authenticated;
    `);
    expect((await db.query('SELECT id FROM hgv_trailer_swaps ORDER BY id')).rows).toEqual([{ id: 11 }]);
  } finally {
    await db.close();
  }
});
