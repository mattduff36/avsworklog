import { z } from 'zod';
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';

export const GUEST_PLANT_COOKIE = 'avs_guest_plant';
export const GUEST_PLANT_PATH = '/guest-plant-checks';
export const GUEST_PHOTO_LIMIT = 5;
export const GUEST_PHOTO_BYTES = 3 * 1024 * 1024;
export function londonToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function guestInspectorName(row: { guest_name?: string | null }, fallback = 'Unknown'): string {
  return row.guest_name ? `${row.guest_name} — Temporary staff` : fallback;
}
export function isGuestPlantCheck(row: { guest_submission_id?: string | null; guest_name?: string | null }): boolean {
  return Boolean(row.guest_submission_id && row.guest_name);
}
// Caller must separately check the Plant Daily Checks module permission.
export function guestPlantRoleCanRead(role: { is_manager_admin?: boolean; is_super_admin?: boolean; role_name?: string | null; team_name?: string | null }): boolean {
  return Boolean(role.is_manager_admin || role.is_super_admin || role.role_name?.trim().toLowerCase() === 'supervisor' || role.team_name?.trim().toLowerCase() === 'workshop');
}
export function numericJobCode(code: string): string | null {
  return /^(\d+)(?:[-\s].*)?$/.exec(code.trim())?.[1] ?? null;
}
export const GuestPlantSubmissionSchema = z.object({
  requestId: z.string().uuid(), plantId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jobNumber: z.string().regex(/^\d{1,12}$/),
  jobSourceType: z.enum(['live_quote', 'legacy_quote', 'project_number']), jobSourceId: z.string().uuid(),
  hours: z.number().int().min(0).max(2147483647), hoursConfirmed: z.boolean(),
  signature: z.string().min(100).max(300000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  comments: z.string().trim().max(2000), informWorkshop: z.boolean(),
  items: z.array(z.object({ number: z.number().int().min(1).max(PLANT_INSPECTION_ITEMS.length),
    status: z.enum(['ok', 'attention', 'na', 'logged']), comment: z.string().trim().max(2000), repeatConfirmed: z.boolean(),
  }).strict()).length(PLANT_INSPECTION_ITEMS.length),
  photoIds: z.array(z.string().uuid()).max(GUEST_PHOTO_LIMIT),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.items.map(i => i.number)).size !== PLANT_INSPECTION_ITEMS.length) ctx.addIssue({ code: 'custom', message: 'Complete every checklist item exactly once.' });
  if (v.items.some(i => i.status === 'attention' && !i.comment)) ctx.addIssue({ code: 'custom', message: 'Describe each defect.' });
  if (new Set(v.photoIds).size !== v.photoIds.length) ctx.addIssue({ code: 'custom', message: 'Duplicate photos.' });
  if (v.informWorkshop && v.comments.length < 10) ctx.addIssue({ code: 'custom', message: 'Add at least 10 characters for Workshop.' });
});
export type GuestPlantSubmission = z.infer<typeof GuestPlantSubmissionSchema>;
export type GuestPlantAsset = { id: string; plant_id: string; nickname: string | null; category: string | null };
export type GuestPlantJob = { sourceType: 'live_quote' | 'legacy_quote' | 'project_number'; sourceId: string; code: string; title: string | null };
export type GuestPlantDefect = { number: number; locked: boolean; recentlyCompleted: boolean };
