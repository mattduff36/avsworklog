import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVENANCE_ENV_KEYS, validateLocalTestDatabaseUrl } from '../../scripts/local-test-postgres';
vi.mock('server-only',()=>({}));
import { resetTestFleet } from '../../lib/server/test-fleet-reset';
import { TEST_FLEET_AUDIT_INDEX_NAME } from '../../lib/server/test-fleet-audit-index';
import { ensureTestFleetAuditIndex } from '../../scripts/run-test-fleet-audit-index-migration';

const suite=process.env.TEST_DATABASE_URL?describe:describe.skip;
suite('Test Fleet reset — disposable PostgreSQL',()=>{
  let db:Client;
  const test=randomUUID(),real=randomUUID(),actor=randomUUID(),check=randomUUID(),realCheck=randomUUID(),task=randomUUID();
  beforeAll(async()=>{
    const url=process.env.TEST_DATABASE_URL!;
    const marker=process.env[PROVENANCE_ENV_KEYS.marker];
    if(!marker)throw new Error('Disposable runner marker required');
    validateLocalTestDatabaseUrl(url,Number(process.env[PROVENANCE_ENV_KEYS.port]));
    db=new Client({connectionString:url,ssl:false});await db.connect();
    expect((await db.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0].marker).toBe(marker);
    await db.query(`CREATE SCHEMA private;
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE vans(id uuid PRIMARY KEY,reg_number text);
      CREATE TABLE hgvs(id uuid PRIMARY KEY,reg_number text,current_mileage int);
      CREATE TABLE plant(id uuid PRIMARY KEY,plant_id text);
      CREATE TABLE hgv_inspections(id uuid PRIMARY KEY,hgv_id uuid REFERENCES hgvs(id));
      CREATE TABLE van_inspections(id uuid PRIMARY KEY,van_id uuid REFERENCES vans(id));
      CREATE TABLE plant_inspections(id uuid PRIMARY KEY,plant_id uuid REFERENCES plant(id));
      CREATE TABLE inspection_items(id uuid PRIMARY KEY,inspection_id uuid);
      CREATE TABLE actions(id uuid PRIMARY KEY,hgv_id uuid REFERENCES hgvs(id),inspection_id uuid,inspection_item_id uuid REFERENCES inspection_items(id));
      CREATE TABLE workshop_task_comments(id uuid PRIMARY KEY,task_id uuid REFERENCES actions(id));
      CREATE TABLE workshop_task_check_photos(id uuid PRIMARY KEY,task_id uuid REFERENCES actions(id),inspection_id uuid);
      CREATE TABLE hgv_inspection_versions(inspection_id uuid,revision int,snapshot jsonb,PRIMARY KEY(inspection_id,revision));
      CREATE TABLE hgv_defect_observations(inspection_id uuid,revision int,task_id uuid,PRIMARY KEY(inspection_id,revision));
      CREATE TABLE audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),table_name text,record_id uuid,user_id uuid,action text,changes jsonb);
      CREATE TABLE private.guest_plant_requests(session_id uuid,request_id uuid,inspection_id uuid);
      CREATE TABLE private.guest_plant_uploads(id uuid PRIMARY KEY,session_id uuid,request_id uuid);
      CREATE TABLE private.daily_check_effects(id bigint GENERATED ALWAYS AS IDENTITY,source_id uuid,target_id uuid,target_table text,before_row jsonb,after_row jsonb);
      CREATE TABLE private.daily_check_storage_cleanup(id bigint GENERATED ALWAYS AS IDENTITY,source_id uuid);
      CREATE TABLE inventory_locations(id uuid PRIMARY KEY,linked_hgv_id uuid REFERENCES hgvs(id));
      CREATE TABLE inventory_items(id uuid PRIMARY KEY,location_id uuid REFERENCES inventory_locations(id));
      CREATE TABLE profiles(id uuid PRIMARY KEY);
      CREATE TABLE profile_fleet_assignments(id uuid PRIMARY KEY,user_id uuid REFERENCES profiles(id),linked_hgv_id uuid REFERENCES hgvs(id));
      CREATE TABLE workshop_attachment_template_versions(id uuid PRIMARY KEY);
      CREATE TABLE workshop_task_attachments(id uuid PRIMARY KEY,task_id uuid REFERENCES actions(id));
      CREATE TABLE workshop_attachment_schema_snapshots(id uuid PRIMARY KEY,attachment_id uuid REFERENCES workshop_task_attachments(id),template_version_id uuid REFERENCES workshop_attachment_template_versions(id));
      CREATE TABLE inspection_orphan_children_archive(id uuid PRIMARY KEY,child_table text,child_id uuid,inspection_id uuid,row_snapshot jsonb);
      CREATE TABLE unknown_task_records(id uuid PRIMARY KEY,action_id uuid REFERENCES actions(id) ON DELETE CASCADE);
      CREATE FUNCTION private.hgv_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'HGV history is append-only'; END $$;
      CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON hgv_inspection_versions FOR EACH ROW EXECUTE FUNCTION private.hgv_history_immutable();
      CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON hgv_defect_observations FOR EACH ROW EXECUTE FUNCTION private.hgv_history_immutable();
      CREATE FUNCTION fixture_delete_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO audit_log(table_name,record_id,action,changes) VALUES(TG_TABLE_NAME,OLD.id,'DELETE',jsonb_build_object('hgv_id',jsonb_build_object('old',OLD.hgv_id)));
        RETURN OLD; END $$;
      CREATE TRIGGER deletion_audit AFTER DELETE ON hgv_inspections FOR EACH ROW EXECUTE FUNCTION fixture_delete_audit();
    `);
    await db.query(readFileSync('supabase/migrations/20261116_test_fleet_reset.sql','utf8'));
    expect(await ensureTestFleetAuditIndex(db)).toBe('created');
    expect(await ensureTestFleetAuditIndex(db)).toBe('reused');
  });
  beforeEach(async()=>{
    await db.query('TRUNCATE vans,hgvs,plant,hgv_inspections,van_inspections,plant_inspections,inspection_items,actions,workshop_task_comments,workshop_task_check_photos,hgv_inspection_versions,hgv_defect_observations,audit_log,private.guest_plant_requests,private.guest_plant_uploads,private.daily_check_effects,private.daily_check_storage_cleanup,inventory_locations,private.test_fleet_reset_scope,profiles,workshop_attachment_template_versions,inspection_orphan_children_archive CASCADE');
    await db.query("INSERT INTO hgvs VALUES($1,'TE57 HGV',123),($2,'REAL HGV',456)",[test,real]);
    await db.query('INSERT INTO hgv_inspections VALUES($1,$2),($3,$4)',[check,test,realCheck,real]);
    await db.query('INSERT INTO inspection_items VALUES($1,$2)',[randomUUID(),check]);
    await db.query('INSERT INTO actions(id,hgv_id,inspection_id) VALUES($1,$2,$3)',[task,test,check]);
    for(const [id,hgv] of [[check,test],[realCheck,real]]) await db.query('INSERT INTO hgv_inspection_versions VALUES($1,1,$2)',[id,JSON.stringify({inspection:{id,hgv_id:hgv}})]);
    await db.query('INSERT INTO hgv_defect_observations VALUES($1,1,$2)',[check,task]);
    await db.query("INSERT INTO private.daily_check_effects(source_id,target_id,target_table,before_row,after_row) VALUES($1,$2,'hgvs','{\"current_mileage\":0}','{\"current_mileage\":123}')",[check,test]);
  });
  afterAll(async()=>{await db?.end();});
  const preview=()=>resetTestFleet(db,{assetIds:[test],actorId:actor});
  async function execute(){const p=await preview();return resetTestFleet(db,{assetIds:[test],actorId:actor,execute:true,fingerprint:p.fingerprint});}
  it('previews, erases owned evidence including generated audit, and preserves assets/real data',async()=>{
    const p=await preview();expect(p.blockers).toEqual([]);expect(p.counts['public.hgv_inspections']).toBe(1);
    expect((await db.query('SELECT count(*) FROM hgv_inspections')).rows[0].count).toBe('2');
    await execute();
    expect((await db.query('SELECT id FROM hgvs ORDER BY reg_number')).rows).toHaveLength(2);
    expect((await db.query('SELECT id FROM hgv_inspections')).rows).toEqual([{id:realCheck}]);
    expect((await db.query('SELECT inspection_id FROM hgv_inspection_versions')).rows).toEqual([{inspection_id:realCheck}]);
    expect((await db.query('SELECT action FROM audit_log')).rows).toEqual([{action:'test_fleet_reset'}]);
    expect((await db.query('SELECT count(*) FROM private.test_fleet_reset_scope')).rows[0].count).toBe('0');
  });
  it('cleans legacy observations without snapshots using the live test parent',async()=>{
    await db.query('TRUNCATE hgv_inspection_versions');
    await execute();expect((await db.query('SELECT * FROM hgv_defect_observations')).rows).toEqual([]);
  });
  it('erases deleted-parent test snapshots but leaves real deleted-parent evidence immutable',async()=>{
    await db.query('DELETE FROM hgv_inspections');
    await execute();
    await expect(db.query('DELETE FROM hgv_inspection_versions')).rejects.toThrow('append-only');
    expect((await db.query('SELECT inspection_id FROM hgv_inspection_versions')).rows).toEqual([{inspection_id:realCheck}]);
  });
  it('rejects broad targets and stale previews atomically',async()=>{
    await expect(resetTestFleet(db,{assetIds:[test,real],actorId:actor})).rejects.toThrow('Select one');
    await expect(resetTestFleet(db,{assetIds:[real],actorId:actor})).rejects.toThrow('exact registered');
    const p=await preview();await db.query('INSERT INTO inspection_items VALUES($1,$2)',[randomUUID(),check]);
    await expect(resetTestFleet(db,{assetIds:[test],actorId:actor,execute:true,fingerprint:p.fingerprint})).rejects.toThrow('changed since preview');
    expect((await db.query('SELECT count(*) FROM hgv_inspections')).rows[0].count).toBe('2');
  });
  it('blocks historic test ownership when a surviving check belongs to a real asset',async()=>{
    const item=randomUUID();
    await db.query('INSERT INTO inspection_items VALUES($1,$2)',[item,realCheck]);
    await db.query("INSERT INTO audit_log(table_name,record_id,action,changes) VALUES('hgv_inspections',$1,'UPDATE',$2)",
      [realCheck,JSON.stringify({hgv_id:{old:test,new:real}})]);
    const p=await preview();
    expect(p.blockers).toContain('Historical test check now belongs to another asset.');
    expect(p.blockers).toContain('Historical audit includes a different asset owner.');
    await expect(execute()).rejects.toThrow();
    expect((await db.query('SELECT id FROM inspection_items WHERE id=$1',[item])).rows).toEqual([{id:item}]);
  });
  it('blocks conflicting nested deleted-check ownership snapshots',async()=>{
    await db.query('DELETE FROM hgv_inspections WHERE id=$1',[check]);
    await db.query("INSERT INTO audit_log(table_name,record_id,action,changes) VALUES('hgv_inspections',$1,'daily_check_deleted',$2)",
      [check,JSON.stringify({inspection:{id:check,hgv_id:real}})]);
    expect((await preview()).blockers).toContain('Historical audit includes a different asset owner.');
    await expect(execute()).rejects.toThrow('different asset owner');
  });
  it('blocks mixed-owner journal snapshots and a journal target outside the reset',async()=>{
    await db.query('UPDATE private.daily_check_effects SET before_row=$1',[JSON.stringify({hgv_id:real})]);
    expect((await preview()).blockers).toContain('Daily check journal includes a different asset owner.');
    await db.query("UPDATE private.daily_check_effects SET before_row='{}',target_id=$1",[real]);
    expect((await preview()).blockers).toContain('Daily check journal has an unknown or shared target.');
    await expect(execute()).rejects.toThrow('unknown or shared target');
  });
  it('blocks unknown foreign-key modules and cross-asset non-FK evidence',async()=>{
    const location=randomUUID();
    await db.query('INSERT INTO inventory_locations VALUES($1,$2)',[location,test]);
    await db.query('INSERT INTO inventory_items VALUES($1,$2)',[randomUUID(),location]);
    expect((await preview()).blockers).toContain('Unsupported related records: public.inventory_items');
    await expect(execute()).rejects.toThrow('Unsupported related');
    await db.query('DELETE FROM inventory_items');
    await db.query('DELETE FROM inventory_locations');
    await db.query('INSERT INTO workshop_task_check_photos VALUES($1,$2,$3)',[randomUUID(),task,realCheck]);
    expect((await preview()).blockers).toContain('Unknown or shared check reference: public.workshop_task_check_photos.inspection_id');
    await expect(execute()).rejects.toThrow('shared check');
  });
  it('retains an empty linked inventory location as asset metadata',async()=>{
    const location=randomUUID();await db.query('INSERT INTO inventory_locations VALUES($1,$2)',[location,test]);
    const p=await preview();expect(p.blockers).toEqual([]);expect(p.counts['public.inventory_locations']).toBeUndefined();
    await execute();expect((await db.query('SELECT id FROM inventory_locations')).rows).toEqual([{id:location}]);
  });
  it('blocks a selected task whose item FK belongs to a real check',async()=>{
    const item=randomUUID();await db.query('INSERT INTO inspection_items VALUES($1,$2)',[item,realCheck]);
    await db.query('UPDATE actions SET inspection_item_id=$1 WHERE id=$2',[item,task]);
    expect((await preview()).blockers).toContain('Unknown or shared parent record: public.actions → public.inspection_items');
    await expect(execute()).rejects.toThrow('shared parent');
  });
  it('erases test-only assignments, attachment snapshots and orphan archive while preserving profiles/templates',async()=>{
    const attachment=randomUUID(),template=randomUUID(),child=randomUUID();
    await db.query('INSERT INTO profiles VALUES($1)',[actor]);
    await db.query('INSERT INTO profile_fleet_assignments VALUES($1,$2,$3)',[randomUUID(),actor,test]);
    await db.query('INSERT INTO workshop_attachment_template_versions VALUES($1)',[template]);
    await db.query('INSERT INTO workshop_task_attachments VALUES($1,$2)',[attachment,task]);
    await db.query('INSERT INTO workshop_attachment_schema_snapshots VALUES($1,$2,$3)',[randomUUID(),attachment,template]);
    await db.query("INSERT INTO inspection_orphan_children_archive VALUES($1,'inspection_items',$2,$3,$4)",[randomUUID(),child,check,JSON.stringify({id:child,inspection_id:check})]);
    const p=await preview();expect(p.blockers).toEqual([]);
    for(const name of ['profile_fleet_assignments','workshop_attachment_schema_snapshots','inspection_orphan_children_archive'])expect(p.counts[`public.${name}`]).toBe(1);
    await execute();
    expect((await db.query('SELECT id FROM profiles')).rows).toEqual([{id:actor}]);
    expect((await db.query('SELECT id FROM workshop_attachment_template_versions')).rows).toEqual([{id:template}]);
    expect((await db.query('SELECT * FROM inspection_orphan_children_archive')).rows).toEqual([]);
  });
  it('blocks archived child snapshots that disagree with their archived parent',async()=>{
    const child=randomUUID();
    await db.query("INSERT INTO inspection_orphan_children_archive VALUES($1,'inspection_items',$2,$3,$4)",[randomUUID(),child,check,JSON.stringify({id:child,inspection_id:realCheck})]);
    expect((await preview()).blockers).toContain('Archived inspection child has inconsistent ownership evidence.');
    await expect(execute()).rejects.toThrow('inconsistent ownership');
  });
  it('discovers legacy deleted van checks and orphan item audits through indexed references',async()=>{
    const van=randomUUID(),oldCheck=randomUUID(),oldItem=randomUUID();
    await db.query("INSERT INTO vans VALUES($1,'TE57 VAN')",[van]);
    await db.query(`INSERT INTO audit_log(table_name,record_id,action,changes)
      VALUES('vehicle_inspections',$1,'DELETE',$2),('inspection_items',$3,'DELETE',$4)`,
      [oldCheck,JSON.stringify({vehicle_id:{old:van}}),oldItem,JSON.stringify({inspection_id:{old:oldCheck}})]);
    const p=await resetTestFleet(db,{assetIds:[van],actorId:actor});expect(p.blockers).toEqual([]);expect(p.counts['public.audit_log']).toBe(2);
    await resetTestFleet(db,{assetIds:[van],actorId:actor,execute:true,fingerprint:p.fingerprint});
    expect((await db.query("SELECT count(*) FROM audit_log WHERE action<>'test_fleet_reset'")).rows[0].count).toBe('0');
  });
  it('recognises legacy mixed-fleet vehicle_id for the exact selected HGV only',async()=>{
    await db.query("INSERT INTO audit_log(table_name,record_id,action,changes) VALUES('vehicle_inspections',$1,'DELETE',$2)",[check,JSON.stringify({vehicle_id:{old:test}})]);
    expect((await preview()).blockers).toEqual([]);
    await db.query("INSERT INTO audit_log(table_name,record_id,action,changes) VALUES('vehicle_inspections',$1,'UPDATE',$2)",[check,JSON.stringify({vehicle_id:{old:test,new:real}})]);
    expect((await preview()).blockers).toContain('Historical audit includes a different asset owner.');
  });
  it('blocks concurrent inserts into unknown cascading children before deletion',async()=>{
    const other=new Client({connectionString:process.env.TEST_DATABASE_URL!,ssl:false});await other.connect();
    await other.query("SET lock_timeout='150ms'");
    const p=await preview();let checked=false;
    try{
      const guarded={query:(async(...args:Parameters<Client['query']>)=>{
        const result=await db.query(...args);
        if(String(args[0]).startsWith('LOCK TABLE')){
          checked=true;
          await expect(other.query('INSERT INTO unknown_task_records VALUES($1,$2)',[randomUUID(),task])).rejects.toThrow('lock timeout');
        }
        return result;
      }) as Client['query']};
      await resetTestFleet(guarded,{assetIds:[test],actorId:actor,execute:true,fingerprint:p.fingerprint});
      expect(checked).toBe(true);
    }finally{await other.end();}
  });
  it('removes test guest request/upload records without touching unrelated guest records',async()=>{
    const plant=randomUUID(),inspection=randomUUID(),session=randomUUID(),request=randomUUID(),otherRequest=randomUUID();
    await db.query("INSERT INTO plant VALUES($1,'TE57')",[plant]);
    await db.query('INSERT INTO plant_inspections VALUES($1,$2)',[inspection,plant]);
    await db.query('INSERT INTO private.guest_plant_requests VALUES($1,$2,$3),($1,$4,$5)',[session,request,inspection,otherRequest,randomUUID()]);
    await db.query('INSERT INTO private.guest_plant_uploads VALUES($1,$2,$3),($4,$2,$5)',[randomUUID(),session,request,randomUUID(),otherRequest]);
    const p=await resetTestFleet(db,{assetIds:[plant],actorId:actor});expect(p.blockers).toEqual([]);
    await resetTestFleet(db,{assetIds:[plant],actorId:actor,execute:true,fingerprint:p.fingerprint});
    expect((await db.query('SELECT request_id FROM private.guest_plant_requests')).rows).toEqual([{request_id:otherRequest}]);
    expect((await db.query('SELECT request_id FROM private.guest_plant_uploads')).rows).toEqual([{request_id:otherRequest}]);
  });
  it('does not accept a temp scope/GUC spoof, real-asset scope, or UPDATE exception',async()=>{
    await db.query(`GRANT USAGE ON SCHEMA private TO authenticated,service_role;
      GRANT SELECT,DELETE,UPDATE ON hgv_inspection_versions TO authenticated,service_role`);
    for(const role of ['authenticated','service_role']){
      await db.query(`SET ROLE ${role}`);
      try{
        await expect(db.query('INSERT INTO private.test_fleet_reset_scope VALUES(txid_current(),$1,$2)',[check,test])).rejects.toThrow('permission denied');
        await db.query("SELECT set_config('app.test_fleet_reset','true',false)");
        await db.query('CREATE TEMP TABLE test_fleet_reset_scope(transaction_id bigint,inspection_id uuid,hgv_id uuid)');
        await db.query('INSERT INTO test_fleet_reset_scope VALUES(txid_current(),$1,$2)',[check,test]);
        await expect(db.query('DELETE FROM hgv_inspection_versions WHERE inspection_id=$1',[check])).rejects.toThrow('append-only');
        await db.query('DROP TABLE test_fleet_reset_scope');
      }finally{await db.query('RESET ROLE');}
    }
    await db.query('BEGIN');
    await db.query('INSERT INTO private.test_fleet_reset_scope VALUES(txid_current(),$1,$2)',[realCheck,test]);
    await expect(db.query('DELETE FROM hgv_inspection_versions WHERE inspection_id=$1',[realCheck])).rejects.toThrow('append-only');
    await db.query('ROLLBACK');
    await expect(db.query('UPDATE hgv_inspection_versions SET revision=2')).rejects.toThrow('append-only');
  });
  it('refuses a same-named index with a different definition without replacing it',async()=>{
    await db.query(`DROP INDEX public.${TEST_FLEET_AUDIT_INDEX_NAME}`);
    await db.query(`CREATE INDEX ${TEST_FLEET_AUDIT_INDEX_NAME} ON audit_log(record_id)`);
    await expect(ensureTestFleetAuditIndex(db)).rejects.toThrow('differs from the reviewed definition');
    const row=(await db.query('SELECT indexdef FROM pg_indexes WHERE indexname=$1',[TEST_FLEET_AUDIT_INDEX_NAME])).rows[0];
    expect(row.indexdef).toContain('USING btree');
  });
});
