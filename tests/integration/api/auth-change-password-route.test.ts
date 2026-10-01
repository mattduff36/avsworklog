import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateUserById, profileEq, profileUpdate, from, verifyUserPassword, revokeOtherAppSessionsForProfile } = vi.hoisted(() => {
  const updateUserById = vi.fn();
  const profileEq = vi.fn();
  const profileUpdate = vi.fn(() => ({ eq: profileEq }));
  const from = vi.fn(() => ({ update: profileUpdate }));
  const verifyUserPassword = vi.fn();
  const revokeOtherAppSessionsForProfile = vi.fn();
  return { updateUserById, profileEq, profileUpdate, from, verifyUserPassword, revokeOtherAppSessionsForProfile };
});

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  revokeOtherAppSessionsForProfile,
}));

vi.mock('@/lib/server/password-auth', () => ({
  verifyUserPassword,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        updateUserById,
      },
    },
    from,
  })),
}));

import { POST as changePasswordPost } from '@/app/api/auth/change-password/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';

describe('auth change-password route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileEq.mockResolvedValue({ error: null });
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
        email: 'user-1@example.com',
      },
      validation: {
        session: { id: 'session-current' },
        cookieValue: null,
        cookieExpiresAt: null,
      },
    } as never);
    updateUserById.mockResolvedValue({ error: null });
    verifyUserPassword.mockResolvedValue(true);
    revokeOtherAppSessionsForProfile.mockResolvedValue(1);
  });

  it('preserves leading and trailing whitespace when updating the password', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: '  Padded1Secret  ',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(verifyUserPassword).toHaveBeenCalledWith('user-1@example.com', 'user-1', 'OldPassword123');
    expect(updateUserById).toHaveBeenCalledWith('user-1', {
      password: '  Padded1Secret  ',
    });
    expect(profileUpdate).toHaveBeenCalledWith({ must_change_password: false });
    expect(profileEq).toHaveBeenCalledWith('id', 'user-1');
    expect(revokeOtherAppSessionsForProfile).toHaveBeenCalledTimes(2);
    expect(revokeOtherAppSessionsForProfile).toHaveBeenCalledWith(
      'user-1',
      'session-current',
      'password_changed'
    );
  });

  it('rejects requests without a current password', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Current password is required');
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revokeOtherAppSessionsForProfile).not.toHaveBeenCalled();
  });

  it('rejects an incorrect current password', async () => {
    verifyUserPassword.mockResolvedValue(false);

    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'WrongPassword123',
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Current password is incorrect');
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revokeOtherAppSessionsForProfile).not.toHaveBeenCalled();
  });

  it('rejects passwords that are only whitespace', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: '   ',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Password is required');
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revokeOtherAppSessionsForProfile).not.toHaveBeenCalled();
  });

  it('rejects a new password that does not meet the strength policy', async () => {
    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: 'short',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Password must be at least 8 characters long');
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revokeOtherAppSessionsForProfile).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request before changing anything', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);

    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(revokeOtherAppSessionsForProfile).not.toHaveBeenCalled();
  });

  it('preserves a rotated session cookie for the current session while revoking others', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
        email: 'user-1@example.com',
      },
      validation: {
        session: { id: 'session-current' },
        cookieValue: 'rotated-cookie',
        cookieExpiresAt: new Date('2026-04-05T12:00:00.000Z'),
      },
    } as never);

    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);

    expect(response.status).toBe(200);
    expect(response.cookies.get('avs_app_session')?.value).toBe('rotated-cookie');
    expect(revokeOtherAppSessionsForProfile).toHaveBeenCalledTimes(2);
    expect(revokeOtherAppSessionsForProfile).toHaveBeenCalledWith(
      'user-1',
      'session-current',
      'password_changed'
    );
  });

  it('preserves a rotated session cookie and revokes other sessions when no app session id is present', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      profile: {
        id: 'user-1',
        email: 'user-1@example.com',
      },
      validation: {
        session: null,
        cookieValue: 'rotated-cookie',
        cookieExpiresAt: new Date('2026-04-05T12:00:00.000Z'),
      },
    } as never);

    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);

    expect(response.status).toBe(200);
    expect(response.cookies.get('avs_app_session')?.value).toBe('rotated-cookie');
    expect(revokeOtherAppSessionsForProfile).toHaveBeenCalledTimes(2);
    expect(revokeOtherAppSessionsForProfile).toHaveBeenCalledWith(
      'user-1',
      null,
      'password_changed'
    );
  });

  it('returns the revocation error without reporting success when other sessions cannot be revoked', async () => {
    revokeOtherAppSessionsForProfile.mockRejectedValue(new Error('session store unavailable'));

    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBeUndefined();
    expect(payload.error).toBe('session store unavailable');
    expect(updateUserById).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('restores the previous password when the account flag cannot be cleared', async () => {
    profileEq.mockResolvedValueOnce({ error: { message: 'profile write failed' } });

    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBeUndefined();
    expect(payload.error).toBe('Password change could not be completed. Please try again.');
    expect(revokeOtherAppSessionsForProfile).toHaveBeenCalledTimes(2);
    expect(revokeOtherAppSessionsForProfile).toHaveBeenCalledWith(
      'user-1',
      'session-current',
      'password_changed'
    );
    expect(updateUserById).toHaveBeenNthCalledWith(1, 'user-1', { password: 'NewPassword123' });
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'user-1', { password: 'OldPassword123' });
  });

  it('restores the previous password when the post-update session sweep fails', async () => {
    revokeOtherAppSessionsForProfile
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('sweep failed'));

    const request = new Request('http://localhost/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'OldPassword123',
        password: 'NewPassword123',
      }),
    });

    const response = await changePasswordPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Password change could not be completed. Please try again.');
    expect(updateUserById).toHaveBeenNthCalledWith(1, 'user-1', { password: 'NewPassword123' });
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'user-1', { password: 'OldPassword123' });
    expect(profileUpdate).not.toHaveBeenCalled();
  });
});
