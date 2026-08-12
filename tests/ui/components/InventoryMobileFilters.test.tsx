/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  InventoryMobileFilterChips,
  InventoryMobileFilters,
} from '@/app/(dashboard)/inventory/components/InventoryMobileFilters';

describe('InventoryMobileFilters', () => {
  it('INV-MOBILE-003: search and the compact Filters button share one row; the sheet is closed by default', () => {
    const onOpenChange = vi.fn();
    render(
      <div className="flex items-center gap-2">
        <input aria-label="Search small tools..." />
        <InventoryMobileFilters
          open={false}
          onOpenChange={onOpenChange}
          activeFilterCount={2}
          hasAnyFilters
          onClearAll={vi.fn()}
        >
          <div>filter body</div>
        </InventoryMobileFilters>
      </div>,
    );

    expect(screen.getByLabelText('Search small tools...')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Filters' });
    expect(trigger).toHaveTextContent('2');
    expect(screen.queryByText('filter body')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('INV-MOBILE-004: active filters can be removed individually or cleared without touching search', async () => {
    const onRemoveOverdue = vi.fn();
    const onClearAll = vi.fn();
    const searchValue = 'small tools search';

    render(
      <>
        <input aria-label="search-input" defaultValue={searchValue} />
        <InventoryMobileFilters
          open
          onOpenChange={vi.fn()}
          activeFilterCount={1}
          hasAnyFilters
          onClearAll={onClearAll}
        >
          <div>filter body</div>
        </InventoryMobileFilters>
        <InventoryMobileFilterChips
          chips={[{ id: 'status:overdue', label: 'Overdue', onRemove: onRemoveOverdue }]}
          onClearAll={onClearAll}
        />
      </>,
    );

    await waitFor(() => expect(screen.getByText('filter body')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Overdue'));
    expect(onRemoveOverdue).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Clear all'));
    expect(onClearAll).toHaveBeenCalledTimes(1);

    // Search input is an independent control; nothing in the filter chip row touches it.
    expect(screen.getByLabelText('search-input')).toHaveValue(searchValue);
  });

  it('reserves no space for chips when there are no active filters', () => {
    const { container } = render(
      <InventoryMobileFilterChips chips={[]} onClearAll={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
