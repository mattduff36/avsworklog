import { Client } from 'pg';
import sharp from 'sharp';
import { persistGuestPhoto } from '@/lib/server/guest-plant-photo';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestPlantSubmissionSchema, londonToday, type GuestPlantSubmission } from '@/lib/inspections/guest-plant';
import { saveGuestPlantCheck } from '@/lib/server/guest-plant-checks';
import { DATABASE_COMMENT_PREFIX, PROJECT_NAME_HASH_LENGTH, PROJECT_NAME_PREFIX, PROVENANCE_ENV_KEYS, STATE_VERSION, validateLocalTestDatabaseUrl } from '../../scripts/local-test-postgres';

vi.mock('server-only', () => ({}));
const local = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8');
function sourceFunction(text: string, name: string) {
  const start = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION (?:public\\.|private\\.)?${name}\\(`, 'iu').exec(text);
  if (!start) throw new Error(`Missing production function ${name}`);
  const open = text.indexOf('$$', start.index); const close = text.indexOf('$$', open + 2);
  return text.slice(start.index, text.indexOf(';', close + 2) + 1);
}
local('Guest plant checks: real disposable PostgreSQL', () => {
  let db: Client; let other: Client; let observer: Client; let session: string; let secondSession: string; let owner: string;
  const asset = randomUUID(); const job = randomUUID(); let signature: string;
  const payload = (patch: Partial<GuestPlantSubmission> = {}): GuestPlantSubmission => ({ requestId: randomUUID(), plantId: asset, name: 'Temporary Worker', date: londonToday(), jobNumber: '12345', jobSourceType: 'live_quote', jobSourceId: job, hours: 150, hoursConfirmed: true, signature, comments: '', informWorkshop: false, items: Array.from({ length: 23 }, (_, i) => ({ number: i + 1, status: 'ok', comment: '', repeatConfirmed: false })), photoIds: [], ...patch });
  beforeAll(async () => {
    const png = await sharp(Buffer.from('<svg width="300" height="100"><rect width="300" height="100" fill="white"/><path d="M10 80 L50 20 L70 70 L140 40 L230 60" stroke="black" stroke-width="4" fill="none"/></svg>')).png().toBuffer();
    signature = `data:image/png;base64,${png.toString('base64')}`;
    const url = process.env.TEST_DATABASE_URL!; const marker = process.env[PROVENANCE_ENV_KEYS.marker] || '';
    const match = new RegExp(`^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`, 'u').exec(marker);
    if (!match || process.env[PROVENANCE_ENV_KEYS.project] !== `${PROJECT_NAME_PREFIX}${match[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`) throw new Error('Disposable runner provenance required');
    validateLocalTestDatabaseUrl(url, Number(process.env[PROVENANCE_ENV_KEYS.port]));
    db = new Client({ connectionString: url, ssl: false }); other = new Client({ connectionString: url, ssl: false }); observer = new Client({ connectionString: url, ssl: false });
    await Promise.all([db.connect(), other.connect(), observer.connect()]);
    expect((await db.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()")).rows[0].marker).toBe(marker);
    await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE SCHEMA private;
      CREATE TABLE auth.users(id uuid PRIMARY KEY, aud text, role text, email text UNIQUE, encrypted_password text, banned_until timestamptz, raw_user_meta_data jsonb, raw_app_meta_data jsonb, created_at timestamptz, updated_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
      CREATE FUNCTION public.effective_has_module_permission(text) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.module', true), '') = 'yes' $$;
      CREATE FUNCTION public.effective_is_manager_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.manager', true), '') = 'yes' $$;
      CREATE FUNCTION public.effective_is_supervisor() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.supervisor', true), '') = 'yes' $$;
      CREATE FUNCTION public.effective_is_workshop_team() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.workshop', true), '') = 'yes' $$;
      CREATE TABLE public.org_teams(id text PRIMARY KEY); INSERT INTO org_teams VALUES('system_accounts');
    `);
    // Start with real profile baseline and signup trigger, then current additive system fields.
    const schema = readFileSync('supabase/schema.sql', 'utf8');
    await db.query(schema.match(/CREATE TABLE IF NOT EXISTS profiles \([\s\S]*?\);/)![0]);
    await db.query(`ALTER TABLE profiles ADD role_id uuid, ADD team_id text REFERENCES org_teams(id), ADD is_system_account boolean NOT NULL DEFAULT false, ADD annual_holiday_allowance_days numeric, ADD super_admin boolean DEFAULT false;`);
    await db.query("CREATE TABLE roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text); INSERT INTO roles(name) VALUES('employee-civils');");
    await db.query(sourceFunction(readFileSync('supabase/fix-profile-trigger-no-role.sql', 'utf8'), 'handle_new_user'));
    await db.query(`CREATE TABLE work_shift_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text, is_default boolean, created_at timestamptz DEFAULT now()); CREATE TABLE work_shift_template_slots(template_id uuid, day_of_week integer, am_working boolean, pm_working boolean, UNIQUE(template_id,day_of_week)); CREATE TABLE employee_work_shifts(profile_id uuid PRIMARY KEY REFERENCES profiles(id), template_id uuid);`);
    await db.query(sourceFunction(sql('20260323_work_shifts.sql'), 'create_default_employee_work_shift'));
    await db.query('CREATE TRIGGER create_default_employee_work_shift AFTER INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION create_default_employee_work_shift()');
    await db.query('CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()');
    await db.query(sourceFunction(sql('20260819170000_system_accounts.sql'), 'protect_system_account_identity'));
    await db.query('CREATE TRIGGER protect_system_account_identity BEFORE INSERT OR UPDATE OR DELETE ON profiles FOR EACH ROW EXECUTE FUNCTION private.protect_system_account_identity()');
    await db.query(`CREATE TABLE public.plant(id uuid PRIMARY KEY, plant_id text, status text);
      CREATE TABLE public.vehicle_maintenance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plant_id uuid UNIQUE REFERENCES plant(id), current_hours integer, last_hours_update timestamptz, updated_at timestamptz DEFAULT now(), daily_check_source_id uuid, daily_check_source_type text);
      CREATE TABLE public.maintenance_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), van_id uuid, plant_id uuid, hgv_id uuid, field_name text, old_value text, new_value text, value_type text, comment text, updated_by uuid REFERENCES profiles(id), daily_check_id uuid, daily_check_type text);
      CREATE TABLE public.workshop_task_categories(id uuid PRIMARY KEY, applies_to text, name text, is_active boolean);
      CREATE TABLE public.audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text, record_id uuid, user_id uuid REFERENCES profiles(id), action text, changes jsonb);
      CREATE TABLE public.inspection_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid NOT NULL, item_number integer NOT NULL, item_description text NOT NULL, day_of_week integer CHECK(day_of_week BETWEEN 1 AND 7), status text CHECK(status IN ('ok','attention','na','logged')), comments text);
      CREATE TABLE public.inspection_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid NOT NULL, item_number integer, day_of_week integer, photo_url text NOT NULL);
      CREATE TABLE public.inspection_daily_hours(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid);
      CREATE TABLE public.actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_type text NOT NULL, plant_id uuid REFERENCES plant(id), title text NOT NULL, description text, status text, created_by uuid REFERENCES auth.users(id), inspection_id uuid, inspection_item_id uuid REFERENCES inspection_items(id), workshop_category_id uuid REFERENCES workshop_task_categories(id), daily_check_source_id uuid, daily_check_source_type text, actioned_at timestamptz, updated_at timestamptz DEFAULT now());
    `);
    await db.query(sql('20260301_split_inspections.sql').match(/CREATE TABLE plant_inspections \([\s\S]*?\);/)![0]);
    await db.query(`ALTER TABLE plant_inspections ADD job_source_type text, ADD job_source_id uuid, ADD job_code text, ADD job_site_address text;
      CREATE UNIQUE INDEX idx_unique_plant_inspection_user_date ON plant_inspections(plant_id,user_id,inspection_date) WHERE plant_id IS NOT NULL;
      CREATE TYPE private.allocation_job AS (source_type text, source_id uuid, job_code text, site_address text, customer_name text, title text, address_valid boolean);
      CREATE TABLE private.fixture_jobs(id uuid PRIMARY KEY, active boolean);
      INSERT INTO private.fixture_jobs VALUES('${job}',true);
      CREATE FUNCTION private.resolve_allocation_job(text, uuid, text) RETURNS SETOF private.allocation_job LANGUAGE sql AS $$
        SELECT ROW($1, $2, '12345-AB', 'Site address', 'Fixture', 'Fixture job', true)::private.allocation_job FROM private.fixture_jobs WHERE id=$2 AND active $$;
    `);
    await db.query(sourceFunction(sql('20260817_plant_legacy_missing_site_actions.sql'), 'compact_catalog_job_code'));
    await db.query(sourceFunction(sql('20260925_plant_inspection_active_job_codes.sql'), 'apply_plant_inspection_job_fields'));
    await db.query(sourceFunction(sql('20261102_preserve_submitted_plant_check_job_snapshot.sql'), 'guard_plant_inspection_job_fields'));
    await db.query('CREATE TRIGGER plant_job_guard BEFORE INSERT OR UPDATE ON plant_inspections FOR EACH ROW EXECUTE FUNCTION private.guard_plant_inspection_job_fields()');
    const effectsSql = sql('20261110_daily_check_deletion_effects.sql');
    await db.query(effectsSql.match(/CREATE TABLE private\.daily_check_effects \([\s\S]*?\);/)![0]);
    for (const name of ['lock_daily_check', 'journal_daily_check_effect', 'finalize_daily_check_effect', 'apply_daily_check_meter']) await db.query(sourceFunction(effectsSql, name));
    await db.query('CREATE TRIGGER daily_check_meter_journal BEFORE INSERT OR UPDATE OF current_hours ON vehicle_maintenance FOR EACH ROW EXECUTE FUNCTION private.journal_daily_check_effect()');
    await db.query('CREATE TRIGGER daily_check_action_journal BEFORE INSERT OR UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION private.journal_daily_check_effect()');
    await db.query('CREATE TRIGGER zz_daily_check_effect AFTER INSERT OR UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION private.finalize_daily_check_effect()');
    await db.query("CREATE TRIGGER plant_meter AFTER INSERT OR UPDATE OF current_mileage ON plant_inspections FOR EACH ROW EXECUTE FUNCTION private.apply_daily_check_meter('plant')");
    for (const table of ['plant_inspections','inspection_items','inspection_photos','inspection_daily_hours']) {
      await db.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY legacy_read ON public.${table} FOR SELECT TO authenticated USING(true); GRANT SELECT, INSERT, UPDATE ON public.${table} TO authenticated;`);
    }
    await db.query('GRANT USAGE ON SCHEMA public, auth TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated');
    await db.query(sql('20261116_guest_plant_daily_checks.sql'));
    owner = (await db.query('SELECT owner_id FROM private.guest_plant_settings')).rows[0].owner_id;
    await db.query('INSERT INTO plant VALUES($1,$2,$3)', [asset, 'P001', 'active']);
  }, 120000);
  beforeEach(async () => {
    await db.query("RESET ROLE; SELECT set_config('test.actor','',false)");
    await db.query(`DELETE FROM private.daily_check_effects; DELETE FROM actions; DELETE FROM inspection_items; DELETE FROM inspection_photos; DELETE FROM plant_inspections;
      DELETE FROM private.guest_plant_uploads; DELETE FROM private.guest_plant_requests; DELETE FROM private.guest_plant_sessions;
      DELETE FROM maintenance_history; DELETE FROM audit_log; DELETE FROM vehicle_maintenance;
      UPDATE private.guest_plant_settings SET enabled=true,generation=1; UPDATE private.fixture_jobs SET active=true; UPDATE plant SET status='active';`);
    session = (await db.query("INSERT INTO private.guest_plant_sessions(token_hash,generation) VALUES('one',1) RETURNING id")).rows[0].id;
    secondSession = (await db.query("INSERT INTO private.guest_plant_sessions(token_hash,generation) VALUES('two',1) RETURNING id")).rows[0].id;
  });
  afterAll(async () => { await Promise.all([db?.end(), other?.end(), observer?.end()]); });
  it('provisions a banned system identity without changing kiosk ownership', async () => {
    const { rows } = await db.query('SELECT p.*,u.banned_until::text FROM profiles p JOIN auth.users u USING(id) WHERE p.id=$1', [owner]);
    expect((await db.query('SELECT * FROM employee_work_shifts WHERE profile_id=$1', [owner])).rows).toHaveLength(0);
    expect(rows[0]).toMatchObject({ full_name: 'Temporary Plant Checks', is_system_account: true, team_id: 'system_accounts', banned_until: 'infinity', role_id: null });
  });
  it('commits all items, hours, signature, name, audit and one defect task; identical concurrent requests return one receipt', async () => {
    const input = payload(); input.items[0] = { number: 1, status: 'attention', comment: 'Oil leak', repeatConfirmed: false };
    const [a,b] = await Promise.all([saveGuestPlantCheck(db, session, input, 1), saveGuestPlantCheck(other, session, input, 1)]);
    expect(a).toEqual(b);
    expect((await db.query('SELECT count(*) FROM plant_inspections')).rows[0].count).toBe('1');
    expect((await db.query('SELECT count(*) FROM inspection_items')).rows[0].count).toBe('23');
    expect((await db.query('SELECT count(*) FROM actions')).rows[0].count).toBe('1');
    expect((await db.query('SELECT current_hours FROM vehicle_maintenance')).rows[0].current_hours).toBe(150);
    expect((await db.query("SELECT target_table FROM private.daily_check_effects WHERE source_id=$1 ORDER BY target_table", [a.id])).rows).toEqual([{target_table:'actions'},{target_table:'vehicle_maintenance'}]);
    expect((await db.query('SELECT guest_name,signature_data FROM plant_inspections')).rows[0]).toMatchObject({ guest_name: input.name, signature_data: input.signature });
    await expect(saveGuestPlantCheck(db, session, { ...input, name: 'Changed' }, 1)).rejects.toThrow('already used');
  });
  it('allows two guests with the same name on the same plant/day', async () => {
    await Promise.all([saveGuestPlantCheck(db, session, payload(),1),saveGuestPlantCheck(other, secondSession,payload(),1)]);
    expect((await db.query('SELECT count(*) FROM plant_inspections')).rows[0].count).toBe('2');
  });
  it('accepts the selected full catalogue code and rejects a different suffix without writes', async () => {
    const { rows } = await db.query('SELECT job_code FROM private.resolve_allocation_job($1,$2,NULL)', ['live_quote', job]);
    const code = rows[0].job_code;
    await expect(saveGuestPlantCheck(db, session, payload({ jobNumber: code + '-WRONG' }), 1)).rejects.toThrow('does not match');
    expect((await db.query('SELECT count(*) FROM plant_inspections')).rows[0].count).toBe('0');
    const input = payload({ jobNumber: code });
    expect(GuestPlantSubmissionSchema.safeParse(input).success).toBe(true);
    const receipt = await saveGuestPlantCheck(db, session, input, 1);
    expect((await db.query('SELECT job_code FROM plant_inspections WHERE id=$1', [receipt.id])).rows[0].job_code).toBe(code);
  });
  it('rolls back the parent, meter and items when a workshop task fails', async () => {
    await db.query("ALTER TABLE actions ADD CONSTRAINT fixture_failure CHECK(title='not a real title')");
    const input = payload(); input.items[1].status = 'attention'; input.items[1].comment = 'Wheel loose';
    try { await expect(saveGuestPlantCheck(db,session,input,1)).rejects.toThrow(); }
    finally { await db.query('ALTER TABLE actions DROP CONSTRAINT fixture_failure'); }
    for (const table of ['plant_inspections','inspection_items','vehicle_maintenance','maintenance_history','private.guest_plant_requests']) expect((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe('0');
  });
  it('rejects inactive jobs/assets, other-session photos, stale days and forged logged defects', async () => {
    await expect(saveGuestPlantCheck(db,session,payload({ date:'2000-01-01' }),1)).rejects.toThrow('today');
    await db.query('UPDATE plant SET status=$1',[ 'retired' ]); await expect(saveGuestPlantCheck(db,session,payload(),1)).rejects.toThrow('no longer available'); await db.query("UPDATE plant SET status='active'");
    await db.query('UPDATE private.fixture_jobs SET active=false'); await expect(saveGuestPlantCheck(db,session,payload(),1)).rejects.toThrow('job'); await db.query('UPDATE private.fixture_jobs SET active=true');
    await expect(saveGuestPlantCheck(db,session,payload({photoIds:[randomUUID()]}),1)).rejects.toThrow('photo');
    const input=payload();input.items[0].status='logged';await expect(saveGuestPlantCheck(db,session,input,1)).rejects.toThrow('logged defect');
  });
  it('claims only ready photos for this session and request and persists their checklist association', async () => {
    const photo = randomUUID(); const input = payload({ photoIds: [photo] });
    await db.query(`INSERT INTO private.guest_plant_uploads(id,session_id,request_id,item_number,object_key,photo_url,ready,content_hash) VALUES($1,$2,$3,4,$4,'https://fixture.invalid/photo.jpg',true,'fixture')`,[photo,secondSession,input.requestId,`${input.requestId}/${photo}.jpg`]);
    await expect(saveGuestPlantCheck(db,session,input,1)).rejects.toThrow('photo');
    await db.query('UPDATE private.guest_plant_uploads SET session_id=$1',[session]);
    const result=await saveGuestPlantCheck(db,session,input,1);
    expect((await db.query('SELECT inspection_id,item_number FROM inspection_photos')).rows).toEqual([{inspection_id:result.id,item_number:4}]);
    expect((await db.query('SELECT claimed FROM private.guest_plant_uploads')).rows[0].claimed).toBe(true);
  });
  it('retries the fifth photo after provider failure and recovers accepted uploads concurrently without duplicates', async () => {
    const requestId = randomUUID(); const bytes = Buffer.from('encoded fixture JPEG');
    const objects = new Map<string, Buffer>(); let fail = false; let lostResponse = false; let uploads = 0;
    const storage = {
      upload: async (key: string, value: Buffer) => { uploads++; if (fail) return {error:'offline'}; if (objects.has(key)) return {error:'exists'}; objects.set(key,value); return {error:lostResponse ? 'response lost' : null}; },
      download: async (key: string) => ({ data: objects.has(key) ? new Blob([objects.get(key)!]) : null, error: objects.has(key) ? null : 'missing' }),
    };
    const input = (id = randomUUID()) => ({id, sessionId:session, requestId, itemNumber:1, bytes, photoUrl:'https://fixture.invalid/photo.jpg'});
    const auth = (client: Client) => async () => { await client.query('SELECT id FROM private.guest_plant_sessions WHERE id=$1 FOR UPDATE',[session]); };
    for (let i=0;i<4;i++) await persistGuestPhoto(db,storage,input(),auth(db));
    const fifth=input(); fail=true;
    await expect(persistGuestPhoto(db,storage,fifth,auth(db))).rejects.toMatchObject({status:503});
    fail=false;lostResponse=true;
    const results=await Promise.all([persistGuestPhoto(db,storage,fifth,auth(db)),persistGuestPhoto(other,storage,fifth,auth(other))]);
    expect(results[0]).toEqual(results[1]); expect(objects.size).toBe(5); expect(uploads).toBe(6);
    expect((await db.query('SELECT count(*) FROM private.guest_plant_uploads WHERE ready')).rows[0].count).toBe('5');
    await expect(persistGuestPhoto(db,storage,{...fifth,bytes:Buffer.from('different')},auth(db))).rejects.toMatchObject({status:409});
    await expect(persistGuestPhoto(db,storage,{...fifth,sessionId:secondSession},auth(db))).rejects.toMatchObject({status:409});
    await expect(persistGuestPhoto(db,storage,input(),auth(db))).rejects.toThrow('maximum');
    await db.query('UPDATE private.guest_plant_uploads SET abandoned=true WHERE id=$1',[fifth.id]);
    await expect(persistGuestPhoto(db,storage,fifth,auth(db))).rejects.toMatchObject({status:409});
    await persistGuestPhoto(db,storage,input(),auth(db));
    expect((await db.query('SELECT count(*) FROM private.guest_plant_uploads WHERE NOT abandoned')).rows[0].count).toBe('5');
  });
  it.each([false, true])('serializes disable/rotation with a waiting submission (enabled=%s)', async enabled => {
    await other.query('BEGIN'); await other.query('UPDATE private.guest_plant_settings SET enabled=$1,generation=2',[enabled]);
    const pending = saveGuestPlantCheck(db,session,payload(),1); let finished=false; void pending.then(()=>{finished=true;},()=>{finished=true;});
    await new Promise(r=>setTimeout(r,100)); expect(finished).toBe(false);
    await other.query('COMMIT'); await expect(pending).rejects.toThrow('no longer available');
    expect((await db.query('SELECT count(*) FROM plant_inspections')).rows[0].count).toBe('0');
  });
  it('restricts guest parent and evidence reads even when legacy policies are permissive; identity cannot be forged', async () => {
    const result=await saveGuestPlantCheck(db,session,payload(),1);
    await db.query("SELECT set_config('test.actor',$1,false),set_config('test.manager','yes',false),set_config('test.module','no',false)",[randomUUID()]);
    await db.query('SET ROLE authenticated');
    expect((await db.query('SELECT id FROM plant_inspections')).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM inspection_items')).rows).toHaveLength(0);
    await expect(db.query('SELECT * FROM private.guest_plant_settings')).rejects.toThrow('permission denied');
    await db.query("SELECT set_config('test.module','yes',false)");
    expect((await db.query('SELECT id FROM plant_inspections')).rows).toEqual([{id:result.id}]);
    expect((await db.query('SELECT id FROM inspection_items')).rows).toHaveLength(23);
    await db.query("SELECT set_config('test.manager','no',false)");
    expect((await db.query('SELECT id FROM plant_inspections')).rows).toHaveLength(0);
    await db.query("SELECT set_config('test.supervisor','yes',false)");
    expect((await db.query('SELECT id FROM plant_inspections')).rows).toHaveLength(1);
    await db.query("SELECT set_config('test.supervisor','no',false)");
    await db.query('RESET ROLE');
    await expect(db.query('UPDATE plant_inspections SET guest_name=$1 WHERE id=$2',['Forged',result.id])).rejects.toThrow('immutable');
    await db.query('SET ROLE anon');await expect(db.query('SELECT * FROM plant_inspections')).rejects.toThrow('permission denied');await db.query('RESET ROLE');
  });
  it('validates every item exactly once before reaching persistence', () => {
    const input=payload(); input.items[22]=input.items[0]; expect(GuestPlantSubmissionSchema.safeParse(input).success).toBe(false);
  });
});
