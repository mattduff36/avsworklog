export const EXTERNAL_DOCUMENT_CATEGORIES = [
  'Service record',
  'Inspection report',
  'Certificate',
  'Warranty',
  'Invoice',
  'Other',
] as const;

export type ExternalDocumentCategory = (typeof EXTERNAL_DOCUMENT_CATEGORIES)[number];

export type ExternalDocumentAssetType = 'van' | 'plant' | 'hgv';

export type ExternalDocumentArchiveFilter = 'active' | 'archived' | 'all';

export type ExternalDocumentSource = 'upload';

export const EXTERNAL_DOCUMENT_LIMITS = {
  maxSourceFiles: 20,
  maxCombinedInputBytes: 20 * 1024 * 1024,
  maxPages: 200,
  maxOutputBytes: 4 * 1024 * 1024,
  signedUrlSeconds: 900,
  defaultPageSize: 25,
  maxPageSize: 50,
} as const;

export const EXTERNAL_DOCUMENT_UPLOAD_FIELDS = {
  file: 'file',
  metadata: 'metadata',
} as const;

export const EXTERNAL_DOCUMENTS_API = {
  collection: '/api/external-documents',
  detail: (id: string) => `/api/external-documents/${id}`,
  file: (id: string) => `/api/external-documents/${id}/file`,
} as const;

export type ExternalDocument = {
  id: string;
  title: string;
  category: ExternalDocumentCategory;
  external_company: string;
  document_date: string;
  expiry_date: string | null;
  reference: string | null;
  notes: string | null;
  van_id: string | null;
  plant_id: string | null;
  hgv_id: string | null;
  shared_with: string[];
  file_name: string;
  file_size: number;
  page_count: number;
  source: ExternalDocumentSource;
  source_files: string[];
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  is_archived: boolean;
};

export type ExternalDocumentMetadataInput = {
  title: string;
  category: ExternalDocumentCategory;
  external_company: string;
  document_date: string;
  expiry_date: string | null;
  reference: string | null;
  notes: string | null;
  van_id: string | null;
  plant_id: string | null;
  hgv_id: string | null;
  shared_with: string[];
  source_files: string[];
};

export type ExternalDocumentPatchInput = {
  title?: string;
  category?: ExternalDocumentCategory;
  external_company?: string;
  document_date?: string;
  expiry_date?: string | null;
  reference?: string | null;
  notes?: string | null;
  van_id?: string | null;
  plant_id?: string | null;
  hgv_id?: string | null;
  shared_with?: string[];
  is_archived?: boolean;
};

export type ExternalDocumentListQuery = {
  q: string | null;
  category: ExternalDocumentCategory | null;
  asset_type: ExternalDocumentAssetType | null;
  asset_id: string | null;
  archive: ExternalDocumentArchiveFilter;
  page: number;
  page_size: number;
};

export type ExternalDocumentListResponse = {
  documents: ExternalDocument[];
  page: number;
  page_size: number;
  total: number;
};

export type ExternalDocumentAssetOption = {
  id: string;
  label: string;
};

export type ExternalDocumentReaderOption = {
  id: string;
  label: string;
};

export type ExternalDocumentOptionsResponse = {
  assets: {
    vans: ExternalDocumentAssetOption[];
    plant: ExternalDocumentAssetOption[];
    hgvs: ExternalDocumentAssetOption[];
  };
  readers: ExternalDocumentReaderOption[];
};

export type ExternalDocumentFileResponse = {
  url: string;
  expires_in: number;
};

export type ExternalDocumentPdfSource = {
  name: string;
  bytes: Uint8Array;
};

export type CombinedExternalDocumentPdf = {
  bytes: Uint8Array;
  pageCount: number;
  fileName: 'combined.pdf';
};
