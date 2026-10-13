import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ZodError } from 'zod';
import { inspectExternalDocumentPdf } from '@/lib/external-documents/pdf';
import {
  parseExternalDocument,
  parseExternalDocumentListQuery,
  parseExternalDocumentMetadata,
  parseExternalDocumentPatch,
} from '@/lib/external-documents/validation';
import {
  EXTERNAL_DOCUMENT_LIMITS,
  type ExternalDocument,
  type ExternalDocumentFileResponse,
  type ExternalDocumentListQuery,
  type ExternalDocumentListResponse,
  type ExternalDocumentOptionsResponse,
  type ExternalDocumentPatchInput,
} from '@/types/external-documents';
import {
  ExternalDocumentsClientError,
  isExternalDocumentId,
  type ExternalDocumentsAdapter,
  type ExternalDocumentsCreateInput,
} from '@/lib/client/external-documents';

export const PREVIEW_CURRENT_USER_ID = '11111111-1111-4111-8111-111111111111';

export const PREVIEW_SAMPLE_READERS = [
  { id: PREVIEW_CURRENT_USER_ID, label: 'Sample User (you)' },
  { id: '22222222-2222-4222-8222-222222222222', label: 'Sample Reader Ada' },
  { id: '33333333-3333-4333-8333-333333333333', label: 'Sample Reader Ben' },
] as const;

export const PREVIEW_SAMPLE_ASSETS = {
  vans: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', label: 'Sample Van AV00 SAM' }],
  plant: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', label: 'Sample Plant EX-001' }],
  hgvs: [{ id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', label: 'Sample HGV HGV00 SAM' }],
} as const;

const SAMPLE_DOCUMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DB_NAME = 'avs-external-documents-preview';
const DB_VERSION = 1;

type FileRow = { id: string; bytes: Uint8Array };

let ready: Promise<void> | null = null;

function fail(status: number, message: string): never {
  throw new ExternalDocumentsClientError(status, message);
}

function validationError(error: unknown): never {
  if (error instanceof ZodError) {
    fail(400, error.issues[0]?.message || 'The request was not valid.');
  }
  throw error;
}

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    fail(500, 'This browser cannot store local preview documents.');
  }
  return indexedDB;
}

function openDatabase(): Promise<IDBDatabase> {
  const factory = requireIndexedDb();
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
  });
}

function finish(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

async function readAll(): Promise<ExternalDocument[]> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction('documents', 'readonly');
    const request = transaction.objectStore('documents').getAll();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
    await finish(transaction);
    return rows.map((row) => parseExternalDocument(row));
  } finally {
    db.close();
  }
}

async function readFileRow(id: string): Promise<Uint8Array> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction('files', 'readonly');
    const request = transaction.objectStore('files').get(id);
    const row = await new Promise<FileRow | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as FileRow | undefined);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
    await finish(transaction);
    const stored: unknown = row?.bytes;
    if (!row || (!(stored instanceof Uint8Array) && !(stored instanceof ArrayBuffer))) {
      fail(500, 'The local document file could not be read.');
    }
    const bytes = stored instanceof Uint8Array ? stored : new Uint8Array(stored);
    if (bytes.byteLength < 1) fail(500, 'The local document file could not be read.');
    return bytes;
  } finally {
    db.close();
  }
}

async function writeDocument(document: ExternalDocument, bytes: Uint8Array): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(['documents', 'files'], 'readwrite');
    transaction.objectStore('documents').put(document);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    transaction.objectStore('files').put({ id: document.id, bytes: copy } satisfies FileRow);
    await finish(transaction);
  } finally {
    db.close();
  }
}

async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 240]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Sample van service record. Not live data.', { x: 32, y: 120, size: 14, font });
  return pdf.save();
}

async function ensureSeed(): Promise<void> {
  const existing = await readAll();
  if (existing.length > 0) return;
  const bytes = await samplePdf();
  const inspected = await inspectExternalDocumentPdf(bytes, 'sample-service.pdf');
  const now = new Date().toISOString();
  const document = parseExternalDocument({
    id: SAMPLE_DOCUMENT_ID,
    title: 'Sample van service record',
    category: 'Service record',
    external_company: 'Sample Garage Ltd',
    document_date: '2026-03-01',
    expiry_date: '2027-03-01',
    reference: 'SAMPLE-VAN-001',
    notes: 'Sample record stored only in this browser.',
    van_id: PREVIEW_SAMPLE_ASSETS.vans[0].id,
    plant_id: null,
    hgv_id: null,
    shared_with: [PREVIEW_CURRENT_USER_ID, PREVIEW_SAMPLE_READERS[1].id],
    file_name: 'sample-service.pdf',
    file_size: bytes.byteLength,
    page_count: inspected.pageCount,
    source: 'upload',
    source_files: ['sample-service.pdf'],
    uploaded_by: PREVIEW_CURRENT_USER_ID,
    created_at: now,
    updated_at: now,
    is_archived: false,
  });
  await writeDocument(document, bytes);
}

