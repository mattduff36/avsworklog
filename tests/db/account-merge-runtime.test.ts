import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema, encryptedFileBackup, fence, hash, inspect, merge, profileHash, readCatalog, retireAuth, verify,
  type Dependencies, type MergeConfig, type Snapshot } from '../../scripts/maintenance/merge-user-accounts';
import { DATABASE_COMMENT_PREFIX, PROJECT_NAME_HASH_LENGTH, PROJECT_NAME_PREFIX, PROVENANCE_ENV_KEYS, STATE_VERSION,
  isInheritedDatabaseUrlKey, validateLocalTestDatabaseUrl } from '../../scripts/local-test-postgres';

const source=randomUUID(),target=randomUUID(),other=randomUUID(),reason=randomUUID();
const absenceIds=Array.from({length:29},()=>randomUUID());
const duplicateIds=Array.from({length:7},()=>randomUUID());
const recipientId=randomUUID(),messageId=randomUUID(),trainingId=randomUUID(),shiftId=randomUUID();
const timesheetIds=Array.from({length:33},()=>randomUUID());
let db:Client;let observer:Client;let temp:string;let c:MergeConfig;let deps:Dependencies;
let snapshots:Snapshot[]=[];let deletes=0;

function definition(file:string,name:string):string {
  const text=readFileSync(path.resolve('supabase','migrations',file),'utf8');
  const start=new RegExp(`CREATE OR REPLACE FUNCTION (?:public\\.|private\\.)?${name}\\(`,'u').exec(text);
  if(!start) throw new Error(`Missing source function ${name}`);
  const end=text.indexOf('$$;',start.index);if(end<0) throw new Error('Missing source function terminator');
  return text.slice(start.index,end+3);
}
async function loadRealGuards():Promise<void> {
  for(const [file,name] of [
    ['20260907230000_delete_user_keep_data_annual_leave.sql','guard_profile_deleted_at_immutability'],
    ['20260907230000_delete_user_keep_data_annual_leave.sql','guard_absence_deleted_profile_write'],
    ['20260313_absence_fy_apr1_cutover.sql','absence_financial_year_start_year'],
    ['20260313_absence_fy_apr1_cutover.sql','absence_is_closed_financial_year'],
    ['20260312_absence_fy_archival.sql','guard_absence_closed_financial_year_mutation'],
    ['20260326_absence_year_closure_carryover_flow.sql','is_absence_financial_year_closed'],
    ['20260819190000_system_accounts_allowance_exclusions.sql','recalculate_financial_year_carryover_for_profile'],
    ['20260326_absence_year_closure_carryover_flow.sql','recalculate_closed_year_carryover_after_absence_change'],
    ['20260806_permission_alignment_absence_profile_lock.sql','prevent_absence_profile_reassignment'],
    ['20260804_absence_historic_delete_guard.sql','guard_absence_historic_delete'],
    ['20260401_absence_processed_status_workflow.sql','validate_absence_conflict'],
    ['20260806_permission_alignment_review_hardening.sql','prevent_message_recipient_reassignment'],
    ['20260813_zzz_daily_allocation_v2_visit_model.sql','guard_daily_allocation_recipient_mutation'],
    ['20261102_preserve_submitted_plant_check_job_snapshot.sql','guard_plant_inspection_job_fields'],
    ['20260903_timesheet_dual_gate_approval.sql','guard_timesheet_payroll_approval'],
  ]) await db.query(definition(file,name));
  const audit=readFileSync(path.resolve('supabase','enable-audit-logging.sql'),'utf8');
  await db.query(audit.slice(audit.indexOf('CREATE OR REPLACE FUNCTION log_audit_changes()'),audit.indexOf('$$ LANGUAGE plpgsql SECURITY DEFINER;')+37));
  await db.query(`
    CREATE TRIGGER deleted_profile_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_deleted_at_immutability();
    CREATE TRIGGER deleted_absence_guard BEFORE INSERT OR UPDATE OF profile_id ON public.absences FOR EACH ROW EXECUTE FUNCTION guard_absence_deleted_profile_write();
    CREATE TRIGGER closed_year BEFORE UPDATE OR DELETE ON public.absences FOR EACH ROW EXECUTE FUNCTION guard_absence_closed_financial_year_mutation();
    CREATE TRIGGER historic_delete BEFORE DELETE ON public.absences FOR EACH ROW EXECUTE FUNCTION guard_absence_historic_delete();
    CREATE TRIGGER owner_lock BEFORE UPDATE ON public.absences FOR EACH ROW EXECUTE FUNCTION prevent_absence_profile_reassignment();
    CREATE TRIGGER conflict BEFORE INSERT OR UPDATE ON public.absences FOR EACH ROW EXECUTE FUNCTION validate_absence_conflict();
    CREATE TRIGGER carryover AFTER INSERT OR UPDATE OR DELETE ON public.absences FOR EACH ROW EXECUTE FUNCTION recalculate_closed_year_carryover_after_absence_change();
    CREATE TRIGGER recipient_lock BEFORE UPDATE ON public.message_recipients FOR EACH ROW EXECUTE FUNCTION prevent_message_recipient_reassignment();
    CREATE TRIGGER allocation_recipient BEFORE INSERT OR UPDATE OR DELETE ON public.message_recipients FOR EACH ROW EXECUTE FUNCTION private.guard_daily_allocation_recipient_mutation();
    CREATE TRIGGER plant_job BEFORE UPDATE ON public.plant_inspections FOR EACH ROW EXECUTE FUNCTION private.guard_plant_inspection_job_fields();
    CREATE TRIGGER payroll BEFORE UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION guard_timesheet_payroll_approval();
    CREATE TRIGGER profile_audit AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION log_audit_changes();
    CREATE TRIGGER absence_audit AFTER INSERT OR UPDATE OR DELETE ON public.absences FOR EACH ROW EXECUTE FUNCTION log_audit_changes();
    CREATE TRIGGER timesheet_audit AFTER INSERT OR UPDATE OR DELETE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION log_audit_changes();
  `);
}
async function batch(statements:readonly string[],values:unknown[]):Promise<void> {
  for(const statement of statements) {
    const params:unknown[]=[];
    const sql=statement.replace(/\$(\d+)/gu,(_match,n:string)=>{params.push(values[Number(n)-1]);return `$${params.length}`;});
    await db.query(sql,params);
  }
}
async function fixture():Promise<void> {
  await db.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
  await db.query(`DROP SCHEMA IF EXISTS private CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS storage CASCADE;
    DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.effective_is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,encrypted_password text,banned_until timestamptz,email text);
    CREATE TABLE auth.identities(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,identity_data jsonb);
    CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),employee_id text UNIQUE,full_name text,
      role text,must_change_password boolean DEFAULT false,role_id uuid DEFAULT gen_random_uuid(),super_admin boolean DEFAULT false,team_id text,line_manager_id uuid REFERENCES public.profiles(id),secondary_manager_id uuid REFERENCES public.profiles(id),
      annual_holiday_allowance_days numeric(4,2) DEFAULT 28,is_system_account boolean DEFAULT false,deleted_at timestamptz,
      phone_number text,emergency_contact_name text,employer_profile_notes text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE public.absence_reasons(id uuid PRIMARY KEY,name text,created_at timestamptz DEFAULT now());
    CREATE TABLE public.absences(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),created_by uuid REFERENCES public.profiles(id),
      reason_id uuid REFERENCES public.absence_reasons(id),date date,end_date date,duration_days numeric(4,2),status text,
      is_half_day boolean DEFAULT false,half_day_session text,is_bank_holiday boolean DEFAULT false,holiday_key text UNIQUE,
      notes text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE public.absences_archive(LIKE public.absences INCLUDING ALL);
    ALTER TABLE public.absences_archive ADD FOREIGN KEY(profile_id) REFERENCES public.profiles(id);
    ALTER TABLE public.absences_archive ADD FOREIGN KEY(created_by) REFERENCES public.profiles(id);
    CREATE TABLE public.absence_financial_year_closures(id uuid PRIMARY KEY,financial_year_start_year int UNIQUE);
    CREATE TABLE public.absence_allowance_carryovers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),profile_id uuid REFERENCES public.profiles(id),
      financial_year_start_year int,source_financial_year_start_year int,carried_days numeric(6,2),auto_generated boolean,generation_source text,
      generated_at timestamptz DEFAULT now(),generated_by uuid REFERENCES public.profiles(id),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
      UNIQUE(profile_id,financial_year_start_year));
    CREATE TABLE public.absence_financial_year_close_snapshot_rows(id uuid PRIMARY KEY,carryover_id uuid,
      profile_id uuid REFERENCES public.profiles(id),generated_by uuid REFERENCES public.profiles(id));
    CREATE TABLE public.audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),table_name text,record_id uuid,
      user_id uuid REFERENCES public.profiles(id),action text,changes jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE public.messages(id uuid PRIMARY KEY,sender_id uuid REFERENCES public.profiles(id),body text,
      daily_allocation_labour_item_id uuid,daily_allocation_publication_id uuid);
    CREATE TABLE public.message_recipients(id uuid PRIMARY KEY,message_id uuid REFERENCES public.messages(id),user_id uuid REFERENCES public.profiles(id),
      status text,signature_data text,signed_at timestamptz,created_at timestamptz,updated_at timestamptz,UNIQUE(message_id,user_id));
    CREATE TABLE public.daily_allocation_labour_items(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id));
    CREATE TABLE public.daily_allocation_publication_notifications(id uuid PRIMARY KEY,message_id uuid REFERENCES public.messages(id),profile_id uuid REFERENCES public.profiles(id));
    CREATE TABLE public.employee_work_shifts(id uuid PRIMARY KEY,profile_id uuid UNIQUE REFERENCES public.profiles(id),template_id uuid,
      monday_am boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE public.user_module_permissions(id uuid PRIMARY KEY,user_id uuid REFERENCES public.profiles(id),module_name text,access_level int);
    CREATE TABLE public.profile_reporting_lines(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),manager_profile_id uuid REFERENCES public.profiles(id),
      relation_type text,valid_to timestamptz,CHECK(profile_id<>manager_profile_id),UNIQUE(profile_id,manager_profile_id,relation_type));
    CREATE TABLE public.profile_team_memberships(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),team_id text,valid_to timestamptz);
    CREATE UNIQUE INDEX active_membership ON public.profile_team_memberships(profile_id) WHERE valid_to IS NULL;
    CREATE TABLE public.org_teams(id text PRIMARY KEY,manager_1_profile_id uuid REFERENCES public.profiles(id));
    CREATE TABLE public.webauthn_devices(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),revoked_at timestamptz,device_id_hash text);
    CREATE TABLE public.app_auth_sessions(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),device_id uuid REFERENCES public.webauthn_devices(id),
      revoked_at timestamptz,session_secret_hash text);
    CREATE TABLE public.webauthn_credentials(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),device_id uuid REFERENCES public.webauthn_devices(id),
      revoked_at timestamptz,credential_id text,public_key text);
    CREATE TABLE public.webauthn_challenges(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),device_id uuid REFERENCES public.webauthn_devices(id),challenge text);
    CREATE TABLE public.webauthn_prompt_preferences(profile_id uuid REFERENCES public.profiles(id),device_id uuid REFERENCES public.webauthn_devices(id),dismissed_at timestamptz,PRIMARY KEY(profile_id,device_id));
    CREATE TABLE public.profile_sensitive_pins(profile_id uuid PRIMARY KEY REFERENCES public.profiles(id),pin_hash text,pin_salt text);
    CREATE TABLE public.sensitive_pin_unlocks(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),session_id uuid REFERENCES public.app_auth_sessions(id));
    CREATE TABLE public.sensitive_pin_verification_tokens(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),token_hash text);
    CREATE TABLE public.training_people(id uuid PRIMARY KEY,profile_id uuid UNIQUE REFERENCES public.profiles(id),name text);
    CREATE TABLE public.training_qualifications(id uuid PRIMARY KEY,person_id uuid REFERENCES public.training_people(id),certificate bytea);
    CREATE TABLE public.payroll_rollout_activations(id uuid PRIMARY KEY,effective_week_ending date);
    CREATE TABLE public.timesheets(id uuid PRIMARY KEY,user_id uuid REFERENCES public.profiles(id),manager_approved_by uuid REFERENCES public.profiles(id),
      week_ending date,status text,signature_data text,current_payroll_snapshot_id uuid,UNIQUE(user_id,week_ending));
    CREATE TABLE public.timesheet_payroll_snapshots(id uuid PRIMARY KEY,timesheet_id uuid REFERENCES public.timesheets(id),supersedes_snapshot_id uuid);
    CREATE TABLE public.timesheet_entries(id uuid PRIMARY KEY,timesheet_id uuid REFERENCES public.timesheets(id),hours numeric,signature bytea);
    CREATE TABLE public.external_documents(id uuid PRIMARY KEY,shared_with uuid[],historical jsonb);
    CREATE TABLE public.reminder_actions(id uuid PRIMARY KEY,created_by uuid REFERENCES public.profiles(id),resolved_by uuid REFERENCES public.profiles(id),workflow_key text,metadata jsonb);
    CREATE TYPE private.allocation_job AS(source_type text,source_id uuid,job_code text,site_address text);
    CREATE FUNCTION private.apply_plant_inspection_job_fields(text,uuid,text,boolean) RETURNS private.allocation_job LANGUAGE sql AS $$ SELECT NULL::private.allocation_job $$;
    CREATE TABLE public.plant_inspections(id uuid PRIMARY KEY,user_id uuid REFERENCES public.profiles(id),status text,
      job_source_type text,job_source_id uuid,job_code text,job_site_address text,signature_data bytea);
    CREATE TABLE public.inspection_files(id uuid PRIMARY KEY,inspection_id uuid REFERENCES public.plant_inspections(id),pdf bytea);
    CREATE TABLE public.future_empty(id uuid PRIMARY KEY,subject uuid REFERENCES public.profiles(id),value text);
    CREATE TABLE public.future_partitioned(id uuid PRIMARY KEY,subject uuid REFERENCES public.profiles(id),value text) PARTITION BY HASH(id);
    CREATE TABLE public.future_partitioned_child PARTITION OF public.future_partitioned FOR VALUES WITH(MODULUS 1,REMAINDER 0);
    CREATE TABLE public.account_merge_runs(id uuid PRIMARY KEY,value text);
    CREATE TABLE private.plain_notes(id uuid PRIMARY KEY,value text);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,name text,owner uuid,owner_id text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY allow_fixture ON storage.objects FOR ALL USING(true) WITH CHECK(true);
  `);
  await db.query("INSERT INTO auth.users VALUES ($1,$4,NULL,'source@example.test'),($2,$5,NULL,'target@example.test'),($3,$6,NULL,'other@example.test')",[source,target,other,'old-password-secret','target-password-secret','other-password']);
  await batch([`INSERT INTO auth.identities VALUES ($1,$2,'{"provider":"fixture"}')`, `INSERT INTO auth.audit_log_entries VALUES ($3,jsonb_build_object('actor_id',$2::text))`],[randomUUID(),source,randomUUID()]);
  await db.query(`INSERT INTO public.profiles(id,employee_id,full_name,role,team_id,phone_number,emergency_contact_name,employer_profile_notes)
    VALUES($1,'fixture-employee','Source fixture','employee','old-team','old-phone','source-contact','employment-notes'),
      ($2,NULL,'Target fixture','manager','manager-team','target-phone',NULL,NULL),($3,'other','Other fixture','employee','manager-team',NULL,NULL,NULL)`,[source,target,other]);
  await db.query('UPDATE public.profiles SET line_manager_id=$1 WHERE id=$2',[target,other]);
  await db.query('INSERT INTO public.org_teams VALUES ($1,$2)',['manager-team',target]);
  await db.query('INSERT INTO public.absence_reasons(id,name) VALUES($1,$2)',[reason,'Annual Leave']);
  for(let i=0;i<29;i++) {
    const index=i<14?i:i-14;const year=i<14?2025:2026;
    const date=`${year}-05-${String(1+index%10*3).padStart(2,'0')}`;
    const actualDate=i<14 && index>=10?`${year}-06-${String(1+(index-10)*3).padStart(2,'0')}`:
      i>=14 && index>=10?`${year}-06-${String(1+(index-10)*3).padStart(2,'0')}`:date;
    const key=i<16?`uk-bank-holiday:england-and-wales:${source}:${actualDate}`:null;
    await db.query(`INSERT INTO public.absences(id,profile_id,created_by,reason_id,date,end_date,duration_days,status,is_bank_holiday,holiday_key,notes)
      VALUES($1,$2,$2,$3,$4,$4,2,'processed',$5,$6,'historical bytes')`,[absenceIds[i],source,reason,actualDate,i<16,key]);
    if(i>=14 && i<21) await db.query(`INSERT INTO public.absences(id,profile_id,created_by,reason_id,date,end_date,duration_days,status,is_bank_holiday,holiday_key)
      VALUES($1,$2,$2,$3,$4,$4,2,'approved',$5,$6)`,[duplicateIds[i-14],target,reason,actualDate,i<16,
      i<16?`uk-bank-holiday:england-and-wales:${target}:${actualDate}`:null]);
  }
  await db.query('INSERT INTO public.absence_financial_year_closures VALUES($1,2025)',[randomUUID()]);
  const adjustment=randomUUID();
  await db.query(`INSERT INTO public.absence_allowance_carryovers(id,profile_id,financial_year_start_year,source_financial_year_start_year,carried_days,auto_generated,generation_source)
    VALUES($1,$2,2026,2025,-17,true,'admin-user-onboarding-adjustment')`,[adjustment,target]);
  await batch([`INSERT INTO public.messages VALUES($1,$2,'signed toolbox bytes',NULL,NULL)`,
    `INSERT INTO public.message_recipients VALUES($3,$1,$2,'SIGNED','data:image/png;base64,fixture-signature','2026-01-01T00:00:00Z','2025-01-01T00:00:00Z','2026-01-01T00:00:00Z')`],[messageId,source,recipientId]);
  const template=randomUUID();
  await db.query('INSERT INTO public.employee_work_shifts(id,profile_id,template_id,monday_am) VALUES($1,$2,$5,true),($3,$4,$5,true)',[shiftId,source,randomUUID(),target,template]);
  for(let i=0;i<23;i++) await db.query('INSERT INTO public.user_module_permissions VALUES($1,$2,$3,5)',[randomUUID(),source,`module-${i}`]);
  await db.query('INSERT INTO public.user_module_permissions VALUES($1,$2,$3,4)',[randomUUID(),target,'manager-permission']);
  await batch([`INSERT INTO public.profile_reporting_lines VALUES($1,$2,$3,'primary',NULL),($4,$2,$5,'historic','2024-01-01T00:00:00Z')`,
    `INSERT INTO public.profile_team_memberships VALUES($6,$2,'historic-team','2024-01-01T00:00:00Z'),($7,$3,'manager-team',NULL)`],
    [randomUUID(),source,target,randomUUID(),other,randomUUID(),randomUUID()]);
  for(const user of [source,target]) {
    const device=randomUUID(),session=randomUUID();
    await batch([`INSERT INTO public.webauthn_devices VALUES($1,$2,NULL,'device-hash')`,
      `INSERT INTO public.app_auth_sessions VALUES($3,$2,$1,NULL,'session-secret')`,
      `INSERT INTO public.webauthn_credentials VALUES($4,$2,$1,NULL,'credential-secret','public-key-material')`,
      `INSERT INTO public.webauthn_challenges VALUES($5,$2,$1,'challenge-secret')`,
      `INSERT INTO public.webauthn_prompt_preferences VALUES($2,$1,'2025-01-01T00:00:00Z')`,
      `INSERT INTO public.profile_sensitive_pins VALUES($2,'pin-hash-secret','pin-salt-secret')`,
      `INSERT INTO public.sensitive_pin_unlocks VALUES($6,$2,$3)`,
      `INSERT INTO public.sensitive_pin_verification_tokens VALUES($7,$2,'token-secret')`],
      [device,user,session,randomUUID(),randomUUID(),randomUUID(),randomUUID()]);
  }
  await db.query('INSERT INTO public.training_people VALUES($1,$2,$3)',[trainingId,source,'Training fixture']);
  for(let i=0;i<6;i++) await db.query(`INSERT INTO public.training_qualifications VALUES($1,$2,decode('00ff0120','hex'))`,[randomUUID(),trainingId]);
  for(let i=0;i<33;i++) {
    await db.query(`INSERT INTO public.timesheets VALUES($1,$2,$3,date '2024-01-07'+$4::int*7,'approved','payroll-signature',NULL)`,[timesheetIds[i],source,target,i]);
    for(let j=0;j<7;j++) await db.query(`INSERT INTO public.timesheet_entries VALUES($1,$2,9,decode('00ff0120','hex'))`,[randomUUID(),timesheetIds[i]]);
  }
  const inspection=randomUUID();
  await batch([`INSERT INTO public.plant_inspections VALUES($1,$2,'submitted','legacy',$3,'HISTORIC','historic site',decode('00ff0120','hex'))`,
    `INSERT INTO public.inspection_files VALUES($4,$1,decode('00ff0120','hex'))`,
    `INSERT INTO public.reminder_actions VALUES($5,$2,NULL,'plant_legacy_missing_site',jsonb_build_object('submitted_by',$2::text,'historical',$2::text))`,
    `INSERT INTO public.audit_log(table_name,record_id,user_id,action,changes) VALUES('profiles',$2,$2,'updated',jsonb_build_object('historical',$2::text))`],
    [inspection,source,randomUUID(),randomUUID(),randomUUID()]);
  for(const [name,col] of Object.entries({actions:'created_by',error_logs:'user_id',inventory_user_locations:'user_id',
    profile_fleet_assignments:'user_id',user_page_visits:'user_id',user_usage_events:'user_id',user_usage_sessions:'user_id',van_inspections:'user_id'})) {
    const history=['user_usage_events','user_usage_sessions'].includes(name);
    await db.query(`CREATE TABLE public.${name}(id uuid PRIMARY KEY,${col} uuid REFERENCES public.profiles(id),payload text${history?',app_session_id uuid REFERENCES public.app_auth_sessions(id) ON DELETE SET NULL':''})`);
    await db.query(`INSERT INTO public.${name} VALUES($1,$2,'untouched business bytes'${history?',(SELECT id FROM public.app_auth_sessions WHERE profile_id=$2)':''})`,[randomUUID(),source]);
  }
  for(const name of ['webauthn_audit_events','sensitive_pin_audit_events']) {
    await db.query(`CREATE TABLE public.${name}(id uuid PRIMARY KEY,profile_id uuid REFERENCES public.profiles(id),actor_profile_id uuid REFERENCES public.profiles(id),metadata jsonb)`);
    await db.query(`INSERT INTO public.${name} VALUES($1,$2::uuid,$2::uuid,jsonb_build_object('historical',$2::uuid::text))`,[randomUUID(),source]);
  }
  await loadRealGuards();
  c=ConfigSchema.parse({version:1,runId:randomUUID(),sourceId:source,targetId:target,projectRef:'syntheticproject',
    sourceEmail:'source@example.test',targetEmail:'target@example.test',
    schemaHash:(await readCatalog(db)).hash,sourceProfileHash:'0'.repeat(64),targetProfileHash:'0'.repeat(64),employeeId:'fixture-employee',
    duplicates:duplicateIds.map((id,i)=>({target:id,source:absenceIds[14+i]})),targetAdjustmentId:adjustment,
    expectedSourceAbsences:29,expectedHolidayKeys:16,expectedPermissionOverrides:23,
    holidayYears:[{year:2025,used:28,carryIn:0,balance:0},{year:2026,used:30,carryIn:0,balance:-2}],
    backupPath:path.join(temp,'snapshot'),receiptPath:path.join(temp,'receipt'),backupProtectionReviewed:true});
  const p=(await db.query('SELECT to_jsonb(p) AS data FROM public.profiles p WHERE id=ANY($1::uuid[])',[[source,target]])).rows;
  c.sourceProfileHash=profileHash(p.find((r)=>r.data.id===source).data);c.targetProfileHash=profileHash(p.find((r)=>r.data.id===target).data);
  snapshots=[];deletes=0;
  const backup=encryptedFileBackup(c.backupPath,randomBytes(32),process.cwd());
  deps={backup:async(s)=>{snapshots.push(s);return backup(s);},auth:{
    async retireProfile(id,before,retired) {
      expect(id).toBe(source);
      const found=(await observer.query('SELECT to_jsonb(p) AS data FROM public.profiles p WHERE id=$1',[id])).rows[0].data;
      if(profileHash(found)===profileHash(retired)) return;
      expect(profileHash(found)).toBe(profileHash(before));
      await observer.query(`SELECT set_config('request.jwt.claim.role','service_role',false)`);
      try {
        const result=await observer.query('UPDATE public.profiles SET deleted_at=$2,role_id=NULL,super_admin=false WHERE id=$1 AND deleted_at IS NULL',
          [id,retired.deleted_at]);
        expect(result.rowCount).toBe(1);
      } finally {await observer.query(`SELECT set_config('request.jwt.claim.role','',false)`);}
    },
    async banSource(id){expect(id).toBe(source);await observer.query(`UPDATE auth.users SET banned_until=now()+interval '100 years' WHERE id=$1`,[id]);},
    async sourceIsBanned(id){return (await observer.query('SELECT 1 FROM auth.users WHERE id=$1 AND banned_until>now()',[id])).rowCount===1;},
    async sourceExists(id){return (await observer.query('SELECT 1 FROM auth.users WHERE id=$1',[id])).rowCount===1;},
    async deleteSource(id){expect(id).toBe(source);deletes++;await observer.query('DELETE FROM auth.users WHERE id=$1',[id]);},
  }};
}

beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;const marker=process.env[PROVENANCE_ENV_KEYS.marker];
  const portText=process.env[PROVENANCE_ENV_KEYS.port];const project=process.env[PROVENANCE_ENV_KEYS.project];
  if(!url||!marker||!project||!portText||!/^\d+$/u.test(portText)) throw new Error('Native disposable runner provenance required; skipped coverage is not a pass');
  const match=new RegExp(`^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`,'u').exec(marker);
  if(!match||project!==`${PROJECT_NAME_PREFIX}${match[1].slice(0,PROJECT_NAME_HASH_LENGTH)}`) throw new Error('Disposable runner project/marker mismatch');
  validateLocalTestDatabaseUrl(url,Number(portText));
  expect(Object.keys(process.env).filter((key)=>key!=='TEST_DATABASE_URL' && isInheritedDatabaseUrlKey(key))).toEqual([]);
  db=new Client({connectionString:url,ssl:false,application_name:'account-merge-test'});observer=new Client({connectionString:url,ssl:false});
  await db.connect();await observer.connect();
  const identity=(await db.query(`SELECT current_database() AS db,current_user AS usr,current_setting('server_version') AS version,
    shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`)).rows[0];
  expect(identity.db).toBe('avsworklog_test');expect(identity.usr).toBe('avsworklog_test');expect(identity.marker).toBe(marker);
  expect((await db.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`)).rowCount).toBe(0);
  await db.query('CREATE ROLE account_merge_rls_test NOLOGIN NOSUPERUSER NOBYPASSRLS');
  console.log(`ACCOUNT-MERGE-PG: native PostgreSQL ${identity.version}; loopback identity and runner marker verified`);
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'account-merge-pg-'));
},60000);
beforeEach(fixture,60000);
afterAll(async()=>{
  if(db) await db.end();if(observer) await observer.end();
  if(temp){for(const name of await fs.readdir(temp)) await fs.unlink(path.join(temp,name));await fs.rmdir(temp);}
});

async function drainedFence() {
  const result=await fence(db,c,deps);
  // Only this owned disposable database simulates passage of the real, non-configurable 960-second drain.
  await db.query(`UPDATE private.account_merge_runs SET fenced_at=clock_timestamp()-interval '961 seconds' WHERE run_id=$1`,[c.runId]);
  return result;
}
async function counts():Promise<unknown> {
  return (await db.query(`SELECT
    (SELECT count(*) FROM public.profiles WHERE id=$1) AS source_profile,
    (SELECT count(*) FROM public.absences WHERE profile_id=$1) AS source_absences,
    (SELECT count(*) FROM public.absences WHERE profile_id=$2) AS target_absences,
    (SELECT count(*) FROM public.timesheet_entries) AS entries`,[source,target])).rows[0];
}
async function targetSecrets():Promise<string> {
  const data:unknown[]=[];
  for(const name of ['profile_sensitive_pins','sensitive_pin_unlocks','sensitive_pin_verification_tokens',
    'app_auth_sessions','webauthn_credentials','webauthn_devices','webauthn_challenges','webauthn_prompt_preferences'])
    data.push((await db.query(`SELECT to_jsonb(t) AS row FROM public.${name} t WHERE profile_id=$1 ORDER BY to_jsonb(t)::text`,[target])).rows);
  data.push((await db.query('SELECT encrypted_password FROM auth.users WHERE id=$1',[target])).rows);
  return hash(data);
}

describe('account consolidation real PostgreSQL',()=>{
  it('AM-DB-001 conserves business IDs/bytes and authoritative leave; preserves target Manager/auth config; deletes Auth only after verification',async()=>{
    const before=await inspect(db,c);const protectedBefore=await targetSecrets();
    const recipient=(await db.query('SELECT to_jsonb(r) AS row FROM public.message_recipients r WHERE id=$1',[recipientId])).rows[0].row;
    expect((await drainedFence()).phase).toBe('fenced');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].rows['auth.users'].join('')).toContain('old-password-secret');
    expect(snapshots[0].rows['auth.audit_log_entries']).toHaveLength(1);
    expect(snapshots[0].rows['public.absences']).toHaveLength(36);
    expect((await db.query('SELECT revoked_at FROM public.app_auth_sessions WHERE profile_id=$1',[source])).rows[0].revoked_at).not.toBeNull();
    expect((await merge(db,c,deps)).phase).toBe('merged');
    expect(await counts()).toEqual({source_profile:'0',source_absences:'0',target_absences:'29',entries:'231'});
    const profile=(await db.query('SELECT * FROM public.profiles WHERE id=$1',[target])).rows[0];
    expect(profile).toMatchObject({role:'manager',team_id:'manager-team',employee_id:'fixture-employee',phone_number:'target-phone',
      emergency_contact_name:'source-contact',employer_profile_notes:'employment-notes'});
    expect(await targetSecrets()).toBe(protectedBefore);
    expect((await db.query('SELECT line_manager_id FROM public.profiles WHERE id=$1',[other])).rows[0].line_manager_id).toBe(target);
    expect((await db.query('SELECT manager_1_profile_id FROM public.org_teams')).rows[0].manager_1_profile_id).toBe(target);
    expect((await db.query('SELECT to_jsonb(r) AS row FROM public.message_recipients r WHERE id=$1',[recipientId])).rows[0].row)
      .toEqual({...recipient,user_id:target});
    expect((await db.query('SELECT id,status FROM public.absences WHERE id=ANY($1::uuid[])',[absenceIds])).rows).toHaveLength(29);
    expect((await db.query(`SELECT 1 FROM public.absences WHERE status<>'processed'`)).rowCount).toBe(0);
    expect((await db.query(`SELECT 1 FROM public.absences WHERE holiday_key LIKE $1`,[`%:${target}:%`])).rowCount).toBe(16);
    expect((await db.query('SELECT * FROM public.absence_allowance_carryovers')).rows).toEqual([]);
    expect((await db.query('SELECT count(*) AS n FROM public.user_module_permissions WHERE user_id=$1',[target])).rows[0].n).toBe('1');
    expect((await db.query('SELECT count(*) AS n FROM public.employee_work_shifts WHERE profile_id=$1',[target])).rows[0].n).toBe('1');
    expect((await db.query('SELECT 1 FROM public.profile_reporting_lines WHERE profile_id=manager_profile_id')).rowCount).toBe(0);
    expect((await db.query('SELECT * FROM public.profile_reporting_lines')).rows).toHaveLength(1);
    expect((await db.query('SELECT id,profile_id FROM public.training_people')).rows[0]).toEqual({id:trainingId,profile_id:target});
    const after=await inspect(db,c);
    for(const table of ['public.training_qualifications','public.timesheet_entries','public.inspection_files','public.timesheet_payroll_snapshots'])
      expect(after.tableHashes[table]).toBe(before.tableHashes[table]);
    expect((await db.query('SELECT metadata FROM public.reminder_actions')).rows[0].metadata).toEqual({submitted_by:target,historical:source});
    const provenance=JSON.stringify((await db.query('SELECT original FROM private.account_merge_provenance')).rows);
    expect(provenance).toContain(source);
    for(const secret of ['session-secret','credential-secret','pin-hash-secret','token-secret','old-password-secret','public-key-material'])
      expect(provenance).not.toContain(secret);
    expect((await db.query(`SELECT 1 FROM public.audit_log WHERE table_name='profiles' AND record_id=$1`,[source])).rowCount).toBe(0);
    expect((await db.query(`SELECT 1 FROM public.audit_log WHERE changes->>'historical'=$1`,[source])).rowCount).toBe(1);
    expect(deletes).toBe(0);expect(await deps.auth.sourceExists(source)).toBe(true);
    await expect(retireAuth(db,c,deps)).rejects.toThrow('VERIFIED_MERGE_REQUIRED');
    expect((await verify(db,c)).phase).toBe('verified');
    expect((await retireAuth(db,c,deps)).phase).toBe('retired');
    expect(deletes).toBe(1);expect(await deps.auth.sourceExists(source)).toBe(false);
    expect((await merge(db,c,deps)).phase).toBe('retired');
    expect((await retireAuth(db,c,deps)).phase).toBe('retired');
    expect(deletes).toBe(1);expect(snapshots).toHaveLength(2);
  });
  it('AM-DB-004 rolls back every business mutation on injected failure; encrypted recovery persists and rerun succeeds',async()=>{
    await drainedFence();const before=await inspect(db,c);const oldCounts=await counts();
    await expect(merge(db,c,{...deps,afterMutation:async()=>{throw new Error('injected rollback');}})).rejects.toThrow('injected rollback');
    expect(await counts()).toEqual(oldCounts);expect((await inspect(db,c)).tableHashes).toEqual(before.tableHashes);
    expect((await db.query('SELECT phase FROM private.account_merge_runs')).rows[0].phase).toBe('fenced');
    expect(snapshots).toHaveLength(2);expect(deletes).toBe(0);
    expect((await merge(db,c,deps)).phase).toBe('merged');
  });
  it('refuses missing/failed backup before fencing or merging, with no mutation-shaped success',async()=>{
    const before=await inspect(db,c);
    const missing={...deps};Reflect.deleteProperty(missing,'backup');
    await expect(fence(db,c,missing)).rejects.toThrow('BACKUP_CALLBACK_REQUIRED');
    await expect(fence(db,c,{...deps,backup:async()=>{throw new Error('backup failed');}})).rejects.toThrow('backup failed');
    await expect(fence(db,c,{...deps,backup:async(s)=>({...await deps.backup(s),snapshotHash:'f'.repeat(64)})})).rejects.toThrow('BACKUP_NOT_DURABLE');
    await expect(fence(db,c,{...deps,backup:async(s)=>({...await deps.backup(s),path:path.join(process.cwd(),'forbidden.enc')})})).rejects.toThrow('BACKUP_INSIDE_REPOSITORY');
    expect((await inspect(db,c)).tableHashes).toEqual(before.tableHashes);
    expect((await db.query(`SELECT to_regclass('private.account_merge_runs') AS t`)).rows[0].t).toBeNull();
    await drainedFence();const fenced=await inspect(db,c);
    await expect(merge(db,c,{...deps,backup:async()=>{throw new Error('backup failed');}})).rejects.toThrow('backup failed');
    expect((await inspect(db,c)).tableHashes).toEqual(fenced.tableHashes);
  });
  it('keeps an explicit pending fence on Auth API failure and can safely retry it',async()=>{
    await expect(fence(db,c,{...deps,auth:{...deps.auth,banSource:async()=>{throw new Error('Auth unavailable');}}})).rejects.toThrow('Auth unavailable');
    expect((await db.query('SELECT phase FROM private.account_merge_runs')).rows[0].phase).toBe('fence-pending-auth');
    await expect(merge(db,c,deps)).rejects.toThrow('DATA_MERGE_NOT_COMMITTED');
    expect((await drainedFence()).phase).toBe('fenced');expect(snapshots).toHaveLength(1);
  });
  it('AM-DB-005 denies retired actors even without old-ID fields; denies new/changed assignment for privileged null actors; ordinary target works',async()=>{
    await drainedFence();
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[source]);
    for(const statement of ["INSERT INTO private.plain_notes VALUES(gen_random_uuid(),'blocked')",
      "UPDATE private.plain_notes SET value='blocked'","DELETE FROM private.plain_notes","TRUNCATE private.plain_notes"])
      await expect(db.query(statement)).rejects.toThrow('Retired account cannot write');
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[target]);
    await db.query(`INSERT INTO private.plain_notes VALUES(gen_random_uuid(),'ordinary target')`);
    await db.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    await expect(db.query(`INSERT INTO public.future_empty VALUES($1,$2,'blocked')`,[randomUUID(),source])).rejects.toThrow('Retired account assignment denied');
    const id=randomUUID();await db.query(`INSERT INTO public.future_empty VALUES($1,$2,'privileged target')`,[id,target]);
    await expect(db.query(`UPDATE public.future_empty SET subject=$1 WHERE id=$2`,[source,id])).rejects.toThrow('Retired account assignment denied');
    await db.query(`UPDATE public.actions SET created_by=$1 WHERE created_by=$2`,[target,source]);
    await expect(db.query(`INSERT INTO storage.objects VALUES($1,$2,NULL,NULL)`,[randomUUID(),`files/${source}/image.png`])).rejects.toThrow('Retired storage path denied');
    await expect(db.query(`INSERT INTO storage.objects VALUES($1,'image.png',NULL,$2)`,[randomUUID(),source])).rejects.toThrow('Retired account assignment denied');
    expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid='private.account_merge_provenance'::regclass`)).rows[0].relrowsecurity).toBe(true);
    expect((await db.query(`SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='private'
      AND table_name LIKE 'account_merge_%' AND grantee='PUBLIC'`)).rowCount).toBe(0);
  });
  it('fences direct partitions, SECURITY DEFINER writes, Storage RLS and private provenance for an unprivileged role',async()=>{
    await db.query(`CREATE FUNCTION private.fixture_definer_write() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
      AS $$ INSERT INTO private.plain_notes VALUES(gen_random_uuid(),'definer attempt') $$;
      GRANT USAGE ON SCHEMA auth,storage,private TO account_merge_rls_test;
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO account_merge_rls_test;
      GRANT EXECUTE ON FUNCTION private.fixture_definer_write() TO account_merge_rls_test`);
    c.schemaHash=(await readCatalog(db)).hash;await drainedFence();
    expect((await inspect(db,c)).tableHashes).toHaveProperty('public.account_merge_runs');
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[source]);
    await expect(db.query(`INSERT INTO public.future_partitioned_child VALUES($1,$2,'old actor')`,[randomUUID(),target])).rejects.toThrow('Retired account cannot write');
    await db.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    await expect(db.query(`INSERT INTO public.future_partitioned_child VALUES($1,$2,'old assignment')`,[randomUUID(),source])).rejects.toThrow('Retired account assignment denied');
    await db.query(`INSERT INTO public.future_partitioned_child VALUES($1,$2,'target works')`,[randomUUID(),target]);
    await db.query(`INSERT INTO storage.objects VALUES($1,'target/image.png',$2::uuid,$2::uuid::text)`,[randomUUID(),target]);
    await db.query('SET ROLE account_merge_rls_test');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[source]);
      expect((await db.query('SELECT * FROM storage.objects')).rows).toEqual([]);
      await expect(db.query('SELECT private.fixture_definer_write()')).rejects.toThrow('Retired account cannot write');
      await expect(db.query(`INSERT INTO storage.objects VALUES($1,'blocked.png',NULL,NULL)`,[randomUUID()])).rejects.toThrow('Retired account cannot write');
      await expect(db.query('SELECT * FROM private.account_merge_provenance')).rejects.toThrow('permission denied');
      await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[target]);
      expect((await db.query('SELECT * FROM storage.objects')).rows).toHaveLength(1);
      await db.query(`INSERT INTO storage.objects VALUES($1,'allowed.png',NULL,NULL)`,[randomUUID()]);
    } finally {await db.query('RESET ROLE');await db.query(`SELECT set_config('request.jwt.claim.sub','',false)`);}
  });
  it('rejects stale actors and null-actor assignments from repeatable-read snapshots established before fencing',async()=>{
    const staleActor=new Client({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
    const staleService=new Client({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
    await staleActor.connect();await staleService.connect();
    try {
      await staleActor.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[source]);
      for(const client of [staleActor,staleService]) {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query('SELECT pg_current_snapshot()');
      }
      await drainedFence();
      await expect(staleActor.query(`INSERT INTO private.plain_notes VALUES(gen_random_uuid(),'stale actor')`)).rejects.toThrow('Retired account cannot write');
      await expect(staleService.query(`INSERT INTO public.future_empty VALUES($1,$2,'stale assignment')`,[randomUUID(),source])).rejects.toThrow('Retired account assignment denied');
    } finally {
      for(const client of [staleActor,staleService]) {await client.query('ROLLBACK');await client.end();}
    }
  });
  it('does not expose the maintenance carryover exception to direct or nested service writes or client-set GUCs',async()=>{
    await db.query(`CREATE FUNCTION private.fixture_fake_carryover() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO public.absence_allowance_carryovers(profile_id,financial_year_start_year,source_financial_year_start_year,
        carried_days,auto_generated,generation_source,generated_by)
      VALUES('${source}',2026,2025,28,true,'absence-year-end-carryover',NULL); RETURN NEW; END $$;
      CREATE TRIGGER fake_carryover AFTER INSERT ON public.future_empty FOR EACH ROW EXECUTE FUNCTION private.fixture_fake_carryover()`);
    c.schemaHash=(await readCatalog(db)).hash;await drainedFence();
    await db.query(`SELECT set_config('app.absence_archive_move','on',false)`);
    try {
      await expect(db.query(`INSERT INTO public.absence_allowance_carryovers(profile_id,financial_year_start_year,
        source_financial_year_start_year,carried_days,auto_generated,generation_source,generated_by)
        VALUES($1,2026,2025,28,true,'absence-year-end-carryover',NULL)`,[source])).rejects.toThrow('Retired account assignment denied');
      await expect(db.query(`INSERT INTO public.future_empty VALUES($1,$2,'nested attempt')`,[randomUUID(),target])).rejects.toThrow('Retired account assignment denied');
      expect((await db.query('SELECT * FROM public.future_empty')).rows).toEqual([]);
    } finally {await db.query(`SELECT set_config('app.absence_archive_move','',false)`);}
  });
  it('refuses fence trigger, policy and function tampering before a business write',async()=>{
    await drainedFence();const before=await inspect(db,c);
    await db.query('ALTER TABLE private.plain_notes DISABLE TRIGGER account_merge_actor');
    await expect(merge(db,c,deps)).rejects.toThrow('FENCE_DEFINITION_DRIFT');
    await db.query('ALTER TABLE private.plain_notes ENABLE TRIGGER account_merge_actor');
    await db.query('ALTER POLICY account_merge_retired_actor ON storage.objects USING(true)');
    await expect(merge(db,c,deps)).rejects.toThrow('FENCE_DEFINITION_DRIFT');
    await db.query(`ALTER POLICY account_merge_retired_actor ON storage.objects USING(auth.uid() IS DISTINCT FROM '${source}'::uuid)`);
    await db.query(`CREATE OR REPLACE FUNCTION private.account_merge_actor_guard() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,private AS $$ BEGIN RETURN NULL; END $$`);
    await expect(merge(db,c,deps)).rejects.toThrow('FENCE_DEFINITION_DRIFT');
    expect((await inspect(db,c)).tableHashes).toEqual(before.tableHashes);expect(snapshots).toHaveLength(1);
  });
  it.each(['before-delete','after-delete'])('can retry an Auth failure %s without repeating the business merge',async(point)=>{
    await drainedFence();await merge(db,c,deps);await verify(db,c);const before=await inspect(db,c);
    const failed={...deps,auth:{...deps.auth,deleteSource:async(id:string)=>{
      if(point==='after-delete') await deps.auth.deleteSource(id);throw new Error('Auth unavailable');
    }}};
    await expect(retireAuth(db,c,failed)).rejects.toThrow('Auth unavailable');
    expect((await db.query('SELECT phase FROM private.account_merge_runs')).rows[0].phase).toBe('verified');
    expect((await inspect(db,c)).tableHashes).toEqual(before.tableHashes);
    expect((await retireAuth(db,c,deps)).phase).toBe('retired');expect(deletes).toBe(1);expect(snapshots).toHaveLength(2);
  });
  it('refuses mismatched duplicate attributes and an occupied target employee ID',async()=>{
    await db.query('UPDATE public.absences SET duration_days=duration_days+0.25 WHERE id=$1',[duplicateIds[0]]);
    await expect(drainedFence()).rejects.toThrow('DUPLICATE_APPROVAL_MISMATCH');
    await db.query('UPDATE public.absences SET duration_days=duration_days-0.25 WHERE id=$1',[duplicateIds[0]]);
    await db.query(`UPDATE public.profiles SET employee_id='existing-manager-id' WHERE id=$1`,[target]);
    c.targetProfileHash=profileHash((await db.query('SELECT to_jsonb(p) AS data FROM public.profiles p WHERE id=$1',[target])).rows[0].data);
    await expect(drainedFence()).rejects.toThrow('UNSUPPORTED_PROFILE_STATE');expect(snapshots).toHaveLength(0);
  });
  it('rejects cross-schema identity dependencies, including empty cascade tables, before mutation',async()=>{
    await db.query('CREATE SCHEMA external_identity; CREATE TABLE external_identity.links(id uuid PRIMARY KEY,subject uuid REFERENCES public.profiles(id) ON DELETE CASCADE)');
    try {await expect(drainedFence()).rejects.toThrow('EXTERNAL_IDENTITY_DEPENDENCY_UNSUPPORTED');}
    finally {await db.query('DROP TABLE external_identity.links; DROP SCHEMA external_identity');}
    expect(snapshots).toHaveLength(0);
  });
  it.each(['recipient','timesheet','membership','reporting','holiday-key'])('rolls back %s collision without losing IDs or history',async(kind)=>{
    if(kind==='recipient') await db.query(`INSERT INTO public.message_recipients(id,message_id,user_id,status) VALUES($1,$2,$3,'PENDING')`,[randomUUID(),messageId,target]);
    if(kind==='timesheet') await db.query(`INSERT INTO public.timesheets(id,user_id,week_ending,status) VALUES($1,$2,'2024-01-07','draft')`,[randomUUID(),target]);
    if(kind==='membership') await db.query(`INSERT INTO public.profile_team_memberships VALUES($1,$2,'active-source',NULL)`,[randomUUID(),source]);
    if(kind==='reporting') await db.query(`INSERT INTO public.profile_reporting_lines VALUES($1,$2,$3,'historic','2024-01-01T00:00:00Z')`,[randomUUID(),target,other]);
    if(kind==='holiday-key') await db.query(`INSERT INTO public.absences(id,profile_id,reason_id,date,end_date,duration_days,status,holiday_key)
      VALUES($1,$2,$3,'2027-08-01','2027-08-01',1,'cancelled',$4)`,[randomUUID(),target,reason,`uk-bank-holiday:england-and-wales:${target}:2025-05-01`]);
    await drainedFence();const before=await inspect(db,c);
    await expect(merge(db,c,deps)).rejects.toThrow();
    expect((await inspect(db,c)).tableHashes).toEqual(before.tableHashes);expect((await counts() as {source_profile:string}).source_profile).toBe('1');
  });
  it('AM-DB-003 fails closed on unknown source dependencies and changed schema/profile/config',async()=>{
    await db.query(`INSERT INTO public.future_empty VALUES($1,$2,'unclassified')`,[randomUUID(),source]);
    await expect(drainedFence()).rejects.toThrow('UNCLASSIFIED_SOURCE_DEPENDENCY:public.future_empty.subject');
    await db.query('DELETE FROM public.future_empty');
    await expect(fence(db,{...c,targetProfileHash:'f'.repeat(64)},deps)).rejects.toThrow('PROFILE_FINGERPRINT_MISMATCH');
    await drainedFence();
    await expect(merge(db,{...c,employeeId:'changed-config'},deps)).rejects.toThrow('RECEIPT_CONFIG_MISMATCH');
    await db.query('CREATE TABLE public.new_operational(id uuid PRIMARY KEY)');
    await expect(merge(db,c,deps)).rejects.toThrow('SCHEMA_DRIFT');
    expect(snapshots).toHaveLength(1);
  });
  it('rejects inbound duplicate/recipient links, allocation recipients, undo-close preimages and unapproved selfloops',async()=>{
    await db.query(`CREATE TABLE public.inbound_recipient(id uuid PRIMARY KEY,recipient_id uuid REFERENCES public.message_recipients(id));
      CREATE TABLE public.inbound_duplicate(id uuid PRIMARY KEY,absence_id uuid REFERENCES public.absences(id) ON DELETE CASCADE)`);
    await db.query('INSERT INTO public.inbound_recipient VALUES($1,$2)',[randomUUID(),recipientId]);
    await db.query('INSERT INTO public.inbound_duplicate VALUES($1,$2)',[randomUUID(),duplicateIds[0]]);c.schemaHash=(await readCatalog(db)).hash;
    await expect(drainedFence()).rejects.toThrow('INCOMING_REFERENCE:public.absences');
    await db.query('DELETE FROM public.inbound_duplicate');
    await expect(drainedFence()).rejects.toThrow('INCOMING_REFERENCE:public.message_recipients');
    await db.query('DELETE FROM public.inbound_recipient');
    await db.query('UPDATE public.messages SET daily_allocation_publication_id=$1',[randomUUID()]);
    await expect(drainedFence()).rejects.toThrow('ALLOCATION_RECIPIENT_REQUIRES_REVIEW');
    await db.query('UPDATE public.messages SET daily_allocation_publication_id=NULL');
    await db.query('INSERT INTO public.absence_financial_year_close_snapshot_rows VALUES($1,$2,$3,NULL)',[randomUUID(),c.targetAdjustmentId,target]);
    await expect(drainedFence()).rejects.toThrow('UNDO_CLOSE_SNAPSHOT_REQUIRES_REVIEW');
    await db.query('DELETE FROM public.absence_financial_year_close_snapshot_rows');
    await db.query(`INSERT INTO public.profile_reporting_lines VALUES($1,$2,$3,'historic','2024-01-01T00:00:00Z')`,[randomUUID(),source,target]);
    await expect(drainedFence()).rejects.toThrow('UNAPPROVED_REPORTING_SELF_LOOP');
    expect(snapshots).toHaveLength(0);
  });
  it('uses real closed-year/owner/recipient guards and only a transaction-local archive move',async()=>{
    await expect(db.query(`UPDATE public.absences SET notes='forbidden' WHERE id=$1`,[absenceIds[0]])).rejects.toThrow('closed financial year');
    await expect(db.query('UPDATE public.message_recipients SET user_id=$1 WHERE id=$2',[target,recipientId])).rejects.toThrow('identity columns are immutable');
    await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[target]);
    await expect(db.query('UPDATE public.absences SET profile_id=$1 WHERE id=$2',[target,absenceIds[28]])).rejects.toThrow('immutable for authenticated updates');
    await db.query(`SELECT set_config('request.jwt.claim.sub','',false)`);
    await drainedFence();await merge(db,c,deps);
    expect((await db.query(`SELECT current_setting('app.absence_archive_move',true) AS setting`)).rows[0].setting).not.toBe('on');
    expect((await db.query(`SELECT tgenabled FROM pg_trigger WHERE tgname IN ('closed_year','owner_lock','recipient_lock')`)).rows.every((r)=>r.tgenabled==='O')).toBe(true);
  });
  it('aborts unexpected trigger side effects even when ordinary business updates succeed',async()=>{
    await db.query(`CREATE FUNCTION public.unexpected_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE public.training_qualifications SET certificate=decode('deadbeef','hex'); RETURN NEW; END $$;
      CREATE TRIGGER unexpected AFTER UPDATE ON public.training_people FOR EACH ROW EXECUTE FUNCTION public.unexpected_side_effect()`);
    c.schemaHash=(await readCatalog(db)).hash;await drainedFence();const before=await inspect(db,c);
    await expect(merge(db,c,deps)).rejects.toThrow('UNEXPECTED_BUSINESS_BYTES:public.training_qualifications');
    expect((await inspect(db,c)).tableHashes).toEqual(before.tableHashes);
  });
  it('refuses ownership of a caller transaction without rolling it back',async()=>{
    await db.query('BEGIN');
    await expect(drainedFence()).rejects.toThrow('RUNNER_REQUIRES_IDLE_CLIENT');
    await db.query('SAVEPOINT still_in_callers_transaction');await db.query('ROLLBACK');
  });
  it('AM-DB-006 waits for in-flight writers under real sorted table locks, then captures their committed preimages',async()=>{
    const watcher=new Client({connectionString:process.env.TEST_DATABASE_URL,ssl:false});await watcher.connect();
    try {
      await observer.query('BEGIN');await observer.query(`UPDATE public.actions SET payload='in-flight history' WHERE created_by=$1`,[source]);
      const operation=drainedFence().then((value)=>({value}),(error:unknown)=>({error}));
      const pid=(await observer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      let blocked=false;
      for(let i=0;i<100;i++) {
        const result=await watcher.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2::int=ANY(pg_blocking_pids(pid))',['account-merge-test',pid]);
        if(result.rowCount){blocked=true;break;}await new Promise((resolve)=>setTimeout(resolve,20));
      }
      await observer.query('COMMIT');const outcome=await operation;if('error' in outcome) throw outcome.error;expect(blocked).toBe(true);
      expect(snapshots[0].rows['public.actions'].join('')).toContain('in-flight history');
      await merge(db,c,deps);expect((await db.query('SELECT payload,created_by FROM public.actions')).rows[0]).toEqual({payload:'in-flight history',created_by:target});
    } finally {await observer.query('ROLLBACK');await watcher.end();}
  });
  it('AM-DB-007 retires source profile authority with the real service-role guard and enforces the complete drain',async()=>{
    const protectedBefore=await targetSecrets();
    await expect(db.query('UPDATE public.profiles SET deleted_at=now() WHERE id=$1',[source])).rejects.toThrow();
    await expect(fence(db,{...c,sourceEmail:'wrong@example.test'},deps)).rejects.toThrow('AUTH_IDENTITY_EMAIL_MISMATCH');
    await expect(fence(db,c,{...deps,auth:{...deps.auth,retireProfile:async()=>{throw new Error('profile API unavailable');}}}))
      .rejects.toThrow('profile API unavailable');
    expect((await db.query('SELECT phase,fenced_at FROM private.account_merge_runs')).rows[0])
      .toMatchObject({phase:'fence-pending-auth',fenced_at:null});
    expect((await fence(db,c,deps)).phase).toBe('fenced');
    const sourceProfile=(await db.query('SELECT deleted_at,role_id,super_admin FROM public.profiles WHERE id=$1',[source])).rows[0];
    expect(sourceProfile.deleted_at).not.toBeNull();expect(sourceProfile.role_id).toBeNull();expect(sourceProfile.super_admin).toBe(false);
    expect(await targetSecrets()).toBe(protectedBefore);
    const fencedAt=(await db.query('SELECT fenced_at FROM private.account_merge_runs')).rows[0].fenced_at;
    await expect(merge(db,c,deps)).rejects.toThrow('REQUEST_DRAIN_INCOMPLETE');
    await fence(db,c,deps);
    expect((await db.query('SELECT fenced_at FROM private.account_merge_runs')).rows[0].fenced_at).toEqual(fencedAt);
    await db.query(`UPDATE private.account_merge_runs SET fenced_at=clock_timestamp()-interval '959 seconds'`);
    await expect(merge(db,c,deps)).rejects.toThrow('REQUEST_DRAIN_INCOMPLETE');
    await db.query(`UPDATE private.account_merge_runs SET fenced_at=clock_timestamp()-interval '961 seconds'`);
    expect((await merge(db,c,deps)).phase).toBe('merged');
  });
  it('AM-DB-008 allows unrelated postcommit activity but refuses changed migrated records before Auth retirement',async()=>{
    await drainedFence();await merge(db,c,deps);
    await db.query(`INSERT INTO private.plain_notes VALUES(gen_random_uuid(),'another active user')`);
    await db.query(`UPDATE public.user_usage_events SET payload='changed migrated row' WHERE user_id=$1`,[target]);
    await expect(verify(db,c)).rejects.toThrow('POSTCOMMIT_RECORD_CHANGED:public.user_usage_events');
    await expect(retireAuth(db,c,deps)).rejects.toThrow('VERIFIED_MERGE_REQUIRED');expect(deletes).toBe(0);
    await db.query(`UPDATE public.user_usage_events SET payload='untouched business bytes' WHERE user_id=$1`,[target]);
    expect((await verify(db,c)).phase).toBe('verified');
    await db.query(`INSERT INTO private.plain_notes VALUES(gen_random_uuid(),'further independent activity')`);
    expect((await retireAuth(db,c,deps)).phase).toBe('retired');
  });
  it('AM-DB-009 conserves a production-sized audit history through batched mutations and scoped proof',async()=>{
    await db.query(`INSERT INTO public.audit_log(table_name,record_id,user_id,action,changes)
      SELECT 'timesheets',$2::uuid,$1::uuid,'updated',jsonb_build_object('sequence',n,'historical_actor',$1::uuid::text)
      FROM generate_series(1,5144) n`,[source,timesheetIds[0]]);
    await drainedFence();await merge(db,c,deps);await verify(db,c);
    expect((await db.query(`SELECT count(*)::int AS n FROM public.audit_log WHERE changes ? 'sequence' AND user_id=$1`,[target])).rows[0].n).toBe(5144);
    expect((await retireAuth(db,c,deps)).phase).toBe('retired');
  },60000);

  it('AM-R1-001 fences all manifested non-FK assignments for null/service actors while allowing target and historical JSON',async()=>{
    const document=randomUUID(),reminder=randomUUID(),audit=randomUUID();
    await drainedFence();
    await db.query(`INSERT INTO public.external_documents VALUES($1,ARRAY[$2::uuid],jsonb_build_object('historical',$3::text))`,[document,target,source]);
    await db.query(`INSERT INTO public.reminder_actions VALUES($1,NULL,NULL,'other_workflow',jsonb_build_object('submitted_by',$2::text,'historical',$3::text))`,[reminder,target,source]);
    await db.query(`INSERT INTO public.audit_log(id,table_name,record_id,user_id,action,changes)
      VALUES($1,'historic_table',$2,NULL,'updated',jsonb_build_object('historical',$2::uuid::text))`,[audit,source]);
    for(const role of ['', 'service_role']) {
      await db.query(`SELECT set_config('request.jwt.claim.role',$1,false)`,[role]);
      await expect(db.query('INSERT INTO public.external_documents VALUES(gen_random_uuid(),ARRAY[$1::uuid],NULL)',[source])).rejects.toThrow('Retired operational assignment denied');
      await expect(db.query('UPDATE public.external_documents SET shared_with=shared_with||$1::uuid WHERE id=$2',[source,document])).rejects.toThrow('Retired operational assignment denied');
      await expect(db.query(`INSERT INTO public.reminder_actions VALUES(gen_random_uuid(),NULL,NULL,'other_workflow',jsonb_build_object('submitted_by',$1::text))`,[source.toUpperCase()])).rejects.toThrow('Retired operational assignment denied');
      await expect(db.query(`UPDATE public.reminder_actions SET metadata=jsonb_set(metadata,'{submitted_by}',to_jsonb($1::text)) WHERE id=$2`,[source.replaceAll('-',''),reminder])).rejects.toThrow('Retired operational assignment denied');
      await expect(db.query(`INSERT INTO public.audit_log(table_name,record_id,action,changes) VALUES('profiles',$1,'updated','{}')`,[source])).rejects.toThrow('Retired operational assignment denied');
      await expect(db.query(`UPDATE public.audit_log SET table_name='profiles' WHERE id=$1`,[audit])).rejects.toThrow('Retired operational assignment denied');
    }
    await db.query(`SELECT set_config('request.jwt.claim.role','',false)`);
    await db.query(`UPDATE public.audit_log SET record_id=$2,table_name='profiles' WHERE id=$1`,[audit,target]);
    await expect(db.query('UPDATE public.audit_log SET record_id=$1 WHERE id=$2',[source,audit])).rejects.toThrow('Retired operational assignment denied');
    await merge(db,c,deps);await verify(db,c);
    expect((await db.query('SELECT shared_with,historical FROM public.external_documents WHERE id=$1',[document])).rows[0])
      .toEqual({shared_with:[target],historical:{historical:source}});
    expect((await db.query(`SELECT metadata FROM public.reminder_actions WHERE workflow_key='plant_legacy_missing_site'`)).rows[0].metadata)
      .toEqual({submitted_by:target,historical:source});
    await expect(db.query(`INSERT INTO public.reminder_actions VALUES(gen_random_uuid(),NULL,NULL,'other_workflow',jsonb_build_object('submitted_by',$1::text))`,[source]))
      .rejects.toThrow('Retired operational assignment denied');
  });
  it('AM-DB-011 refuses preexisting unapproved shares and residual operational references before Auth deletion',async()=>{
    const id=randomUUID();
    await db.query('INSERT INTO public.external_documents VALUES($1,ARRAY[$2::uuid],NULL)',[id,source]);
    await expect(fence(db,c,deps)).rejects.toThrow('UNAPPROVED_OPERATIONAL_REFERENCE:public.external_documents.shared_with');
    expect(snapshots).toHaveLength(0);
    expect((await db.query(`SELECT to_regclass('private.account_merge_runs') AS value`)).rows[0].value).toBeNull();
    await db.query('DELETE FROM public.external_documents WHERE id=$1',[id]);
    await drainedFence();await merge(db,c,deps);
    // Owned disposable fixture corruption simulates a privileged residual; production never disables guards.
    await db.query('ALTER TABLE public.reminder_actions DISABLE TRIGGER account_merge_assignment');
    await db.query(`INSERT INTO public.reminder_actions VALUES($1,NULL,NULL,'corruption',jsonb_build_object('submitted_by',$2::text))`,[id,source]);
    await db.query('ALTER TABLE public.reminder_actions ENABLE TRIGGER account_merge_assignment');
    await expect(verify(db,c)).rejects.toThrow('SOURCE_OPERATIONAL_REFERENCE_REMAINS:public.reminder_actions.metadata');
    await expect(retireAuth(db,c,deps)).rejects.toThrow('VERIFIED_MERGE_REQUIRED');expect(deletes).toBe(0);
  });
  it('AM-DB-012 permits exact native profile lifecycle audits only in the authorized transaction',async()=>{
    await db.query(`CREATE FUNCTION private.fake_profile_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN INSERT INTO public.audit_log(table_name,record_id,user_id,action,changes)
        VALUES('profiles','${source}',NULL,'updated','{}'); RETURN NEW; END $$;
      CREATE TRIGGER fake_profile_audit AFTER INSERT ON private.plain_notes FOR EACH ROW EXECUTE FUNCTION private.fake_profile_audit()`);
    c.schemaHash=(await readCatalog(db)).hash;
    const real=deps.auth.retireProfile;
    deps.auth.retireProfile=async(id,before,retired)=>{
      expect((await observer.query('SELECT retirement_xid FROM private.account_merge_runs')).rows[0].retirement_xid).toBeNull();
      await expect(observer.query(`INSERT INTO private.plain_notes VALUES(gen_random_uuid(),'fake nested pending audit')`)).rejects.toThrow('Retired operational assignment denied');
      await expect(observer.query(`INSERT INTO public.audit_log(table_name,record_id,action,changes) VALUES('profiles',$1,'updated','{}')`,[source])).rejects.toThrow('Retired operational assignment denied');
      await real(id,before,retired);
    };
    await drainedFence();
    expect((await db.query('SELECT retirement_xid FROM private.account_merge_runs')).rows[0].retirement_xid).toBeNull();
    await expect(db.query(`INSERT INTO private.plain_notes VALUES(gen_random_uuid(),'fake nested fenced audit')`)).rejects.toThrow('Retired operational assignment denied');
    await expect(db.query('UPDATE public.profiles SET role_id=gen_random_uuid() WHERE id=$1',[source])).rejects.toThrow('Retired profile authority cannot return');
    await expect(db.query('UPDATE public.profiles SET super_admin=true WHERE id=$1',[source])).rejects.toThrow('Retired profile authority cannot return');
    await merge(db,c,deps);await verify(db,c);
    expect((await db.query(`SELECT count(*)::int AS n FROM public.audit_log WHERE table_name='profiles' AND record_id=$1`,[source])).rows[0].n).toBe(0);
    expect((await retireAuth(db,c,deps)).phase).toBe('retired');
  });

  it('AM-DB-013 detects same-value updates and identical reinserts in partitioned unrelated rows',async()=>{
    await db.query(`CREATE TABLE public.proof_partitioned(id int PRIMARY KEY,value text) PARTITION BY RANGE(id);
      CREATE TABLE public.proof_partition_one PARTITION OF public.proof_partitioned FOR VALUES FROM(0) TO(10);
      CREATE TABLE public.proof_partition_two PARTITION OF public.proof_partitioned FOR VALUES FROM(10) TO(20);
      INSERT INTO public.proof_partitioned VALUES(1,'same bytes'),(11,'same bytes')`);
    const physical=(await db.query('SELECT tableoid::text AS table_id,ctid::text AS location,xmin::text AS created FROM public.proof_partitioned ORDER BY id')).rows;
    expect(physical[0].location).toBe(physical[1].location);
    expect(physical[0].created).toBe(physical[1].created);
    expect(physical[0].table_id).not.toBe(physical[1].table_id);
    c.schemaHash=(await readCatalog(db)).hash;await drainedFence();const before=await inspect(db,c);
    await expect(merge(db,c,{...deps,afterMutation:async()=>{
      await db.query('UPDATE public.proof_partitioned SET value=value WHERE id=1');
    }})).rejects.toThrow('UNEXPECTED_BUSINESS_BYTES:public.proof_partitioned');
    await expect(merge(db,c,{...deps,afterMutation:async()=>{
      await db.query(`DELETE FROM public.proof_partitioned WHERE id=1;
        INSERT INTO public.proof_partitioned VALUES(1,'same bytes')`);
    }})).rejects.toThrow('UNEXPECTED_BUSINESS_BYTES:public.proof_partitioned');
    expect((await inspect(db,c)).tableHashes).toEqual(before.tableHashes);
  });
  it('AM-DB-014 refuses a planned signed record changed again by a native AFTER trigger',async()=>{
    await db.query(`CREATE FUNCTION public.change_reinserted_signature() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE public.message_recipients SET signature_data='unexpected signature' WHERE id=NEW.id;
        RETURN NEW; END $$;
      CREATE TRIGGER changed_signature AFTER INSERT ON public.message_recipients FOR EACH ROW
        WHEN(NEW.user_id='${target}'::uuid) EXECUTE FUNCTION public.change_reinserted_signature()`);
    c.schemaHash=(await readCatalog(db)).hash;await drainedFence();
    await expect(merge(db,c,deps)).rejects.toThrow('UNEXPECTED_BUSINESS_BYTES:public.message_recipients');
    expect((await db.query('SELECT user_id,signature_data FROM public.message_recipients WHERE id=$1',[recipientId])).rows[0])
      .toEqual({user_id:source,signature_data:'data:image/png;base64,fixture-signature'});
  });


  it('AM-R2-001 retains linked and unlinked usage history, private session attribution and target sessions',async()=>{
    const protectedBefore=await targetSecrets();
    const originals=new Map<string,Record<string,unknown>[]>();
    for(const name of ['user_usage_events','user_usage_sessions']) {
      await db.query(`INSERT INTO public.${name} VALUES($1,$2,'target history',(SELECT id FROM public.app_auth_sessions WHERE profile_id=$2)),
        ($3,$4,'unlinked source history',NULL)`,[randomUUID(),target,randomUUID(),source]);
      originals.set(name,(await db.query(`SELECT to_jsonb(t) AS data FROM public.${name} t ORDER BY id`)).rows.map((r)=>r.data));
    }
    await drainedFence();await merge(db,c,deps);await verify(db,c);
    expect(await targetSecrets()).toBe(protectedBefore);
    expect((await db.query('SELECT 1 FROM public.app_auth_sessions WHERE profile_id=$1',[source])).rowCount).toBe(0);
    for(const [name,rows] of originals) for(const original of rows) {
      const current=(await db.query(`SELECT to_jsonb(t) AS data FROM public.${name} t WHERE id=$1`,[original.id])).rows[0].data;
      expect(current).toEqual(original.user_id===source?{...original,user_id:target,app_session_id:null}:original);
      if(original.user_id===source) {
        const proof=(await db.query(`SELECT operation,original FROM private.account_merge_provenance
          WHERE table_name=$1 AND original->>'id'=$2`,[`public.${name}`,original.id])).rows;
        expect(proof).toEqual([{operation:original.app_session_id===null?'identity-transfer':'detach-retired-session-history',original}]);
      }
    }
  });
  it.each(['user_usage_events','user_usage_sessions'])('session history rejects another owner referencing the retired session in %s',async(name)=>{
    await db.query(`INSERT INTO public.${name} VALUES($1,$2,'other owner history',(SELECT id FROM public.app_auth_sessions WHERE profile_id=$3))`,
      [randomUUID(),other,source]);
    await expect(fence(db,c,deps)).rejects.toThrow('DELETE_HAS_SURVIVING_DEPENDENT:public.app_auth_sessions');
    expect(snapshots).toHaveLength(0);
    expect((await db.query(`SELECT to_regclass('private.account_merge_runs') AS value`)).rows[0].value).toBeNull();
  });
  it.each(['user_usage_events','user_usage_sessions'])('session history rejects source history linked to another account session in %s',async(name)=>{
    await db.query(`UPDATE public.${name} SET app_session_id=(SELECT id FROM public.app_auth_sessions WHERE profile_id=$1)`,[target]);
    await expect(fence(db,c,deps)).rejects.toThrow('SESSION_HISTORY_OWNER_MISMATCH');
    expect(snapshots).toHaveLength(0);
    expect((await db.query(`SELECT to_regclass('private.account_merge_runs') AS value`)).rows[0].value).toBeNull();
  });

  it('AM-DB-015 preserves PostgreSQL numeric scale and exact JSON numbers in business rows and provenance',async()=>{
    const auditId=randomUUID();
    await db.query(`UPDATE public.reminder_actions SET metadata=metadata||'{"scaled":2.00,"exact":9007199254740993}'::jsonb;
      INSERT INTO public.audit_log(id,table_name,record_id,user_id,action,changes)
        VALUES('${auditId}','profiles','${source}','${source}','updated','{"scaled":2.00,"exact":9007199254740993,"secret_probe":"must-be-redacted"}')`);
    const before=(await db.query(`SELECT (metadata-'submitted_by')::text AS value FROM public.reminder_actions`)).rows[0].value;
    const auditBefore=(await db.query('SELECT changes::text AS value FROM public.audit_log WHERE id=$1',[auditId])).rows[0].value;
    const redactedBefore=(await db.query("SELECT (changes-'secret_probe')::text AS value FROM public.audit_log WHERE id=$1",[auditId])).rows[0].value;
    await drainedFence();await merge(db,c,deps);await verify(db,c);
    expect((await db.query(`SELECT (metadata-'submitted_by')::text AS value FROM public.reminder_actions`)).rows[0].value).toBe(before);
    expect((await db.query('SELECT changes::text AS value FROM public.audit_log WHERE id=$1',[auditId])).rows[0].value).toBe(auditBefore);
    expect((await db.query(`SELECT (original->'changes')::text AS value FROM private.account_merge_provenance
      WHERE table_name='public.audit_log' AND original->>'id'=$1`,[auditId])).rows[0].value).toBe(redactedBefore);
    expect((await db.query('SELECT DISTINCT duration_days::text AS value FROM public.absences')).rows).toEqual([{value:'2.00'}]);
    expect((await db.query('SELECT annual_holiday_allowance_days::text AS value FROM public.profiles WHERE id=$1',[target])).rows[0].value).toBe('28.00');
  });

  it('AM-DB-002 proves authoritative holiday totals and removes only duplicate bookings and setup adjustment',async()=>{
    await db.query(`UPDATE public.absences SET status='processed' WHERE id=ANY($1::uuid[])`,[duplicateIds]);
    await drainedFence();await merge(db,c,deps);
    const totals=(await db.query(`SELECT public.absence_financial_year_start_year(a.date) AS year,sum(duration_days)::int AS used
      FROM public.absences a JOIN public.absence_reasons r ON r.id=a.reason_id
      WHERE a.profile_id=$1 AND lower(r.name)='annual leave' AND a.status IN ('approved','processed')
      GROUP BY 1 ORDER BY 1`,[target])).rows;
    expect(totals).toEqual([{year:2025,used:28},{year:2026,used:30}]);
    expect((await db.query('SELECT annual_holiday_allowance_days::int AS allowance FROM public.profiles WHERE id=$1',[target])).rows[0].allowance).toBe(28);
    expect(28-totals[1].used).toBe(-2);
    expect((await db.query('SELECT 1 FROM public.absences WHERE id=ANY($1::uuid[])',[duplicateIds])).rowCount).toBe(0);
    expect((await db.query('SELECT id FROM public.absences WHERE id=ANY($1::uuid[])',[absenceIds])).rowCount).toBe(29);
    expect((await db.query('SELECT 1 FROM public.absence_allowance_carryovers')).rowCount).toBe(0);
  });

});