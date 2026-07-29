/** @vitest-environment happy-dom */

import { render, screen } from '@testing-library/react';
import { PackageSearch } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';

describe('AppPageLoadingShell', () => {
  it('keeps the page title visible while content loads', () => {
    render(
      <AppPageLoadingShell
        title="Inventory"
        description="Manage stock and equipment"
        icon={<PackageSearch aria-hidden="true" />}
        message="Loading inventory..."
        accent="inventory"
      />
    );

    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByText('Manage stock and equipment')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading inventory...');
    expect(screen.getByTestId('page-loader')).toHaveAttribute('data-loader-variant', 'compact');
  });
});
