import assert from 'node:assert/strict';
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
it('executes the exact migration and proves document and storage access boundaries', async () => {
const db = new PGlite();
try {
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA storage;
 GRANT USAGE ON SCHEMA auth, storage TO authenticated, anon, service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE FUNCTION public.permission_alignment_effective_module_access_level(text) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.level',true),''),'0')::integer $$;
 CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END; $$;
 CREATE TABLE public.roles(id uuid PRIMARY KEY, name text, hierarchy_rank integer);
 INSERT INTO public.roles VALUES ('11111111-1111-4111-8111-111111111111','contractor',1);
 CREATE TABLE public.permission_modules(module_name text PRIMARY KEY,minimum_role_id uuid,sort_order integer,access_mode text,requires_sensitive_pin boolean,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.team_module_permissions(module_name text, enabled boolean,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.user_module_permissions(module_name text,access_level integer,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,role_id uuid,team_id text,deleted_at timestamptz,is_placeholder boolean DEFAULT false,is_system_account boolean DEFAULT false);
 CREATE TABLE public.vans(id uuid PRIMARY KEY); CREATE TABLE public.plant(id uuid PRIMARY KEY); CREATE TABLE public.hgvs(id uuid PRIMARY KEY);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT ALL ON storage.objects TO anon,authenticated;
 CREATE POLICY broad_legacy ON storage.objects FOR ALL TO authenticated USING (true) WITH CHECK (true);
 INSERT INTO storage.objects(bucket_id) VALUES ('external-documents'),('other');
 INSERT INTO public.profiles(id) VALUES ('22222222-2222-4222-8222-222222222222');
 `);
 await db.exec(fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20261013_external_documents.sql'),'utf8'));
 await db.exec(`INSERT INTO public.external_documents(title,category,external_company,document_date,file_name,file_size,page_count,source_files,uploaded_by,storage_path,shared_with)
 VALUES ('Sample','Service record','Sample provider','2026-10-13','sample.pdf',100,1,'["page.pdf"]','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333.pdf',ARRAY['22222222-2222-4222-8222-222222222222'::uuid]);`);
 await assert.rejects(db.exec(`UPDATE public.external_documents SET source_files='[12]'`));
 await assert.rejects(db.exec(`UPDATE public.external_documents SET shared_with=ARRAY['99999999-9999-4999-8999-999999999999'::uuid]`));
 await db.exec(`SET test.uid='22222222-2222-4222-8222-222222222222'; SET ROLE authenticated; SET test.level='0';`);
 assert.equal((await db.query(`SELECT public.external_documents_can_read(ARRAY[auth.uid()],false) allowed`)).rows[0].allowed,false);
 await db.exec(`SET test.level='2';`);
 assert.equal((await db.query(`SELECT public.external_documents_can_read(ARRAY[auth.uid()],false) allowed`)).rows[0].allowed,true);
 assert.equal((await db.query(`SELECT public.external_documents_can_read(ARRAY[auth.uid()],true) allowed`)).rows[0].allowed,false);
 assert.equal((await db.query(`SELECT public.external_documents_can_read(ARRAY[]::uuid[],false) allowed`)).rows[0].allowed,false);
 await db.exec(`SET test.level='4';`);
 assert.equal((await db.query(`SELECT public.external_documents_can_read(ARRAY[]::uuid[],true) allowed`)).rows[0].allowed,true);
 await assert.rejects(db.query(`SELECT * FROM public.external_documents`));
 assert.deepEqual((await db.query(`SELECT bucket_id FROM storage.objects`)).rows,[{bucket_id:'other'}]);
 await assert.rejects(db.exec(`INSERT INTO storage.objects(bucket_id) VALUES ('external-documents')`));
 await db.exec(`RESET ROLE; GRANT SELECT ON public.external_documents TO authenticated; SET ROLE authenticated; SET test.level='2';`);
 assert.equal((await db.query(`SELECT count(*)::int n FROM public.external_documents`)).rows[0].n,1);
 await db.exec(`SET test.uid='99999999-9999-4999-8999-999999999999';`);
 assert.equal((await db.query(`SELECT count(*)::int n FROM public.external_documents`)).rows[0].n,0);
 await db.exec(`SET test.level='4';`);
 assert.equal((await db.query(`SELECT count(*)::int n FROM public.external_documents`)).rows[0].n,1);
 console.log('PASS: exact migration applies; source/reader constraints; levels 0/2/4; archive/unshared denial; no direct metadata bypass; restrictive storage protects against permissive legacy policies; RLS scope.');
} finally { await db.close(); }
}, 20000);
