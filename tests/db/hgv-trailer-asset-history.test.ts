import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tractor = '40000000-0000-0000-0000-000000000001';
const trailer = '40000000-0000-0000-0000-000000000002';
const secondTrailer = '40000000-0000-0000-0000-000000000003';
const check = '40000000-0000-0000-0000-000000000004';
const swap = '40000000-0000-0000-0000-000000000005';
const driver = '40000000-0000-0000-0000-000000000006';
const migration = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');

describe('HGV trailer entries in asset history', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE hgv_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text);
      CREATE TABLE hgvs(id uuid PRIMARY KEY, reg_number text, category_id uuid REFERENCES hgv_categories);
      CREATE TABLE profiles(id uuid PRIMARY KEY, full_name text);
      CREATE TABLE hgv_inspections(id uuid PRIMARY KEY, hgv_id uuid, trailer_hgv_id uuid, inspection_date date,
        submitted_at timestamptz, record_kind text, current_mileage integer, user_id uuid, trailer_label text, status text);
      CREATE TABLE inspection_items(inspection_id uuid, item_description text, status text);
      CREATE TABLE hgv_trailer_swaps(id uuid PRIMARY KEY, parent_check_id uuid, hgv_id uuid, trailer_hgv_id uuid,
        user_id uuid, created_at timestamptz, trailer_label text, items jsonb);
      INSERT INTO hgvs VALUES ('${tractor}','XT71 AVS',NULL), ('${trailer}','C517773',NULL), ('${secondTrailer}','T2',NULL);
      INSERT INTO profiles VALUES ('${driver}', 'Fixture Driver');
      INSERT INTO hgv_inspections VALUES ('${check}','${tractor}','${trailer}','2026-11-01','2026-11-01T08:00Z',
        'full_check',1000,'${driver}','C517773','submitted');
      INSERT INTO inspection_items VALUES ('${check}','Transmission','attention'), ('${check}','Brake Hoses','attention');
      INSERT INTO hgv_trailer_swaps VALUES ('${swap}','${check}','${tractor}','${secondTrailer}','${driver}',
        '2026-11-01T11:00Z','T2','[{"status":"ok"}]');
    `);
    await db.exec(migration('20261124000100_hgv_trailer_category'));
    await db.exec(migration('20261124000400_hgv_asset_daily_checks'));
  });
  afterAll(async () => { await db?.close(); });

  const history = async (id: string) => (await db.query(
    'SELECT id, inspection_id, entry_kind, defect_count, current_mileage, driver_name FROM hgv_asset_daily_checks($1)', [id],
  )).rows;
  it('retains both signed events on the tractor and projects only matching checks onto each trailer', async () => {
    expect(await history(tractor)).toMatchObject([
      { id: swap, entry_kind: 'swap', defect_count: 0 }, { id: check, entry_kind: 'tractor', defect_count: 2, current_mileage: 1000 },
    ]);
    expect(await history(trailer)).toEqual([{
      id: check, inspection_id: check, entry_kind: 'trailer', defect_count: 1, current_mileage: null, driver_name: 'Fixture Driver',
    }]);
    expect(await history(secondTrailer)).toMatchObject([{ id: swap, inspection_id: check, entry_kind: 'swap', defect_count: 0 }]);
  });
  it('identifies the known trailer and preserves the category used by the picker', async () => {
    expect((await db.query('SELECT reg_number FROM hgvs JOIN hgv_categories ON hgv_categories.id = hgvs.category_id')).rows)
      .toEqual([{ reg_number: 'C517773' }]);
    await expect(db.exec("UPDATE hgv_categories SET name = 'Other' WHERE name = 'Trailer'")).rejects.toThrow('used by HGV');
    await expect(db.exec("DELETE FROM hgv_categories WHERE name = 'Trailer'")).rejects.toThrow('used by HGV');
  });
  it('can reach older trailer checks beyond the first 50', async () => {
    await db.exec('BEGIN');
    try {
      await db.exec(`
        INSERT INTO hgv_inspections(id,hgv_id,trailer_hgv_id,inspection_date,submitted_at,record_kind,status)
        SELECT gen_random_uuid(),'${tractor}','${trailer}', DATE '2026-11-02' + n, TIMESTAMPTZ '2026-11-02T09:00Z' + n * INTERVAL '1 day',
          'full_check','submitted' FROM generate_series(1,51) n
      `);
      expect(await history(trailer)).toHaveLength(50);
      const older = await db.query('SELECT id FROM hgv_asset_daily_checks($1, 50)', [trailer]);
      expect(older.rows).toHaveLength(2);
      expect(older.rows[1]).toEqual({ id: check });
    } finally { await db.exec('ROLLBACK'); }
  });
  it('honours the calling role and parent inspection visibility for both types of event', async () => {
    await db.exec(`
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      ALTER TABLE hgv_inspections ENABLE ROW LEVEL SECURITY;
      SET ROLE authenticated;
    `);
    try {
      expect(await history(tractor)).toEqual([]);
      expect(await history(secondTrailer)).toEqual([]);
    } finally { await db.exec('RESET ROLE'); }
  });
});
