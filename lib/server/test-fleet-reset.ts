import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { TEST_FLEET_AUDIT_KEYS, TEST_FLEET_AUDIT_PREDICATE_SQL, TEST_FLEET_AUDIT_REFERENCES_SQL, TEST_FLEET_AUDIT_TABLES } from './test-fleet-audit-index';

export const TEST_ASSETS = [
  { kind: 'van', table: 'vans', column: 'reg_number', label: 'TE57 VAN', foreignKey: 'van_id' },
  { kind: 'hgv', table: 'hgvs', column: 'reg_number', label: 'TE57 HGV', foreignKey: 'hgv_id' },
  { kind: 'plant', table: 'plant', column: 'plant_id', label: 'TE57', foreignKey: 'plant_id' },
] as const;
export type TestAsset = { id: string; kind: string; label: string };
export class TestFleetResetError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
type DB = Pick<pg.Client, 'query'>;
type Row = { tid: string; data: Record<string, unknown> };
type Relation = { schema: string; name: string; columns: string[]; types:string[] };
type FK = { child: string; parent: string; child_columns: string[]; parent_columns: string[] };
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const sqlName = (name: string) => name.split('.').map(quote).join('.');
const masters = new Set(TEST_ASSETS.map(a => `public.${a.table}`));
const retained = new Set([...masters,'public.inventory_locations']);
// Deliberately closed: a new module/reference requires an explicit ownership
// review. Inventory/external documents and shared allocation containers block.
const owned = new Set([
  'van_inspections','hgv_inspections','plant_inspections','inspection_items','inspection_photos',
  'inspection_daily_hours','hgv_inspection_versions','hgv_defect_observations',
  'actions','workshop_task_comments','workshop_task_attachments','workshop_attachment_field_responses',
  'workshop_attachment_responses','workshop_attachment_corrections','workshop_task_check_photos',
  'asset_service_events','vehicle_maintenance','maintenance_history','dvla_sync_log','mot_test_history',
  'inspection_orphan_children_archive','profile_fleet_assignments','workshop_attachment_schema_snapshots',
  'reminder_actions','reminders','van_archive','plant_service_intervals',
  'daily_plant_allocation_drafts','daily_allocation_visit_plant',
  'daily_allocation_conflict_overrides','audit_log',
].map(name => `public.${name}`).concat([
  'private.guest_plant_requests','private.guest_plant_uploads','private.daily_check_effects',
  'private.daily_check_storage_cleanup','private.daily_allocation_plant_day_jobs',
]));

export async function listTestAssets(db: DB): Promise<TestAsset[]> {
  const assets: TestAsset[] = [];
  for (const spec of TEST_ASSETS) {
    const rows = await db.query(`SELECT id FROM public.${quote(spec.table)} WHERE ${quote(spec.column)}=$1`, [spec.label]);
    if (rows.rows.length > 1) throw new TestFleetResetError(`Duplicate ${spec.label} identifiers must be resolved first.`);
    for (const row of rows.rows) assets.push({ id: row.id, kind: spec.kind, label: spec.label });
  }
  return assets;
}

