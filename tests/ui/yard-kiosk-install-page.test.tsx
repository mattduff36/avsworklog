/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YardKioskInstallPage from '@/app/yard-kiosk/install/page';

describe('YardKioskInstallPage', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the Android manual install path and kiosk constraints', () => {
    render(<YardKioskInstallPage />);

    expect(screen.getByRole('heading', { name: 'Install Yard Inventory' }))
      .toBeInTheDocument();
    expect(screen.getByText('Choose Add to Home screen')).toBeInTheDocument();
    expect(screen.getByText('Kiosk only')).toBeInTheDocument();
    expect(screen.getByText('Landscape')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open kiosk/i }))
      .toHaveAttribute('href', '/yard-kiosk');
  });

  it('uses the browser installation prompt when Android Chrome supplies it', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    render(<YardKioskInstallPage />);

    const installEvent = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({
        outcome: 'accepted' as const,
        platform: 'web',
      }),
    });
    await act(async () => {
      window.dispatchEvent(installEvent);
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Install Yard Inventory' }),
    );

    await waitFor(() => {
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(/Installation started/i),
      ).toBeInTheDocument();
    });
  });
});
