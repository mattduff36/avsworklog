import type { SupabaseClient } from '@supabase/supabase-js';
import { validateAndNormalizePlantSerialNumber } from '@/lib/utils/plant-serial-number';

export const INVENTORY_MINOR_PLANT_CATEGORY = 'minor_plant';

export function parseMinorPlantSerialNumber(raw: unknown): {
  ok: true;
  value: string | null;
} | {
  ok: false;
  error: string;
} {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Serial Number must contain only letters and numbers' };
  }

  const result = validateAndNormalizePlantSerialNumber(raw);
  if (!result.valid) {
    return {
      ok: false,
      error: result.error || 'Serial Number must contain only letters and numbers',
    };
  }

  return { ok: true, value: result.value };
}

export async function saveMinorPlantSerialNumber(
  admin: SupabaseClient,
  input: {
    inventoryItemId: string;
    serialNumber: string | null;
    userId: string;
  },
): Promise<void> {
  const { data: existing, error: existingError } = await admin
    .from('inventory_minor_plant_details')
    .select('id')
    .eq('inventory_item_id', input.inventoryItemId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await admin
      .from('inventory_minor_plant_details')
      .update({
        serial_number: input.serialNumber,
        updated_by: input.userId,
      })
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  if (!input.serialNumber) return;

  const { error } = await admin
    .from('inventory_minor_plant_details')
    .insert({
      inventory_item_id: input.inventoryItemId,
      serial_number: input.serialNumber,
      created_by: input.userId,
      updated_by: input.userId,
    });
  if (error) throw error;
}
