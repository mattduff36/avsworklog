/** Explicit, resumable SharePoint import. Originals stay outside Git. Dry-run by default. */
import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { handlePolicyRequest, validatePolicyFile, type PolicyContext } from '../lib/server/policy-documents-service';
import { policyMetadataSchema, type PolicyMetadata } from '../lib/policies-procedures/schema';

config({ path: '.env.local', quiet: true });
const target = 'lrhufzqfzeutgvudcowy';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
if (args.some(arg => !['--apply', '--confirm-target', target].includes(arg)) ||
    (apply && args[args.indexOf('--confirm-target') + 1] !== target)) {
  throw new Error('Use --apply --confirm-target ' + target);
}
const root = path.resolve('data/policies-procedures');
const actor = '21db3e88-e0e5-469e-aa43-243ea0874d03'; // Matt: explicitly authorized import.
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type Source = { reference: string; title: string; category: PolicyMetadata['category']; version_label: string;
  notes: string; file_name: string; storage_path: string; sha256: string; source_path: string };

async function main() {
  const manifest = JSON.parse(await readFile(path.join(root, 'import/manifest.json'), 'utf8')) as { documents: Source[] };
  if (manifest.documents.length !== 73) throw new Error('Expected the reviewed 73-document manifest.');
  const prepared = [];
  for (const source of manifest.documents) {
    if (path.basename(source.storage_path) !== source.storage_path) throw new Error('Invalid source path.');
    const bytes = await readFile(path.join(root, 'import', source.storage_path));
    if (hash(bytes) !== source.sha256) throw new Error('Original checksum mismatch.');
    const file = new File([new Uint8Array(bytes)], source.file_name);
    await validatePolicyFile(file);
    const metadata = policyMetadataSchema.parse({ reference: source.reference, title: source.title,
      category: source.category, version_label: source.reference === 'AVS-HSMP-008' ? '7.0' : source.version_label,
      effective_date: null, review_date: null,
      notes: `Imported original from SharePoint: ${source.source_path}\nSource SHA-256: ${source.sha256}` +
        (source.reference === 'AVS-HSMP-008' ? '\nOpened in Microsoft Word and reviewed 2026-10-20. Complete two-page procedure; footer April 2026 revision 7.0. Original retained unchanged.' : '') +
        (source.reference === 'AVS-EMPLOYEE-HANDBOOK' ? '\nOriginal footer duplicates Inspection and Testing reference AVS-SHEQ-IMS-006. Retained for traceability; corrected draft follows.' : ''),
    });
    prepared.push({ file, metadata, sha256: source.sha256 });
  }
  const correctedBytes = await readFile(path.join(root, 'reviewed/Employee-Handbook-March-2026-reference-corrected.docx'));
  const correctedFile = new File([new Uint8Array(correctedBytes)], 'Employee Handbook - March 2026 - reference corrected.docx');
  await validatePolicyFile(correctedFile);
  const handbook = prepared.find(item => item.metadata.reference === 'AVS-EMPLOYEE-HANDBOOK')!;
  const corrected = { file: correctedFile, sha256: hash(correctedBytes), metadata: {
    ...handbook.metadata, version_label: 'March 2026 - reference corrected',
    notes: 'Document-control correction authorized by Matt Duffill on 2026-10-20: footer reference changed from AVS-SHEQ-IMS-006 to AVS-EMPLOYEE-HANDBOOK. Policy wording unchanged. Original retained as version 1. Remains draft pending publication.',
  } };
  const connection = new URL(process.env.POSTGRES_URL_NON_POOLING || '');
  if ((!connection.hostname.includes(target) && !decodeURIComponent(connection.username).includes(target)) ||
      connection.port !== '5432' || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname !== `${target}.supabase.co`) {
    throw new Error('Database/storage target mismatch.');
  }
  const db = new pg.Client({ host: connection.hostname, port: 5432, database: connection.pathname.slice(1),
    user: decodeURIComponent(connection.username), password: decodeURIComponent(connection.password), ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000, statement_timeout: 60000 });
  await db.connect();
  try {
    const user = await db.query("SELECT p.id FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=$1 AND lower(r.name)='admin'", [actor]);
    if (user.rowCount !== 1) throw new Error('Authorized admin identity not found.');
    const bucket = await db.query("SELECT public FROM storage.buckets WHERE id='policies-procedures'");
    if (bucket.rows.length !== 1 || bucket.rows[0].public) throw new Error('Private bucket required.');
    console.log(JSON.stringify({ target, mode: apply ? 'apply' : 'dry-run', originalsValidated: prepared.length, correctedDrafts: 1 }));
    if (!apply) return;
    await db.query("SELECT pg_advisory_lock(hashtext('squires-policy-sharepoint-import'))");
    const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from('policies-procedures');
    const context: PolicyContext = {
      userId: actor, level: 5,
      async transaction(fn) { await db.query('BEGIN'); try { const result = await fn(db); await db.query('COMMIT'); return result; } catch (error) { await db.query('ROLLBACK'); throw error; } },
      async upload(key, bytes, contentType) { const { error } = await storage.upload(key, bytes, { contentType, upsert: false }); if (error) throw error; },
      async remove(key) { const { error } = await storage.remove([key]); if (error) throw error; },
      async fileUrl() { throw new Error('Import does not issue file URLs.'); },
    };
    let imported = 0, reused = 0;
    for (const item of [...prepared, corrected]) {
      const existing = await db.query('SELECT d.id,d.is_archived,v.sha256,v.version FROM public.policy_documents d JOIN public.policy_document_versions v ON v.document_id=d.id WHERE lower(d.reference)=lower($1) ORDER BY v.version DESC', [item.metadata.reference]);
      if (existing.rows.some(row => row.sha256 === item.sha256)) { reused++; continue; }
      const metadata = { ...item.metadata };
      if (existing.rows.length) {
        if (item !== corrected || existing.rows[0].is_archived || existing.rows[0].sha256 !== handbook.sha256) throw new Error('Existing document conflicts with import: ' + item.metadata.reference);
        Object.assign(metadata, { document_id: existing.rows[0].id, expected_version: existing.rows[0].version });
      }
      const form = new FormData(); form.set('file', item.file); form.set('metadata', JSON.stringify(metadata));
      const response = await handlePolicyRequest(new NextRequest('http://localhost/api/policies-procedures', { method: 'POST', body: form }), context);
      if (!response.ok) throw new Error(`Import failed (${response.status}): ${item.metadata.reference}`);
      imported++;
      if (imported % 10 === 0) console.log(JSON.stringify({ imported, reused }));
    }
    const result = await db.query('SELECT count(DISTINCT document_id)::int AS documents,count(*)::int AS versions,count(*) FILTER(WHERE status=\'published\')::int AS published FROM public.policy_document_versions');
    console.log(JSON.stringify({ imported, reused, ...result.rows[0] }));
    const expectedHashes = new Set([...prepared, corrected].map(item => item.sha256));
    const versions = await db.query('SELECT sha256,storage_path FROM public.policy_document_versions');
    let verified = 0;
    for (const version of versions.rows.filter(row => expectedHashes.has(row.sha256))) {
      const { data, error } = await storage.download(version.storage_path);
      if (error || !data || hash(Buffer.from(await data.arrayBuffer())) !== version.sha256) throw new Error('Stored file checksum verification failed.');
      verified++;
    }
    if (verified !== 74) throw new Error('Expected 74 verified stored versions.');
    console.log(JSON.stringify({ storedFilesVerified: verified }));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Import failed'); process.exitCode = 1; });
