import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { ExternalDocumentPdfError, inspectExternalDocumentPdf } from '@/lib/external-documents/pdf';
import {
  parseExternalDocument,
  parseExternalDocumentListQuery,
  parseExternalDocumentMetadata,
  parseExternalDocumentPatch,
  parseStoredExternalDocument,
} from '@/lib/external-documents/validation';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';
import { isSystemAccountProfile } from '@/lib/utils/system-accounts';
import { logServerError } from '@/lib/utils/server-error-logger';
import { getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import {
  EXTERNAL_DOCUMENT_LIMITS,
  EXTERNAL_DOCUMENT_UPLOAD_FIELDS,
  type ExternalDocument,
  type ExternalDocumentAssetOption,
  type ExternalDocumentFileResponse,
  type ExternalDocumentListResponse,
  type ExternalDocumentOptionsResponse,
  type ExternalDocumentPatchInput,
  type ExternalDocumentReaderOption,
} from '@/types/external-documents';

const BUCKET = 'external-documents';
const PUBLIC_COLUMNS = [
  'id',
  'title',
  'category',
  'external_company',
  'document_date',
  'expiry_date',
  'reference',
  'notes',
  'van_id',
  'plant_id',
  'hgv_id',
  'shared_with',
  'file_name',
  'file_size',
  'page_count',
  'source',
  'source_files',
  'uploaded_by',
  'created_at',
  'updated_at',
  'is_archived',
].join(',');
const STORED_COLUMNS = `${PUBLIC_COLUMNS},storage_path`;
const OPTION_LIMIT = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Actor = {
  userId: string;
  accessLevel: number;
};

type DbError = { message: string } | null;

type QueryResult = {
  data: unknown;
  error: DbError;
  count?: number | null;
};

type DocumentChain = {
  select: (columns: string, options?: { count?: 'exact' }) => DocumentChain;
  insert: (values: Record<string, unknown>) => DocumentChain;
  update: (values: Record<string, unknown>) => DocumentChain;
  eq: (column: string, value: string | boolean) => DocumentChain;
  contains: (column: string, value: readonly string[]) => DocumentChain;
  or: (filters: string) => DocumentChain;
  order: (column: string, options: { ascending: boolean }) => DocumentChain;
  range: (from: number, to: number) => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
};

type AdminClient = ReturnType<typeof createAdminClient>;

export class ExternalDocumentsHttpError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 413 | 500;

  constructor(status: ExternalDocumentsHttpError['status'], message: string) {
    super(message);
    this.name = 'ExternalDocumentsHttpError';
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function externalDocumentsErrorResponse(
  error: unknown,
  request: NextRequest,
  componentName: string,
) {
  if (error instanceof ExternalDocumentsHttpError) {
    return json({ error: error.message }, error.status);
  }
  if (error instanceof ExternalDocumentPdfError) {
    return json({ error: error.message }, error.status);
  }
  if (error instanceof ZodError) {
    return json({ error: error.issues[0]?.message || 'The request was not valid.' }, 400);
  }

  await logServerError({
    error: error instanceof Error ? error : new Error('Unknown external documents failure'),
    request,
    componentName,
  });
  return json({ error: 'Something went wrong while handling the document.' }, 500);
}

async function authorize(minimumLevel: number): Promise<Actor | NextResponse> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id || !UUID_RE.test(effectiveRole.user_id)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const accessLevel = await getEffectiveModuleAccessLevel('external-documents');
  if (accessLevel < 1) {
    return json({ error: 'Forbidden' }, 403);
  }

  const pinResponse = await requireSensitiveModuleAccess('external-documents');
  if (pinResponse) {
    pinResponse.headers.set('Cache-Control', 'no-store');
    return pinResponse;
  }

  if (accessLevel < minimumLevel) {
    return json({ error: 'Forbidden' }, 403);
  }

  return { userId: effectiveRole.user_id, accessLevel };
}

function documents(admin: AdminClient): DocumentChain {
  return (admin as unknown as { from: (table: 'external_documents') => DocumentChain }).from(
    'external_documents',
  );
}

function canReadDocument(
  actor: Actor,
  document: { shared_with: string[]; is_archived: boolean },
): boolean {
  if (actor.accessLevel >= 4) return true;
  if (document.is_archived) return false;
  const userId = actor.userId.toLowerCase();
  return document.shared_with.some((id) => id.toLowerCase() === userId);
}

function readPublicDocument(row: unknown): ExternalDocument {
  try {
    return parseExternalDocument(row);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ExternalDocumentsHttpError(500, 'A stored document could not be read.');
    }
    throw error;
  }
}

