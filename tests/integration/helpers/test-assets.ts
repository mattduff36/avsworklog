import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TEST_ASSET_PREFIX = 'TE57';

function createMaintenanceWriteClient(fallbackClient: SupabaseClient): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return fallbackClient;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function ensureTestVanMaintenanceRecord(
  supabase: SupabaseClient,
  vanId: string
): Promise<void> {
  const maintenanceClient = createMaintenanceWriteClient(supabase);
  const { data: existing, error: existingError } = await maintenanceClient
    .from('vehicle_maintenance')
    .select('id')
    .eq('van_id', vanId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing?.id) {
    return;
  }

  const { error: insertError } = await maintenanceClient
    .from('vehicle_maintenance')
    .insert({
      van_id: vanId,
      current_mileage: 0,
    });

  if (insertError) {
    throw insertError;
  }
}

export async function ensureTestHgvMaintenanceRecord(
  supabase: SupabaseClient,
  hgvId: string
): Promise<void> {
  const maintenanceClient = createMaintenanceWriteClient(supabase);
  const { data: existing, error: existingError } = await maintenanceClient
    .from('vehicle_maintenance')
    .select('id')
    .eq('hgv_id', hgvId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing?.id) {
    return;
  }

  const { error: insertError } = await maintenanceClient
    .from('vehicle_maintenance')
    .insert({
      hgv_id: hgvId,
      current_mileage: 0,
    });

  if (insertError) {
    throw insertError;
  }
}

export async function ensureTestPlantMaintenanceRecord(
  supabase: SupabaseClient,
  plantId: string
): Promise<void> {
  const maintenanceClient = createMaintenanceWriteClient(supabase);
  const { data: existing, error: existingError } = await maintenanceClient
    .from('vehicle_maintenance')
    .select('id')
    .eq('plant_id', plantId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing?.id) {
    return;
  }

  const { error: insertError } = await maintenanceClient
    .from('vehicle_maintenance')
    .insert({
      plant_id: plantId,
    });

  if (insertError) {
    throw insertError;
  }
}

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

  if (!data?.id) {
    return null;
  }

  await ensureTestVanMaintenanceRecord(supabase, data.id);
  return data.id;
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

  if (!data?.id) {
    return null;
  }

  await ensureTestHgvMaintenanceRecord(supabase, data.id);
  return data.id;
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

  if (!data?.id) {
    return null;
  }

  await ensureTestPlantMaintenanceRecord(supabase, data.id);
  return data.id;
}
