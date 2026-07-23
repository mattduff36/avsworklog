/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { YardKioskBasket } from '@/app/yard-kiosk/components/YardKioskBasket';
import { YardKioskItemPicker } from '@/app/yard-kiosk/components/YardKioskItemPicker';
import type {
  YardKioskBasketLine,
  YardKioskCategory,
  YardKioskStockItem,
} from '@/lib/inventory/kiosk-types';
import type { YardKioskItemUiState } from '@/lib/inventory/kiosk-remote-types';

function makeSerializedItem(index: number, category = 'tools'): YardKioskStockItem {
  return {
    kind: 'serialized',
    id: `item-${index}`,
    item_number: `TOOL-${String(index).padStart(3, '0')}`,
    name: `Item ${String(index).padStart(2, '0')}`,
    category,
    check_status: 'ok',
    is_check_blocked: false,
  };
}

function makeHardwareItem(index: number): YardKioskStockItem {
  return {
    kind: 'hardware',
    id: `hardware-${index}`,
    name: `Hardware ${String(index).padStart(2, '0')}`,
    category: 'hardware',
    available_quantity: 20,
  };
}

interface ControlledPickerProps {
  items: YardKioskStockItem[];
  basket?: YardKioskBasketLine[];
  categories?: YardKioskCategory[];
}

const DEFAULT_CATEGORIES: YardKioskCategory[] = [
  { id: 'tools', slug: 'tools', name: 'Tools', sort_order: 1 },
  { id: 'plant', slug: 'plant', name: 'Minor Plant', sort_order: 2 },
];

function ControlledPicker({
  items,
  basket = [],
  categories = DEFAULT_CATEGORIES,
}: ControlledPickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [uiState, setUiState] = useState<YardKioskItemUiState>({
    page_index: 0,
    hardware_item_id: null,
    hardware_quantity: 1,
  });

  return (
    <YardKioskItemPicker
      categories={categories}
      items={items}
      basket={basket}
      searchQuery={query}
      activeCategory={category}
      loading={false}
      uiState={uiState}
      onUiStateChange={setUiState}
      onSearchChange={(nextQuery) => {
        setQuery(nextQuery);
        if (nextQuery) setCategory('all');
      }}
      onCategoryChange={(nextCategory) => {
        setCategory(nextCategory);
        setQuery('');
      }}
      onAddSerialized={vi.fn()}
      onSetHardwareQuantity={vi.fn()}
    />
  );
}