function readStoredDocument(row: unknown) {
  try {
    return parseStoredExternalDocument(row);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ExternalDocumentsHttpError(500, 'A stored document could not be read.');
    }
    throw error;
  }
}

async function logQueryFailure(error: DbError, request: NextRequest, componentName: string) {
  await logServerError({
    error: new Error(error?.message || 'External documents query failed'),
    request,
    componentName,
  });
}

function pdfFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/[^\w.\- ()]+/g, '').trim().slice(0, 180);
  if (!cleaned.toLowerCase().endsWith('.pdf')) return 'document.pdf';
  return cleaned;
}

function searchOrFilter(raw: string): string | null {
  const cleaned = raw.trim().slice(0, 80).replace(/[%_\\",()]/g, '');
  if (!cleaned) return null;
  const pattern = `%${cleaned}%`;
  return ['title', 'external_company', 'reference', 'notes']
    .map((column) => `${column}.ilike."${pattern}"`)
    .join(',');
}

function optionLabel(parts: Array<string | null | undefined>, fallback: string): string {
  const text = parts
    .map((part) => part?.replace(/[\u0000-\u001f]/g, '').trim())
    .filter((part): part is string => Boolean(part))
    .join(' · ');
  return text || fallback;
}

async function assertComplete(
  result: QueryResult,
  request: NextRequest,
  componentName: string,
): Promise<unknown[]> {
  if (result.error || !Array.isArray(result.data)) {
    await logQueryFailure(result.error, request, componentName);
    throw new ExternalDocumentsHttpError(500, 'Document options could not be loaded.');
  }
  if (typeof result.count === 'number' && result.count > result.data.length) {
    throw new ExternalDocumentsHttpError(500, 'Document options could not be loaded.');
  }
  return result.data;
}

async function loadOptions(admin: AdminClient, request: NextRequest): Promise<ExternalDocumentOptionsResponse> {
  const [vansResult, plantResult, hgvResult, readerResult] = await Promise.all([
    admin
      .from('vans')
      .select('id, reg_number, nickname, status, asset_type', { count: 'exact' })
      .or('asset_type.is.null,asset_type.eq.vehicle')
      .limit(OPTION_LIMIT),
    admin
      .from('plant')
      .select('id, plant_id, nickname, status', { count: 'exact' })
      .limit(OPTION_LIMIT),
    admin
      .from('hgvs')
      .select('id, reg_number, nickname, retired_at', { count: 'exact' })
      .is('retired_at', null)
      .limit(OPTION_LIMIT),
    admin
      .from('profiles')
      .select('id, full_name, email, employee_id, is_placeholder, is_system_account', { count: 'exact' })
      .is('deleted_at', null)
      .eq('is_placeholder', false)
      .eq('is_system_account', false)
      .order('full_name', { ascending: true })
      .limit(OPTION_LIMIT),
  ]);

  const [vans, plant, hgvs, readers] = await Promise.all([
    assertComplete(vansResult, request, 'external-documents van options'),
    assertComplete(plantResult, request, 'external-documents plant options'),
    assertComplete(hgvResult, request, 'external-documents hgv options'),
    assertComplete(readerResult, request, 'external-documents reader options'),
  ]);

  return {
    assets: {
      vans: mapAssets(vans, ['nickname', 'reg_number'], 'Van'),
      plant: mapAssets(plant, ['nickname', 'plant_id'], 'Plant'),
      hgvs: mapAssets(hgvs, ['nickname', 'reg_number'], 'HGV'),
    },
    readers: mapReaders(readers),
  };
}

function mapAssets(
  rows: unknown[],
  fields: string[],
  fallback: string,
): ExternalDocumentAssetOption[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') {
      throw new ExternalDocumentsHttpError(500, 'Document options could not be loaded.');
    }
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string') {
      throw new ExternalDocumentsHttpError(500, 'Document options could not be loaded.');
    }
    const status = typeof record.status === 'string' ? record.status.toLowerCase() : '';
    if (status === 'retired' || record.retired_at) return [];
    const parts = fields.map((field) => (typeof record[field] === 'string' ? record[field] : null));
    return [{ id: record.id, label: optionLabel(parts, fallback) }];
  }).sort((left, right) => left.label.localeCompare(right.label));
}

