/** @vitest-environment happy-dom */

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { AlertTriangle, Bug, CheckSquare, ListTodo } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  DashboardTaskBadgeLinks,
  type DashboardTaskBadgeLink,
} from '@/components/layout/DashboardTaskBadgeLinks';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const taskLinks: DashboardTaskBadgeLink[] = [
  {
    href: '/approvals',
    label: 'Approvals',
    count: 3,
    icon: CheckSquare,
  },
  {
    href: '/actions',
    label: 'Actions',
    count: 12,
    icon: ListTodo,
  },
  {
    href: '/admin/errors/manage',
    label: 'Error Reports',
    count: 125,
    icon: AlertTriangle,
  },
  {
    href: '/debug',
    label: 'Debug',
    count: 7,
    icon: Bug,
    accent: 'danger',
  },
];

describe('DashboardTaskBadgeLinks', () => {
  it('renders accessible direct links for pending modules', () => {
    render(<DashboardTaskBadgeLinks items={taskLinks} />);

    expect(
      screen.getByRole('navigation', { name: 'Pending management tasks' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Approvals: 3 pending' })).toHaveAttribute(
      'href',
      '/approvals'
    );
    expect(screen.getByRole('link', { name: 'Actions: 12 pending' })).toHaveAttribute(
      'href',
      '/actions'
    );
    expect(
      screen.getByRole('link', { name: 'Error Reports: 125 pending' })
    ).toHaveAttribute('href', '/admin/errors/manage');
    expect(screen.getByRole('link', { name: 'Debug: 7 pending' })).toHaveAttribute(
      'href',
      '/debug'
    );
    expect(screen.getByRole('link', { name: 'Debug: 7 pending' })).toHaveClass('text-red-500');
  });

  it('caps the displayed badge count at 99+', () => {
    render(<DashboardTaskBadgeLinks items={taskLinks} />);

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('stages animated links at consistent 75ms intervals', () => {
    render(
      <DashboardTaskBadgeLinks
        items={taskLinks}
        animateOnLoad
        animationStartIndex={2}
      />
    );

    expect(screen.getByRole('link', { name: 'Approvals: 3 pending' })).toHaveStyle({
      animationDelay: '225ms',
    });
    expect(screen.getByRole('link', { name: 'Actions: 12 pending' })).toHaveStyle({
      animationDelay: '300ms',
    });
  });

  it('does not reserve header space when no tasks are pending', () => {
    const { container } = render(<DashboardTaskBadgeLinks items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
