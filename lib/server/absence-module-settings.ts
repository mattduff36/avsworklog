import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type AnySupabase = SupabaseClient;
type AbsenceModuleSettingsRow = Database['public']['Tables']['absence_module_settings']['Row'];

export interface AbsenceAnnouncementRecord {
  message: string | null;
  updatedAt: string | null;
}

export function normalizeAbsenceAnnouncementMessage(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

export async function getAbsenceAnnouncement(
  supabase: AnySupabase
): Promise<AbsenceAnnouncementRecord> {
  const { data, error } = await supabase
    .from('absence_module_settings')
    .select('announcement_message, updated_at')
    .eq('id', true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = (data || null) as Pick<AbsenceModuleSettingsRow, 'announcement_message' | 'updated_at'> | null;
  return {
    message: normalizeAbsenceAnnouncementMessage(row?.announcement_message),
    updatedAt: row?.updated_at || null,
  };
}

export async function saveAbsenceAnnouncement(
  supabase: AnySupabase,
  message: string | null | undefined
): Promise<AbsenceAnnouncementRecord> {
  const normalizedMessage = normalizeAbsenceAnnouncementMessage(message);
  const { data, error } = await supabase
    .from('absence_module_settings')
    .upsert(
      {
        id: true,
        announcement_message: normalizedMessage,
      },
      { onConflict: 'id' }
    )
    .select('announcement_message, updated_at')
    .single();

  if (error) {
    throw error;
  }

  const row = data as Pick<AbsenceModuleSettingsRow, 'announcement_message' | 'updated_at'>;
  return {
    message: normalizeAbsenceAnnouncementMessage(row.announcement_message),
    updatedAt: row.updated_at,
  };
}