function mapReaders(rows: unknown[]): ExternalDocumentReaderOption[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') {
      throw new ExternalDocumentsHttpError(500, 'Document options could not be loaded.');
    }
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.full_name !== 'string') {
      throw new ExternalDocumentsHttpError(500, 'Document options could not be loaded.');
    }
    const candidate = {
      id: record.id,
      full_name: record.full_name,
      email: typeof record.email === 'string' ? record.email : null,
      employee_id: typeof record.employee_id === 'string' ? record.employee_id : null,
      is_placeholder: record.is_placeholder === true,
      is_system_account: record.is_system_account === true,
    };
    if (
      candidate.is_placeholder
      || isSystemAccountProfile(candidate)
      || isHiddenSystemTestAccountProfile(candidate)
    ) {
      return [];
    }
    return [{ id: candidate.id, label: optionLabel([candidate.full_name], 'Person') }];
  });
}

async function assertAssetExists(admin: AdminClient, kind: 'van' | 'plant' | 'hgv', id: string) {
  const table = kind === 'van' ? 'vans' : kind === 'plant' ? 'plant' : 'hgvs';
  const { data, error } = await admin.from(table).select('id').eq('id', id).maybeSingle();
  if (error) {
    throw new ExternalDocumentsHttpError(500, 'The linked asset could not be checked.');
  }
  if (!data?.id) {
    throw new ExternalDocumentsHttpError(400, 'The selected van, plant item, or HGV does not exist.');
  }
}

async function canonicalReaderIds(admin: AdminClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, email, employee_id, is_placeholder, is_system_account, deleted_at')
    .in('id', ids);
  if (error || !Array.isArray(data)) {
    throw new ExternalDocumentsHttpError(500, 'The people to share with could not be checked.');
  }

  const usable = new Map<string, string>();
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string') continue;
    if (record.deleted_at) continue;
    const candidate = {
      id: record.id,
      full_name: typeof record.full_name === 'string' ? record.full_name : '',
      email: typeof record.email === 'string' ? record.email : null,
      employee_id: typeof record.employee_id === 'string' ? record.employee_id : null,
      is_placeholder: record.is_placeholder === true,
      is_system_account: record.is_system_account === true,
    };
    if (
      candidate.is_placeholder
      || isSystemAccountProfile(candidate)
      || isHiddenSystemTestAccountProfile(candidate)
    ) {
      continue;
    }
    usable.set(candidate.id.toLowerCase(), candidate.id);
  }

  if (usable.size !== ids.length) {
    throw new ExternalDocumentsHttpError(400, 'One or more people to share with could not be found.');
  }
  return ids.map((id) => usable.get(id.toLowerCase()) as string);
}

async function resolveAssetLinks(
  admin: AdminClient,
  links: { van_id: string | null; plant_id: string | null; hgv_id: string | null },
) {
  const selected = [
    links.van_id ? 'van' : null,
    links.plant_id ? 'plant' : null,
    links.hgv_id ? 'hgv' : null,
  ].filter(Boolean);
  if (selected.length > 1) {
    throw new ExternalDocumentsHttpError(400, 'Link a document to only one van, plant item, or HGV.');
  }
  if (links.van_id) await assertAssetExists(admin, 'van', links.van_id);
  if (links.plant_id) await assertAssetExists(admin, 'plant', links.plant_id);
  if (links.hgv_id) await assertAssetExists(admin, 'hgv', links.hgv_id);
}

async function findDocument(admin: AdminClient, id: string) {
  const result = await documents(admin).select(STORED_COLUMNS).eq('id', id).maybeSingle();
  if (result.error) {
    throw new ExternalDocumentsHttpError(500, 'The document could not be loaded.');
  }
  if (!result.data) return null;
  return readStoredDocument(result.data);
}

