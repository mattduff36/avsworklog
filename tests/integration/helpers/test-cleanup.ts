import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for test cleanup');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function deleteActionsByIds(ids: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return;
  }

  const supabase = getAdminClient();
  const { error } = await supabase.from('actions').delete().in('id', uniqueIds);
  if (error) {
    throw error;
  }
}

export async function deleteRowsByIds(table: string, ids: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return;
  }

  const supabase = getAdminClient();
  const { error } = await supabase.from(table).delete().in('id', uniqueIds);
  if (error) {
    throw error;
  }
}

export async function deleteWorkshopTasksForUserMatching(params: {
  createdBy: string;
  titlePrefixes?: string[];
  titlePatterns?: RegExp[];
}): Promise<number> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('actions')
    .select('id, title')
    .eq('created_by', params.createdBy)
    .eq('action_type', 'workshop_vehicle_task');

  if (error) {
    throw error;
  }

  const prefixes = params.titlePrefixes ?? [];
  const patterns = params.titlePatterns ?? [];
  const idsToDelete = (data ?? [])
    .filter((row) => {
      const title = row.title || '';
      return (
        prefixes.some((prefix) => title.startsWith(prefix)) ||
        patterns.some((pattern) => pattern.test(title))
      );
    })
    .map((row) => row.id);

  await deleteActionsByIds(idsToDelete);
  return idsToDelete.length;
}

export function prefixPattern(prefix: string): RegExp {
  return new RegExp(`^${escapeRegExp(prefix)}`);
}
