/** @vitest-environment happy-dom */

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReleaseVersionLink } from '@/components/layout/ReleaseVersionLink';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/config/release-version', () => ({
  getPublicReleaseVersion: () => '0726.1.0',
  getPublicReleaseVersionLabel: () => 'Version 0726.1.0',
}));

describe('ReleaseVersionLink', () => {
  it('renders the version label linking to version history', () => {
    render(<ReleaseVersionLink />);

    const link = screen.getByRole('link', { name: 'Open version history' });
    expect(link).toHaveAttribute('href', '/help/version-history');
    expect(link).toHaveTextContent('Version 0726.1.0');
  });

  it('renders a compact bare version number when requested', () => {
    render(<ReleaseVersionLink compact />);

    const link = screen.getByRole('link', { name: 'Open version history' });
    expect(link).toHaveTextContent('0726.1.0');
    expect(link).not.toHaveTextContent('Version');
  });
});
