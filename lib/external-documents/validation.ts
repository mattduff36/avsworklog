import { z } from 'zod';
import {
  EXTERNAL_DOCUMENT_CATEGORIES,
  EXTERNAL_DOCUMENT_LIMITS,
  type ExternalDocument,
  type ExternalDocumentListQuery,
  type ExternalDocumentMetadataInput,
  type ExternalDocumentPatchInput,
} from '@/types/external-documents';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const categorySchema = z.enum(EXTERNAL_DOCUMENT_CATEGORIES);
const uuidSchema = z.string().uuid('Use a valid id.');
const assetTypeSchema = z.enum(['van', 'plant', 'hgv']);

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

const isoDateSchema = z.string().refine(isIsoDate, 'Use a real YYYY-MM-DD date.');

const requiredTextSchema = (max: number, message: string) => z.string().trim().min(1, message).max(max);

const optionalTextSchema = (max: number) => z.union([
  z.string().trim().max(max),
  z.null(),
]).transform((value) => (value ? value : null));

const sourceFileNameSchema = z.string().trim().min(1, 'Each original file needs a name.').max(255).refine(
  (value) => !/[\u0000-\u001f\\/]/.test(value),
  'Original file names cannot include folders or control characters.',
);

const nullableUuidSchema = z.union([uuidSchema, z.null()]);

function assertSingleAsset(
  value: { van_id?: string | null; plant_id?: string | null; hgv_id?: string | null },
  ctx: z.RefinementCtx,
) {
  const selected = [value.van_id, value.plant_id, value.hgv_id].filter((id) => id != null);
  if (selected.length > 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'Link a document to only one van, plant item, or HGV.',
    });
  }
}

function assertDateOrder(
  value: { document_date?: string; expiry_date?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.document_date && value.expiry_date && value.expiry_date < value.document_date) {
    ctx.addIssue({
      code: 'custom',
      message: 'The expiry date cannot be earlier than the document date.',
    });
  }
}

const uniqueUuids = z.array(uuidSchema).max(200).transform((ids) => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(id);
  }
  return unique;
});

export const externalDocumentMetadataSchema = z.object({
  title: requiredTextSchema(200, 'Enter a title.'),
  category: categorySchema,
  external_company: requiredTextSchema(200, 'Enter the external company.'),
  document_date: isoDateSchema,
  expiry_date: z.union([isoDateSchema, z.null()]).optional(),
  reference: optionalTextSchema(120).optional(),
  notes: optionalTextSchema(4000).optional(),
  van_id: nullableUuidSchema.optional(),
  plant_id: nullableUuidSchema.optional(),
  hgv_id: nullableUuidSchema.optional(),
  shared_with: uniqueUuids.optional(),
  source_files: z.array(sourceFileNameSchema).min(1, 'Add at least one original file.').max(
    EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles,
    `Choose ${EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles} files or fewer.`,
  ),
}).strict().superRefine((value, ctx) => {
  assertSingleAsset(value, ctx);
  assertDateOrder(value, ctx);
}).transform((value) => ({
  title: value.title,
  category: value.category,
  external_company: value.external_company,
  document_date: value.document_date,
  expiry_date: value.expiry_date ?? null,
  reference: value.reference ?? null,
  notes: value.notes ?? null,
  van_id: value.van_id ?? null,
  plant_id: value.plant_id ?? null,
  hgv_id: value.hgv_id ?? null,
  shared_with: value.shared_with ?? [],
  source_files: value.source_files,
}));

export const externalDocumentPatchSchema = z.object({
  title: requiredTextSchema(200, 'Enter a title.').optional(),
  category: categorySchema.optional(),
  external_company: requiredTextSchema(200, 'Enter the external company.').optional(),
  document_date: isoDateSchema.optional(),
  expiry_date: z.union([isoDateSchema, z.null()]).optional(),
  reference: optionalTextSchema(120).optional(),
  notes: optionalTextSchema(4000).optional(),
  van_id: nullableUuidSchema.optional(),
  plant_id: nullableUuidSchema.optional(),
  hgv_id: nullableUuidSchema.optional(),
  shared_with: uniqueUuids.optional(),
  is_archived: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({ code: 'custom', message: 'No changes were provided.' });
  }
  assertSingleAsset(value, ctx);
  assertDateOrder(value, ctx);
});

export const externalDocumentListQuerySchema = z.object({
  q: z.string().trim().max(80).nullable().default(null),
  category: categorySchema.nullable().default(null),
  asset_type: assetTypeSchema.nullable().default(null),
  asset_id: uuidSchema.nullable().default(null),
  archive: z.enum(['active', 'archived', 'all']).default('active'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  page_size: z.coerce.number().int().min(1).max(EXTERNAL_DOCUMENT_LIMITS.maxPageSize).default(
    EXTERNAL_DOCUMENT_LIMITS.defaultPageSize,
  ),
}).strict().superRefine((value, ctx) => {
  const hasType = value.asset_type != null;
  const hasId = value.asset_id != null;
  if (hasType !== hasId) {
    ctx.addIssue({
      code: 'custom',
      message: 'Choose both an asset type and an asset.',
    });
  }
});

const timestampSchema = z.string().regex(TIMESTAMP_RE);

export const externalDocumentSchema = z.object({
  id: uuidSchema,
  title: z.string().trim().min(1).max(200),
  category: categorySchema,
  external_company: z.string().trim().min(1).max(200),
  document_date: isoDateSchema,
  expiry_date: z.union([isoDateSchema, z.null()]),
  reference: z.union([z.string().max(120), z.null()]),
  notes: z.union([z.string().max(4000), z.null()]),
  van_id: nullableUuidSchema,
  plant_id: nullableUuidSchema,
  hgv_id: nullableUuidSchema,
  shared_with: z.array(uuidSchema),
  file_name: z.string().trim().min(1).max(180),
  file_size: z.number().int().positive().max(EXTERNAL_DOCUMENT_LIMITS.maxOutputBytes),
  page_count: z.number().int().min(1).max(EXTERNAL_DOCUMENT_LIMITS.maxPages),
  source: z.literal('upload'),
  source_files: z.array(z.string().min(1).max(255)).min(1).max(EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles),
  uploaded_by: uuidSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  is_archived: z.boolean(),
}).strict();

export const externalDocumentStoredSchema = externalDocumentSchema.extend({
  storage_path: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i,
  ),
}).strict();

export function parseExternalDocumentMetadata(input: unknown): ExternalDocumentMetadataInput {
  return externalDocumentMetadataSchema.parse(input);
}

export function parseExternalDocumentPatch(input: unknown): ExternalDocumentPatchInput {
  return externalDocumentPatchSchema.parse(input);
}

export function parseExternalDocumentListQuery(input: unknown): ExternalDocumentListQuery {
  return externalDocumentListQuerySchema.parse(input);
}

export function parseExternalDocument(input: unknown): ExternalDocument {
  return externalDocumentSchema.parse(input);
}

export function parseStoredExternalDocument(input: unknown) {
  return externalDocumentStoredSchema.parse(input);
}