export async function resetTestFleet(connection: DB, input: {
  assetIds: string[]; actorId: string; fingerprint?: string; execute?: boolean;
}) {
  if(input.assetIds.length!==1)throw new TestFleetResetError('Select one exact registered test asset.',400);
  const deadline = Date.now()+20_000;
  const db = {query: ((...args: Parameters<DB['query']>) => {
    if (Date.now()>deadline) throw new TestFleetResetError('Reset exceeded its time limit. No records were reset; try again when the system is quiet.');
    return connection.query(...args);
  }) as DB['query']};
  await db.query(input.execute?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await db.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s'");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('test-fleet-reset',0))");
    const catalog = await db.query<Relation>(`SELECT n.nspname AS schema,c.relname AS name,
      array_agg(a.attname::text ORDER BY a.attnum) AS columns,
      array_agg(format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum) AS types FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
      GROUP BY n.nspname,c.relname`);
    const relations = new Map(catalog.rows.map(r => [`${r.schema}.${r.name}`, r]));
    const matches=(name:string,column:string,param=1)=>{
      const relation=relations.get(name)!;
      return `t.${quote(column)}=ANY($${param}::${relation.types[relation.columns.indexOf(column)]}[])`;
    };
    if (input.execute && !relations.has('private.test_fleet_reset_scope')) throw new TestFleetResetError('Test Fleet reset migration is not installed.', 503);
    const fks = (await db.query<FK>(`SELECT cn.nspname||'.'||cc.relname AS child,pn.nspname||'.'||pc.relname AS parent,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS child_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS parent_columns
      FROM pg_constraint c JOIN pg_class cc ON cc.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=cc.relnamespace
      JOIN pg_class pc ON pc.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=pc.relnamespace
      WHERE c.contype='f' AND pn.nspname IN ('public','private')`)).rows;
    // Rare administrative operation: short, ordered table locks close legacy
    // non-FK writer races. Timeout rolls everything back; no partial purge.
    const referenceColumns=['van_id','hgv_id','plant_id','inspection_id','task_id'];
    const locked = [...new Set([...owned, ...retained,
      ...[...relations].filter(([name,rel])=>name!=='private.test_fleet_reset_scope' && rel.columns.some(c=>referenceColumns.includes(c))).map(([name])=>name),
      ...fks.filter(f=>owned.has(f.parent)||retained.has(f.parent)).map(f=>f.child),
    ])].filter(n => relations.has(n)).sort();
    if (input.execute) await db.query(`LOCK TABLE ${locked.map(sqlName).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
    const assets = (await listTestAssets(db)).filter(a => input.assetIds.includes(a.id));
    if (!assets.length || assets.length !== new Set(input.assetIds).size || assets.length !== input.assetIds.length) {
      throw new TestFleetResetError('Select only the exact registered test assets.', 400);
    }
    const selected = new Map<string, Map<string, Row>>();
    const predicates = new Map<string,{name:string;predicate:string;params:unknown[]}>();
    const scanned=new Set<string>();
    const blockers = new Set<string>();
    const collect = async (name: string, predicate: string, params: unknown[]) => {
      if (!relations.has(name)) return;
      const key=JSON.stringify([name,predicate,params]);
      if(scanned.has(key))return;
      scanned.add(key);
      if (owned.has(name)) predicates.set(key,{name,predicate,params});
      const rows = (await db.query<Row>(`SELECT t.ctid::text AS tid,to_jsonb(t) AS data FROM ${sqlName(name)} t WHERE ${predicate} LIMIT 10001`, params)).rows;
      if(rows.length>10000)throw new TestFleetResetError('Reset exceeds 10,000 records; use a reviewed maintenance operation.');
      if (!rows.length) return;
      if (!owned.has(name) && !retained.has(name)) { blockers.add(`Unsupported related records: ${name}`); return; }
      const target = selected.get(name) ?? new Map<string, Row>();
      for (const row of rows) {
        // No record with a second, real fleet owner may be consumed transitively.
        for (const spec of TEST_ASSETS) {
          if (masters.has(name)) continue;
          for(const value of [row.data[spec.foreignKey],row.data[`linked_${spec.foreignKey}`]]) {
            if (value && !assets.some(a => a.kind===spec.kind && a.id===value)) blockers.add(`Shared asset record: ${name}`);
          }
        }
        target.set(row.tid,row);
      }
      selected.set(name,target);
    };
    const matchedValues=new Map<string,Set<string>>();
    const collectMatches=async(name:string,column:string,values:unknown[])=>{
      const key=`${name}.${column}`,seen=matchedValues.get(key)??new Set<string>();
      const pending=values.filter(value=>value!==null&&value!==undefined&&!seen.has(String(value)));
      if(!pending.length)return;
      pending.forEach(value=>seen.add(String(value)));matchedValues.set(key,seen);
      await collect(name,matches(name,column),[[...new Set(pending)]]);
    };
    const seenAuditReferences=new Set<string>();
    const collectAuditReferences=async(ids:string[])=>{
      const pending=[...new Set(ids)].filter(id=>!seenAuditReferences.has(id));
      for(let start=0;start<pending.length;start+=16){
        const batch=pending.slice(start,start+16);
        await collect('public.audit_log',`${TEST_FLEET_AUDIT_PREDICATE_SQL} AND ${TEST_FLEET_AUDIT_REFERENCES_SQL} && $1::text[]`,[batch]);
        batch.forEach(id=>seenAuditReferences.add(id));
      }
    };
    for (const spec of TEST_ASSETS) {
      const ids = assets.filter(a => a.kind===spec.kind).map(a => a.id);
      if (!ids.length) continue;
      await collectMatches(`public.${spec.table}`,'id',ids);
      for (const [name, rel] of relations) {
        if (masters.has(name) || name==='private.test_fleet_reset_scope') continue;
        if (rel.columns.includes(spec.foreignKey)) await collectMatches(name,spec.foreignKey,ids);
        // Journals and deleted-parent evidence have no asset FK.
        if (name==='public.hgv_inspection_versions' && spec.kind==='hgv') {
          await collect(name, "t.snapshot #>> '{inspection,hgv_id}'=ANY($1::text[])", [ids]);
        }
        if (name==='public.audit_log') await collectAuditReferences(ids);
        if (name==='private.daily_check_effects') await collect(name,
          `(t.before_row->>'${spec.foreignKey}'=ANY($1::text[]) OR t.after_row->>'${spec.foreignKey}'=ANY($1::text[]))`, [ids]);
      }
      if (spec.kind==='van' && relations.has('public.van_archive')) await collect('public.van_archive','t.reg_number=$1',[spec.label]);
    }
    const idsFor = (...names: string[]) => [...new Set(names.flatMap(name => [
      ...[...(selected.get(name)?.values() ?? [])].map(r => String(r.data.id ?? r.data.inspection_id)),
      ...[...(selected.get('public.audit_log')?.values()??[])].filter(({data})=>
        `public.${data.table_name}`===name || (name==='public.vans'&&data.table_name==='vehicles') ||
        (name==='public.van_inspections'&&data.table_name==='vehicle_inspections')).map(({data})=>String(data.record_id)),
      ...[...(selected.get('public.inspection_orphan_children_archive')?.values()??[])].filter(({data})=>`public.${data.child_table}`===name).map(({data})=>String(data.child_id)),
    ].filter(v => /^[a-f0-9-]{36}$/i.test(v))))];
    const inspectionIds = () => [...new Set([
      ...idsFor('public.van_inspections','public.hgv_inspections','public.plant_inspections','public.hgv_inspection_versions'),
      ...[...(selected.get('public.audit_log')?.values() ?? [])].flatMap(({data})=>{
        const changes=data.changes as {inspection?:{id?:string}}|undefined;
        return ['vehicle_inspections','van_inspections','hgv_inspections','plant_inspections'].includes(String(data.table_name)) ? [String(changes?.inspection?.id ?? data.record_id)] : [];
      }),
    ])];
    let size = -1;
    for (let pass=0; pass<20; pass++) {
      const nextSize = [...selected.values()].reduce((n,m) => n+m.size,0);
      if (nextSize===size) break;
      if (pass===19) throw new TestFleetResetError('Related records exceed the supported dependency depth.');
      size=nextSize;
      if (size>10000) throw new TestFleetResetError('Reset exceeds 10,000 records; use a reviewed maintenance operation.');
      for (const fk of fks) {
        const parentRows = [...(selected.get(fk.parent)?.values() ?? [])];
        if (!parentRows.length || fk.child==='private.test_fleet_reset_scope') continue;
        const values = parentRows.map(r => Object.fromEntries(fk.parent_columns.map((col,i) => [fk.child_columns[i],r.data[col]])));
        if (fk.child_columns.length===1 && relations.has(fk.child)) {
          await collectMatches(fk.child,fk.child_columns[0],values.map(v=>v[fk.child_columns[0]]));
        } else await collect(fk.child, `EXISTS(SELECT 1 FROM jsonb_array_elements($1::jsonb) p WHERE ${fk.child_columns.map(c => `t.${quote(c)}::text=p->>'${c}'`).join(' AND ')})`, [JSON.stringify(values)]);
      }
      const checks = inspectionIds();
      const tasks = idsFor('public.actions');
      const auditReferences=idsFor(...TEST_FLEET_AUDIT_TABLES.map(name=>`public.${name}`));
      await collectAuditReferences(auditReferences);
      for (const [name, rel] of relations) {
        if (masters.has(name) || name==='private.test_fleet_reset_scope') continue;
        if (rel.columns.includes('inspection_id') && checks.length) await collectMatches(name,'inspection_id',checks);
        if (rel.columns.includes('task_id') && tasks.length) await collectMatches(name,'task_id',tasks);
        if (name==='private.daily_check_storage_cleanup' && checks.length) await collectMatches(name,'source_id',checks);
        if (name==='private.daily_check_effects') {
          await collectMatches(name,'source_id',checks);
          await collectMatches(name,'target_id',idsFor('public.vehicle_maintenance','public.hgvs','public.actions','public.reminders','public.reminder_actions'));
        }
        if (name==='public.audit_log') for(const selectedName of new Set([...selected.keys(),...TEST_FLEET_AUDIT_TABLES.map(table=>`public.${table}`)])) {
          if(!selectedName.startsWith('public.')||selectedName===name)continue;
          const tableName=selectedName.slice(7);
          const tableNames=tableName==='vans'?['vans','vehicles']:tableName==='van_inspections'?['van_inspections','vehicle_inspections']:[tableName];
          const recordIds=['vehicle_inspections','van_inspections','hgv_inspections','plant_inspections'].includes(tableName)?checks:idsFor(selectedName);
          const key=`audit-record:${tableName}`,seen=matchedValues.get(key)??new Set<string>();
          const pending=recordIds.filter(id=>!seen.has(id));
          if(pending.length){
            await collect(name,"t.action<>'test_fleet_reset' AND t.table_name=ANY($1::text[]) AND t.record_id=ANY($2::uuid[])",[tableNames,pending]);
            pending.forEach(id=>seen.add(id));matchedValues.set(key,seen);
          }
        }
      }
      for (const request of selected.get('private.guest_plant_requests')?.values() ?? []) {
        await collect('private.guest_plant_uploads','t.session_id::text=$1 AND t.request_id::text=$2',[request.data.session_id,request.data.request_id]);
      }
    }
    // Non-FK task references can otherwise consume evidence of a real HGV.
    const hgvIds = assets.filter(a=>a.kind==='hgv').map(a=>a.id);
    for (const row of selected.get('public.hgv_inspection_versions')?.values() ?? []) {
      const snapshot=row.data.snapshot as {inspection?:{hgv_id?:string}};
      if (!snapshot?.inspection?.hgv_id || !hgvIds.includes(snapshot.inspection.hgv_id)) blockers.add('HGV evidence has a different or unknown asset owner.');
    }
    const checkIds = new Set(inspectionIds());
    for (const spec of TEST_ASSETS) {
      const checkTable=`public.${spec.kind}_inspections`;
      if (!relations.has(checkTable)) continue;
      const owners=await db.query(`SELECT ${quote(spec.foreignKey)}::text AS asset_id FROM ${sqlName(checkTable)} WHERE id::text=ANY($1::text[])`,[[...checkIds]]);
      if (owners.rows.some(row=>!assets.some(a=>a.kind===spec.kind && a.id===row.asset_id))) blockers.add('Historical test check now belongs to another asset.');
    }
    const taskIds = new Set(idsFor('public.actions'));
    for(const {data} of selected.get('public.inspection_orphan_children_archive')?.values()??[]) {
      const snapshot=data.row_snapshot as Record<string,unknown>|null;
      if(!snapshot || snapshot.id!==data.child_id || snapshot.inspection_id!==data.inspection_id ||
        !['inspection_items','inspection_photos'].includes(String(data.child_table))) {
        blockers.add('Archived inspection child has inconsistent ownership evidence.');continue;
      }
    }
    for(const childTable of ['inspection_items','inspection_photos']) {
      const archive=[...(selected.get('public.inspection_orphan_children_archive')?.values()??[])].filter(({data})=>data.child_table===childTable);
      if(!archive.length)continue;
      const current=await db.query(`SELECT id,inspection_id::text AS inspection_id FROM ${sqlName(`public.${childTable}`)} WHERE id=ANY($1::uuid[])`,[archive.map(({data})=>data.child_id)]);
      if(current.rows.some(row=>archive.some(({data})=>row.id===data.child_id&&row.inspection_id!==data.inspection_id)))blockers.add('Archived inspection child now belongs to another check.');
    }
    for (const table of TEST_FLEET_AUDIT_TABLES) {
      const name=`public.${table}`,rel=relations.get(name);
      if(!rel?.columns.includes('id')||!owned.has(name))continue;
      const idList=idsFor(name);if(!idList.length)continue;
      for(const spec of TEST_ASSETS) {
        if(!rel.columns.includes(spec.foreignKey))continue;
        const owners=await db.query(`SELECT ${quote(spec.foreignKey)}::text AS asset_id FROM ${sqlName(name)} t WHERE ${matches(name,'id')} AND ${quote(spec.foreignKey)} IS NOT NULL`,[idList]);
        if(owners.rows.some(row=>!assets.some(a=>a.kind===spec.kind&&a.id===row.asset_id)))blockers.add(`Historical record now belongs to another asset: ${name}`);
      }
    }
    for (const [name,rows] of selected) {
      if (masters.has(name)) continue;
      for (const {data} of rows.values()) {
        for (const key of ['inspection_id','parent_check_id','daily_check_source_id']) {
          if (data[key] && !checkIds.has(String(data[key]))) blockers.add(`Unknown or shared check reference: ${name}.${key}`);
        }
        if (data.task_id && !taskIds.has(String(data.task_id))) blockers.add(`Unknown or shared workshop reference: ${name}.task_id`);
        if (name==='public.audit_log') {
          const changes=data.changes as Record<string,unknown>|null;
          for (const key of TEST_FLEET_AUDIT_KEYS) {
            const spec=TEST_ASSETS.find(s=>s.foreignKey===key || (s.kind==='van'&&key==='vehicle_id'));
            const value=changes?.[key];
            const witnesses=typeof value==='string'?[value]:value && typeof value==='object'?Object.values(value):[];
            const inspection=changes?.inspection as Record<string,unknown>|undefined;
            if(inspection?.[key])witnesses.push(inspection[key]);
            if(spec && witnesses.some(id=>id && !assets.some(a=>(key==='vehicle_id'?a.kind!=='plant':a.kind===spec.kind)&&a.id===id))) blockers.add('Historical audit includes a different asset owner.');
            const referenceIds=key==='inspection_id'?checkIds:key==='task_id'||key==='action_id'?taskIds:
              key==='attachment_id'?new Set(idsFor('public.workshop_task_attachments')):
              key==='inspection_item_id'?new Set(idsFor('public.inspection_items')):null;
            if(referenceIds && witnesses.some(id=>id && !referenceIds.has(String(id)))) blockers.add(`Unknown or shared historical reference: ${key}`);
          }
        }
        if(name==='private.daily_check_effects') {
          for(const snapshot of [data.before_row,data.after_row]) {
            if(!snapshot||typeof snapshot!=='object')continue;
            for(const spec of TEST_ASSETS) {
              const witness=(snapshot as Record<string,unknown>)[spec.foreignKey];
              if(witness && !assets.some(a=>a.kind===spec.kind&&a.id===witness))blockers.add('Daily check journal includes a different asset owner.');
            }
          }
          const targetName=`public.${data.target_table}`;
          if(data.target_id && !idsFor(targetName).includes(String(data.target_id))) {
            blockers.add('Daily check journal has an unknown or shared target.');
          }
          if(data.source_id && !checkIds.has(String(data.source_id)))blockers.add('Daily check journal has an unknown or shared check.');
        }
        for (const fk of fks.filter(f=>f.child===name && owned.has(f.parent))) {
          if (fk.child_columns.some(col=>data[col]===null||data[col]===undefined)) continue;
          const parents=[...(selected.get(fk.parent)?.values()??[])];
          if (!parents.some(parent=>fk.parent_columns.every((col,i)=>String(parent.data[col])===String(data[fk.child_columns[i]])))) {
            blockers.add(`Unknown or shared parent record: ${name} → ${fk.parent}`);
          }
        }
      }
    }
    const counts: Record<string,number> = Object.fromEntries([...selected].filter(([name])=>!retained.has(name)).map(([name,rows])=>[name,rows.size]).sort(([a],[b])=>String(a).localeCompare(String(b))));
    const fingerprint = createHash('sha256').update(JSON.stringify([...selected].sort(([a],[b])=>a.localeCompare(b)).map(([name,rows])=>[name,[...rows.values()].map(r=>JSON.stringify(r.data)).sort()]))).digest('hex');
    const preview = { assets, counts, blockers:[...blockers].sort(), fingerprint, total:Object.values(counts).reduce((sum,n)=>sum+Number(n),0) };
    if (!input.execute) { await db.query('ROLLBACK'); return preview; }
    if (blockers.size) throw new TestFleetResetError([...blockers].join('; '));
    if (fingerprint!==input.fingerprint) throw new TestFleetResetError('Records changed since preview. Preview again before resetting.');
    const historyScope=[];
    for (const name of ['public.hgv_inspection_versions','public.hgv_inspections']) for (const row of selected.get(name)?.values() ?? []) {
      const snapshot=row.data.snapshot as {inspection:{hgv_id:string}}|undefined;
      historyScope.push({inspection_id:row.data.inspection_id??row.data.id,hgv_id:snapshot?.inspection.hgv_id??row.data.hgv_id});
    }
    if(historyScope.length)await db.query(`INSERT INTO private.test_fleet_reset_scope(transaction_id,inspection_id,hgv_id)
      SELECT txid_current(),s.inspection_id,s.hgv_id FROM jsonb_to_recordset($1::jsonb) s(inspection_id uuid,hgv_id uuid) ON CONFLICT DO NOTHING`,[JSON.stringify(historyScope)]);
    const pending = new Set([...selected.keys()].filter(n=>!retained.has(n)));
    // Explicit non-FK ordering, in addition to the actual FK dependency graph.
    const dependencies = [...fks,
      {child:'public.hgv_defect_observations',parent:'public.hgv_inspection_versions'},
      {child:'public.hgv_defect_observations',parent:'public.workshop_task_comments'},
      {child:'public.hgv_defect_observations',parent:'public.hgv_inspections'},
      ...['inspection_items','inspection_photos','inspection_daily_hours','hgv_inspection_versions'].flatMap(child=>['van_inspections','hgv_inspections','plant_inspections'].map(parent=>({child:`public.${child}`,parent:`public.${parent}`}))),
    ];
    while (pending.size) {
      const ready = [...pending].filter(name=>!dependencies.some(f=>f.parent===name && f.child!==name && pending.has(f.child)));
      if (!ready.length) throw new TestFleetResetError('Related records contain a dependency cycle; no records were reset.');
      for (const name of ready) {
        await db.query(`DELETE FROM ${sqlName(name)} WHERE ctid=ANY($1::tid[])`,[[...selected.get(name)!.keys()]]);
        pending.delete(name);
      }
    }
    // DELETE audit triggers are intentionally left enabled. Remove their scoped
    // output as well as older snapshots; only the new cleanup receipt survives.
    for(const name of selected.keys()) if(name.startsWith('public.')&&name!=='public.audit_log') {
      await db.query("DELETE FROM public.audit_log WHERE action<>'test_fleet_reset' AND table_name=$1 AND record_id=ANY($2::uuid[])",[name.slice(7),idsFor(name)]);
    }
    // Triggers may update/delete other selected rows, changing their physical
    // identity. Never report success while any scoped record survives.
    for (const {name,predicate,params} of predicates.values()) {
      const remaining=await db.query(`SELECT 1 FROM ${sqlName(name)} t WHERE ${predicate} LIMIT 1`,params);
      if (remaining.rows.length) throw new TestFleetResetError(`Related records remain in ${name}; no reset was committed.`);
    }
    await db.query('DELETE FROM private.test_fleet_reset_scope WHERE transaction_id=txid_current()');
    const receiptId=randomUUID();
    await db.query(`INSERT INTO public.audit_log(table_name,record_id,user_id,action,changes)
      VALUES('test_fleet',$1,$2,'test_fleet_reset',$3::jsonb)`,[receiptId,input.actorId,JSON.stringify({assets,counts,storage_files_retained:true})]);
    await db.query('COMMIT');
    return {...preview,receiptId};
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
}
