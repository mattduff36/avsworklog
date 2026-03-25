import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { getFinancialYear } from '@/lib/utils/date';

type TypedSupabaseClient = SupabaseClient<Database>;

type CarryoverSelectRow = Pick<
  Database['public']['Tables']['absence_allowance_carryovers']['Row'],
  'profile_id' | 'carried_days'
>;

export function getFinancialYearStartYearFromDate(date: Date): number {
  return getFinancialYear(date).start.getFullYear();
}

export function getEffectiveAllowance(
  baseAllowance: number | null | undefined,
  carriedDays = 0
): number {
  return (baseAllowance ?? 28) + carriedDays;
}

export async function fetchCarryoverMapForFinancialYear(
  supabase: TypedSupabaseClient,
  financialYearStartYear: number,
  profileIds?: string[]
): Promise<Map<string, number>> {
  let query = supabase
    .from('absence_allowance_carryovers')
    .select('profile_id, carried_days')
    .eq('financial_year_start_year', financialYearStartYear);

  if (profileIds && profileIds.length > 0) {
    query = query.in('profile_id', profileIds);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const map = new Map<string, number>();
  for (const row of (data || []) as CarryoverSelectRow[]) {
    map.set(row.profile_id, row.carried_days || 0);
  }

  return map;
}
