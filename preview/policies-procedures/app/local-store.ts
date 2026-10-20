import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { handlePolicyRequest, type PolicyContext, type PolicyDb } from '@/lib/server/policy-documents-service';

const root = path.resolve(process.cwd(), '../..');
const directory = path.join(root, 'data/policies-procedures');
const actor = '22222222-2222-4222-8222-222222222222';
const globalStore = globalThis as typeof globalThis & { policyPreview?: Promise<PGlite> };

async function initialize() {
  await mkdir(path.join(directory, 'files'), { recursive: true });
  const db = new PGlite(path.join(directory, 'preview-db'));
  await db.waitReady;
  const existing = await db.query("SELECT to_regclass('public.policy_documents') AS name");
  if (!(existing.rows[0] as { name: string | null }).name) {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
      CREATE TABLE storage.objects(id uuid,bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE TABLE public.profiles(id uuid PRIMARY KEY); INSERT INTO public.profiles VALUES('${actor}');
      CREATE TABLE public.roles(id uuid PRIMARY KEY,name text,hierarchy_rank integer);
      INSERT INTO public.roles VALUES('${actor}','contractor',1);
      CREATE TABLE public.permission_modules(module_name text PRIMARY KEY,minimum_role_id uuid,sort_order integer,access_mode text,requires_sensitive_pin boolean);`);
    await db.exec(await readFile(path.join(root, 'supabase/migrations/20261020_policies_procedures.sql'), 'utf8'));
  }
  const manifest = JSON.parse(await readFile(path.join(directory, 'import/manifest.json'), 'utf8')) as { documents: Array<Record<string, string | number | null>> };
  for (const doc of manifest.documents) {
    const bytes = await readFile(path.join(directory, 'import', String(doc.storage_path)));
    if (createHash('sha256').update(bytes).digest('hex') !== doc.sha256) throw new Error('Imported document checksum mismatch.');
    const ext = String(doc.file_name).split('.').pop();
    const mime = ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : ext === 'doc' ? 'application/msword' : 'application/pdf';
    await writeFile(path.join(directory, 'files', String(doc.storage_path)), bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await db.transaction(async tx => {
      await tx.query('INSERT INTO public.policy_documents(id,reference,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [doc.document_id, doc.reference, actor]);
      await tx.query(`INSERT INTO public.policy_document_versions(id,document_id,version,version_label,title,category,notes,storage_path,file_name,file_size,mime_type,sha256,created_by)
        VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`, [doc.id, doc.document_id, doc.version_label, doc.title, doc.category, doc.notes, doc.storage_path, doc.file_name, doc.file_size, mime, doc.sha256, actor]);
      await tx.query("INSERT INTO public.policy_document_events(document_id,version_id,action,actor_id) SELECT $1,$2,'upload',$3 WHERE NOT EXISTS(SELECT 1 FROM public.policy_document_events WHERE version_id=$2 AND action='upload')", [doc.document_id, doc.id, actor]);
    });
  }
  return db;
}

export async function localRoute(request: NextRequest, id?: string, file = false) {
  // This fixture application is never deployed and has no production credentials.
  if (process.env.NODE_ENV !== 'development' || !['localhost','127.0.0.1'].includes(request.nextUrl.hostname)
    || request.headers.get('sec-fetch-site') === 'cross-site'
    || (request.headers.get('origin') && new URL(request.headers.get('origin')!).host !== request.headers.get('host'))) {
    return NextResponse.json({ error: 'Local preview only.' }, { status: 403 });
  }
  const level = Number(request.headers.get('x-preview-level') ?? request.nextUrl.searchParams.get('level') ?? 0);
  if (![0,2,4].includes(level)) return NextResponse.json({ error: 'Invalid preview level.' }, { status: 403 });
  if (!globalStore.policyPreview) globalStore.policyPreview = initialize();
  const db = await globalStore.policyPreview;
  const context: PolicyContext = {
    userId: actor, level,
    transaction: fn => db.transaction(tx => fn(tx as unknown as PolicyDb)),
    async upload(key, bytes) { await writeFile(path.join(directory, 'files', key), bytes, { flag: 'wx' }); },
    async remove(key) { await unlink(path.join(directory, 'files', key)); },
    async fileUrl(_key, _name, documentId, versionId) { return `/api/policies-procedures/${documentId}/file?version=${versionId}&level=${level}&download=1`; },
  };
  const response = await handlePolicyRequest(request, context, id, file);
  if (file && request.nextUrl.searchParams.get('download') === '1' && response.ok) {
    const result = await db.query<{ storage_path: string; mime_type: string; file_name: string }>('SELECT storage_path,mime_type,file_name FROM public.policy_document_versions WHERE id=$1 AND document_id=$2', [request.nextUrl.searchParams.get('version'), id]);
    const row = result.rows[0];
    const bytes = await readFile(path.join(directory, 'files', row.storage_path));
    return new NextResponse(bytes, { headers: { 'Content-Type': row.mime_type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return response;
}
