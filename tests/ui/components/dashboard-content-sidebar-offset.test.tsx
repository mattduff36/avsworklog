import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DashboardContent } from '@/components/layout/DashboardContent';

const authState = {
  isManager: false,
  isActualSuperAdmin: false,
};

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

describe('DashboardContent sidebar offset', () => {
  beforeEach(() => {
    authState.isManager = false;
    authState.isActualSuperAdmin = false;
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
});
