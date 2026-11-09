'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDailyAllocationResourceJobs } from '@/lib/client/daily-allocation';
import { useDailyAllocationBoard } from './use-daily-allocation-board';

export function useDailyAllocationResourceJobs(search: string, enabled = true) {
  const board = useDailyAllocationBoard().viewBoard;
  const term = search.trim();
  const [debouncedTerm, setDebouncedTerm] = useState(term);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term), 300);
    return () => clearTimeout(timer);
  }, [term]);
  const start = board?.start_date || '';
  const end = board?.end_date || '';
  const context = board?.context;
  const planVersions = board?.plan_days.map((plan) => `${plan.id}:${plan.plan_version}`).join(',');
  const ready = term === debouncedTerm && (term.length === 0 || term.length >= 2);
  const query = useQuery({
    queryKey: ['daily-allocation-resource-jobs', context?.user_id, context?.team_id, context?.access_level, start, end, planVersions, debouncedTerm],
    queryFn: ({ signal }) => fetchDailyAllocationResourceJobs(start, end, debouncedTerm, signal),
    enabled: enabled && Boolean(board) && ready,
    staleTime: 60_000,
  });
  return {
    jobs: ready ? query.data?.jobs || [] : [],
    isLoading: enabled && term.length !== 1 && (!ready || query.isPending),
    error: ready ? query.error : null,
    retry: () => { void query.refetch(); },
    needsMoreCharacters: term.length === 1,
  };
}
