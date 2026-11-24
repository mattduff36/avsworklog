import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { Client } from 'pg';
import { HGV_TRAILER_SWAP_ITEM_NUMBERS, type HgvTrailerSelection } from '../../lib/checklists/hgv-trailer-swap';
import { TRUCK_CHECKLIST_ITEMS } from '../../lib/checklists/vehicle-checklists';
import { HGV_SAVE_FIXTURE as F } from './hgv-inspection-save-rpc-harness';

export async function verifyTrailerAssociations(db: Client, date: string, day: number) {
  const tractor = randomUUID(), trailer = randomUUID(), second = randomUUID(), rigid = randomUUID();
  const oldCheck = randomUUID(), naCheck = randomUUID(), noItems = randomUUID();
  await db.query(`
    CREATE TABLE hgv_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text);
    ALTER TABLE hgvs ADD COLUMN category_id uuid, ADD COLUMN status text DEFAULT 'active', ADD COLUMN retired_at timestamptz;
    CREATE TABLE vehicle_maintenance(hgv_id uuid, ves_wheelplan text);
    ALTER TABLE actions ADD COLUMN actioned_at timestamptz, ADD COLUMN updated_at timestamptz;
    INSERT INTO hgv_categories(name) VALUES ('All HGVs');
  `);
  for (const [id, reg, category] of [[tractor, 'XT71 AVS', 'All HGVs'], [trailer, 'C517773','All HGVs'],
    [second, 'SECOND','All HGVs'], [rigid, 'RIGID','All HGVs']]) {
    await db.query('INSERT INTO hgvs(id,reg_number,category_id) SELECT $1,$2,id FROM hgv_categories WHERE name=$3', [id,reg,category]);
  }
  await db.query(readFileSync('supabase/migrations/20261124000100_hgv_trailer_category.sql', 'utf8'));
  await db.query("UPDATE hgvs SET category_id=(SELECT id FROM hgv_categories WHERE name='Trailer') WHERE id=$1", [second]);
  await db.query("INSERT INTO vehicle_maintenance VALUES ($1,'3 AXLE + ARTIC'),($2,'MULTI AXLE RIGID')", [tractor,rigid]);
  for (const id of [oldCheck,naCheck,noItems]) {
    await db.query("INSERT INTO hgv_inspections(id,hgv_id,user_id,inspection_date,status,signature_data) VALUES ($1,$2,$3,$4,'submitted','historic signature')", [id,tractor,F.actor,date]);
  }
  await db.query("INSERT INTO inspection_items(inspection_id,item_number,item_description,status,day_of_week) VALUES ($1,22,'Brake Hoses','ok',$3),($2,23,'Brake Hoses','na',$3)",[oldCheck,naCheck,day]);
  await db.query(readFileSync('supabase/migrations/20261124000200_hgv_trailer_checks.sql','utf8'));
  await db.query(readFileSync('supabase/migrations/20261124000300_hgv_trailer_workshop.sql', 'utf8'));
  await db.query(readFileSync('supabase/migrations/20261124000400_hgv_asset_daily_checks.sql', 'utf8'));
  expect((await db.query("SELECT id,signature_data FROM hgv_inspections WHERE trailer_hgv_id=$1",[trailer])).rows)
    .toEqual([{ id: oldCheck, signature_data: 'historic signature' }]);

  const fullItems = TRUCK_CHECKLIST_ITEMS.map((label,index) => ({
    item_number:index+1,item_description:label,day_of_week:day,status:'ok',comments:null,
  }));
  const fleet = {kind:'fleet',trailerHgvId:trailer} as const;
  const hired = {kind:'hired',hiredTrailerId:'HIRED-1',hiredTrailerCompany:'Hire Co'} as const;
  type SaveInput = {
    id?: string; hint?: string; selection?: HgvTrailerSelection | null; status?: 'draft'|'submitted';
    hgv?: string; na?: boolean; correction?: boolean; parent?: string; discovered?: string; compat?: boolean;
  };
  async function save(input: SaveInput) {
    const items = input.parent ? [{...fullItems[22],status:'attention',comments:'Hose split'}] :
      fullItems.map(item => ({...item,status:input.na && item.item_number>=23?'na':item.status}));
    const values = [F.actor,false,F.actor,input.hgv ?? tractor,date,input.hint ?? null,input.status ?? 'submitted',
      input.parent?null:3000,null,'data:image/png;base64,TEST',JSON.stringify(items),input.id ?? randomUUID(),
      input.parent?'defect_report':'full_check',input.parent ?? null,input.parent && input.status!=='draft'?(input.discovered ?? new Date().toISOString()):null,
      input.correction?'Correction in test':null,input.correction?0:null,false,JSON.stringify(input.selection === undefined ? {keep:true} : input.selection)];
    const fn=input.compat?'save_hgv_inspection_compat':'save_hgv_inspection_v2';
    return (await db.query(`SELECT public.${fn}(${values.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,values)).rows[0].result;
  }
  // Failed submissions roll back the inspection, snapshots, and any workshop updates.
  const invalidId=randomUUID();
  await expect(save({ id:invalidId })).rejects.toThrow('TRAILER_REQUIRED');
  expect((await db.query('SELECT id FROM hgv_inspections WHERE id=$1',[invalidId])).rowCount).toBe(0);
  await expect(save({ selection:{kind:'fleet',trailerHgvId:tractor} })).rejects.toThrow('INVALID_TRAILER');
  await expect(save({ hgv:rigid,selection:fleet })).rejects.toThrow('INVALID_TRAILER');
  await expect(save({ selection:{kind:'none'} })).rejects.toThrow('INVALID_TRAILER');
  await save({ hgv:rigid,selection:{kind:'none'},na:true,compat:true });

  await expect(save({hgv:trailer,selection:{kind:'none'},na:true})).rejects.toThrow('INVALID_TRAILER');
  const retirementDraft=randomUUID();
  await save({id:retirementDraft,status:'draft',selection:fleet});
  await db.query('UPDATE hgvs SET retired_at=now() WHERE id=$1',[trailer]);
  await expect(save({hint:retirementDraft,selection:fleet})).rejects.toThrow('INVALID_TRAILER');
  expect((await db.query('SELECT status FROM hgv_inspections WHERE id=$1',[retirementDraft])).rows[0].status).toBe('draft');
  await db.query("UPDATE hgvs SET retired_at=NULL,category_id=(SELECT id FROM hgv_categories WHERE name='All HGVs') WHERE id=$1",[trailer]);
  await expect(save({hint:retirementDraft,selection:fleet})).rejects.toThrow('INVALID_TRAILER');
  await db.query("UPDATE hgvs SET category_id=(SELECT id FROM hgv_categories WHERE name='Trailer') WHERE id=$1",[trailer]);
  const signingId=randomUUID();
  await save({id:signingId,hint:retirementDraft,selection:fleet});
  await db.query('UPDATE hgvs SET retired_at=now() WHERE id=$1',[trailer]);
  await save({id:signingId,hint:retirementDraft,selection:fleet});
  await save({hint:retirementDraft,correction:true});
  await db.query('UPDATE hgvs SET retired_at=NULL WHERE id=$1',[trailer]);

  const draft=randomUUID();
  await save({id:draft,status:'draft',selection:fleet});
  await db.query('INSERT INTO inspection_photos(inspection_id,item_number) VALUES ($1,23)',[draft]);
  await expect(save({hint:draft,status:'draft',selection:hired})).rejects.toThrow('TRAILER_PHOTOS');
  await db.query('DELETE FROM inspection_photos WHERE inspection_id=$1',[draft]);
  await save({hint:draft,status:'draft',selection:hired});
  await save({hint:draft,selection:fleet});
  expect((await db.query("SELECT snapshot->'inspection'->>'trailer_hgv_id' AS trailer FROM hgv_inspection_versions WHERE inspection_id=$1",[draft])).rows[0].trailer).toBe(trailer);
  await save({hint:draft,correction:true});
  expect((await db.query('SELECT trailer_hgv_id FROM hgv_inspections WHERE id=$1',[draft])).rows[0].trailer_hgv_id).toBe(trailer);

  const swapItems: {item_number: number; item_description: string; status: string; comments: string | null}[] = HGV_TRAILER_SWAP_ITEM_NUMBERS.map(number=>({
    item_number:number,item_description:TRUCK_CHECKLIST_ITEMS[number-1],status:'ok',comments:null,
  }));
  const swapId=randomUUID();
  const swap=(actor:string, selection:HgvTrailerSelection, id=swapId, items=swapItems) => db.query(
    "SELECT public.append_hgv_trailer_swap($1,$2,$3,$4,'data:image/png;base64,TEST',$5) AS id",
    [actor,draft,id,JSON.stringify(selection),JSON.stringify(items)]);
  const otherTrailer={kind:'fleet',trailerHgvId:second} as const;
  await expect(swap(F.subject,otherTrailer)).rejects.toThrow('FORBIDDEN_OWNER');
  await expect(swap(F.actor,otherTrailer,swapId,swapItems.slice(1))).rejects.toThrow('INVALID_ITEM');
  await expect(swap(F.actor,fleet)).rejects.toThrow('INVALID_TRAILER');
  const beforeSwap=(await db.query('SELECT clock_timestamp() AS at')).rows[0].at.toISOString();
  const pendingReport=await save({parent:draft,status:'draft'});
  await swap(F.actor,otherTrailer);
  await swap(F.actor,otherTrailer);
  await expect(swap(F.actor,hired)).rejects.toThrow('IDENTITY_CHANGED');
  expect((await db.query('SELECT trailer_hgv_id FROM hgv_trailer_swaps WHERE parent_check_id=$1',[draft])).rows).toEqual([{trailer_hgv_id:second}]);
  const priorReport=await save({parent:draft,discovered:beforeSwap});
  expect((await db.query('SELECT trailer_hgv_id FROM hgv_inspections WHERE id=$1',[priorReport.id])).rows[0].trailer_hgv_id).toBe(trailer);
  await expect(save({parent:draft,hint:pendingReport.id})).rejects.toThrow('REPORT_TRAILER_CHANGED');
  const report=await save({parent:draft});
  expect((await db.query('SELECT trailer_hgv_id FROM hgv_inspections WHERE id=$1',[report.id])).rows[0].trailer_hgv_id).toBe(second);
  const fleetHistory = await db.query('SELECT id FROM hgv_asset_daily_checks($1)', [second]);
  expect(fleetHistory.rows.map(row => row.id).sort()).toEqual([swapId, report.id].sort());
  const failedSwap = swapItems.map(item => item.item_number === 23 ? { ...item, status: 'attention', comments: 'Leaking coupling' } : item);
  await swap(F.actor,hired,randomUUID(),failedSwap);
  expect((await db.query("SELECT hgv_pair->>'hired_id' AS hired, hgv_repair_side FROM actions WHERE description LIKE 'Trailer change defect:%'")).rows)
    .toMatchObject([{hired: 'HIRED-1', hgv_repair_side: 'pair'}]);
  await expect(db.query("UPDATE hgv_trailer_swaps SET trailer_label='Changed' WHERE id=$1",[swapId])).rejects.toThrow('append-only');
  for (const role of ['anon','authenticated']) {
    const acl=await db.query(`SELECT has_function_privilege($1,'public.append_hgv_trailer_swap(uuid,uuid,uuid,jsonb,text,jsonb)','execute') AS rpc,
      has_table_privilege($1,'public.hgv_trailer_swaps','insert') AS direct`,[role]);
    expect(acl.rows[0]).toEqual({rpc:false,direct:false});
  }
}
