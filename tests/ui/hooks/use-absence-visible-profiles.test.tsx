/** @vitest-environment happy-dom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostgrestClient } from '@supabase/postgrest-js';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { useAllAbsences } from '@/lib/hooks/useAbsence';

const { requests } = vi.hoisted(() => ({ requests: [] as URL[] }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => new PostgrestClient('https://supabase.test/rest/v1', {
    fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const table = url.pathname.split('/').at(-1);
      const profileLink = `profiles!${table}_profile_id_fkey!inner(`;
      const rows = [
        {
          id: `${table}-visible`, date: '2026-11-24',
          profiles: { full_name: 'Active Employee', employee_id: '42' },
          approved_by_profile: null,
          created_by_profile: null,
        },
        { id: `${table}-hidden`, date: '2026-11-24', profiles: null },
      ];
      // Model PostgREST's response when profile RLS hides the joined employee.
      const select = url.searchParams.get('select') ?? '';
      return Response.json(select.includes(profileLink) ? rows.filter((row) => row.profiles) : rows);
    },
  }),
}));

it('keeps current and archived bookings with visible employees, even if their approver is hidden', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useAllAbsences({ includeArchived: true }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.map((row) => [row.id, row.record_source, row.profiles?.full_name])).toEqual([
    ['absences-visible', 'active', 'Active Employee'],
    ['absences_archive-visible', 'archived', 'Active Employee'],
  ]);
  for (const url of requests) {
    expect(url.searchParams.get('select')).not.toMatch(/(?:approved|created)_by_fkey!inner/);
  }
});
