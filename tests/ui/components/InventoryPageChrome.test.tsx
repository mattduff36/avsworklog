/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  InventoryContextToolbar,
  InventoryRoleViewToggle,
  InventorySummaryCards,
  INVENTORY_PRIMARY_TABS_LIST_CLASSNAME,
  INVENTORY_SECONDARY_TABS_LIST_CLASSNAME,
  INVENTORY_SECONDARY_TABS_ROW_CLASSNAME,
} from '@/app/(dashboard)/inventory/components/InventoryPageChrome';
import { PackageSearch } from 'lucide-react';

describe('InventoryPageChrome', () => {
  it('renders labelled view and location controls in the context toolbar', () => {
    const onChangeLocation = vi.fn();
    const onValueChange = vi.fn();

    render(
      <InventoryContextToolbar
        roleViewToggle={(
          <InventoryRoleViewToggle value="management" onValueChange={onValueChange} />
        )}
        locationLabel="Van - TE57 VAN"
        onChangeLocation={onChangeLocation}
      />,
    );

    expect(screen.getByTestId('inventory-context-toolbar')).toBeInTheDocument();
    expect(screen.getByText('Working context')).toBeInTheDocument();
    expect(screen.getByText('Current location: Van - TE57 VAN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Management' })).toHaveTextContent('Management');
    expect(screen.getByRole('button', { name: 'My Location' })).toHaveTextContent('My Location');

    fireEvent.click(screen.getByRole('button', { name: 'My Location' }));
    expect(onValueChange).toHaveBeenCalledWith('employee');

    fireEvent.click(screen.getByRole('button', { name: /Change My Location/i }));
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

  it('keeps location and view controls out of the Add Item header slot', () => {
    render(
      <div>
        <button type="button">Add Item</button>
        <InventoryContextToolbar
          roleViewToggle={<InventoryRoleViewToggle value="management" onValueChange={vi.fn()} />}
          locationLabel="Van - TE57 VAN"
          onChangeLocation={vi.fn()}
        />
      </div>,
    );

    const toolbar = screen.getByTestId('inventory-context-toolbar');
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Management' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: /Change My Location/i }));
    expect(toolbar).not.toContainElement(screen.getByRole('button', { name: 'Add Item' }));
  });

  it('exports the management tab alignment contract', () => {
    expect(INVENTORY_PRIMARY_TABS_LIST_CLASSNAME).toContain('grid-cols-3');
    expect(INVENTORY_PRIMARY_TABS_LIST_CLASSNAME).toContain('md:inline-flex');
    expect(INVENTORY_SECONDARY_TABS_LIST_CLASSNAME).toContain('grid-cols-2');
    expect(INVENTORY_SECONDARY_TABS_LIST_CLASSNAME).toContain('md:inline-flex');
    expect(INVENTORY_SECONDARY_TABS_ROW_CLASSNAME).toContain('justify-start');
    expect(INVENTORY_SECONDARY_TABS_ROW_CLASSNAME).toContain('md:justify-end');
  });
});
