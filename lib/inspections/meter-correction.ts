import { z } from 'zod';

export const InspectionAssetTypeSchema = z.enum(['van', 'plant', 'hgv']);
export type InspectionAssetType = z.infer<typeof InspectionAssetTypeSchema>;

export const InspectionMeterIdentitySchema = z.object({
  assetType: InspectionAssetTypeSchema,
  inspectionId: z.string().uuid(),
}).strict();

export const InspectionMeterCorrectionSchema = InspectionMeterIdentitySchema.extend({
  reading: z.number().int().min(0).max(2147483647),
  expectedReading: z.number().int().nonnegative().nullable(),
  expectedVersion: z.string().min(1).max(100),
  comment: z.string().trim().max(2000).optional(),
}).strict();

export type InspectionMeterCorrection = z.infer<typeof InspectionMeterCorrectionSchema>;

export function inspectionMeterUnit(assetType: InspectionAssetType): string {
  return assetType === 'plant' ? 'hours' : assetType === 'hgv' ? 'km' : 'miles';
}

export function formatInspectionMeter(reading: number | null | undefined, assetType: InspectionAssetType): string {
  return reading == null ? 'Not recorded' : `${reading.toLocaleString('en-GB')} ${inspectionMeterUnit(assetType)}`;
}

// Role class is the same source used by useAuth's manager flag. Module level
// alone must not promote supervisors or employees to correction privileges.
export function canCorrectInspectionMeter(role: {
  role_class?: string | null;
  role_name?: string | null;
  is_super_admin?: boolean | null;
  is_actual_super_admin?: boolean | null;
  is_viewing_as?: boolean | null;
} | null | undefined): boolean {
  if (!role) return false;
  return Boolean(
    (role.is_actual_super_admin && !role.is_viewing_as) || role.is_super_admin ||
    role.role_class === 'admin' || role.role_class === 'manager' ||
    role.role_name?.trim().toLowerCase() === 'admin'
  );
}

export interface InspectionMeterHistoryEntry {
  id: string;
  created_at: string;
  actor_name: string | null;
  changes: { old_reading: number | null; new_reading: number; comment: string | null };
}

export interface InspectionMeterSnapshot {
  reading: number | null;
  version: string;
  history: InspectionMeterHistoryEntry[];
}
