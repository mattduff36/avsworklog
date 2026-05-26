/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { JobCodeFields } from '@/components/timesheets/JobCodeFields';

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
  it('selects an active quote job code from the modal picker', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={[{ value: '40001-GH', label: '40001-GH' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    fireEvent.click(screen.getByRole('button', { name: '40001-GH' }));

    expect(handleChange).toHaveBeenCalledWith(0, '40001-GH');
  });

  it('allows manual legacy job code entry inside the modal', () => {
    const handleChange = vi.fn();

    render(
      <JobCodeFields
        values={[]}
        onChange={handleChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        placeholder="Select job code"
        jobCodeOptions={[{ value: '40001-GH', label: '40001-GH' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    fireEvent.change(screen.getByPlaceholderText('Enter 4 digit code'), {
      target: { value: '1234ab' },
    });

    expect(handleChange).toHaveBeenCalledWith(0, '1234ab');
    expect(screen.queryByTestId('job-code-dialog')).not.toBeInTheDocument();
  });
});
