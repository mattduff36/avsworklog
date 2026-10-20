import { z } from 'zod';
import { isIsoDate } from '@/lib/external-documents/validation';

export const POLICY_CATEGORIES = ['Company policies', 'Environmental procedures', 'Health and safety procedures', 'Quality management procedures', 'Manuals and handbooks'] as const;
export const POLICY_MAX_BYTES = 4 * 1024 * 1024;
export const policyDate = z.string().refine(isIsoDate, 'Use a real YYYY-MM-DD date.');
export const policyMetadataSchema = z.object({
  document_id: z.string().uuid().optional(),
  expected_version: z.number().int().positive().optional(),
  reference: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._ -]+$/),
  title: z.string().trim().min(1).max(200),
  category: z.enum(POLICY_CATEGORIES),
  version_label: z.string().trim().min(1).max(60),
  effective_date: policyDate.nullable().default(null),
  review_date: policyDate.nullable().default(null),
  notes: z.string().trim().max(4000).default(''),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.document_id) !== Boolean(value.expected_version)) ctx.addIssue({ code: 'custom', message: 'Supply the current version when replacing a document.' });
  if (value.review_date && value.effective_date && value.review_date < value.effective_date) ctx.addIssue({ code: 'custom', message: 'Review date must not precede the effective date.' });
});
export const policyActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish'), version_id: z.string().uuid(), expected_version: z.number().int().positive(), confirm_complete: z.literal(true) }).strict(),
  z.object({ action: z.literal('archive'), archived: z.boolean(), expected_version: z.number().int().positive() }).strict(),
]);
export type PolicyMetadata = z.infer<typeof policyMetadataSchema>;
export interface PolicyVersion {
  id: string; document_id: string; reference: string; title: string;
  category: typeof POLICY_CATEGORIES[number]; version: number; version_label: string;
  status: 'draft' | 'published' | 'superseded'; is_archived: boolean;
  effective_date: string | null; review_date: string | null; notes: string;
  file_name: string; file_size: number; mime_type: string; sha256: string;
  created_at: string; published_at: string | null;
}
export type PolicyAction = z.infer<typeof policyActionSchema>;
export interface PolicyAdapter {
  list(): Promise<PolicyVersion[]>;
  versions(id: string): Promise<PolicyVersion[]>;
  upload(file: File, metadata: PolicyMetadata): Promise<void>;
  action(id: string, action: PolicyAction): Promise<void>;
  file(id: string, versionId: string): Promise<string>;
}
