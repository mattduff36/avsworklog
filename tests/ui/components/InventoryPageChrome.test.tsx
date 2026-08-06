/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppPageHeader } from '@/components/layout/AppPageShell';
import {
  InventoryLocationAction,
  InventoryLocationLabel,
  InventoryRoleViewToggle,
  InventorySummaryCards,
  INVENTORY_EMPLOYEE_TABS_LIST_CLASSNAME,
  INVENTORY_HEADER_CTA_CLASSNAME,
  INVENTORY_PAGE_HEADER_CLASSNAME,
  INVENTORY_PRIMARY_TABS_LIST_CLASSNAME,
  INVENTORY_PRIMARY_TABS_ROW_CLASSNAME,
  INVENTORY_SECONDARY_TABS_LIST_CLASSNAME,
  INVENTORY_SECONDARY_TABS_ROW_CLASSNAME,
  INVENTORY_TAB_TRIGGER_CLASSNAME,
} from '@/app/(dashboard)/inventory/components/InventoryPageChrome';
import { PackageSearch } from 'lucide-react';

describe('InventoryPageChrome', () => {
  it('renders compact location controls and a separate view toggle', () => {
    const onChangeLocation = vi.fn();
    const onValueChange = vi.fn();

    render(
      <>
        <InventoryLocationLabel locationLabel="Van - TE57 VAN" />
        <InventoryLocationAction
          locationLabel="Van - TE57 VAN"
          onChangeLocation={onChangeLocation}
        />
        <InventoryRoleViewToggle value="management" onValueChange={onValueChange} />
      </>,
    );

    expect(screen.queryByText('Working context')).not.toBeInTheDocument();
    expect(screen.getByText('Current location: Van - TE57 VAN')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Management' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'My Location' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'My Location' }));
    expect(onValueChange).toHaveBeenCalledWith('employee');

    fireEvent.click(screen.getByRole('button', { name: 'Change My Location' }));
    expect(onChangeLocation).toHaveBeenCalledTimes(1);
  });

  it('keeps summary cards clickable with responsive class contracts', () => {
    const onClick = vi.fn();

    const { container } = render(
      <InventorySummaryCards
        cards={[
          {
            id: 'active',
            label: 'Active Items',
            shortLabel: 'Active',
            value: 12,
            icon: <PackageSearch className="h-5 w-5" />,
            onClick,
          },
        ]}
      />,
    );

    const region = screen.getByTestId('inventory-summary-cards');
    expect(region.className).toContain('grid-cols-5');
    expect(region.className).toContain('md:gap-4');
    expect(container.innerHTML).not.toContain('min-[900px]');
    expect(container.innerHTML).toContain('md:p-4');
    expect(container.innerHTML).toContain('md:text-2xl');

    fireEvent.click(screen.getByRole('button', { name: 'Filter inventory by Active Items' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses the standard module CTA interaction treatment', () => {
    expect(INVENTORY_HEADER_CTA_CLASSNAME).toContain('bg-inventory');
    expect(INVENTORY_HEADER_CTA_CLASSNAME).toContain('shadow-md');
    expect(INVENTORY_HEADER_CTA_CLASSNAME).toContain('hover:shadow-lg');
    expect(INVENTORY_HEADER_CTA_CLASSNAME).toContain('active:scale-95');
  });

  it('keeps Add Item and location context inside one clean header surface', () => {
    render(
      <AppPageHeader
        title="Inventory"
        description="Track inventory."
        details={<InventoryLocationLabel locationLabel="Van - TE57 VAN" />}
        className={INVENTORY_PAGE_HEADER_CLASSNAME}
        actions={(
          <>
            <button type="button">Add Item</button>
            <InventoryLocationAction
              locationLabel="Van - TE57 VAN"
              onChangeLocation={vi.fn()}
            />
          </>
        )}
      />,
    );

    const headingSurface = screen.getByRole('heading', { name: 'Inventory' }).closest('.rounded-lg');
    const locationActionSurface = screen.getByTestId('inventory-location-action').closest('.rounded-lg');
    const actionSurface = screen.getByRole('button', { name: 'Add Item' }).closest('.rounded-lg');

    expect(headingSurface).toBe(locationActionSurface);
    expect(headingSurface).toBe(actionSurface);
    expect(headingSurface).toHaveTextContent('Current location: Van - TE57 VAN');
    expect(headingSurface).not.toHaveTextContent('Working context');
    expect(headingSurface).toHaveClass('p-4');
  });

  it('exports the contiguous tab alignment contract', () => {
    expect(INVENTORY_PRIMARY_TABS_LIST_CLASSNAME).toContain('grid-cols-3');
    expect(INVENTORY_PRIMARY_TABS_LIST_CLASSNAME).toContain('gap-0');
    expect(INVENTORY_PRIMARY_TABS_LIST_CLASSNAME).toContain('md:inline-flex');
    expect(INVENTORY_EMPLOYEE_TABS_LIST_CLASSNAME).toContain('grid-cols-2');
    expect(INVENTORY_EMPLOYEE_TABS_LIST_CLASSNAME).toContain('gap-0');
    expect(INVENTORY_PRIMARY_TABS_ROW_CLASSNAME).toContain('md:justify-between');
    expect(INVENTORY_SECONDARY_TABS_LIST_CLASSNAME).toContain('grid-cols-2');
    expect(INVENTORY_SECONDARY_TABS_LIST_CLASSNAME).toContain('gap-0');
    expect(INVENTORY_SECONDARY_TABS_LIST_CLASSNAME).toContain('md:inline-flex');
    expect(INVENTORY_SECONDARY_TABS_ROW_CLASSNAME).toContain('justify-start');
    expect(INVENTORY_SECONDARY_TABS_ROW_CLASSNAME).toContain('md:justify-end');
    expect(INVENTORY_SECONDARY_TABS_ROW_CLASSNAME).not.toContain('mt-3');
    expect(INVENTORY_TAB_TRIGGER_CLASSNAME).toContain('md:min-h-8');
    expect(INVENTORY_TAB_TRIGGER_CLASSNAME).toContain('data-[state=active]:bg-inventory');
    expect(INVENTORY_PAGE_HEADER_CLASSNAME).toBe('p-4');
  });
});
