import {
  EXTERNAL_DOCUMENT_UPLOAD_FIELDS,
  EXTERNAL_DOCUMENTS_API,
  EXTERNAL_DOCUMENT_LIMITS,
  type ExternalDocument,
  type ExternalDocumentFileResponse,
  type ExternalDocumentListQuery,
  type ExternalDocumentListResponse,
  type ExternalDocumentMetadataInput,
  type ExternalDocumentOptionsResponse,
  type ExternalDocumentPatchInput,
} from '@/types/external-documents';
import { parseExternalDocument } from '@/lib/external-documents/validation';

export type ExternalDocumentsAccessLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type ExternalDocumentsAssetFilter = {
  asset_type: 'van' | 'plant' | 'hgv';
  asset_id: string;
} | null;

export type ExternalDocumentsCreateInput = {
  metadata: ExternalDocumentMetadataInput;
  file: Blob;
  fileName: string;
};

export type ExternalDocumentsAdapter = {
  list: (query: ExternalDocumentListQuery) => Promise<ExternalDocumentListResponse>;
  options: () => Promise<ExternalDocumentOptionsResponse>;
  create: (input: ExternalDocumentsCreateInput) => Promise<ExternalDocument>;
  update: (id: string, patch: ExternalDocumentPatchInput) => Promise<ExternalDocument>;
  get: (id: string) => Promise<ExternalDocument>;
  file: (id: string) => Promise<ExternalDocumentFileResponse>;
};

export class ExternalDocumentsClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ExternalDocumentsClientError';
    this.status = status;
  }
}

const DOCUMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isExternalDocumentId(value: string): boolean {
  return DOCUMENT_ID_RE.test(value);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ExternalDocumentsClientError(response.status, 'The server returned an unreadable response.');
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error.trim()) {
    return body.error;
  }
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'Document not found.';
  return `The request failed (${status}).`;
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const body = await readBody(response);
  if (!response.ok) {
    throw new ExternalDocumentsClientError(response.status, errorMessage(body, response.status));
  }
  return body;
}

function readDocument(body: unknown): ExternalDocument {
  return parseExternalDocument(body);
}

function readList(body: unknown): ExternalDocumentListResponse {
  if (!body || typeof body !== 'object') {
    throw new ExternalDocumentsClientError(500, 'Documents could not be loaded.');
  }
  const record = body as Partial<ExternalDocumentListResponse>;
  if (!Array.isArray(record.documents) || typeof record.page !== 'number' || typeof record.page_size !== 'number' || typeof record.total !== 'number') {
    throw new ExternalDocumentsClientError(500, 'Documents could not be loaded.');
  }
  return {
    documents: record.documents.map((document) => readDocument(document)),
    page: record.page,
    page_size: record.page_size,
    total: record.total,
  };
}

function readOptions(body: unknown): ExternalDocumentOptionsResponse {
  if (!body || typeof body !== 'object' || !('assets' in body) || !('readers' in body)) {
    throw new ExternalDocumentsClientError(500, 'Document options could not be loaded.');
  }
  const record = body as ExternalDocumentOptionsResponse;
  const assets = record.assets;
  if (!assets || !Array.isArray(assets.vans) || !Array.isArray(assets.plant) || !Array.isArray(assets.hgvs) || !Array.isArray(record.readers)) {
    throw new ExternalDocumentsClientError(500, 'Document options could not be loaded.');
  }
  return record;
}

function readFile(body: unknown): ExternalDocumentFileResponse {
  if (!body || typeof body !== 'object') {
    throw new ExternalDocumentsClientError(500, 'The document file could not be opened.');
  }
  const record = body as Partial<ExternalDocumentFileResponse>;
  if (typeof record.url !== 'string' || !record.url || typeof record.expires_in !== 'number') {
    throw new ExternalDocumentsClientError(500, 'The document file could not be opened.');
  }
  return { url: record.url, expires_in: record.expires_in };
}

export function buildExternalDocumentsListUrl(query: ExternalDocumentListQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.asset_type && query.asset_id) {
    params.set('asset_type', query.asset_type);
    params.set('asset_id', query.asset_id);
  }
  params.set('archive', query.archive);
  params.set('page', String(query.page));
  params.set('page_size', String(query.page_size));
  return `${EXTERNAL_DOCUMENTS_API.collection}?${params.toString()}`;
}

export const httpExternalDocumentsAdapter: ExternalDocumentsAdapter = {
  list(query) {
    return requestJson(buildExternalDocumentsListUrl(query)).then(readList);
  },
  options() {
    return requestJson(`${EXTERNAL_DOCUMENTS_API.collection}?options=1`).then(readOptions);
  },
  create(input) {
    const formData = new FormData();
    formData.set(EXTERNAL_DOCUMENT_UPLOAD_FIELDS.metadata, JSON.stringify(input.metadata));
    formData.set(EXTERNAL_DOCUMENT_UPLOAD_FIELDS.file, input.file, input.fileName);
    return requestJson(EXTERNAL_DOCUMENTS_API.collection, { method: 'POST', body: formData }).then(readDocument);
  },
  update(id, patch) {
    return requestJson(EXTERNAL_DOCUMENTS_API.detail(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(readDocument);
  },
  get(id) {
    return requestJson(EXTERNAL_DOCUMENTS_API.detail(id)).then(readDocument);
  },
  file(id) {
    return requestJson(EXTERNAL_DOCUMENTS_API.file(id)).then(readFile);
  },
};

export { EXTERNAL_DOCUMENT_LIMITS };