export async function listExternalDocuments(request: NextRequest) {
  try {
    const actorOrResponse = await authorize(1);
    if (actorOrResponse instanceof NextResponse) return actorOrResponse;
    const actor = actorOrResponse;

    if (request.nextUrl.searchParams.get('options') != null) {
      if (request.nextUrl.searchParams.get('options') !== '1') {
        return json({ error: 'Use options=1 to load upload choices.' }, 400);
      }
      if (actor.accessLevel < 4) return json({ error: 'Forbidden' }, 403);
      const admin = createAdminClient();
      return json(await loadOptions(admin, request));
    }

    const query = parseExternalDocumentListQuery({
      q: request.nextUrl.searchParams.get('q'),
      category: request.nextUrl.searchParams.get('category'),
      asset_type: request.nextUrl.searchParams.get('asset_type'),
      asset_id: request.nextUrl.searchParams.get('asset_id'),
      archive: request.nextUrl.searchParams.get('archive') ?? undefined,
      page: request.nextUrl.searchParams.get('page') ?? undefined,
      page_size: request.nextUrl.searchParams.get('page_size') ?? undefined,
    });

    if (actor.accessLevel < 4 && query.archive !== 'active') {
      return json({ error: 'Forbidden' }, 403);
    }

    const admin = createAdminClient();
    let chain = documents(admin).select(PUBLIC_COLUMNS, { count: 'exact' });
    if (actor.accessLevel < 4) {
      chain = chain.eq('is_archived', false).contains('shared_with', [actor.userId]);
    } else if (query.archive === 'active') {
      chain = chain.eq('is_archived', false);
    } else if (query.archive === 'archived') {
      chain = chain.eq('is_archived', true);
    }
    if (query.category) chain = chain.eq('category', query.category);
    if (query.asset_type && query.asset_id) {
      const column = query.asset_type === 'van' ? 'van_id' : query.asset_type === 'plant' ? 'plant_id' : 'hgv_id';
      chain = chain.eq(column, query.asset_id);
    }
    const search = query.q ? searchOrFilter(query.q) : null;
    if (search) chain = chain.or(search);

    const from = (query.page - 1) * query.page_size;
    const result = await chain
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + query.page_size - 1);

    if (result.error || !Array.isArray(result.data) || typeof result.count !== 'number') {
      await logQueryFailure(result.error, request, 'GET /api/external-documents');
      return json({ error: 'Documents could not be loaded.' }, 500);
    }

    const body: ExternalDocumentListResponse = {
      documents: result.data.filter((row) => {
        const document = readPublicDocument(row);
        return canReadDocument(actor, document);
      }).map((row) => readPublicDocument(row)),
      page: query.page,
      page_size: query.page_size,
      total: result.count,
    };
    return json(body);
  } catch (error) {
    return externalDocumentsErrorResponse(error, request, 'GET /api/external-documents');
  }
}

export async function createExternalDocument(request: NextRequest) {
  try {
    const actorOrResponse = await authorize(4);
    if (actorOrResponse instanceof NextResponse) return actorOrResponse;
    const actor = actorOrResponse;

    const formData = await request.formData();
    const metadataRaw = formData.get(EXTERNAL_DOCUMENT_UPLOAD_FIELDS.metadata);
    const file = formData.get(EXTERNAL_DOCUMENT_UPLOAD_FIELDS.file);
    if (typeof metadataRaw !== 'string' || !(file instanceof File)) {
      return json({ error: 'Upload the merged PDF and its details together.' }, 400);
    }
    if (file.size > EXTERNAL_DOCUMENT_LIMITS.maxOutputBytes) {
      return json({
        error: 'The PDF is larger than the 4 MB upload limit. Reduce the file and try again.',
      }, 413);
    }

    const metadata = parseExternalDocumentMetadata(JSON.parse(metadataRaw));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspected = await inspectExternalDocumentPdf(bytes, file.name || 'document.pdf');
    const admin = createAdminClient();
    await resolveAssetLinks(admin, metadata);
    const sharedWith = await canonicalReaderIds(admin, metadata.shared_with);
    const storagePath = `${crypto.randomUUID()}.pdf`;

    const upload = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (upload.error) {
      await logQueryFailure(upload.error, request, 'POST /api/external-documents');
      return json({ error: 'The PDF could not be stored.' }, 500);
    }

    const inserted = await documents(admin).insert({
      title: metadata.title,
      category: metadata.category,
      external_company: metadata.external_company,
      document_date: metadata.document_date,
      expiry_date: metadata.expiry_date,
      reference: metadata.reference,
      notes: metadata.notes,
      van_id: metadata.van_id,
      plant_id: metadata.plant_id,
      hgv_id: metadata.hgv_id,
      shared_with: sharedWith,
      file_name: pdfFileName(file.name || 'document.pdf'),
      file_size: bytes.byteLength,
      page_count: inspected.pageCount,
      source: 'upload',
      source_files: metadata.source_files,
      uploaded_by: actor.userId,
      is_archived: false,
      storage_path: storagePath,
    }).select(PUBLIC_COLUMNS).single();

    if (inserted.error || !inserted.data) {
      const removed = await admin.storage.from(BUCKET).remove([storagePath]);
      await logQueryFailure(inserted.error ?? removed.error, request, 'POST /api/external-documents');
      return json({ error: 'The document could not be saved.' }, 500);
    }

    return json(readPublicDocument(inserted.data), 201);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ error: 'Document details must be JSON.' }, 400);
    }
    return externalDocumentsErrorResponse(error, request, 'POST /api/external-documents');
  }
}