function databaseReady(): Promise<void> {
  if (!ready) {
    ready = ensureSeed().catch((error: unknown) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

function canRead(accessLevel: number, userId: string, document: ExternalDocument): boolean {
  if (accessLevel >= 4) return true;
  if (document.is_archived) return false;
  const key = userId.toLowerCase();
  return document.shared_with.some((id) => id.toLowerCase() === key);
}

function assetIds(type: 'van' | 'plant' | 'hgv'): Set<string> {
  return new Set(PREVIEW_SAMPLE_ASSETS[type === 'van' ? 'vans' : type === 'plant' ? 'plant' : 'hgvs'].map((asset) => asset.id.toLowerCase()));
}

function assertKnownAssets(links: { van_id: string | null; plant_id: string | null; hgv_id: string | null }) {
  const selected = [links.van_id, links.plant_id, links.hgv_id].filter((id) => id != null);
  if (selected.length > 1) fail(400, 'Link a document to only one van, plant item, or HGV.');
  if (links.van_id && !assetIds('van').has(links.van_id.toLowerCase())) fail(400, 'That asset could not be found.');
  if (links.plant_id && !assetIds('plant').has(links.plant_id.toLowerCase())) fail(400, 'That asset could not be found.');
  if (links.hgv_id && !assetIds('hgv').has(links.hgv_id.toLowerCase())) fail(400, 'That asset could not be found.');
}

function canonicalReaders(ids: string[]): string[] {
  const catalog = new Map(PREVIEW_SAMPLE_READERS.map((reader) => [reader.id.toLowerCase(), reader.id]));
  if (ids.some((id) => !catalog.has(id.toLowerCase()))) {
    fail(400, 'One or more people to share with could not be found.');
  }
  return ids.map((id) => catalog.get(id.toLowerCase()) as string);
}

function searchText(value: string | null): string {
  return (value ?? '').toLowerCase();
}

function matchesQuery(document: ExternalDocument, query: ExternalDocumentListQuery): boolean {
  if (query.category && document.category !== query.category) return false;
  if (query.asset_type === 'van' && document.van_id?.toLowerCase() !== query.asset_id?.toLowerCase()) return false;
  if (query.asset_type === 'plant' && document.plant_id?.toLowerCase() !== query.asset_id?.toLowerCase()) return false;
  if (query.asset_type === 'hgv' && document.hgv_id?.toLowerCase() !== query.asset_id?.toLowerCase()) return false;
  if (query.archive === 'active' && document.is_archived) return false;
  if (query.archive === 'archived' && !document.is_archived) return false;
  const cleaned = (query.q ?? '').trim().slice(0, 80).replace(/[%_\\",()]/g, '').toLowerCase();
  if (!cleaned) return true;
  return [document.title, document.external_company, document.reference, document.notes]
    .some((value) => searchText(value).includes(cleaned));
}

function findStored(documents: ExternalDocument[], id: string): ExternalDocument | null {
  return documents.find((document) => document.id.toLowerCase() === id.toLowerCase()) ?? null;
}

export function createPreviewExternalDocumentsAdapter(input: {
  accessLevel: number;
  userId: string;
}): ExternalDocumentsAdapter {
  const accessLevel = input.accessLevel;
  const userId = input.userId;

  function assertLevel(minimum: number) {
    if (accessLevel < minimum) fail(403, 'Forbidden');
  }

  return {
    async list(rawQuery): Promise<ExternalDocumentListResponse> {
      assertLevel(1);
      let query: ExternalDocumentListQuery;
      try {
        query = parseExternalDocumentListQuery(rawQuery);
      } catch (error) {
        validationError(error);
      }
      if (accessLevel < 4 && query.archive !== 'active') fail(403, 'Forbidden');
      await databaseReady();
      const documents = (await readAll())
        .filter((document) => canRead(accessLevel, userId, document) && matchesQuery(document, query))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id));
      const from = (query.page - 1) * query.page_size;
      return {
        documents: documents.slice(from, from + query.page_size),
        page: query.page,
        page_size: query.page_size,
        total: documents.length,
      };
    },
    async options(): Promise<ExternalDocumentOptionsResponse> {
      assertLevel(4);
      await databaseReady();
      return {
        assets: {
          vans: [...PREVIEW_SAMPLE_ASSETS.vans],
          plant: [...PREVIEW_SAMPLE_ASSETS.plant],
          hgvs: [...PREVIEW_SAMPLE_ASSETS.hgvs],
        },
        readers: [...PREVIEW_SAMPLE_READERS],
      };
    },
    async create(createInput: ExternalDocumentsCreateInput): Promise<ExternalDocument> {
      assertLevel(4);
      let metadata;
      try {
        metadata = parseExternalDocumentMetadata(createInput.metadata);
      } catch (error) {
        validationError(error);
      }
      assertKnownAssets(metadata);
      const sharedWith = canonicalReaders(metadata.shared_with);
      const bytes = new Uint8Array(await createInput.file.arrayBuffer());
      if (bytes.byteLength > EXTERNAL_DOCUMENT_LIMITS.maxOutputBytes) {
        fail(413, 'The PDF is larger than the 4 MB upload limit. Reduce the file and try again.');
      }
      const inspected = await inspectExternalDocumentPdf(bytes, createInput.fileName || 'document.pdf');
      await databaseReady();
      const now = new Date().toISOString();
      const document = parseExternalDocument({
        id: crypto.randomUUID(),
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
        file_name: createInput.fileName.toLowerCase().endsWith('.pdf') ? createInput.fileName.slice(0, 180) : 'document.pdf',
        file_size: bytes.byteLength,
        page_count: inspected.pageCount,
        source: 'upload',
        source_files: metadata.source_files,
        uploaded_by: userId,
        created_at: now,
        updated_at: now,
        is_archived: false,
      });
      await writeDocument(document, bytes);
      return document;
    },
    async update(id, patchInput): Promise<ExternalDocument> {
      assertLevel(4);
      if (!isExternalDocumentId(id)) fail(400, 'Use a valid document id.');
      let patch: ExternalDocumentPatchInput;
      try {
        patch = parseExternalDocumentPatch(patchInput);
      } catch (error) {
        validationError(error);
      }
      await databaseReady();
      const current = findStored(await readAll(), id);
      if (!current) fail(404, 'Document not found.');
      const nextLinks = {
        van_id: patch.van_id !== undefined ? patch.van_id : current.van_id,
        plant_id: patch.plant_id !== undefined ? patch.plant_id : current.plant_id,
        hgv_id: patch.hgv_id !== undefined ? patch.hgv_id : current.hgv_id,
      };
      assertKnownAssets(nextLinks);
      const documentDate = patch.document_date ?? current.document_date;
      const expiryDate = patch.expiry_date !== undefined ? patch.expiry_date : current.expiry_date;
      if (expiryDate && expiryDate < documentDate) fail(400, 'The expiry date cannot be earlier than the document date.');
      const next = parseExternalDocument({
        ...current,
        ...patch,
        ...nextLinks,
        shared_with: patch.shared_with ? canonicalReaders(patch.shared_with) : current.shared_with,
        updated_at: new Date().toISOString(),
      });
      const bytes = await readFileRow(current.id);
      await writeDocument(next, bytes);
      return next;
    },
    async get(id): Promise<ExternalDocument> {
      assertLevel(1);
      if (!isExternalDocumentId(id)) fail(400, 'Use a valid document id.');
      await databaseReady();
      const document = findStored(await readAll(), id);
      if (!document || !canRead(accessLevel, userId, document)) fail(404, 'Document not found.');
      return document;
    },
    async file(id): Promise<ExternalDocumentFileResponse> {
      assertLevel(1);
      if (!isExternalDocumentId(id)) fail(400, 'Use a valid document id.');
      await databaseReady();
      const document = findStored(await readAll(), id);
      if (!document || !canRead(accessLevel, userId, document)) fail(404, 'Document not found.');
      const bytes = await readFileRow(document.id);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return {
        url: URL.createObjectURL(new Blob([copy], { type: 'application/pdf' })),
        expires_in: EXTERNAL_DOCUMENT_LIMITS.signedUrlSeconds,
      };
    },
  };
}
