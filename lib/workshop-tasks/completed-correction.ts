import { createHash } from 'crypto';
import { z } from 'zod';
import { WORKSHOP_TASK_COMMENT_MIN_LENGTH } from '@/lib/workshop-tasks/validation';

export const CORRECTION_REASON_MIN_LENGTH = 10;

export const CorrectCompletedTaskBodySchema = z
  .object({
    reason: z.string().trim().min(CORRECTION_REASON_MIN_LENGTH),
    expectedUpdatedAt: z
      .string()
      .trim()
      .min(1)
      .refine((value) => Number.isFinite(Date.parse(value)), 'expectedUpdatedAt must be a valid timestamp'),
    workshop_comments: z.string().trim().min(WORKSHOP_TASK_COMMENT_MIN_LENGTH).optional(),
    meter_reading: z.number().int().nonnegative().optional(),
    vehicle_id: z.string().uuid().optional(),
    asset_type: z.enum(['van', 'hgv', 'plant']).optional(),
    workshop_category_id: z.string().uuid().nullable().optional(),
    workshop_subcategory_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAsset = Boolean(value.vehicle_id) || Boolean(value.asset_type);
    if (Boolean(value.vehicle_id) !== Boolean(value.asset_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'vehicle_id and asset_type must be provided together',
      });
    }
    if (
      !value.workshop_comments &&
      value.meter_reading === undefined &&
      !hasAsset &&
      value.workshop_category_id === undefined &&
      value.workshop_subcategory_id === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one correctable field is required',
      });
    }
  });

export type CorrectCompletedTaskBody = z.infer<typeof CorrectCompletedTaskBodySchema>;

export const CorrectAttachmentResponsesBodySchema = z
  .object({
    reason: z.string().trim().min(CORRECTION_REASON_MIN_LENGTH),
    expectedPreimageHash: z.string().min(8),
    responses: z
      .array(
        z
          .object({
            field_id: z.string().uuid().nullable().optional(),
            section_key: z.string().trim().min(1),
            field_key: z.string().trim().min(1),
            response_value: z.string().nullable().optional(),
            response_json: z.record(z.string(), z.unknown()).nullable().optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

export type CorrectAttachmentResponsesBody = z.infer<typeof CorrectAttachmentResponsesBodySchema>;

export interface CanonicalAttachmentResponse {
  section_key: string;
  field_key: string;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

export function canonicalizeAttachmentResponses(
  responses: Array<{
    section_key?: string | null;
    field_key?: string | null;
    response_value?: string | null;
    response_json?: Record<string, unknown> | null;
  }>
): CanonicalAttachmentResponse[] {
  return responses
    .map((response) => ({
      section_key: String(response.section_key || '').trim(),
      field_key: String(response.field_key || '').trim(),
      response_value: response.response_value ?? null,
      response_json: response.response_json ?? null,
    }))
    .filter((response) => response.section_key.length > 0 && response.field_key.length > 0)
    .sort((left, right) => {
      const section = left.section_key.localeCompare(right.section_key);
      return section !== 0 ? section : left.field_key.localeCompare(right.field_key);
    });
}

export function hashAttachmentResponses(responses: CanonicalAttachmentResponse[]): string {
  return createHash('sha256').update(JSON.stringify(responses)).digest('hex');
}

export function diffAttachmentResponses(
  previous: CanonicalAttachmentResponse[],
  next: CanonicalAttachmentResponse[]
): {
  changedFields: string[];
  previousResponses: CanonicalAttachmentResponse[];
  newResponses: CanonicalAttachmentResponse[];
} {
  const previousMap = new Map(previous.map((row) => [`${row.section_key}::${row.field_key}`, row]));
  const nextMap = new Map(next.map((row) => [`${row.section_key}::${row.field_key}`, row]));
  const keys = new Set([...previousMap.keys(), ...nextMap.keys()]);
  const changedFields: string[] = [];
  const previousResponses: CanonicalAttachmentResponse[] = [];
  const newResponses: CanonicalAttachmentResponse[] = [];

  for (const key of keys) {
    const before = previousMap.get(key) ?? null;
    const after = nextMap.get(key) ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changedFields.push(key);
    if (before) previousResponses.push(before);
    if (after) newResponses.push(after);
  }

  return { changedFields, previousResponses, newResponses };
}

export type BoundedCorrectionValue = string | number | boolean | null;

export function boundedTaskCorrectionValues(
  before: Record<string, BoundedCorrectionValue>,
  after: Record<string, BoundedCorrectionValue>
): { before: Record<string, BoundedCorrectionValue>; after: Record<string, BoundedCorrectionValue> } {
  const changedKeys = Object.keys(after).filter((key) => before[key] !== after[key]);
  return {
    before: Object.fromEntries(changedKeys.map((key) => [key, before[key]])),
    after: Object.fromEntries(changedKeys.map((key) => [key, after[key]])),
  };
}

export function timestampsMatch(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const expectedMs = Date.parse(expected);
  const actualMs = Date.parse(actual);
  return Number.isFinite(expectedMs) && Number.isFinite(actualMs) && expectedMs === actualMs;
}
