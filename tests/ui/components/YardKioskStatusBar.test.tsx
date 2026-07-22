/** @vitest-environment happy-dom */

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YardKioskStatusBar } from '@/app/yard-kiosk/components/YardKioskStatusBar';

const originalVisualViewport = Object.getOwnPropertyDescriptor(
  window,
  'visualViewport',
);

describe('Yard kiosk viewport sizing', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--yard-kiosk-viewport-height');
    if (originalVisualViewport) {
      Object.defineProperty(window, 'visualViewport', originalVisualViewport);
    } else {
      Reflect.deleteProperty(window, 'visualViewport');
    }
    vi.restoreAllMocks();
  });

  it('uses the visible Android viewport without rounding beyond the screen', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 583.8,
        addEventListener,
        removeEventListener,
      },
    });

    const view = render(<YardKioskStatusBar />);

    expect(
      document.documentElement.style.getPropertyValue(
        '--yard-kiosk-viewport-height',
      ),
    ).toBe('583px');
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      'resize',
      expect.any(Function),
    );
  });
});
