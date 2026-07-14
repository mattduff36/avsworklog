/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { YardKioskBootstrapResponse } from '@/lib/inventory/kiosk-types';

const { useAuthMock } = vi.hoisted(() => ({
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

describe('YardKioskApp biometric enrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hosts the existing enrollment prompt for the authenticated kiosk profile', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'kiosk-profile' },
      loading: false,
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
    });

    render(<YardKioskApp bootstrap={bootstrap} />);

    expect(screen.getByTestId('biometric-enrollment-prompt'))
      .toHaveAttribute('data-can-check', 'false');
  });
});
