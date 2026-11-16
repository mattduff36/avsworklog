import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROVENANCE_ENV_KEYS, validateLocalTestDatabaseUrl } from '../../scripts/local-test-postgres';
import { hgvInspectionSaveSchemaSql, readHgvInspectionSaveFunctionSql, HGV_SAVE_FIXTURE as F } from './hgv-inspection-save-rpc-harness';
import { TRUCK_CHECKLIST_ITEMS } from '../../lib/checklists/vehicle-checklists';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('HGV same-day updates - disposable real PostgreSQL', () => {
  const clients: Client[] = [];
  let db: Client;
  let other: Client;
  let date: string;
  let day: number;
  async function connect() {
    const connectionString = process.env.TEST_DATABASE_URL!;
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    if (!marker) throw new Error('Disposable runner marker is required');
    validateLocalTestDatabaseUrl(connectionString, Number(process.env[PROVENANCE_ENV_KEYS.port]));
    const client = new Client({ connectionString, ssl: false });
    await client.connect(); clients.push(client);
    const provenance = await client.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
    if (provenance.rows[0].marker !== marker) throw new Error('Disposable database provenance mismatch');
    await client.query("SET statement_timeout='15s'; SET lock_timeout='10s'");
    return client;
  }
  beforeAll(async () => {
    db = await connect(); other = await connect();
    await db.query(hgvInspectionSaveSchemaSql());
    await db.query(readHgvInspectionSaveFunctionSql());
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS private;
      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text UNIQUE,metadata jsonb);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      GRANT USAGE ON SCHEMA storage TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
      CREATE POLICY fixture_storage_owner ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
      ALTER TABLE hgvs ADD COLUMN reg_number text, ADD COLUMN nickname text, ADD COLUMN daily_check_source_id uuid, ADD COLUMN daily_check_source_type text;
      CREATE TABLE profiles(id uuid PRIMARY KEY,full_name text);
      CREATE TABLE workshop_task_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,applies_to text,is_active boolean);
      CREATE TABLE workshop_task_comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid,author_id uuid,body text,created_at timestamptz DEFAULT now());
      CREATE TABLE inspection_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),inspection_id uuid,item_number int,photo_url text,day_of_week int,caption text);
      CREATE TABLE private.daily_check_storage_cleanup(photo_url text);
      ALTER TABLE actions ADD COLUMN action_type text, ADD COLUMN hgv_id uuid, ADD COLUMN title text, ADD COLUMN description text,
        ADD COLUMN status text, ADD COLUMN created_by uuid, ADD COLUMN inspection_id uuid, ADD COLUMN workshop_category_id uuid,
        ADD COLUMN daily_check_source_id uuid, ADD COLUMN daily_check_source_type text, ADD COLUMN created_at timestamptz DEFAULT now();
    `);
    const deletion = readFileSync('supabase/migrations/20261110_daily_check_deletion_effects.sql','utf8');
    for (const name of ['daily_check_photo_text','daily_check_photo_key','daily_check_workshop_photo_guard']) {
      const start = deletion.indexOf(`CREATE FUNCTION private.${name}(`);
      await db.query(deletion.slice(start,deletion.indexOf('$$;',start)+3));
    }
    await db.query(readFileSync('supabase/migrations/20261116_hgv_same_day_updates.sql','utf8'));
    await db.query("INSERT INTO hgvs(id,reg_number,current_mileage) VALUES($1,'TEST HGV',100)",[F.hgv]);
    await db.query("INSERT INTO profiles(id,full_name) VALUES($1,'Test driver'),($2,'Other driver')",[F.actor,F.subject]);
    const clock = await db.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Europe/London','YYYY-MM-DD') AS date, extract(isodow FROM clock_timestamp() AT TIME ZONE 'Europe/London')::int AS day");
    date=clock.rows[0].date; day=clock.rows[0].day;
  });
  afterAll(async () => { for (const client of clients) await client.end(); });
  const fullItems = (defect = false) => TRUCK_CHECKLIST_ITEMS.map((label,index) => ({item_number:index+1,item_description:label,day_of_week:day,status:defect && index===0?'attention':'ok',comments:defect && index===0?'Fuel leak':null}));
  type Input = { id?: string; hint?: string; actor?: string; owner?: string; kind?: string; parent?: string; items?: unknown[]; mileage?: number|null; reason?: string; revision?: number; status?: string; date?: string; inform?: boolean; notes?: string };
  async function save(input: Input = {}, connection = db) {
    const values = [input.actor||F.actor,false,input.owner||F.actor,F.hgv,input.date||date,input.hint||null,input.status||'submitted',input.mileage===undefined?120:input.mileage,input.notes||null,'data:image/png;base64,TEST',JSON.stringify(input.items||fullItems()),input.id||randomUUID(),input.kind||'full_check',input.parent||null,input.kind==='defect_report'?new Date().toISOString():null,input.reason||null,input.revision??null,input.inform||false];
    const result=await connection.query('SELECT public.save_hgv_inspection_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) AS saved',values);
    return result.rows[0].saved;
  }
  it('allows independent same-day full checks and deduplicates simultaneous retries', async () => {
    const id=randomUUID();
    const [first,retry]=await Promise.all([save({id}),save({id},other)]);
    expect(first.id).toBe(retry.id);
    expect((await save()).id).not.toBe(id);
    await expect(save({hint:id})).rejects.toThrow('SUBMITTED_CONFLICT');
    expect((await db.query('SELECT count(*)::int AS count FROM hgv_inspections WHERE id=$1',[id])).rows[0].count).toBe(1);
  });
  it('reports defects atomically, links repeated observations and never writes a report KM', async () => {
    const parent=await save({items:fullItems(true)});
    const item=fullItems(true).slice(0,1);
    const reportRequest=randomUUID();
    const [a,b]=await Promise.all([
      save({id:reportRequest,kind:'defect_report',parent:parent.id,mileage:null,items:[{...item[0],comments:'Fuel leak worsened after journey'}]}),
      save({kind:'defect_report',parent:parent.id,mileage:null,items:item},other),
    ]);
    const tasks=await db.query('SELECT DISTINCT task_id FROM hgv_defect_observations WHERE inspection_id=ANY($1::uuid[])',[[parent.id,a.id,b.id]]);
    expect(tasks.rowCount).toBe(1);
    const comments=await db.query('SELECT id,body FROM workshop_task_comments WHERE task_id=$1',[tasks.rows[0].task_id]);
    expect(comments.rows.some(row=>row.body.includes('Fuel leak worsened after journey'))).toBe(true);
    await save({id:reportRequest,kind:'defect_report',parent:parent.id,mileage:null,items:[{...item[0],comments:'Fuel leak worsened after journey'}]});
    expect((await db.query('SELECT count(*)::int AS count FROM workshop_task_comments WHERE task_id=$1',[tasks.rows[0].task_id])).rows[0].count).toBe(comments.rowCount);
    await expect(db.query("UPDATE workshop_task_comments SET body='changed' WHERE id=$1",[comments.rows[0].id])).rejects.toThrow('retained as submitted');

    expect((await db.query('SELECT current_mileage FROM hgvs WHERE id=$1',[F.hgv])).rows[0].current_mileage).toBe(120);
    const report=await db.query('SELECT current_mileage,record_kind FROM hgv_inspections WHERE id=$1',[a.id]);
    expect(report.rows[0]).toEqual({current_mileage:null,record_kind:'defect_report'});
  });
  it('preserves original signatures and records a correction without closing workshop work', async () => {
    const original=await save({items:fullItems(true)});
    const operation=randomUUID();
    const corrected=await save({id:operation,hint:original.id,reason:'Wrong item selected',revision:0,items:fullItems()});
    expect(corrected.revision).toBe(1);
    expect((await save({id:operation,hint:original.id,reason:'Wrong item selected',revision:0,items:fullItems()})).revision).toBe(1);
    const versions=await db.query('SELECT revision,snapshot FROM hgv_inspection_versions WHERE inspection_id=$1 ORDER BY revision',[original.id]);
    expect(versions.rows.map(row=>row.revision)).toEqual([0,1]);
    expect(versions.rows[0].snapshot.items[0].status).toBe('attention');
    expect(versions.rows[1].snapshot.items[0].status).toBe('ok');
    const task=await db.query('SELECT status FROM actions WHERE id IN (SELECT task_id FROM hgv_defect_observations WHERE inspection_id=$1)',[original.id]);
    expect(task.rows[0].status).toBe('pending');
    await expect(save({hint:original.id,reason:'Stale correction',revision:0})).rejects.toThrow('REVISION_CONFLICT');
    await expect(save({hint:original.id,reason:'Change KM forbidden',revision:1,mileage:999})).rejects.toThrow('INVALID_INPUT');
    await expect(save({hint:original.id,reason:'Other driver correction',revision:1,actor:F.subject,owner:F.subject})).rejects.toThrow('FORBIDDEN_OWNER');
  });
  it('reuses legacy task descriptions with day suffix and accepts five-character workshop notes', async () => {
    await db.query("UPDATE actions SET status='completed'");
    const legacy=randomUUID();
    await db.query("INSERT INTO actions(id,action_type,hgv_id,title,description,status) VALUES($1,'inspection_defect',$2,'Legacy',E'HGV inspection defect found:\nItem 1 - Fuel - and ad-blu (Monday)\nComment: leak','pending')",[legacy,F.hgv]);
    const result=await save({items:fullItems(true),inform:true,notes:'12345'});
    const links=await db.query('SELECT item_number,task_id FROM hgv_defect_observations WHERE inspection_id=$1 ORDER BY item_number',[result.id]);
    expect(links.rows).toHaveLength(2);
    expect(links.rows[1].task_id).toBe(legacy);
    const task=(await db.query('SELECT description FROM actions WHERE id=$1',[links.rows[0].task_id])).rows[0];
    expect(task.description).toBe('12345');
  });
  it('rejects a correction after the London submission day', async () => {
    const original=await save();
    await db.query("UPDATE hgv_inspections SET submitted_at=now()-interval '2 days' WHERE id=$1",[original.id]);
    await expect(save({hint:original.id,reason:'Late correction',revision:0})).rejects.toThrow('CORRECTION_EXPIRED');
  });
  it('rejects forged report ownership, parent/kind changes and report KM', async () => {
    const parent=await save();
    await expect(save({kind:'defect_report',parent:parent.id,actor:F.subject,owner:F.subject,mileage:null,items:fullItems(true).slice(0,1)})).rejects.toThrow('FORBIDDEN_OWNER');
    await expect(save({hint:parent.id,kind:'defect_report',parent:parent.id,mileage:null,items:fullItems(true).slice(0,1)})).rejects.toThrow('IDENTITY_CHANGED');
    await expect(save({kind:'defect_report',parent:parent.id,mileage:999,items:fullItems(true).slice(0,1)})).rejects.toThrow('INVALID_INPUT');
  });
  it('creates a fresh task for a recurrence after completion', async () => {
    await db.query("UPDATE actions SET status='completed'");
    const parent=await save();
    const report=await save({kind:'defect_report',parent:parent.id,mileage:null,items:fullItems(true).slice(0,1)});
    expect((await db.query('SELECT status FROM actions WHERE id IN (SELECT task_id FROM hgv_defect_observations WHERE inspection_id=$1)',[report.id])).rows[0].status).toBe('pending');
  });
  it('rolls back the report when workshop task creation fails', async () => {
    await db.query("UPDATE actions SET status='completed'");
    const parent=await save(); const id=randomUUID();
    await db.query("CREATE FUNCTION private.fail_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workshop unavailable'; END $$; CREATE TRIGGER fail_task BEFORE INSERT ON actions FOR EACH ROW EXECUTE FUNCTION private.fail_task()");
    try { await expect(save({id,kind:'defect_report',parent:parent.id,mileage:null,items:fullItems(true).slice(0,1)})).rejects.toThrow('workshop unavailable'); }
    finally { await db.query('DROP TRIGGER fail_task ON actions'); }
    expect((await db.query('SELECT 1 FROM hgv_inspections WHERE id=$1',[id])).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM hgv_inspection_versions WHERE inspection_id=$1',[id])).rowCount).toBe(0);
  });
  it('denies public RPC execution and direct submitted-content mutation', async () => {
    const original=await save();
    await db.query('GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT,UPDATE ON hgv_inspections,inspection_items TO authenticated');
    const draft=await save({status:'draft'});
    await db.query('SET ROLE authenticated');
    try {
      await expect(save()).rejects.toThrow('permission denied');
      await expect(db.query("UPDATE hgv_inspections SET inspector_comments='bypass' WHERE id=$1",[original.id])).rejects.toThrow('authorised HGV save');
      await expect(db.query("UPDATE inspection_items SET status='attention' WHERE inspection_id=$1",[original.id])).rejects.toThrow('audited correction');
      await expect(db.query('UPDATE inspection_items SET inspection_id=$2 WHERE inspection_id=$1',[original.id,draft.id])).rejects.toThrow('audited correction');
      await expect(db.query('SELECT * FROM hgv_inspection_versions')).rejects.toThrow('permission denied');
    } finally { await db.query('RESET ROLE'); }
  });
  it('denies Storage deletion and overwrite of signed snapshot evidence, including after check deletion', async () => {
    const id=randomUUID(); const key=`${id}/photo.png`;
    await save({id,status:'draft'});
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('inspection-photos',$1)",[key]);
    await db.query('INSERT INTO inspection_photos(inspection_id,item_number,photo_url) VALUES($1,1,$2)',[id,`https://example.test/storage/v1/object/public/inspection-photos/${key}`]);
    await save({id,hint:id});
    await db.query('DELETE FROM inspection_photos WHERE inspection_id=$1',[id]);
    await db.query('DELETE FROM hgv_inspections WHERE id=$1',[id]);
    await db.query('SET ROLE authenticated');
    try {
      expect((await db.query('DELETE FROM storage.objects WHERE name=$1',[key])).rowCount).toBe(0);
      expect((await db.query("UPDATE storage.objects SET metadata='{}' WHERE name=$1",[key])).rowCount).toBe(0);
      await expect(db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('inspection-photos',$1) ON CONFLICT(name) DO UPDATE SET metadata='{}'",[key])).rejects.toThrow('row-level security');
    } finally { await db.query('RESET ROLE'); }
    expect((await db.query('SELECT 1 FROM storage.objects WHERE name=$1',[key])).rowCount).toBe(1);
  });
  it('protects legacy and post-submission photo rows from owner removal, reparenting and URL swaps', async () => {
    const legacy=randomUUID(), draft=randomUUID(), photo=randomUUID();
    await db.query("INSERT INTO hgv_inspections(id,hgv_id,user_id,inspection_date,status,submitted_at) VALUES($1,$2,$3,$4,'submitted',now()),($5,$2,$3,$4,'draft',NULL)",[legacy,F.hgv,F.actor,date,draft]);
    const key=`${legacy}/legacy.png`;
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('inspection-photos',$1)",[key]);
    await db.query('INSERT INTO inspection_photos(id,inspection_id,item_number,photo_url) VALUES($1,$2,1,$3)',[photo,legacy,`https://example.test/storage/v1/object/public/inspection-photos/${key}`]);
    await db.query('GRANT SELECT,UPDATE,DELETE ON inspection_photos TO authenticated; SET ROLE authenticated');
    try {
      await expect(db.query('DELETE FROM inspection_photos WHERE id=$1',[photo])).rejects.toThrow('photo evidence is retained');
      await expect(db.query('UPDATE inspection_photos SET inspection_id=$2 WHERE id=$1',[photo,draft])).rejects.toThrow('photo evidence is retained');
      await expect(db.query("UPDATE inspection_photos SET photo_url='other' WHERE id=$1",[photo])).rejects.toThrow('photo evidence is retained');
      expect((await db.query("UPDATE inspection_photos SET caption='More detail' WHERE id=$1",[photo])).rowCount).toBe(1);
      expect((await db.query('DELETE FROM storage.objects WHERE name=$1',[key])).rowCount).toBe(0);
    } finally { await db.query('RESET ROLE'); }
  });
  it('keeps immutable evidence and blocks snapshot references to queued photo cleanup', async () => {
    const original=await save();
    await expect(db.query("UPDATE hgv_inspection_versions SET reason='changed' WHERE inspection_id=$1",[original.id])).rejects.toThrow('append-only');
    await db.query("INSERT INTO private.daily_check_storage_cleanup VALUES('https://example.test/storage/v1/object/public/inspection-photos/deleted.png')");
    await expect(db.query("INSERT INTO hgv_inspection_versions VALUES($1,99,$2,$3,now(),'invalid', $4)",[original.id,randomUUID(),F.actor,JSON.stringify({photos:[{photo_url:'https://example.test/storage/v1/object/public/inspection-photos/deleted.png'}]})])).rejects.toThrow('deleted Daily Check');
    await db.query('DELETE FROM hgv_inspections WHERE id=$1',[original.id]);
    expect((await db.query('SELECT 1 FROM hgv_inspection_versions WHERE inspection_id=$1',[original.id])).rowCount).toBe(1);
  });
});
