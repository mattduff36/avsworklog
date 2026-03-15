import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import {
  TABLET_TOUCH_BUTTON_CLASS,
  TABLET_TOUCH_DROPDOWN_CONTENT_CLASS,
  TABLET_TOUCH_DROPDOWN_ITEM_CLASS,
  TABLET_TOUCH_SELECT_CONTENT_CLASS,
  TABLET_TOUCH_SELECT_ITEM_CLASS,
  TABLET_TOUCH_SELECT_TRIGGER_CLASS,
  TabletAwareButton,
  TabletAwareDropdownMenuContent,
  TabletAwareDropdownMenuItem,
  TabletAwareSelectContent,
  TabletAwareSelectItem,
  TabletAwareSelectTrigger,
} from '@/components/ui/tablet-mode-controls';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'tablet-test-user' } },
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ className, children, ...props }: React.ComponentProps<'button'>) => (
    <button className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/select', () => ({
  SelectTrigger: ({ className, children, ...props }: React.ComponentProps<'button'>) => (
    <button className={className} {...props}>
      {children}
    </button>
  ),
  SelectContent: ({ className, children, ...props }: React.ComponentProps<'div'>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  SelectItem: ({ className, children, ...props }: React.ComponentProps<'div'>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuContent: ({ className, children, ...props }: React.ComponentProps<'div'>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({ className, children, ...props }: React.ComponentProps<'div'>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}));

function Harness({ tabletEnabled }: { tabletEnabled: boolean }) {
  if (tabletEnabled) {
    localStorage.setItem('tablet_mode:tablet-test-user', 'on');
  }

  return (
    <TabletModeProvider>
      <TabletAwareButton data-testid="touch-button">Tap</TabletAwareButton>
      <TabletAwareSelectTrigger data-testid="touch-select-trigger">Trigger</TabletAwareSelectTrigger>
      <TabletAwareSelectContent data-testid="touch-select-content">Content</TabletAwareSelectContent>
      <TabletAwareSelectItem data-testid="touch-select-item" value="one">
        Item
      </TabletAwareSelectItem>
      <TabletAwareDropdownMenuContent data-testid="touch-dropdown-content">
        Dropdown Content
      </TabletAwareDropdownMenuContent>
      <TabletAwareDropdownMenuItem data-testid="touch-dropdown-item">
        Dropdown Item
      </TabletAwareDropdownMenuItem>
    </TabletModeProvider>
  );
}

describe('tablet touch controls wrappers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps default classes when tablet mode is off', async () => {
    render(<Harness tabletEnabled={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('touch-button')).toBeInTheDocument();
    });

    expect(screen.getByTestId('touch-button').className).not.toContain('min-h-11');
    expect(screen.getByTestId('touch-select-trigger').className).not.toContain('min-h-11');
    expect(screen.getByTestId('touch-select-content').className).not.toContain('max-h-[420px]');
    expect(screen.getByTestId('touch-select-item').className).not.toContain('min-h-11');
    expect(screen.getByTestId('touch-dropdown-content').className).not.toContain('min-w-[12rem]');
    expect(screen.getByTestId('touch-dropdown-item').className).not.toContain('min-h-11');
  });

  it('adds touch-size classes when tablet mode is on', async () => {
    render(<Harness tabletEnabled />);

    await waitFor(() => {
      expect(screen.getByTestId('touch-button').className).toContain('min-h-11');
    });

    expect(screen.getByTestId('touch-button').className).toContain(TABLET_TOUCH_BUTTON_CLASS);
    expect(screen.getByTestId('touch-select-trigger').className).toContain(TABLET_TOUCH_SELECT_TRIGGER_CLASS);
    expect(screen.getByTestId('touch-select-content').className).toContain(TABLET_TOUCH_SELECT_CONTENT_CLASS);
    expect(screen.getByTestId('touch-select-item').className).toContain(TABLET_TOUCH_SELECT_ITEM_CLASS);
    expect(screen.getByTestId('touch-dropdown-content').className).toContain(TABLET_TOUCH_DROPDOWN_CONTENT_CLASS);
    expect(screen.getByTestId('touch-dropdown-item').className).toContain(TABLET_TOUCH_DROPDOWN_ITEM_CLASS);
  });
});
