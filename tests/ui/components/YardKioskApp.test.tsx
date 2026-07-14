/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { YardKioskBootstrapResponse } from '@/lib/inventory/kiosk-types';
import { YARD_KIOSK_ADMIN_HOLD_DURATION_MS } from '@/app/yard-kiosk/components/YardKioskAdminMenu';

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
    external_reference: null,
    linked_asset_label: null,
    linked_asset_nickname: null,
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

  it('keeps the logo visible beside the Back control during a kiosk transaction', () => {
    render(<YardKioskApp bootstrap={bootstrap} />);

    fireEvent.click(screen.getByRole('button', { name: /^Take/ }));

    expect(screen.getByRole('button', {
      name: /Yard Inventory logo\. Press and hold/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
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