export async function getExternalDocument(request: NextRequest, id: string) {
  try {
    if (!UUID_RE.test(id)) return json({ error: 'Use a valid document id.' }, 400);
    const actorOrResponse = await authorize(1);
    if (actorOrResponse instanceof NextResponse) return actorOrResponse;
    const admin = createAdminClient();
    const document = await findDocument(admin, id);
    if (!document || !canReadDocument(actorOrResponse, document)) {
      return json({ error: 'Document not found.' }, 404);
    }
    const { storage_path: _storagePath, ...publicDocument } = document;
    return json(publicDocument);
  } catch (error) {
    return externalDocumentsErrorResponse(error, request, 'GET /api/external-documents/[id]');
  }
}

export async function updateExternalDocument(request: NextRequest, id: string) {
  try {
    if (!UUID_RE.test(id)) return json({ error: 'Use a valid document id.' }, 400);
    const actorOrResponse = await authorize(4);
    if (actorOrResponse instanceof NextResponse) return actorOrResponse;

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'The request body must be JSON.' }, 400);
    }
    const patch = parseExternalDocumentPatch(payload);
    const admin = createAdminClient();
    const current = await findDocument(admin, id);
    if (!current) return json({ error: 'Document not found.' }, 404);

    const nextLinks = {
      van_id: patch.van_id !== undefined ? patch.van_id : current.van_id,
      plant_id: patch.plant_id !== undefined ? patch.plant_id : current.plant_id,
      hgv_id: patch.hgv_id !== undefined ? patch.hgv_id : current.hgv_id,
    };
    await resolveAssetLinks(admin, nextLinks);
    const documentDate = patch.document_date ?? current.document_date;
    const expiryDate = patch.expiry_date !== undefined ? patch.expiry_date : current.expiry_date;
    if (expiryDate && expiryDate < documentDate) {
      return json({ error: 'The expiry date cannot be earlier than the document date.' }, 400);
    }

    const update = buildUpdate(patch, nextLinks);
    if (patch.shared_with) {
      update.shared_with = await canonicalReaderIds(admin, patch.shared_with);
    }

    const result = await documents(admin)
      .update(update)
      .eq('id', id)
      .select(PUBLIC_COLUMNS)
      .single();
    if (result.error || !result.data) {
      await logQueryFailure(result.error, request, 'PATCH /api/external-documents/[id]');
      return json({ error: 'The document could not be updated.' }, 500);
    }
    return json(readPublicDocument(result.data));
  } catch (error) {
    return externalDocumentsErrorResponse(error, request, 'PATCH /api/external-documents/[id]');
  }
}

function buildUpdate(
  patch: ExternalDocumentPatchInput,
  links: { van_id: string | null; plant_id: string | null; hgv_id: string | null },
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.external_company !== undefined) update.external_company = patch.external_company;
  if (patch.document_date !== undefined) update.document_date = patch.document_date;
  if (patch.expiry_date !== undefined) update.expiry_date = patch.expiry_date;
  if (patch.reference !== undefined) update.reference = patch.reference;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.is_archived !== undefined) update.is_archived = patch.is_archived;
  if (patch.van_id !== undefined || patch.plant_id !== undefined || patch.hgv_id !== undefined) {
    update.van_id = links.van_id;
    update.plant_id = links.plant_id;
    update.hgv_id = links.hgv_id;
  }
  return update;
}

export async function getExternalDocumentFile(request: NextRequest, id: string) {
  try {
    if (!UUID_RE.test(id)) return json({ error: 'Use a valid document id.' }, 400);
    const actorOrResponse = await authorize(1);
    if (actorOrResponse instanceof NextResponse) return actorOrResponse;
    const admin = createAdminClient();
    const document = await findDocument(admin, id);
    if (!document || !canReadDocument(actorOrResponse, document)) {
      return json({ error: 'Document not found.' }, 404);
    }

    const signed = await admin.storage
      .from(BUCKET)
      .createSignedUrl(document.storage_path, EXTERNAL_DOCUMENT_LIMITS.signedUrlSeconds, { download: document.file_name });
    if (signed.error || !signed.data?.signedUrl) {
      await logQueryFailure(signed.error, request, 'GET /api/external-documents/[id]/file');
      return json({ error: 'The document file could not be opened.' }, 500);
    }

    const body: ExternalDocumentFileResponse = {
      url: signed.data.signedUrl,
      expires_in: EXTERNAL_DOCUMENT_LIMITS.signedUrlSeconds,
    };
    return json(body);
  } catch (error) {
    return externalDocumentsErrorResponse(error, request, 'GET /api/external-documents/[id]/file');
  }
}
