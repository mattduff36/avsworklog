import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handlePolicyRequest, type PolicyContext, type PolicyDb } from '@/lib/server/policy-documents-service';
import { policyMetadataSchema } from '@/lib/policies-procedures/schema';
const actor = '22222222-2222-4222-8222-222222222222';
const db = new PGlite();
const upload = vi.fn(async () => undefined), remove = vi.fn(async () => undefined);
const context: PolicyContext = { userId: actor, level: 4, transaction: fn => db.transaction(tx => fn(tx as unknown as PolicyDb)), upload, remove, fileUrl: async () => 'https://private.example.test/file' };
function request(method = 'GET', body?: BodyInit, suffix = '') { return new NextRequest(`http://localhost/api/policies-procedures${suffix}`, { method, body }); }
function form(reference = 'TEST-001', extra = {}) {
  const value = new FormData(); value.set('metadata', JSON.stringify({ reference, title: 'Test policy', category: 'Company policies', version_label: '1', ...extra }));
  value.set('file', new File(['%PDF-1.4\nfixture'], 'policy.pdf', { type: 'application/pdf' })); return value;
}
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
    CREATE TABLE storage.objects(id uuid,bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated;
    CREATE POLICY legacy_broad ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
    INSERT INTO storage.objects VALUES(gen_random_uuid(),'policies-procedures'),(gen_random_uuid(),'other');
    CREATE TABLE public.profiles(id uuid PRIMARY KEY); INSERT INTO public.profiles VALUES('${actor}');
    CREATE TABLE public.roles(id uuid PRIMARY KEY,name text,hierarchy_rank integer); INSERT INTO public.roles VALUES('${actor}','contractor',1);
    CREATE TABLE public.permission_modules(module_name text PRIMARY KEY,minimum_role_id uuid,sort_order integer,access_mode text,requires_sensitive_pin boolean);`);
  await db.exec(readFileSync(resolve('supabase/migrations/20261020_policies_procedures.sql'), 'utf8'));
});
afterAll(() => db.close());
describe('Policies lifecycle and boundaries with the real migration', () => {
  it('denies Level 0 and reader writes without storage access', async () => {
    expect((await handlePolicyRequest(request(), { ...context, level: 0 })).status).toBe(403);
    expect((await handlePolicyRequest(request('POST', form()), { ...context, level: 2 })).status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });
  it('uploads drafts, publishes atomically, retains history, rejects stale writes and hides archive', async () => {
    const created = await handlePolicyRequest(request('POST', form()), context); expect(created.status).toBe(201);
    const { id, version_id } = await created.json();
    const reader = { ...context, level: 2 };
    expect((await (await handlePolicyRequest(request(), reader)).json()).documents).toHaveLength(0);
    expect((await handlePolicyRequest(request('GET', undefined, `?version=${version_id}`), reader, id, true)).status).toBe(404);
    const publish = (version: string, expected: number) => request('PATCH', JSON.stringify({ action: 'publish', version_id: version, expected_version: expected, confirm_complete: true }));
    expect((await handlePolicyRequest(publish(version_id, 1), context, id)).status).toBe(200);
    expect((await (await handlePolicyRequest(request(), reader)).json()).documents).toHaveLength(1);
    const next = await handlePolicyRequest(request('POST', form('TEST-001', { document_id: id, expected_version: 1, version_label: '2' })), context);
    expect(next.status).toBe(201); const v2 = (await next.json()).version_id;
    expect((await (await handlePolicyRequest(request(), reader)).json()).documents[0].id).toBe(version_id);
    expect((await handlePolicyRequest(publish(v2, 1), context, id)).status).toBe(409);
    expect((await handlePolicyRequest(publish(v2, 2), context, id)).status).toBe(200);
    expect((await (await handlePolicyRequest(request(), reader, id)).json()).documents.map((v: { id: string }) => v.id)).toEqual([v2]);
    expect((await (await handlePolicyRequest(request(), context, id)).json()).documents).toHaveLength(2);
    expect((await handlePolicyRequest(request('GET', undefined, `?version=${version_id}`), reader, id, true)).status).toBe(404);
    expect((await handlePolicyRequest(request('PATCH', JSON.stringify({ action: 'archive', archived: true, expected_version: 2 })), context, id)).status).toBe(200);
    expect((await (await handlePolicyRequest(request(), reader)).json()).documents).toHaveLength(0);
    expect((await handlePolicyRequest(request('GET', undefined, `?version=${v2}`), reader, id, true)).status).toBe(404);
    expect((await handlePolicyRequest(request('PATCH', JSON.stringify({ action: 'archive', archived: false, expected_version: 2 })), context, id)).status).toBe(200);
    expect((await handlePolicyRequest(request('GET', undefined, `?version=${v2}`), reader, id, true)).status).toBe(200);
    const duplicate = await handlePolicyRequest(request('POST', form()), context); expect(duplicate.status).toBe(409); expect(remove).toHaveBeenCalled();
  });
  it('rejects invalid metadata and spoofed extensions', async () => {
    expect(policyMetadataSchema.safeParse({ reference: 'X', title: 'X', category: 'Company policies', version_label: '1', effective_date: '2026-02-30' }).success).toBe(false);
    const data = form('TEST-002'); data.set('file', new File(['html'], 'evil.pdf'));
    expect((await handlePolicyRequest(request('POST', data), context)).status).toBe(400);
    expect((await handlePolicyRequest(request('GET', undefined, '?version=invalid'), context, actor, true)).status).toBe(400);
  });
  it('blocks direct table access and legacy-permissive storage access', async () => {
    await db.exec('SET ROLE authenticated');
    try {
      await expect(db.query('SELECT * FROM public.policy_documents')).rejects.toThrow();
      expect((await db.query('SELECT bucket_id FROM storage.objects')).rows).toEqual([{ bucket_id: 'other' }]);
      await expect(db.query("INSERT INTO storage.objects VALUES(gen_random_uuid(),'policies-procedures')")).rejects.toThrow();
    } finally { await db.exec('RESET ROLE'); }
    expect((await db.query("SELECT public FROM storage.buckets WHERE id='policies-procedures'")).rows[0]).toEqual({ public: false });
  });
});
