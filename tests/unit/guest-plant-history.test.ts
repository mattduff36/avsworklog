import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDailyChecks } from '@/components/fleet/DailyChecksHistoryTab';
const state = vi.hoisted(() => ({ selects: [] as string[], rows: [] as Record<string, unknown>[] }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  const query = { select: (value: string) => {state.selects.push(value);return query;}, eq: () => query, order: () => query, limit: () => query, in: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({data:table === 'inspection_items' ? [] : state.rows,error:null}).then(resolve) };return query;
} }) }));
describe('Asset daily-check history guest attribution', () => {
  beforeEach(() => { state.selects=[];state.rows=[{id:'check',guest_name:'Pat Smith',guest_submission_id:'receipt',profile:{full_name:'Temporary Plant Checks'}}]; });
  it('selects and displays the plant guest name with Temporary staff attribution', async () => {
    const rows=await fetchDailyChecks('plant','asset'); expect(rows[0].profile?.full_name).toBe('Pat Smith — Temporary staff');expect(state.selects[0]).toContain('guest_name');
  });
  it.each(['van','hgv'] as const)('preserves %s employee attribution', async type => {
    const rows=await fetchDailyChecks(type,'asset');expect(rows[0].profile?.full_name).toBe('Temporary Plant Checks');expect(state.selects[0]).not.toContain('guest_name');
  });
});
