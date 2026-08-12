/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppPageHeader } from '@/components/layout/AppPageShell';
import {
  InventoryLocationAction,
  InventoryLocationLabel,
  InventoryMobileHeader,
  InventoryMobilePrimaryNav,
  InventoryMobileSecondaryNav,
  InventoryMobileStatusOverview,
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
import { MapPin, PackageSearch, Settings } from 'lucide-react';

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

  it('keeps desktop summary cards clickable but hides them on mobile', () => {
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
    expect(region.className).toContain('hidden');
    expect(region.className).toContain('md:grid');
    expect(region.className).toContain('grid-cols-5');
    expect(container.innerHTML).toContain('md:p-4');

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

  it('renders primary/secondary tab surfaces as desktop-only (mobile uses dedicated nav components)', () => {
    expect(INVENTORY_PRIMARY_TABS_LIST_CLASSNAME).toContain('hidden');
    expect(INVENTORY_PRIMARY_TABS_LIST_CLASSNAME).toContain('md:inline-flex');
    expect(INVENTORY_EMPLOYEE_TABS_LIST_CLASSNAME).toContain('hidden');
    expect(INVENTORY_EMPLOYEE_TABS_LIST_CLASSNAME).toContain('md:inline-flex');
    expect(INVENTORY_PRIMARY_TABS_ROW_CLASSNAME).toContain('hidden');
    expect(INVENTORY_PRIMARY_TABS_ROW_CLASSNAME).toContain('md:flex');
    expect(INVENTORY_SECONDARY_TABS_LIST_CLASSNAME).toContain('hidden');
    expect(INVENTORY_SECONDARY_TABS_LIST_CLASSNAME).toContain('md:inline-flex');
    expect(INVENTORY_SECONDARY_TABS_ROW_CLASSNAME).toContain('hidden');
    expect(INVENTORY_SECONDARY_TABS_ROW_CLASSNAME).toContain('md:flex');
    expect(INVENTORY_TAB_TRIGGER_CLASSNAME).toContain('data-[state=active]:bg-inventory');
    expect(INVENTORY_PAGE_HEADER_CLASSNAME).toBe('p-4');
  });

  it('INV-MOBILE-001: mobile primary nav exposes destinations and changes section on click', () => {
    const onValueChange = vi.fn();
    render(
      <InventoryMobilePrimaryNav
        items={[
          { value: 'overview', label: 'Overview', icon: PackageSearch },
          { value: 'locations', label: 'Locations', icon: MapPin },
          { value: 'settings', label: 'Settings', icon: Settings },
        ]}
        value="overview"
        onValueChange={onValueChange}
        aria-label="Inventory sections"
      />,
    );

    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Locations' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onValueChange).toHaveBeenCalledWith('settings');
  });

  it('secondary nav renders distinct tiles with active state and optional counts', () => {
    const onValueChange = vi.fn();
    render(
      <InventoryMobileSecondaryNav
        items={[
          { value: 'small_tools', label: 'Small Tools', icon: PackageSearch },
          { value: 'retired', label: 'Retired', icon: Settings, count: 7 },
        ]}
        value="small_tools"
        onValueChange={onValueChange}
        aria-label="Overview sections"
      />,
    );

    expect(screen.getByText('7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retired/ }));
    expect(onValueChange).toHaveBeenCalledWith('retired');
  });

  it('INV-MOBILE-002: mobile status overview retains all five summary values and quick-filter callbacks', () => {
    const onActiveClick = vi.fn();
    const onOverdueClick = vi.fn();

    render(
      <InventoryMobileStatusOverview
        activeLabel="Active items"
        activeValue={469}
        activeIcon={<PackageSearch className="h-5 w-5" />}
        onActiveClick={onActiveClick}
        statuses={[
          { id: 'overdue', label: 'Overdue', value: 78, icon: <PackageSearch className="h-4 w-4" />, tone: 'danger', onClick: onOverdueClick },
          { id: 'due-soon', label: 'Due soon', value: 2, icon: <PackageSearch className="h-4 w-4" />, tone: 'warning' },
          { id: 'needs-check', label: 'Need check', value: 106, icon: <PackageSearch className="h-4 w-4" />, tone: 'info' },
          { id: 'unknown', label: 'Unknown location', value: 113, icon: <PackageSearch className="h-4 w-4" />, tone: 'neutral' },
        ]}
      />,
    );

    expect(screen.getByText('469')).toBeInTheDocument();
    expect(screen.getByText('78')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('106')).toBeInTheDocument();
    expect(screen.getByText('113')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Active items/ }));
    expect(onActiveClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Overdue'));
    expect(onOverdueClick).toHaveBeenCalledTimes(1);
  });

  it('mobile header exposes Add and current-location Change actions', () => {
    const onAdd = vi.fn();
    const onChangeLocation = vi.fn();

    render(
      <InventoryMobileHeader
        onAdd={onAdd}
        locationLabel="Van - TE57 VAN"
        onChangeLocation={onChangeLocation}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('inventory-mobile-location-action'));
    expect(onChangeLocation).toHaveBeenCalledTimes(1);
  });
});
