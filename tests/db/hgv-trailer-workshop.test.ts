import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { TRUCK_CHECKLIST_ITEMS } from '../../lib/checklists/vehicle-checklists';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = 'supabase/migrations/20261124000300_hgv_trailer_workshop.sql';
const tractor = randomUUID(), otherTractor = randomUUID(), nooteboom = randomUUID(), otherTrailer = randomUUID();
const driver = randomUUID(), check = randomUUID(), sourceItem = randomUUID(), historicTask = randomUUID();
let db: PGlite;
async function locks(hgv: string, trailer: string | null, swap = false, hireId: string | null = null, completed = false, warning = false) {
  const rows = await db.query<{id: string}>(
    'select id from public.hgv_check_workshop_defects($1,$2,$3,$4,$5,$6,7) where trailer_warning=$7',
    [hgv, trailer, hireId, hireId ? 'Hire company' : null, swap, completed, warning]);
  return rows.rows.map(row => row.id);
}
async function submitSwap(hgv: string, trailer: string | null, item = 'Brake Hoses', hireId?: string) {
  await db.query(`insert into hgv_trailer_swaps values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(),check,hgv,driver,trailer,hireId ?? null,hireId ? 'Hire company' : null,
      hireId ?? trailer,JSON.stringify([{item_number:item === 'Tyres' ? 9 : 23,item_description:item,status:'attention',comments:'Split'}])]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema private; create role anon; create role authenticated; create role service_role;
    create table hgvs(id uuid primary key, reg_number text);
    create table hgv_inspections(id uuid primary key,hgv_id uuid,trailer_kind text,trailer_hgv_id uuid,
      trailer_label text,hired_trailer_id text,hired_trailer_company text);
    create table inspection_items(id uuid,inspection_id uuid,item_number int,item_description text,comments text);
    create table hgv_trailer_swaps(id uuid primary key,parent_check_id uuid,hgv_id uuid,user_id uuid,trailer_hgv_id uuid,
      hired_trailer_id text,hired_trailer_company text,trailer_label text,items jsonb);
    create table actions(id uuid primary key default gen_random_uuid(),action_type text,hgv_id uuid,
      title text,description text,status text,created_by uuid,inspection_id uuid,inspection_item_id uuid,
      workshop_category_id uuid,daily_check_source_id uuid,daily_check_source_type text,
      created_at timestamptz default now(),actioned_at timestamptz,updated_at timestamptz default now());
    create table workshop_task_categories(id uuid,name text,applies_to text,is_active boolean);
    create table workshop_task_comments(id uuid default gen_random_uuid(),task_id uuid,author_id uuid,body text);
    create table profiles(id uuid,full_name text);
  `);
  const foundation = readFileSync('supabase/migrations/20261116_hgv_compat_foundation.sql','utf8');
  for (const name of ['save_hgv_inspection_v2','sync_hgv_defects_compat']) {
    const start = foundation.indexOf('CREATE FUNCTION public.' + name + '(');
    await db.exec(foundation.slice(start,foundation.indexOf('END; $$;',start)+8));
  }
  await db.query("insert into hgvs values ($1,'Tractor 1'),($2,'Tractor 2'),($3,'Nooteboom'),($4,'New trailer')",[tractor,otherTractor,nooteboom,otherTrailer]);
  await db.query("insert into hgv_inspections values ($1,$2,'fleet',$3,'Nooteboom',null,null)",[check,tractor,nooteboom]);
  await db.query("insert into inspection_items values ($1,$2,22,'Brake Hoses','Split')",[sourceItem,check]);
  await db.query(`insert into actions(id,action_type,hgv_id,description,status,inspection_id,inspection_item_id)
    values ($1,'inspection_defect',$2,'Item 22 - Brake Hoses (Monday)','pending',$3,$4)`,[historicTask,tractor,check,sourceItem]);
  await db.exec(`
    alter table hgv_inspections add column user_id uuid,add column inspection_date date,add column inspection_end_date date,
      add column status text default 'draft', add column current_mileage int,add column inspector_comments text,
      add column record_kind text default 'full_check',add column parent_check_id uuid,add column discovered_at timestamptz,
      add column revision int default 0,add column submitted_at timestamptz,add column signature_data text,
      add column signed_at timestamptz,add column updated_at timestamptz;
    alter table inspection_items add column day_of_week int,add column status text,alter column id set default gen_random_uuid();
    alter table hgvs add column current_mileage int,add column daily_check_source_id uuid,add column daily_check_source_type text,add column nickname text;
    create table hgv_inspection_versions(inspection_id uuid,revision int, request_id uuid unique,actor_id uuid,reason text,snapshot jsonb);
    create table hgv_defect_observations(inspection_id uuid,revision int,item_number int,task_id uuid,comment text,workshop_comment_id uuid);
    create table inspection_photos(inspection_id uuid);
  `);
  await db.exec(readFileSync(migration,'utf8'));
});
afterAll(async () => { await db?.close(); });

