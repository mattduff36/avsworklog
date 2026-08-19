/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YardKioskBootstrapResponse } from '@/lib/inventory/kiosk-types';
import type { YardKioskControlAction } from '@/lib/inventory/kiosk-remote-types';
import { YARD_KIOSK_ADMIN_HOLD_DURATION_MS } from '@/app/yard-kiosk/components/YardKioskAdminMenu';
import {
  YARD_KIOSK_INACTIVITY_RESET_MS,
  YARD_KIOSK_INACTIVITY_WARNING_MS,
} from '@/app/yard-kiosk/components/YardKioskInactivityGuard';

const { signOutMock, useAuthMock, useRemoteControlMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  useAuthMock: vi.fn(),
  useRemoteControlMock: vi.fn(),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/lib/hooks/useYardKioskRemoteControl', () => ({
  useYardKioskRemoteControl: useRemoteControlMock,
}));

interface BiometricPromptProps {
  profileId: string | null | undefined;
  canCheck: boolean;
}

vi.mock('@/components/auth/BiometricEnrollmentPrompt', () => ({
  BiometricEnrollmentPrompt: ({ profileId, canCheck }: BiometricPromptProps) => (
    <div
      data-testid="biometric-enrollment-prompt"
      data-profile-id={profileId}
      data-can-check={canCheck}
    />
  ),
}));

import { YardKioskApp } from '@/app/yard-kiosk/components/YardKioskApp';

const bootstrap: YardKioskBootstrapResponse = {
  configured: true,
  yard: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Yard',
    description: null,
    location_type: 'yard',
    source_type: null,
    external_reference: null,
    linked_asset_label: null,
    linked_asset_nickname: null,
    primary_user_names: [],
    secondary_user_names: [],
  },
  locations: [],
  categories: [],
};

const warningItemId = '33333333-3333-4333-8333-333333333333';
const warningSite = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Site One',
  description: null,
  location_type: 'site' as const,
  source_type: 'manual' as const,
  external_reference: null,
  linked_asset_label: null,
  linked_asset_nickname: null,
  primary_user_names: [],
  secondary_user_names: [],
};
const warningBootstrap: YardKioskBootstrapResponse = {
  ...bootstrap,
  locations: [warningSite],
};

function warningStockResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      items: [{
        kind: 'serialized',
        id: warningItemId,
        item_number: 'TOOL-001',
        name: 'Breaker',
        category: 'tools',
        check_status: 'overdue',
        check_warning_required: true,
      }],
    }),
  };
}

function warningRequiredResponse() {
  return {
    ok: false,
    status: 409,
    json: async () => ({
      code: 'INVENTORY_CHECK_WARNING_REQUIRED',
      error: 'Confirm warning',
      warning_items: [{
        id: warningItemId,
        item_number: 'TOOL-001',
        name: 'Breaker',
        check_status: 'overdue',
      }],
      move_item_ids: [warningItemId],
    }),
  };
}

async function addWarningItemToBasket() {
  fireEvent.click(screen.getByRole('button', { name: /^Collect/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Site One/ }));
  });
  fireEvent.click(screen.getByRole('button', { name: /^Breaker/ }));
}

function latestRemoteControlHandler(): (action: YardKioskControlAction) => void {
  const latestCall = useRemoteControlMock.mock.calls[
    useRemoteControlMock.mock.calls.length - 1
  ]?.[0] as { onControlAction?: (action: YardKioskControlAction) => void } | undefined;
  if (!latestCall?.onControlAction) {
    throw new Error('Remote control handler was not registered');
  }
  return latestCall.onControlAction;
}

