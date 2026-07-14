/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  YARD_KIOSK_INSTRUCTION_FADE_MS,
  YARD_KIOSK_INSTRUCTION_VISIBLE_MS,
  YardKioskInstructionOverlay,
} from '@/app/yard-kiosk/components/YardKioskInstructionOverlay';

function setReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList));
}

describe('YardKioskInstructionOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses a strong pill treatment, stays readable for three seconds, then fades away', () => {
    render(
      <YardKioskInstructionOverlay
        instructionKey="location:take"
        message="Select the destination location"
      />,
    );

    const overlay = screen.getByRole('status');
    expect(overlay).toHaveTextContent('Select the destination location');
    expect(overlay).toHaveAttribute('data-state', 'visible');
    expect(overlay.firstElementChild).toHaveClass(
      'max-w-[calc(100vw-2.5rem)]',
      'rounded-full',
      'border-[3px]',
      'px-[clamp(3rem,12vw,9rem)]',
      'py-[clamp(3rem,14vh,5.25rem)]',
      'text-center',
    );

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INSTRUCTION_VISIBLE_MS - 1);
    });
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'visible');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'fading');

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INSTRUCTION_FADE_MS);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not restart on rerender but replaces stale guidance on a step change', () => {
    const { rerender } = render(
      <YardKioskInstructionOverlay
        instructionKey="mode"
        message="Choose how stock is moving"
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    rerender(
      <YardKioskInstructionOverlay
        instructionKey="mode"
        message="Choose how stock is moving"
      />,
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'fading');

    rerender(
      <YardKioskInstructionOverlay
        instructionKey="location:return"
        message="Select the source location"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Select the source location');
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'visible');

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INSTRUCTION_VISIBLE_MS - 1);
    });
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'visible');
  });

  it('dismisses immediately on click, clears timers, and stays hidden on same-step rerenders', () => {
    const { rerender } = render(
      <YardKioskInstructionOverlay
        instructionKey="location:take"
        message="Select the destination location"
      />,
    );
    expect(vi.getTimerCount()).toBe(2);

    fireEvent.click(screen.getByRole('button', {
      name: 'Dismiss guidance: Select the destination location',
    }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);

    rerender(
      <YardKioskInstructionOverlay
        instructionKey="location:take"
        message="Select the destination location"
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(
      <YardKioskInstructionOverlay
        instructionKey="items:take"
        message="Choose stock to collect"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Choose stock to collect');
  });

  it.each(['Enter', ' '])('supports keyboard dismissal with %j', (key) => {
    render(
      <YardKioskInstructionOverlay
        instructionKey={`items:${key}`}
        message="Choose stock to collect"
      />,
    );
    const dismissButton = screen.getByRole('button', {
      name: 'Dismiss guidance: Choose stock to collect',
    });

    dismissButton.focus();
    fireEvent.keyDown(dismissButton, { key });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes immediately after the readable period when motion is reduced', () => {
    setReducedMotion(true);
    render(
      <YardKioskInstructionOverlay
        instructionKey="receipt:take"
        message="Transfer complete"
      />,
    );

    act(() => {
      vi.advanceTimersByTime(YARD_KIOSK_INSTRUCTION_VISIBLE_MS);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