describe('trailer workshop diagnosis', () => {
  it('links historical trailer faults, deduplicates the same pairing, and keeps separate trailers independent', async () => {
    expect(await locks(tractor,nooteboom)).toEqual([historicTask]);
    expect(await locks(tractor,otherTrailer)).toEqual([]);
    await submitSwap(tractor,nooteboom);
    expect(await locks(tractor,nooteboom)).toEqual([historicTask]);
    await submitSwap(tractor,otherTrailer);
    const [newTask] = await locks(tractor,otherTrailer);
    expect(newTask).toBeTruthy();
    expect(newTask).not.toBe(historicTask);

    await db.query("select assign_hgv_trailer_repair($1,$2,'trailer','pair')",[historicTask,driver]);
    expect(await locks(otherTractor,nooteboom)).toEqual([historicTask]);
    expect(await locks(tractor,otherTrailer)).toEqual([newTask]);
    await expect(db.query("select assign_hgv_trailer_repair($1,$2,'tractor','pair')",[historicTask,driver])).rejects.toThrow('Assignment changed');

    await db.query("select assign_hgv_trailer_repair($1,$2,'tractor','pair')",[newTask,driver]);
    expect(await locks(tractor,nooteboom)).toContain(newTask);
    expect(await locks(otherTractor,otherTrailer)).not.toContain(newTask);
    await db.query("update actions set status='completed', actioned_at=now() where id=$1",[historicTask]);
    expect(await locks(otherTractor,nooteboom)).not.toContain(historicTask);
    expect(await locks(otherTractor,nooteboom,false,null,true)).toContain(historicTask);
    await expect(db.query("select assign_hgv_trailer_repair($1,$2,'tractor','trailer')",[historicTask,driver])).rejects.toThrow('Task is unavailable');
  });
  it('uses the original save and compatibility RPCs to keep identical faults on different trailers separate', async () => {
    const date='2026-11-23';
    const items=TRUCK_CHECKLIST_ITEMS.map((description,i) => ({item_number:i+1,item_description:description,
      day_of_week:1,status:description==='Electrical Connections' ? 'attention' : 'ok',comments:'Plug loose'}));
    for (const trailer of [nooteboom,otherTrailer,nooteboom]) {
      const id=randomUUID();
      await db.query(`insert into hgv_inspections(id,hgv_id,user_id,inspection_date,trailer_kind,trailer_hgv_id,trailer_label)
        values ($1,$2,$3,$4,'fleet',$5,'Trailer')`,[id,tractor,driver,date,trailer]);
      await db.query(`select save_hgv_inspection_v2($1,false,$1,$2,$3,$4,'submitted',100,'','sig',$5,$6,
        'full_check',null,null,null,null,false)`,[driver,tractor,date,id,JSON.stringify(items),randomUUID()]);
    }
    const result=await db.query<{id:string,hgv_pair:{trailer_id:string}}>(
      "select id,hgv_pair from actions where description like '%Electrical Connections%'");
    expect(result.rows.map(row=>row.hgv_pair.trailer_id).sort()).toEqual([nooteboom,otherTrailer].sort());
    const legacy=randomUUID(), legacyItem=randomUUID();
    await db.query(`insert into hgv_inspections(id,hgv_id,user_id,status,trailer_kind,trailer_hgv_id,trailer_label)
      values ($1,$2,$3,'submitted','fleet',$4,'New trailer')`,[legacy,tractor,driver,otherTrailer]);
    await db.query(`insert into inspection_items(id,inspection_id,item_number,item_description,status,comments)
      values ($1,$2,25,'Electrical Connections','attention','Still loose')`,[legacyItem,legacy]);
    await db.query('select sync_hgv_defects_compat($1,false,$2,$3)',[driver,legacy,tractor]);
    const observation=await db.query<{task_id:string}>('select task_id from hgv_defect_observations where inspection_id=$1',[legacy]);
    expect(observation.rows[0].task_id).toBe(result.rows.find(row=>row.hgv_pair.trailer_id===otherTrailer)?.id);
  });
  it('warns on open trailer walkaround faults while keeping the tractor checklist independent', async () => {
    const warnings = (hgv: string, trailer: string | null, hireId: string | null = null) =>
      locks(hgv,trailer,false,hireId,false,true);
    for (const item of ['Tyres','Brakes','Lights']) await submitSwap(tractor,otherTrailer,item);
    const faults = await warnings(tractor,otherTrailer);
    expect(faults).toHaveLength(3);
    expect((await locks(tractor,otherTrailer)).filter(id=>faults.includes(id))).toEqual([]);
    expect(await locks(tractor,otherTrailer,true)).toEqual(expect.arrayContaining(faults));
    expect(await warnings(tractor,nooteboom)).toEqual([]);
    expect(await warnings(tractor,null)).toEqual([]);
    expect(await warnings(otherTractor,otherTrailer)).toEqual([]);

    const tractorTyre = randomUUID();
    await db.query(`insert into actions(id,action_type,hgv_id,status,description)
      values ($1,'inspection_defect',$2,'pending','Item 9 - Tyres (Monday)')`,[tractorTyre,tractor]);
    expect(await locks(tractor,otherTrailer)).toContain(tractorTyre);
    expect(await warnings(tractor,otherTrailer)).not.toContain(tractorTyre);

    await db.query("select assign_hgv_trailer_repair($1,$2,'trailer','pair')",[faults[0],driver]);
    expect(await warnings(otherTractor,otherTrailer)).toEqual([faults[0]]);
    await db.query("select assign_hgv_trailer_repair($1,$2,'tractor','pair')",[faults[1],driver]);
    expect(await warnings(tractor,otherTrailer)).not.toContain(faults[1]);
    expect(await locks(tractor,nooteboom)).toContain(faults[1]);
    await db.query("update actions set status='completed', actioned_at=now() where id=$1",[faults[0]]);
    expect(await warnings(otherTractor,otherTrailer)).toEqual([]);

    await submitSwap(tractor,null,'Tyres','H-123');
    const hired = await warnings(tractor,null,'H-123');
    expect(hired).toHaveLength(1);
    expect(await locks(tractor,null,false,'H-123')).not.toContain(hired[0]);
    expect(await warnings(tractor,null,'H-124')).toEqual([]);
    await db.query("select assign_hgv_trailer_repair($1,$2,'trailer','pair')",[hired[0],driver]);
    expect(await warnings(tractor,null,'H-123')).toEqual(hired);
  });
  it('denies direct driver RPC access and retains original pairing after assignment', async () => {
    const original = await db.query<{hgv_pair:{tractor_id:string,trailer_id:string}}>('select hgv_pair from actions where id=$1',[historicTask]);
    expect(original.rows[0].hgv_pair).toMatchObject({tractor_id:tractor,trailer_id:nooteboom});
    await db.exec('set role authenticated');
    try {
      await expect(db.query("select assign_hgv_trailer_repair($1,$2,'trailer','pair')",[historicTask,driver])).rejects.toThrow('permission denied');
      await expect(locks(tractor,nooteboom)).rejects.toThrow('permission denied');
    } finally { await db.exec('reset role'); }
  });
});
