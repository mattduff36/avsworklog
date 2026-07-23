/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullToRefresh } from '@/components/layout/PullToRefresh';

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function setStandalonePwaMode() {
  Object.defineProperty(window.navigator, 'standalone', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: 0,
  });
}

async function getPullIndicator(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector('.fixed')).not.toBeNull();
  });

  return container.querySelector('.fixed') as HTMLElement;
}

function pullFromTarget(target: Element) {
  fireEvent.touchStart(target, {
    touches: [{ clientY: 0 }],
  });
  return fireEvent.touchMove(target, {
    touches: [{ clientY: 100 }],
  });
}

describe('PullToRefresh', () => {
  beforeEach(() => {
    setStandalonePwaMode();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window.navigator as NavigatorWithStandalone).standalone;
  });

  it('keeps normal top-of-page pull gestures enabled', async () => {
    const { container } = render(<PullToRefresh />);
    const indicator = await getPullIndicator(container);

    const wasNotPrevented = pullFromTarget(document.body);

    expect(wasNotPrevented).toBe(false);
    await waitFor(() => {
      expect(indicator.style.opacity).toBe('1');
      expect(indicator.style.transform).toBe('translateY(40px)');
    });
  });

  it('ignores pull gestures while a form control is focused', async () => {
    const { container } = render(
      <>
        <PullToRefresh />
        <input aria-label="Inventory search" />
      </>,
    );
    const indicator = await getPullIndicator(container);
    const input = container.querySelector('input') as HTMLInputElement;
    input.focus();

    const wasNotPrevented = pullFromTarget(document.body);

    expect(wasNotPrevented).toBe(true);
    expect(indicator.style.opacity).toBe('0');
  });

  it('ignores pull gestures while a marked overlay is open', async () => {
    const { container } = render(
      <>
        <PullToRefresh />
        <div data-mobile-scroll-lock="true" data-state="open">
          Inventory picker
        </div>
      </>,
    );
    const indicator = await getPullIndicator(container);

    const wasNotPrevented = pullFromTarget(document.body);

    expect(wasNotPrevented).toBe(true);
    expect(indicator.style.opacity).toBe('0');
  });

  it('ignores pull gestures originating inside a marked scroll region', async () => {
    const { container } = render(
      <>
        <PullToRefresh />
        <div data-mobile-scroll-lock="true" data-state="closed">
          <span>Scrollable options</span>
        </div>
      </>,
    );
    const indicator = await getPullIndicator(container);
    const target = container.querySelector('span') as HTMLSpanElement;

    const wasNotPrevented = pullFromTarget(target);

    expect(wasNotPrevented).toBe(true);
    expect(indicator.style.opacity).toBe('0');
  });
});
