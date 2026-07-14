/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YardKioskBootstrapResponse } from '@/lib/inventory/kiosk-types';
import { YARD_KIOSK_ADMIN_HOLD_DURATION_MS } from '@/app/yard-kiosk/components/YardKioskAdminMenu';
import {
  YARD_KIOSK_INACTIVITY_RESET_MS,
  YARD_KIOSK_INACTIVITY_WARNING_MS,
} from '@/app/yard-kiosk/components/YardKioskInactivityGuard';

const { signOutMock, useAuthMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: useAuthMock,
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
    expect(screen.getByRole('status')).toHaveTextContent('Select the destination location');

    fireEvent.click(screen.getByRole('button', { name: 'Back to direction selection' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Return/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Select the source location');
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
          is_check_blocked: false,
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
    expect(screen.getByRole('list', { name: 'Transfer basket' }))
      .toHaveTextContent('Breaker');

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
