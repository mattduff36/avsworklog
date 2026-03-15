import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { TaskCommentsDrawer } from '@/components/workshop-tasks/TaskCommentsDrawer';

let outsidePrevented = false;
let escapePrevented = false;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'workshop-test-user' } },
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
    className,
    onInteractOutside,
    onEscapeKeyDown,
  }: {
    children: React.ReactNode;
    className?: string;
    onInteractOutside?: (event: { preventDefault: () => void }) => void;
    onEscapeKeyDown?: (event: { preventDefault: () => void }) => void;
  }) => (
    <div data-testid="dialog-content" className={className}>
      <button
        type="button"
        data-testid="dialog-outside"
        onClick={() => {
          outsidePrevented = false;
          onInteractOutside?.({ preventDefault: () => { outsidePrevented = true; } });
        }}
      >
        Outside
      </button>
      <button
        type="button"
        data-testid="dialog-escape"
        onClick={() => {
          escapePrevented = false;
          onEscapeKeyDown?.({ preventDefault: () => { escapePrevented = true; } });
        }}
      >
        Escape
      </button>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

describe('TaskCommentsDrawer tablet safeguards', () => {
  beforeEach(() => {
    localStorage.clear();
    outsidePrevented = false;
    escapePrevented = false;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [] }),
    })));
  });

  it('prevents accidental close with unsaved draft', async () => {
    const onOpenChange = vi.fn();
    localStorage.setItem('tablet_mode:workshop-test-user', 'on');

    render(
      <TabletModeProvider>
        <TaskCommentsDrawer
          open
          onOpenChange={onOpenChange}
          taskId="task-1"
          taskTitle="VAN-1"
        />
      </TabletModeProvider>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Add a comment...'), {
      target: { value: 'unsaved draft' },
    });

    fireEvent.click(screen.getByTestId('dialog-request-close'));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('dialog-outside'));
    expect(outsidePrevented).toBe(true);

    fireEvent.click(screen.getByTestId('dialog-escape'));
    expect(escapePrevented).toBe(true);

    expect(screen.getByRole('button', { name: 'Discard Draft' })).toBeInTheDocument();
  });
});

