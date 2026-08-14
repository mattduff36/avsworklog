/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import type { CSSProperties, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JobCataloguePicker } from '@/components/daily-allocation/JobCataloguePicker';
import type { JobCatalogueOption } from '@/types/job-catalogue';

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) => (
    open ? <div data-testid="job-code-dialog">{children}</div> : null
  ),
  DialogContent: ({
    children,
    className,
    style,
  }: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
  }) => (
    <div
      className={className}
      data-testid="job-code-dialog-panel"
      data-top-style={String(style?.top || '')}
    >
      {children}
    </div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const selectableOption: JobCatalogueOption = {
  value: '40001-GH',
  label: '40001-GH',
  customerName: 'Omexom',
  quoteTitle: 'Cable repairs',
  source: 'live_quote',
  sourceId: 'quote-1',
  siteAddress: '1 Test Street, Test Town',
  addressValid: true,
  aliases: [],
  isAmbiguous: false,
  blockReason: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('JobCataloguePicker', () => {
  it('uses the shared timesheet SELECT modal with valid, unique job-number-only results', async () => {
    const duplicateOption: JobCatalogueOption = {
      ...selectableOption,
      source: 'project_number',
      sourceId: 'project-duplicate',
    };
    const blockedOption: JobCatalogueOption = {
      ...selectableOption,
      value: '4323-GH',
      label: '4323-GH',
      source: 'legacy_quote',
      sourceId: 'legacy-1',
      siteAddress: null,
      addressValid: false,
      blockReason: 'missing_site_address',
    };
    const onSelect = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ job_codes: [selectableOption, duplicateOption, blockedOption] })
    ));

    const { rerender } = render(
      <JobCataloguePicker
        value={null}
        variant="timesheet-modal"
        onSelect={onSelect}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Select job code' });
    expect(trigger).toHaveClass('uppercase');
    fireEvent.click(trigger);
    expect(screen.getByTestId('job-code-dialog-panel')).toHaveClass(
      'top-[calc(env(safe-area-inset-top,0px)+0.5rem)]',
      'max-h-[calc(100dvh-1rem)]'
    );
    expect(screen.getByTestId('job-code-dialog-panel')).toHaveAttribute(
      'data-top-style',
      'max(8px, calc(env(safe-area-inset-top, 0px) + 8px))'
    );
    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: '432' },
    });
    expect(await screen.findByText('No matching job codes found.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: '400' },
    });

    const optionButtons = await screen.findAllByRole('button', { name: '40001-GH' });
    expect(optionButtons).toHaveLength(1);
    expect(screen.queryByText('Omexom')).not.toBeInTheDocument();
    expect(screen.queryByText('Cable repairs')).not.toBeInTheDocument();
    fireEvent.click(optionButtons[0]);

    expect(onSelect).toHaveBeenCalledWith(selectableOption);
    rerender(
      <JobCataloguePicker
        value="40001-GH"
        sourceId="quote-1"
        variant="timesheet-modal"
        onSelect={onSelect}
      />
    );
    expect(screen.getByRole('button', { name: 'Selected job code 40001-GH' })).toBeInTheDocument();
  });

  it('PDC-JOB-005A/B shows a load error and retries successfully', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Job catalogue access required' }, 403))
      .mockResolvedValueOnce(jsonResponse({ job_codes: [selectableOption] }));
    const onSelect = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <JobCataloguePicker
        value={null}
        variant="timesheet-modal"
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Job catalogue access required');
    expect(screen.queryByText('No matching job codes found.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: '400' },
    });
    const optionButton = await screen.findByRole('button', { name: '40001-GH' });
    fireEvent.click(optionButton);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/job-codes', { cache: 'no-store' });
    expect(onSelect).toHaveBeenCalledWith(selectableOption);
  });

  it('PDC-JOB-006 keeps blocked catalogue entries visible and unselectable', async () => {
    const blockedOption: JobCatalogueOption = {
      ...selectableOption,
      value: '4323-GH',
      label: '4323-GH',
      source: 'legacy_quote',
      sourceId: 'legacy-1',
      siteAddress: null,
      addressValid: false,
      blockReason: 'missing_site_address',
    };
    const onSelect = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ job_codes: [blockedOption] })
    ));

    render(<JobCataloguePicker value={null} onSelect={onSelect} />);

    const optionButton = await screen.findByRole('button', { name: /4323-GH/ });
    expect(optionButton).toBeDisabled();
    expect(screen.getByText(/cannot be allocated until its source record has a proper site address/i))
      .toBeInTheDocument();

    fireEvent.click(optionButton);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('PDC-JOB-007 shares only in-flight requests and clears options after a later authorization failure', async () => {
    let resolveRequest: ((response: Response) => void) | null = null;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(pendingResponse)
      .mockResolvedValueOnce(jsonResponse({ error: 'Job catalogue access required' }, 403));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <>
        <JobCataloguePicker value={null} onSelect={vi.fn()} />
        <JobCataloguePicker value={null} onSelect={vi.fn()} />
      </>
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveRequest?.(jsonResponse({ job_codes: [selectableOption] }));
      await pendingResponse;
    });

    expect(await screen.findAllByRole('button', { name: /40001-GH/ })).toHaveLength(2);

    cleanup();
    render(<JobCataloguePicker value={null} onSelect={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Job catalogue access required');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /40001-GH/ })).not.toBeInTheDocument();
  });
});
