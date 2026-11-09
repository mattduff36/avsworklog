/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyAllocationResourceJobs } from '@/components/daily-allocation/board/hooks/use-daily-allocation-resource-jobs';
import { DraftJobPicker } from '@/components/daily-allocation/board/DraftJobPicker';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  board: {
    start_date: '2026-11-09', end_date: '2026-11-09', plan_days: [],
    context: { user_id: 'manager', team_id: 'team-1', access_level: 5 },
  },
}));
vi.mock('@/lib/client/daily-allocation', () => ({ fetchDailyAllocationResourceJobs: mocks.fetch }));
vi.mock('@/components/daily-allocation/board/hooks/use-daily-allocation-board', () => ({
  useDailyAllocationBoard: () => ({ viewBoard: mocks.board }),
}));

const missingSite = {
  source_type: 'project_number', source_id: 'job-1', job_code: '50075-LC',
  site_address: null, address_valid: false, aliases: ['OLD-LC'],
  customer_name: 'Customer', title: 'Works', source_href: null,
};
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function Search({ term }: { term: string }) {
  const result = useDailyAllocationResourceJobs(term);
  return <div>{result.jobs.map((job) => <p key={job.source_id}>{job.job_code}</p>)}
    {result.isLoading ? <p>Loading</p> : null}
    {result.needsMoreCharacters ? <p>More characters needed</p> : null}
    {result.error ? <p role="alert">{result.error.message}</p> : null}
  </div>;
}
beforeEach(() => {
  mocks.fetch.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('bounded draft resource lookup', () => {
  it('debounces searches, hides stale matches and carries cancellation through query changes', async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.fetch.mockImplementation((_start, _end, term) => term === 'old'
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : Promise.resolve({ jobs: [missingSite], limit: 80 }));
    const view = render(<Search term="old" />, { wrapper });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const firstSignal = mocks.fetch.mock.calls[0][3] as AbortSignal;
    view.rerender(<Search term="500" />);
    expect(screen.queryByText('50075-LC')).not.toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    view.rerender(<Search term="50075" />);
    await screen.findByText('50075-LC');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1].slice(0, 3)).toEqual(['2026-11-09', '2026-11-09', '50075']);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { resolveFirst({ jobs: [{ ...missingSite, job_code: 'OLD' }], limit: 80 }); });
    expect(screen.queryByText('OLD')).not.toBeInTheDocument();
    expect(screen.getByText('50075-LC')).toBeInTheDocument();
  });

  it('does not send a one-character query and surfaces lookup failures', async () => {
    const view = render(<Search term="5" />, { wrapper });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.getByText('More characters needed')).toBeInTheDocument();
    mocks.fetch.mockRejectedValue(new Error('Catalogue unavailable'));
    view.rerender(<Search term="50" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalogue unavailable');
  });

  it('selects missing-site jobs as canonical draft identities with a publish warning', async () => {
    mocks.fetch.mockResolvedValue({ jobs: [missingSite], limit: 80 });
    const select = vi.fn();
    render(<DraftJobPicker value={null} onSelect={select} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    expect(await screen.findByText('Site address needed before publish')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /50075-LC/ }));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({
      value: '50075-LC', source: 'project_number', sourceId: 'job-1', addressValid: false, blockReason: null,
    }));
  });
});
