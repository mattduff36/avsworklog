/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChangePasswordPage from '@/app/(auth)/change-password/page';
import { ProfileSecurityTab } from '@/components/profile/ProfileSecurityTab';

const { replaceMock, pushMock, loadClientAuthSessionMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  loadClientAuthSessionMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
  }),
  usePathname: () => '/change-password',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/app-auth/client-session', () => ({
  loadClientAuthSession: loadClientAuthSessionMock,
}));

vi.mock('@/components/profile/ProfileBiometricsCard', () => ({
  ProfileBiometricsCard: () => null,
}));

vi.mock('@/components/profile/ProfileSensitivePinCard', () => ({
  ProfileSensitivePinCard: () => null,
}));

vi.mock('@/components/profile/ProfileWidescreenPreferenceCard', () => ({
  ProfileWidescreenPreferenceCard: () => null,
}));

function authenticatedSession(mustChangePassword: boolean) {
  return {
    status: 'authenticated',
    payload: {
      authenticated: true,
      user: { id: 'user-1', email: 'user@example.com' },
      profile: {
        full_name: 'Alex Stone',
        must_change_password: mustChangePassword,
      },
    },
    responseStatus: 200,
    error: null,
  };
}

describe('change password page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('sends an unauthenticated visitor to login', async () => {
    loadClientAuthSessionMock.mockResolvedValue({
      status: 'unauthenticated',
      payload: null,
      responseStatus: 401,
      error: null,
    });

    render(<ChangePasswordPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login');
    });
  });

  it('lets a normal signed-in user change their password and returns to profile security', async () => {
    loadClientAuthSessionMock.mockResolvedValue(authenticatedSession(false));
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    render(<ChangePasswordPage />);

    expect(await screen.findByText('Change password')).toBeInTheDocument();
    expect(screen.getByText(/stay signed in on this device/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Current Password/i), {
      target: { value: 'OldPassword1' },
    });
    fireEvent.change(screen.getByLabelText(/^New Password/i), {
      target: { value: 'NewPassword1' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/i), {
      target: { value: 'NewPassword1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));

    expect(await screen.findByText(/Redirecting you to Security/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/profile?tab=settings&settingsTab=security');
    }, { timeout: 3000 });
  });

  it('keeps mandatory temporary-password wording and returns to the dashboard', async () => {
    loadClientAuthSessionMock.mockResolvedValue(authenticatedSession(true));
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    render(<ChangePasswordPage />);

    expect(await screen.findByText('Change Your Password')).toBeInTheDocument();
    expect(screen.getByText(/temporary password/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Current Password/i), {
      target: { value: 'TempPassword1' },
    });
    fireEvent.change(screen.getByLabelText(/^New Password/i), {
      target: { value: 'NewPassword1' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/i), {
      target: { value: 'NewPassword1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));

    expect(await screen.findByText(/Redirecting you to the dashboard/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    }, { timeout: 3000 });
  });
});

describe('profile security password entry', () => {
  it('links a signed-in user to the shared change-password page', () => {
    render(<ProfileSecurityTab sensitiveModules={[]} />);

    expect(screen.getAllByText('Change password').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Change password' })).toHaveAttribute('href', '/change-password');
  });
});