describe('Yard kiosk item result threshold', () => {
  it('labels the Van Stock category as Small Tools', () => {
    render(
      <ControlledPicker
        items={[makeSerializedItem(1, 'van_stock')]}
        categories={[{
          id: 'van-stock',
          slug: 'van_stock',
          name: 'Van Stock',
          sort_order: 1,
        }]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Small Tools' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Van Stock' })).not.toBeInTheDocument();
  });

  it('suppresses tiles and pagination above 24 matches', () => {
    render(
      <ControlledPicker
        items={Array.from({ length: 25 }, (_, index) => makeSerializedItem(index + 1))}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Start typing to narrow the stock list',
    );
    expect(screen.queryByRole('button', { name: /^Item 01/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Item page navigation')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Item pages')).not.toBeInTheDocument();
  });

  it('shows normal tiles and pagination at exactly 24 matches', () => {
    render(
      <ControlledPicker
        items={Array.from({ length: 24 }, (_, index) => makeSerializedItem(index + 1))}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Item 01/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'All available stock 1 / 4' }))
      .toHaveClass('px-1');
    expect(within(screen.getByLabelText('Item pages')).getAllByRole('button'))
      .toHaveLength(4);
  });

  it('keeps prompting while a broad query matches 25 items, then reveals narrowed results', () => {
    render(
      <ControlledPicker
        items={Array.from({ length: 25 }, (_, index) => makeSerializedItem(index + 1))}
      />,
    );
    const search = screen.getByRole('searchbox', { name: 'Search available stock' });

    fireEvent.change(search, { target: { value: 'Item' } });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Keep typing to narrow the stock list',
    );

    fireEvent.change(search, { target: { value: 'Item 25' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Item 25/ })).toBeInTheDocument();
  });

  it('reveals results when an item category narrows the list to 24 or fewer', () => {
    render(
      <ControlledPicker
        items={[
          ...Array.from({ length: 13 }, (_, index) => makeSerializedItem(index + 1)),
          ...Array.from({ length: 12 }, (_, index) => makeHardwareItem(index + 1)),
        ]}
      />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hardware' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Hardware 01/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Hardware 1 / 2' })).toBeInTheDocument();
  });

  it('retains the existing zero-results state', () => {
    render(<ControlledPicker items={[makeSerializedItem(1)]} />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search available stock' }), {
      target: { value: 'missing item' },
    });

    expect(screen.getByText('No stock found')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Item page navigation')).not.toBeInTheDocument();
  });

  it('resets the active page after query, category, and threshold changes', () => {
    render(
      <ControlledPicker
        items={Array.from({ length: 24 }, (_, index) => (
          makeSerializedItem(index + 1, index < 12 ? 'tools' : 'plant')
        ))}
      />,
    );
    let navigation = screen.getByLabelText('Item page navigation');
    fireEvent.click(within(navigation).getByRole('button', { name: 'Next item page' }));
    expect(within(navigation).getByRole('button', { name: 'Previous item page' }))
      .toBeEnabled();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search available stock' }), {
      target: { value: 'Item 0' },
    });
    navigation = screen.getByLabelText('Item page navigation');
    expect(within(navigation).getByRole('button', { name: 'Previous item page' }))
      .toBeDisabled();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search available stock' }), {
      target: { value: 'Item' },
    });
    expect(screen.queryByLabelText('Item page navigation')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search available stock' }), {
      target: { value: '' },
    });
    navigation = screen.getByLabelText('Item page navigation');
    fireEvent.click(within(navigation).getByRole('button', { name: 'Next item page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    navigation = screen.getByLabelText('Item page navigation');
    expect(within(navigation).getByRole('button', { name: 'Previous item page' }))
      .toBeDisabled();
  });

  it('returns to page one after entering and leaving threshold suppression', () => {
    render(
      <ControlledPicker
        items={[
          ...Array.from({ length: 12 }, (_, index) => (
            makeSerializedItem(index + 1, 'tools')
          )),
          ...Array.from({ length: 13 }, (_, index) => (
            makeSerializedItem(index + 13, 'plant')
          )),
        ]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('narrow the stock list');

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    let navigation = screen.getByLabelText('Item page navigation');
    fireEvent.click(within(navigation).getByRole('button', { name: 'Next item page' }));
    expect(within(navigation).getByRole('button', { name: 'Previous item page' }))
      .toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'All stock' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByLabelText('Item page navigation')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    navigation = screen.getByLabelText('Item page navigation');
    expect(within(navigation).getByRole('button', { name: 'Previous item page' }))
      .toBeDisabled();
  });

  it('keeps basket contents usable while item results are suppressed', () => {
    const basketLine: YardKioskBasketLine = {
      kind: 'serialized',
      item_id: 'item-1',
      item_number: 'TOOL-001',
      name: 'Item 01',
      category: 'tools',
    };
    render(
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_21rem] overflow-hidden">
        <div className="min-w-0 overflow-hidden">
          <ControlledPicker
            items={Array.from({ length: 25 }, (_, index) => makeSerializedItem(index + 1))}
            basket={[basketLine]}
          />
        </div>
        <div className="min-w-0 overflow-hidden">
          <YardKioskBasket
            direction="take"
            counterpart={{
              id: 'site-one',
              name: 'Site One',
              description: null,
              location_type: 'site',
              source_type: 'manual',
              external_reference: null,
              linked_asset_label: null,
              linked_asset_nickname: null,
              primary_user_names: [],
              secondary_user_names: [],
            }}
            basket={[basketLine]}
            offline={false}
            submitting={false}
            onRemove={vi.fn()}
            onClear={vi.fn()}
            onSubmit={vi.fn()}
          />
        </div>
      </div>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('narrow the stock list');
    expect(screen.getByRole('list', { name: 'Transfer basket' }))
      .toHaveTextContent('Item 01');
    expect(screen.getByRole('button', { name: 'Remove Item 01' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeEnabled();
  });
});
