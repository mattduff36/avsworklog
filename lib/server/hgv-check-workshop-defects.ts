import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

const id = z.string().uuid();
export function parseHgvWorkshopLookup(params: URLSearchParams) {
  return z.object({
    p_tractor: id,
    p_trailer: id.nullable(),
    p_hire_id: z.string().max(200).nullable(),
    p_company: z.string().max(200).nullable(),
    p_swap: z.boolean(),
  }).safeParse({
    p_tractor: params.get('hgvId'),
    p_trailer: params.get('trailerHgvId'),
    p_hire_id: params.get('hiredTrailerId'),
    p_company: params.get('hiredTrailerCompany'),
    p_swap: params.get('context') === 'swap',
  });
}

const defects = z.array(z.object({
  id: z.string(),
  status: z.string(),
  description: z.string().nullable(),
  inspection_item_id: z.string().nullable(),
  updated_at: z.string().nullable(),
  actioned_at: z.string().nullable(),
}));

type Lookup = Extract<ReturnType<typeof parseHgvWorkshopLookup>, { success: true }>['data'];

export async function fetchHgvWorkshopDefects(client: SupabaseClient, lookup: Lookup, completed: boolean, days = 7) {
  const { data, error } = await client.rpc('hgv_check_workshop_defects', {
    ...lookup,
    p_completed: completed,
    p_days: days,
  });
  return { data: error ? [] : defects.parse(data), error };
}
