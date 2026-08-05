import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  validateAppSession,
  requireInventoryKioskAccess,
  getYardKioskBootstrap,
  redirect,
} = vi.hoisted(() => ({
  validateAppSession: vi.fn(),
  requireInventoryKioskAccess: vi.fn(),
  getYardKioskBootstrap: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect,
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession,
}));

vi.mock('@/lib/server/inventory-kiosk', () => ({
  requireInventoryKioskAccess,
  getYardKioskBootstrap,
}));

vi.mock('@/app/yard-kiosk/components/YardKioskApp', () => ({
  YardKioskApp: () => null,
}));

vi.mock('@/app/yard-kiosk/components/YardKioskRecoveryScreen', () => ({
  YardKioskRecoveryScreen: () => null,
}));

import YardKioskPage from '@/app/yard-kiosk/page';

describe('Yard kiosk page session gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to activate when the session is inactive', async () => {
    validateAppSession.mockResolvedValue({
      status: 'invalid',
      secretRotated: false,
    });

    await expect(YardKioskPage()).rejects.toThrow('REDIRECT:/yard-kiosk/activate');
    expect(requireInventoryKioskAccess).not.toHaveBeenCalled();
  });

  it('redirects to activate when the session secret was rotated', async () => {
    validateAppSession.mockResolvedValue({
      status: 'active',
      secretRotated: true,
      cookieValue: 'rotated',
    });

    await expect(YardKioskPage()).rejects.toThrow('REDIRECT:/yard-kiosk/activate');
    expect(requireInventoryKioskAccess).not.toHaveBeenCalled();
  });

  it('continues into kiosk access when the session is stable', async () => {
    validateAppSession.mockResolvedValue({
      status: 'active',
      secretRotated: false,
    });
    requireInventoryKioskAccess.mockResolvedValue({
      allowed: false,
      status: 503,
      error: 'The Yard kiosk has not been configured',
    });

    const result = await YardKioskPage();
    expect(requireInventoryKioskAccess).toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
