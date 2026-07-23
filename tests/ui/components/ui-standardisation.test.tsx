import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataViewToggle } from '@/components/ui/data-view-controls';
import {
  Dialog,
  DialogContent,
  DialogScrollArea,
  DialogTitle,
  dialogContentViewportClassName,
} from '@/components/ui/dialog';

describe('UI standardisation helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('composes viewport-safe dialog classes with size variants', () => {
    const className = dialogContentViewportClassName({
      size: '3xl',
      className: 'border-border text-white',
    });

    expect(className).toContain('max-h-[calc(100dvh-1rem)]');
    expect(className).toContain('w-[calc(100vw-1rem)]');
    expect(className).toContain('overflow-y-auto');
    expect(className).toContain('max-w-3xl');
    expect(className).toContain('border-border');
    expect(className).toContain('text-white');
  });

  it('applies the opt-in keyboard-safe dialog layout and bounded scroll body', () => {
    render(
      <Dialog open>
        <DialogContent mobileKeyboardSafe hideCloseButton>
          <DialogTitle>Mobile inventory form</DialogTitle>
          <DialogScrollArea data-testid="dialog-scroll-area">
            Form fields
          </DialogScrollArea>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Mobile inventory form' });
    const scrollArea = screen.getByTestId('dialog-scroll-area');

    expect(dialog).toHaveAttribute('data-mobile-scroll-lock', 'true');
    expect(dialog.className).toContain('top-[var(--dialog-visual-viewport-top,0px)]');
    expect(dialog.className).toContain('h-[var(--dialog-visual-viewport-height,100dvh)]');
    expect(dialog.className).toContain('sm:top-[50%]');
    expect(dialog.className).toContain('sm:translate-y-[-50%]');
    expect(scrollArea.className).toContain('min-h-0');
    expect(scrollArea.className).toContain('flex-1');
    expect(scrollArea.className).toContain('overflow-y-auto');
  });

  it('tracks the visible viewport while the mobile keyboard changes its height', async () => {
    const resizeListeners = new Set<EventListener>();
    const visualViewport = {
      height: 420,
      offsetTop: 72,
      addEventListener: vi.fn((event: string, listener: EventListener) => {
        if (event === 'resize') resizeListeners.add(listener);
      }),
      removeEventListener: vi.fn((event: string, listener: EventListener) => {
        if (event === 'resize') resizeListeners.delete(listener);
      }),
    };
    vi.stubGlobal('visualViewport', visualViewport);

    render(
      <Dialog open>
        <DialogContent mobileKeyboardSafe hideCloseButton>
          <DialogTitle>Keyboard-aware dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Keyboard-aware dialog' });
    await waitFor(() => {
      expect(dialog.style.getPropertyValue('--dialog-visual-viewport-height')).toBe('420px');
      expect(dialog.style.getPropertyValue('--dialog-visual-viewport-top')).toBe('72px');
    });

    visualViewport.height = 300;
    resizeListeners.forEach((listener) => listener(new Event('resize')));

    await waitFor(() => {
      expect(dialog.style.getPropertyValue('--dialog-visual-viewport-height')).toBe('300px');
    });
  });

  it('keeps table/card view toggle callbacks generic', () => {
    const onValueChange = vi.fn();

    render(<DataViewToggle value="table" onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole('button', { name: /cards/i }));

    expect(onValueChange).toHaveBeenCalledWith('cards');
  });
});
