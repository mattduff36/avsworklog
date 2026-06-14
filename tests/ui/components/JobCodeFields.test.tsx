/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { JobCodeFields } from '@/components/timesheets/JobCodeFields';
import type { TimesheetJobCodeOption } from '@/lib/client/timesheet-job-codes';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) => (
    open ? <div data-testid="job-code-dialog">{children}</div> : null
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
}));

describe('JobCodeFields', () => {
  const jobCodeOptions: TimesheetJobCodeOption[] = [
    {
      value: '40001-GH',
      label: '40001-GH',
      customerName: 'Omexom',
      quoteTitle: 'Cable repairs',
      source: 'live_quote',
    },
    {
      value: '4323-GH',
      label: '4323-GH',
      customerName: 'Saint Gobain East Leake',
      quoteTitle: 'ATV hire',
      source: 'legacy_quote',
    },
  ];

  it('selects an active quote job code from the modal picker', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: '400' },
    });
    fireEvent.click(screen.getByRole('button', { name: /40001-GH/ }));

    expect(handleChange).toHaveBeenCalledWith(0, '40001-GH');
  });

  it('requires at least three characters before showing filtered results', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    expect(screen.getByText('Start typing a job code, customer, or quote name to filter the list.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /4323-GH/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: 'sa' },
    });
    expect(screen.queryByRole('button', { name: /4323-GH/ })).not.toBeInTheDocument();
  });

  it('closes the picker from the inline close button', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close job code search' }));

    expect(screen.queryByTestId('job-code-dialog')).not.toBeInTheDocument();
  });

  it('filters and selects a legacy job code by customer or quote name', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={jobCodeOptions}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), {
      target: { value: 'gob' },
    });

    expect(screen.getByText('Saint Gobain East Leake - ATV hire')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /4323-GH/ }));

    expect(handleChange).toHaveBeenCalledWith(0, '4323-GH');
    expect(screen.queryByTestId('job-code-dialog')).not.toBeInTheDocument();
  });
});
