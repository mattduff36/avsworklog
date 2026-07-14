/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  YARD_KIOSK_AUTO_LAUNCH_DELAY_MS,
  YardKioskAutoLaunch,
} from '@/app/(dashboard)/dashboard/components/YardKioskAutoLaunch';

const { replaceMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

describe('YardKioskAutoLaunch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replaceMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces the dashboard route after exactly ten seconds for the kiosk account', () => {
    render(<YardKioskAutoLaunch enabled />);

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_AUTO_LAUNCH_DELAY_MS - 1);
    });
    expect(replaceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(replaceMock).toHaveBeenCalledWith('/yard-kiosk');
  });

  it('does nothing for an account without kiosk launch access', () => {
    render(<YardKioskAutoLaunch enabled={false} />);

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_AUTO_LAUNCH_DELAY_MS);
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('cancels the pending launch when the dashboard unmounts', () => {
    const { unmount } = render(<YardKioskAutoLaunch enabled />);

    unmount();
    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_AUTO_LAUNCH_DELAY_MS);
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
