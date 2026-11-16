import type { InspectionStatus } from '@/types/inspection';

export type HgvRecordKind = 'full_check' | 'defect_report';
export interface HgvUpdateItem {
  id?: string;
  item_number: number;
  item_description: string;
  day_of_week: number;
  status: InspectionStatus;
  comments: string | null;
}
export interface HgvVersion {
  revision: number;
  actor_id: string;
  recorded_at: string;
  reason: string;
  snapshot: {
    inspection: { id: string; inspection_date: string; current_mileage: number | null; inspector_comments: string | null; signature_data: string | null; signed_at: string | null; submitted_at: string | null; record_kind?: HgvRecordKind; discovered_at?: string | null };
    items: HgvUpdateItem[];
    photos: Array<{ photo_url: string; caption: string | null; item_number: number | null }>;
    hgv?: { reg_number: string; nickname: string | null };
    operator?: { full_name: string };
  };
}
export function londonDate(value: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function canCorrectHgvCheck(check: { user_id: string; status: string; inspection_date: string; submitted_at: string | null }, actorId: string, now = new Date()): boolean {
  return check.user_id === actorId && check.status === 'submitted' && Boolean(check.submitted_at) && check.inspection_date === londonDate(now) && londonDate(check.submitted_at!) === londonDate(now);
}
