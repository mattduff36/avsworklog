import type { SupabaseClient } from '@supabase/supabase-js';

export const TEST_ASSET_PREFIX = 'TE57';

export async function resolveTestVanId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('vans')
    .select('id')
    .ilike('reg_number', `${TEST_ASSET_PREFIX}%`)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id || null;
}

export async function resolveTestHgvId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('hgvs')
    .select('id')
    .ilike('reg_number', `${TEST_ASSET_PREFIX}%`)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id || null;
}

export async function resolveTestPlantId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('plant')
    .select('id')
    .ilike('reg_number', `${TEST_ASSET_PREFIX}%`)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id || null;
}
