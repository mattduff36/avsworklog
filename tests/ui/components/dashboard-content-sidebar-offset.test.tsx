import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DashboardContent } from '@/components/layout/DashboardContent';
import { isDashboardFullWidthPath } from '@/lib/config/layout-preferences';

const authState = {
  isManager: false,
  isActualSuperAdmin: false,
};
const tabletState = {
  tabletModeEnabled: false,
};

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({
    tabletModeEnabled: tabletState.tabletModeEnabled,
  }),
}));

describe('dashboard full-width routes', () => {
  it('only expands the daily allocation board', () => {
    expect(isDashboardFullWidthPath('/daily-allocation')).toBe(true);
    expect(isDashboardFullWidthPath('/daily-allocation/my')).toBe(false);
    expect(isDashboardFullWidthPath('/quotes')).toBe(false);
  });
});

describe('DashboardContent sidebar offset', () => {
  beforeEach(() => {
    authState.isManager = false;
    authState.isActualSuperAdmin = false;
    tabletState.tabletModeEnabled = false;
  });

  it('does not add sidebar offset for standard users', () => {
    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toContain('md:pl-16');
  });

  it('adds sidebar offset for manager users', () => {
    authState.isManager = true;

    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('md:pl-16');
  });

  it('adds sidebar offset for superadmin users', () => {
    authState.isActualSuperAdmin = true;

    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('md:pl-16');
  });

  it('does not add sidebar offset in tablet mode', () => {
    authState.isManager = true;
    tabletState.tabletModeEnabled = true;

    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toContain('md:pl-16');
  });

  it('keeps the default content max width unless fullWidth is requested', () => {
    const { container, rerender } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const defaultMain = container.querySelector('main') as HTMLElement;
    expect(defaultMain.className).toContain('max-w-7xl');
    expect(defaultMain).toHaveAttribute('data-content-width', 'default');

    rerender(
      <DashboardContent fullWidth>
        <div>content</div>
      </DashboardContent>
    );

    const fullMain = container.querySelector('main') as HTMLElement;
    expect(fullMain.className).toContain('max-w-none');
    expect(fullMain.className).not.toContain('max-w-7xl');
    expect(fullMain.className).toContain('xl:overflow-hidden');
    expect(fullMain.className).toContain('xl:flex-1');
    expect(fullMain).toHaveAttribute('data-content-width', 'full');

    const fullWrapper = container.firstElementChild as HTMLElement;
    expect(fullWrapper.className).toContain('xl:flex-1');
  });
});
