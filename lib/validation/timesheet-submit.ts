import { z } from 'zod';
import { timesheetEntryHasWorkingHours } from '@/lib/utils/timesheet-bank-holiday-work';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u;
const SIGNATURE_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const MAX_SIGNATURE_CHARS = 512_000;
const MAX_TEXT = 500;

const optionalText = z
  .string()
  .trim()
  .max(MAX_TEXT)
  .nullable()
  .optional()
  .transform((value) => value || null);

const TimesheetSubmitEntrySchema = z
  .object({
    day_of_week: z.number().int().min(1).max(7),
    time_started: z.string().regex(TIME_PATTERN).nullable().optional(),
    time_finished: z.string().regex(TIME_PATTERN).nullable().optional(),
    operator_travel_hours: z.number().min(0).max(24).nullable().optional(),
    operator_yard_hours: z.number().min(0).max(24).nullable().optional(),
    operator_working_hours: z.number().min(0).max(24).nullable().optional(),
    machine_travel_hours: z.number().min(0).max(24).nullable().optional(),
    machine_start_time: z.string().regex(TIME_PATTERN).nullable().optional(),
    machine_finish_time: z.string().regex(TIME_PATTERN).nullable().optional(),
    machine_working_hours: z.number().min(0).max(24).nullable().optional(),
    machine_standing_hours: z.number().min(0).max(24).nullable().optional(),
    machine_operator_hours: z.number().min(0).max(24).nullable().optional(),
    maintenance_breakdown_hours: z.number().min(0).max(24).nullable().optional(),
    job_number: z.string().trim().max(64).nullable().optional(),
    job_numbers: z.array(z.string().trim().min(1).max(64)).max(8).nullable().optional(),
    did_not_work: z.boolean().nullable().optional(),
    working_in_yard: z.boolean().nullable().optional(),
    subsistence_payment_required: z.boolean().nullable().optional(),
    daily_total: z.number().min(0).max(24).nullable().optional(),
    night_shift: z.boolean().nullable().optional(),
    bank_holiday: z.boolean().nullable().optional(),
    remarks: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const TimesheetSubmitBodySchema = z
  .object({
    timesheetId: z.string().uuid().nullable().optional(),
    userId: z.string().uuid(),
    weekEnding: z.string().regex(ISO_DATE_PATTERN),
    timesheetType: z.enum(['civils', 'plant']),
    templateVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    regNumber: optionalText,
    siteAddress: optionalText,
    hirerName: optionalText,
    isHiredPlant: z.boolean().nullable().optional(),
    hiredPlantIdSerial: optionalText,
    hiredPlantDescription: optionalText,
    hiredPlantHiringCompany: optionalText,
    signatureData: z
      .string()
      .min(32)
      .max(MAX_SIGNATURE_CHARS)
      .regex(SIGNATURE_PATTERN, 'Signature must be a PNG, JPEG, or WebP data URL'),
    entries: z.array(TimesheetSubmitEntrySchema).length(7),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<number>();
    for (const entry of body.entries) {
      if (seen.has(entry.day_of_week)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries'],
          message: 'Each day of the week must appear once',
        });
        return;
      }
      seen.add(entry.day_of_week);
      if (
        entry.did_not_work &&
        (timesheetEntryHasWorkingHours(entry) || entry.subsistence_payment_required === true)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', entry.day_of_week - 1],
          message: 'Did not work entries cannot contain work hours or payment claims',
        });
        return;
      }
      const hasHours = Boolean(entry.time_started && entry.time_finished);
      if (!hasHours && !entry.did_not_work) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries'],
          message: 'Each day must have hours or be marked did not work',
        });
        return;
      }
    }
    for (let day = 1; day <= 7; day += 1) {
      if (!seen.has(day)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries'],
          message: 'Submit requires all seven days',
        });
        return;
      }
    }
  });

export type TimesheetSubmitBodyInput = z.input<typeof TimesheetSubmitBodySchema>;
export type TimesheetSubmitBody = z.output<typeof TimesheetSubmitBodySchema>;

export interface TimesheetSubmitValidationIssue {
  path: Array<string | number>;
  message: string;
  code: string;
}

function getSafeValidationMessage(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return 'Invalid field type';
    case 'too_big':
    case 'too_small':
      return 'Field is outside the allowed range';
    case 'invalid_format':
      return 'Invalid field format';
    case 'unrecognized_keys':
      return 'Unexpected field';
    case 'custom':
      return 'Invalid field combination';
    default:
      return 'Invalid field value';
  }
}

export function getTimesheetSubmitValidationIssues(
  error: z.ZodError
): TimesheetSubmitValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => (
      typeof segment === 'symbol' ? segment.description || 'symbol' : segment
    )),
    message: getSafeValidationMessage(issue),
    code: issue.code,
  }));
}
