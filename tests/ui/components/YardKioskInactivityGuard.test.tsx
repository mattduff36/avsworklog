/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  YARD_KIOSK_INACTIVITY_RESET_MS,
  YARD_KIOSK_INACTIVITY_WARNING_MS,
  YardKioskInactivityGuard,
} from '@/app/yard-kiosk/components/YardKioskInactivityGuard';

describe('YardKioskInactivityGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns at 105 seconds, counts down, and resets at 120 seconds', () => {
    const onTimeout = vi.fn();
    render(<YardKioskInactivityGuard onTimeout={onTimeout} />);

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INACTIVITY_WARNING_MS - 1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('15 seconds');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('14 seconds');

    act(() => {
      vi.advanceTimersByTime(
        YARD_KIOSK_INACTIVITY_RESET_MS
          - YARD_KIOSK_INACTIVITY_WARNING_MS
          - 1000,
      );
    });
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('restarts the full deadline after activity before the warning', () => {
    render(<YardKioskInactivityGuard onTimeout={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(100_000);
    });
    fireEvent.pointerDown(window);
    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INACTIVITY_WARNING_MS - 1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('15 seconds');
  });

  it('dismisses and restarts after click or keyboard activity during a warning', () => {
    render(<YardKioskInactivityGuard onTimeout={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INACTIVITY_WARNING_MS);
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(window);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INACTIVITY_WARNING_MS);
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cleans timers on exit and starts fresh when re-entered', () => {
    const firstTimeout = vi.fn();
    const firstEntry = render(
      <YardKioskInactivityGuard onTimeout={firstTimeout} />,
    );
    expect(vi.getTimerCount()).toBe(2);

    firstEntry.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INACTIVITY_RESET_MS);
    });
    expect(firstTimeout).not.toHaveBeenCalled();

    const secondTimeout = vi.fn();
    render(<YardKioskInactivityGuard onTimeout={secondTimeout} />);
    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INACTIVITY_WARNING_MS);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('15 seconds');
    expect(secondTimeout).not.toHaveBeenCalled();
  });
});
