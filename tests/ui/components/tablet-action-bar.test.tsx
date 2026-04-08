import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { TabletActionBar } from '@/components/ui/tablet-action-bar';

let isLandscapeMatch = false;

vi.mock('@/lib/app-auth/client', () => ({
  subscribeToAuthStateChange: () => vi.fn(),
}));

function installMatchMediaMock() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(orientation: landscape)' ? isLandscapeMatch : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderHarness() {
  const onPrimary = vi.fn();
  const onSecondary = vi.fn();
  const onTertiary = vi.fn();

  render(
    <TabletModeProvider>
      <TabletActionBar
        statusText="Unsaved changes"
        primaryAction={{ label: 'Save', onClick: onPrimary }}
        secondaryAction={{ label: 'Discard', onClick: onSecondary, variant: 'outline' }}
        tertiaryAction={{ label: 'Help', onClick: onTertiary, variant: 'secondary' }}
      />
    </TabletModeProvider>
  );

  return { onPrimary, onSecondary, onTertiary };
}

describe('TabletActionBar', () => {
  beforeEach(() => {
    localStorage.clear();
    isLandscapeMatch = false;
    installMatchMediaMock();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            user: { id: 'tablet-action-bar-user' },
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it('renders only when tablet mode is enabled', async () => {
    renderHarness();
    await waitFor(() => {
      expect(screen.queryByTestId('tablet-action-bar')).not.toBeInTheDocument();
    });

    cleanup();
    localStorage.setItem('tablet_mode:tablet-action-bar-user', 'on');
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId('tablet-action-bar')).toBeInTheDocument();
    });
  });

  it('uses portrait sticky-bottom layout by default', async () => {
    localStorage.setItem('tablet_mode:tablet-action-bar-user', 'on');
    renderHarness();

    await waitFor(() => {
      const bar = screen.getByTestId('tablet-action-bar');
      expect(bar.className).toContain('bottom-0');
      expect(bar.className).not.toContain('ml-auto');
      expect(bar.className).not.toContain('top-3');
    });

    expect(screen.getByTestId('tablet-action-bar-actions').className).toContain('flex-row');
  });

  it('keeps bottom-bar layout in landscape (safe fallback)', async () => {
    localStorage.setItem('tablet_mode:tablet-action-bar-user', 'on');
    isLandscapeMatch = true;
    renderHarness();

    await waitFor(() => {
      const bar = screen.getByTestId('tablet-action-bar');
      expect(bar.className).toContain('bottom-0');
      expect(bar.className).not.toContain('ml-auto');
      expect(bar.className).not.toContain('top-3');
    });

    expect(screen.getByTestId('tablet-action-bar-actions').className).toContain('flex-row');
  });

  it('wires primary, secondary, and tertiary actions', async () => {
    localStorage.setItem('tablet_mode:tablet-action-bar-user', 'on');
    const actions = renderHarness();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));

    expect(actions.onPrimary).toHaveBeenCalledTimes(1);
    expect(actions.onSecondary).toHaveBeenCalledTimes(1);
    expect(actions.onTertiary).toHaveBeenCalledTimes(1);
  });
});
