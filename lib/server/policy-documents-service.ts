import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import JSZip from 'jszip';
import { POLICY_MAX_BYTES, policyActionSchema, policyMetadataSchema } from '@/lib/policies-procedures/schema';

export interface PolicyDb { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>; }
export interface PolicyContext {
  userId: string; level: number;
  transaction<T>(fn: (db: PolicyDb) => Promise<T>): Promise<T>;
  upload(path: string, bytes: Buffer, mime: string): Promise<void>;
  remove(path: string): Promise<void>;
  fileUrl(path: string, name: string, documentId: string, versionId: string): Promise<string>;
}
class PolicyError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const columns = `v.id,v.document_id,d.reference,d.is_archived,v.version,v.version_label,v.title,v.category,v.status,
  v.effective_date::text,v.review_date::text,v.notes,v.file_name,v.file_size,v.mime_type,v.sha256,v.created_at,v.published_at`;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function validatePolicyFile(file: File) {
  if (!file.size || file.size > POLICY_MAX_BYTES) throw new PolicyError(413, 'Choose a document up to 4 MB.');
  const ext = file.name.split('.').pop()?.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());
  let mime: string;
  if (ext === 'pdf' && bytes.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf';
  else if (ext === 'doc' && bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) mime = 'application/msword';
  else if ((ext === 'docx' || ext === 'xlsx') && bytes.subarray(0, 2).toString() === 'PK') {
    let archive: JSZip;
    try { archive = await JSZip.loadAsync(bytes); } catch { throw new PolicyError(400, 'The Office document is not valid.'); }
    if (!archive.file(ext === 'docx' ? 'word/document.xml' : 'xl/workbook.xml') || archive.file(/vbaProject\.bin$/i).length) throw new PolicyError(400, 'Choose a valid document without macros.');
    mime = ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else throw new PolicyError(400, 'Choose a valid PDF, DOCX, DOC or XLSX file.');
  return { bytes, mime, ext, name: file.name.replace(/[\x00-\x1f\\/]/g, '_').slice(0, 180), hash: createHash('sha256').update(bytes).digest('hex') };
}

export async function handlePolicyRequest(request: NextRequest, context: PolicyContext, id?: string, isFile = false) {
  let uploadedPath: string | undefined;
  try {
    if (context.level < 1) throw new PolicyError(403, 'You do not have access to Policies and Procedures.');
    const manage = context.level >= 4;
    if (request.method !== 'GET' && !manage) throw new PolicyError(403, 'Document management requires Level 4 access.');
    if (id) z.string().uuid().parse(id);
    if (request.method === 'GET') {
      if (isFile) {
        const versionId = z.string().uuid().parse(request.nextUrl.searchParams.get('version'));
        const row = await context.transaction(async db => (await db.query(`SELECT v.*,d.is_archived FROM public.policy_document_versions v JOIN public.policy_documents d ON d.id=v.document_id WHERE d.id=$1 AND v.id=$2`, [id, versionId])).rows[0]);
        if (!row || (!manage && (row.status !== 'published' || row.is_archived))) throw new PolicyError(404, 'Document not found.');
        return json({ url: await context.fileUrl(String(row.storage_path), String(row.file_name), String(id), versionId) });
      }
      const rows = await context.transaction(async db => {
        if (id) return (await db.query(`SELECT ${columns} FROM public.policy_document_versions v JOIN public.policy_documents d ON d.id=v.document_id WHERE d.id=$1 ${manage ? '' : "AND NOT d.is_archived AND v.status='published'"} ORDER BY v.version DESC`, [id])).rows;
        return (await db.query(`SELECT DISTINCT ON (d.id) ${columns} FROM public.policy_document_versions v JOIN public.policy_documents d ON d.id=v.document_id ${manage ? '' : "WHERE NOT d.is_archived AND v.status='published'"} ORDER BY d.id,v.version DESC`)).rows;
      });
      return json({ documents: rows });
    }
    if (request.method === 'POST' && !id) {
      const length = Number(request.headers.get('content-length') || 0);
      if (length > POLICY_MAX_BYTES + 65536) throw new PolicyError(413, 'Choose a document up to 4 MB.');
      const form = await request.formData();
      const metadata = policyMetadataSchema.parse(JSON.parse(String(form.get('metadata'))));
      const file = form.get('file');
      if (!(file instanceof File)) throw new PolicyError(400, 'Choose a document.');
      const validated = await validatePolicyFile(file);
      const versionId = randomUUID();
      const path = `${versionId}.${validated.ext}`;
      await context.upload(path, validated.bytes, validated.mime);
      uploadedPath = path;
      const result = await context.transaction(async db => {
        let documentId = metadata.document_id;
        let version = 1;
        if (documentId) {
          const doc = (await db.query('SELECT * FROM public.policy_documents WHERE id=$1 FOR UPDATE', [documentId])).rows[0];
          if (!doc || doc.is_archived) throw new PolicyError(409, 'Restore the document before adding a version.');
          if (String(doc.reference).toLowerCase() !== metadata.reference.toLowerCase()) throw new PolicyError(400, 'Keep the original document reference.');
          const latest = (await db.query('SELECT max(version) AS latest FROM public.policy_document_versions WHERE document_id=$1', [documentId])).rows[0];
          if (Number(latest.latest) !== metadata.expected_version) throw new PolicyError(409, 'This document changed. Reload before adding a version.');
          version = Number(latest.latest) + 1;
        } else {
          documentId = randomUUID();
          await db.query('INSERT INTO public.policy_documents(id,reference,created_by) VALUES($1,$2,$3)', [documentId, metadata.reference, context.userId]);
        }
        await db.query(`INSERT INTO public.policy_document_versions(id,document_id,version,version_label,title,category,effective_date,review_date,notes,storage_path,file_name,file_size,mime_type,sha256,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [versionId, documentId, version, metadata.version_label, metadata.title, metadata.category, metadata.effective_date, metadata.review_date, metadata.notes, path, validated.name, validated.bytes.length, validated.mime, validated.hash, context.userId]);
        await db.query("INSERT INTO public.policy_document_events(document_id,version_id,action,actor_id) VALUES($1,$2,'upload',$3)", [documentId, versionId, context.userId]);
        return { id: documentId, version_id: versionId };
      });
      uploadedPath = undefined;
      return json(result, 201);
    }
    if (request.method === 'PATCH' && id) {
      const action = policyActionSchema.parse(await request.json());
      await context.transaction(async db => {
        const doc = (await db.query('SELECT * FROM public.policy_documents WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!doc) throw new PolicyError(404, 'Document not found.');
        const latest = (await db.query('SELECT max(version) AS latest FROM public.policy_document_versions WHERE document_id=$1', [id])).rows[0];
        if (Number(latest.latest) !== action.expected_version) throw new PolicyError(409, 'This document changed. Reload and try again.');
        if (action.action === 'publish') {
          if (doc.is_archived) throw new PolicyError(409, 'Restore this document before publishing.');
          const version = (await db.query('SELECT * FROM public.policy_document_versions WHERE id=$1 AND document_id=$2', [action.version_id, id])).rows[0];
          if (!version || version.status !== 'draft' || Number(version.version) !== Number(latest.latest)) throw new PolicyError(409, 'Only the latest draft can be published.');
          await db.query("UPDATE public.policy_document_versions SET status='superseded' WHERE document_id=$1 AND status='published'", [id]);
          await db.query("UPDATE public.policy_document_versions SET status='published',published_by=$1,published_at=now() WHERE id=$2", [context.userId, action.version_id]);
        } else await db.query('UPDATE public.policy_documents SET is_archived=$1 WHERE id=$2', [action.archived, id]);
        await db.query('INSERT INTO public.policy_document_events(document_id,version_id,action,actor_id) VALUES($1,$2,$3,$4)', [id, action.action === 'publish' ? action.version_id : null, action.action === 'publish' ? 'publish' : action.archived ? 'archive' : 'restore', context.userId]);
      });
      return json({ ok: true });
    }
    return json({ error: 'Method not allowed.' }, 405);
  } catch (error) {
    if (uploadedPath) { try { await context.remove(uploadedPath); } catch { /* Private orphan retained for reconciliation. */ } }
    if (error instanceof PolicyError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message || 'Invalid request.' }, 400);
    if (error instanceof SyntaxError) return json({ error: 'Invalid document metadata.' }, 400);
    if ((error as { code?: string }).code === '23505') return json({ error: 'That reference or version already exists. Open the existing document to add a version.' }, 409);
    console.error('Policy document operation failed', { code: (error as { code?: string }).code });
    return json({ error: 'Unable to load or save policies. The module may not yet be configured.' }, 500);
  }
}