describe('YardKioskApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    signOutMock.mockResolvedValue({ error: null });
    useAuthMock.mockReturnValue({
      profile: { id: 'kiosk-profile' },
      loading: false,
      signOut: signOutMock,
    });
    useRemoteControlMock.mockReturnValue({ isRemotelyControlled: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hosts the existing enrollment prompt for the authenticated kiosk profile', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'kiosk-profile' },
      loading: false,
      signOut: signOutMock,
    });

    render(<YardKioskApp bootstrap={bootstrap} />);

    expect(screen.getByTestId('biometric-enrollment-prompt'))
      .toHaveAttribute('data-profile-id', 'kiosk-profile');
    expect(screen.getByTestId('biometric-enrollment-prompt'))
      .toHaveAttribute('data-can-check', 'true');
  });

  it('locks physical input while a manager holds remote control', () => {
    useRemoteControlMock.mockReturnValue({ isRemotelyControlled: true });

    render(<YardKioskApp bootstrap={bootstrap} />);

    expect(screen.getByTestId('yard-kiosk-remote-lock')).toHaveTextContent(
      'Remote control active — tablet input locked',
    );
  });

  it('waits for kiosk authentication to finish before checking enrollment', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'kiosk-profile' },
      loading: true,
      signOut: signOutMock,
    });

    render(<YardKioskApp bootstrap={bootstrap} />);

    expect(screen.getByTestId('biometric-enrollment-prompt'))
      .toHaveAttribute('data-can-check', 'false');
  });

  it('skips guidance on the main screen and shows direction-aware guidance afterward', () => {
    render(<YardKioskApp bootstrap={bootstrap} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Select the destination, or type the location details',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to direction selection' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Return/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Select the source location');
  });

  it('loads Yard stock after Collect typed location details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<YardKioskApp bootstrap={bootstrap} />);
    fireEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Type location details' }));
    fireEvent.change(screen.getByPlaceholderText(/Type the van, site, job or person/i), {
      target: { value: 'Job van, not listed' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with these details' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('unallocated=true'),
      expect.anything(),
    );
    expect(screen.getByTestId('yard-kiosk-items-layout')).toBeInTheDocument();
  });

  it('keeps fixed header slots while workflow controls change by step', () => {
    render(<YardKioskApp bootstrap={bootstrap} />);

    const workflowNav = screen.getByTestId('yard-kiosk-workflow-nav');
    const backSlot = within(workflowNav).getByTestId('workflow-back-slot');
    const brandSlot = within(workflowNav).getByTestId('workflow-brand-slot');
    const statusSlot = within(workflowNav).getByTestId('workflow-status-slot');
    const forwardSlot = within(workflowNav).getByTestId('workflow-forward-slot');
    const brandClassName = brandSlot.className;
    const statusClassName = statusSlot.className;

    expect(within(backSlot).queryByRole('button')).not.toBeInTheDocument();
    expect(within(forwardSlot).queryByRole('button')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Collect/ }));

    expect(screen.getByTestId('workflow-brand-slot')).toBe(brandSlot);
    expect(screen.getByTestId('workflow-brand-slot')).toHaveClass(...brandClassName.split(' '));
    expect(screen.getByTestId('workflow-status-slot')).toBe(statusSlot);
    expect(screen.getByTestId('workflow-status-slot')).toHaveClass(...statusClassName.split(' '));
    expect(within(backSlot).getByRole('button', {
      name: 'Back to direction selection',
    })).toBeInTheDocument();
    expect(within(forwardSlot).queryByRole('button')).not.toBeInTheDocument();

    const pagerNavigation = screen.getByLabelText('Location page navigation');
    expect(within(pagerNavigation).getByRole('button', {
      name: 'Previous location page',
    })).toBeDisabled();
  });

  it('bounds item content and pager controls inside the left pane', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    }));
    render(
      <YardKioskApp
        bootstrap={{
          ...bootstrap,
          locations: [{
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Site One',
            description: null,
            location_type: 'site',
            source_type: 'manual',
            external_reference: null,
            linked_asset_label: null,
            linked_asset_nickname: null,
            primary_user_names: [],
            secondary_user_names: [],
          }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Site One/ }));
    });

    expect(screen.getByTestId('yard-kiosk-items-layout'))
      .toHaveClass('min-w-0', 'overflow-hidden');
    expect(screen.getByTestId('yard-kiosk-item-pane'))
      .toHaveClass('min-w-0', 'overflow-hidden');
    expect(screen.getByTestId('yard-kiosk-basket-pane'))
      .toHaveClass('min-w-0', 'overflow-hidden');
    expect(screen.getByTestId('yard-kiosk-item-picker'))
      .toHaveClass('min-w-0', 'overflow-hidden');
  });

  it('discards the active basket and workflow after two minutes of inactivity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          kind: 'serialized',
          id: '33333333-3333-4333-8333-333333333333',
          item_number: 'TOOL-001',
          name: 'Breaker',
          category: 'tools',
          check_status: 'ok',
          check_warning_required: false,
        }],
      }),
    }));
    render(
      <YardKioskApp
        bootstrap={{
          ...bootstrap,
          locations: [{
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Site One',
            description: null,
            location_type: 'site',
            source_type: 'manual',
            external_reference: null,
            linked_asset_label: null,
            linked_asset_nickname: null,
            primary_user_names: [],
            secondary_user_names: [],
          }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Site One/ }));
    });
    fireEvent.click(screen.getByRole('button', { name: /^Breaker/ }));
    expect(screen.getByTestId('yard-kiosk-basket-pane')).toHaveTextContent('Breaker');

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INACTIVITY_WARNING_MS);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('15 seconds');
    expect(screen.getByRole('list', { name: 'Transfer basket' }))
      .toHaveTextContent('Breaker');

    act(() => {
      vi.advanceTimersByTime(
        YARD_KIOSK_INACTIVITY_RESET_MS - YARD_KIOSK_INACTIVITY_WARNING_MS,
      );
    });
    expect(screen.getByRole('button', { name: /^Collect/ })).toBeInTheDocument();
    expect(screen.queryByText('Breaker')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    expect(screen.getByRole('button', { name: /^Site One/ })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Transfer basket' }))
      .not.toBeInTheDocument();
  });

  it('INV-KIOSK-07 confirms warning items once at final transfer', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/inventory/kiosk/stock')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{
              kind: 'serialized',
              id: itemId,
              item_number: 'TOOL-001',
              name: 'Breaker',
              category: 'tools',
              check_status: 'overdue',
              check_warning_required: true,
            }],
          }),
        };
      }

      const body = JSON.parse(String(init?.body || '{}')) as {
        check_warning_confirmation?: {
          warning_item_ids: string[];
          move_item_ids: string[];
        };
      };
      if (!body.check_warning_confirmation) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            code: 'INVENTORY_CHECK_WARNING_REQUIRED',
            error: 'Confirm warning',
            warning_items: [{
              id: itemId,
              item_number: 'TOOL-001',
              name: 'Breaker',
              check_status: 'overdue',
            }],
            move_item_ids: [itemId],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          kiosk_batch_id: '44444444-4444-4444-8444-444444444444',
          movement_batch_id: '55555555-5555-4555-8555-555555555555',
          hardware_batch_id: null,
          serialized_count: 1,
          hardware_line_count: 0,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <YardKioskApp
        bootstrap={{
          ...bootstrap,
          locations: [{
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Site One',
            description: null,
            location_type: 'site',
            source_type: 'manual',
            external_reference: null,
            linked_asset_label: null,
            linked_asset_nickname: null,
            primary_user_names: [],
            secondary_user_names: [],
          }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Site One/ }));
    });
    fireEvent.click(screen.getByRole('button', { name: /^Breaker/ }));
    expect(screen.getByRole('list', { name: 'Transfer basket' }))
      .toHaveTextContent('Check required');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    });
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Are you sure you want to move it anyway?',
    );
    expect(screen.getByTestId('yard-kiosk-basket-pane')).toHaveTextContent('Breaker');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move anyway' }));
    });
    expect(screen.getByText('Transfer complete')).toBeInTheDocument();

    const submitCalls = fetchMock.mock.calls.filter(([input]) => (
      String(input).includes('/api/inventory/kiosk/submit')
    ));
    const confirmedBody = JSON.parse(
      String((submitCalls[1]?.[1] as RequestInit | undefined)?.body || '{}'),
    );
    expect(confirmedBody.check_warning_confirmation).toEqual({
      warning_item_ids: [itemId],
      move_item_ids: [itemId],
    });
  });

  it('INV-KIOSK-07 blocks double submit and basket mutations until a warning response settles', async () => {
    let resolveSubmit: ((response: ReturnType<typeof warningRequiredResponse>) => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/inventory/kiosk/stock')) {
        return Promise.resolve(warningStockResponse());
      }
      return new Promise<ReturnType<typeof warningRequiredResponse>>((resolve) => {
        resolveSubmit = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<YardKioskApp bootstrap={warningBootstrap} />);
    await addWarningItemToBasket();

    const confirm = screen.getByRole('button', { name: 'Confirm transfer' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    const submitCalls = fetchMock.mock.calls.filter(([input]) => (
      String(input).includes('/api/inventory/kiosk/submit')
    ));
    expect(submitCalls).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Breaker' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear basket' })).toBeDisabled();

    act(() => {
      latestRemoteControlHandler()({ type: 'clear_basket' });
    });
    expect(screen.getByTestId('yard-kiosk-basket-pane')).toHaveTextContent('Breaker');

    await act(async () => {
      resolveSubmit?.(warningRequiredResponse());
      await Promise.resolve();
    });
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Are you sure you want to move it anyway?',
    );
    expect(screen.getByTestId('yard-kiosk-basket-pane')).toHaveTextContent('Breaker');
  });

  it('INV-KIOSK-07 ignores a late warning response after remote reset', async () => {
    let resolveSubmit: ((response: ReturnType<typeof warningRequiredResponse>) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/inventory/kiosk/stock')) {
        return Promise.resolve(warningStockResponse());
      }
      return new Promise<ReturnType<typeof warningRequiredResponse>>((resolve) => {
        resolveSubmit = resolve;
      });
    }));
    render(<YardKioskApp bootstrap={warningBootstrap} />);
    await addWarningItemToBasket();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transfer' }));

    act(() => {
      latestRemoteControlHandler()({ type: 'reset' });
    });
    await act(async () => {
      resolveSubmit?.(warningRequiredResponse());
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /^Collect/ })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Breaker')).not.toBeInTheDocument();
  });

  it('INV-KIOSK-07 never exposes a late warning dialog after remote control activates', async () => {
    let resolveSubmit: ((response: ReturnType<typeof warningRequiredResponse>) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/inventory/kiosk/stock')) {
        return Promise.resolve(warningStockResponse());
      }
      return new Promise<ReturnType<typeof warningRequiredResponse>>((resolve) => {
        resolveSubmit = resolve;
      });
    }));
    const view = render(<YardKioskApp bootstrap={warningBootstrap} />);
    await addWarningItemToBasket();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transfer' }));

    useRemoteControlMock.mockReturnValue({ isRemotelyControlled: true });
    view.rerender(<YardKioskApp bootstrap={warningBootstrap} />);
    await act(async () => {
      resolveSubmit?.(warningRequiredResponse());
      await Promise.resolve();
    });

    expect(screen.getByTestId('yard-kiosk-remote-lock')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('yard-kiosk-basket-pane')).toHaveTextContent('Breaker');

    useRemoteControlMock.mockReturnValue({ isRemotelyControlled: false });
    view.rerender(<YardKioskApp bootstrap={warningBootstrap} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not reveal admin controls for a short or cancelled hold', () => {
    render(<YardKioskApp bootstrap={bootstrap} />);
    const logo = screen.getByRole('button', { name: /Press and hold for 3 seconds/i });

    fireEvent.pointerDown(logo, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_ADMIN_HOLD_DURATION_MS - 1);
    });
    fireEvent.pointerUp(logo);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.pointerDown(logo, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    fireEvent.pointerLeave(logo);
    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_ADMIN_HOLD_DURATION_MS);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('reveals the logout menu after a three-second hold and requires confirmation', async () => {
    render(<YardKioskApp bootstrap={bootstrap} />);
    const logo = screen.getByRole('button', { name: /Press and hold for 3 seconds/i });

    fireEvent.pointerDown(logo, { button: 0 });
    await act(async () => {
      vi.advanceTimersByTime(YARD_KIOSK_ADMIN_HOLD_DURATION_MS);
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    expect(screen.getByRole('alertdialog', { name: 'Log out of Yard Inventory?' }))
      .toBeInTheDocument();
    expect(signOutMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep kiosk open' }));
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('supports the three-second hold with the keyboard', async () => {
    render(<YardKioskApp bootstrap={bootstrap} />);
    const logo = screen.getByRole('button', { name: /Press and hold for 3 seconds/i });

    logo.focus();
    fireEvent.keyDown(logo, { key: ' ' });
    await act(async () => {
      vi.advanceTimersByTime(YARD_KIOSK_ADMIN_HOLD_DURATION_MS);
    });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('logs out once after confirmation and reports a sign-out failure', async () => {
    signOutMock.mockResolvedValue({ error: { message: 'Logout unavailable' } });
    render(<YardKioskApp bootstrap={bootstrap} />);
    const logo = screen.getByRole('button', { name: /Press and hold for 3 seconds/i });

    fireEvent.pointerDown(logo, { button: 0 });
    await act(async () => {
      vi.advanceTimersByTime(YARD_KIOSK_ADMIN_HOLD_DURATION_MS);
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    });

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Logout unavailable');
  });
});
