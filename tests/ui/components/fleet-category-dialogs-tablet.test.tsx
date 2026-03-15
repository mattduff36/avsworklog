import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { VehicleCategoryDialog } from '@/app/(dashboard)/fleet/components/VehicleCategoryDialog';
import { HgvCategoryDialog } from '@/app/(dashboard)/fleet/components/HgvCategoryDialog';

let outsidePrevented = false;
let escapePrevented = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'fleet-dialog-user' } },
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <button type="button" data-testid="dialog-request-close" onClick={() => onOpenChange?.(false)}>
          Request Close
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({
    children,
    onInteractOutside,
    onEscapeKeyDown,
  }: {
    children: React.ReactNode;
    onInteractOutside?: (event: { preventDefault: () => void }) => void;
    onEscapeKeyDown?: (event: { preventDefault: () => void }) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="dialog-outside"
        onClick={() => {
          outsidePrevented = false;
          onInteractOutside?.({
            preventDefault: () => {
              outsidePrevented = true;
            },
          });
        }}
      >
        Outside
      </button>
      <button
        type="button"
        data-testid="dialog-escape"
        onClick={() => {
          escapePrevented = false;
          onEscapeKeyDown?.({
            preventDefault: () => {
              escapePrevented = true;
            },
          });
        }}
      >
        Escape
      </button>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('Fleet category dialog safeguards', () => {
  beforeEach(() => {
    localStorage.clear();
    outsidePrevented = false;
    escapePrevented = false;
  });

  it('blocks accidental dismissal for dirty vehicle category form', () => {
    const onOpenChange = vi.fn();

    render(
      <TabletModeProvider>
        <VehicleCategoryDialog open onOpenChange={onOpenChange} mode="create" />
      </TabletModeProvider>
    );

    fireEvent.change(screen.getByLabelText('Category Name *'), { target: { value: 'Tablet Van' } });

    fireEvent.click(screen.getByTestId('dialog-request-close'));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('dialog-outside'));
    expect(outsidePrevented).toBe(true);

    fireEvent.click(screen.getByTestId('dialog-escape'));
    expect(escapePrevented).toBe(true);

    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeInTheDocument();
  });

  it('blocks accidental dismissal for dirty HGV category form', () => {
    const onOpenChange = vi.fn();

    render(
      <TabletModeProvider>
        <HgvCategoryDialog open onOpenChange={onOpenChange} mode="create" />
      </TabletModeProvider>
    );

    fireEvent.change(screen.getByLabelText('Category Name *'), { target: { value: 'Tablet HGV' } });

    fireEvent.click(screen.getByTestId('dialog-request-close'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Discard Changes' })).toBeInTheDocument();
  });
});
