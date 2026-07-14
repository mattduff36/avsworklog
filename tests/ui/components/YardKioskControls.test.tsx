/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { YardKioskBasket } from '@/app/yard-kiosk/components/YardKioskBasket';
import { YardKioskItemPicker } from '@/app/yard-kiosk/components/YardKioskItemPicker';
import { YardKioskLocationPager } from '@/app/yard-kiosk/components/YardKioskLocationPager';
import { YardKioskModeSelect } from '@/app/yard-kiosk/components/YardKioskModeSelect';

const counterpart = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Van AB12 CDE',
  description: null,
  location_type: 'van' as const,
  source_type: null,
  external_reference: null,
  primary_user_names: [],
  secondary_user_names: [],
};

describe('Yard kiosk touch controls', () => {
  it('starts Collect or Return with one large action while preserving direction values', () => {
    const onSelect = vi.fn();
    render(<YardKioskModeSelect yardName="Yard" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /^collect/i }));
    fireEvent.click(screen.getByRole('button', { name: /return/i }));

    expect(onSelect).toHaveBeenNthCalledWith(1, 'take');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'return');
    expect(screen.getByText('Start a collection')).toBeInTheDocument();
  });

  it('shows a unified basket summary and submits once', () => {
    const onSubmit = vi.fn();
    render(
      <YardKioskBasket
        direction="take"
        counterpart={counterpart}
        basket={[
          {
            kind: 'serialized',
            item_id: '22222222-2222-4222-8222-222222222222',
            item_number: 'TOOL-001',
            name: 'Breaker',
            category: 'tools',
          },
          {
            kind: 'hardware',
            item_id: '33333333-3333-4333-8333-333333333333',
            name: 'Cones',
            quantity: 5,
            available_quantity: 10,
          },
        ]}
        offline={false}
        submitting={false}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText('Breaker')).toBeInTheDocument();
    expect(screen.getByText('Quantity 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('blocks submission while offline without clearing the basket', () => {
    render(
      <YardKioskBasket
        direction="return"
        counterpart={counterpart}
        basket={[{
          kind: 'serialized',
          item_id: '22222222-2222-4222-8222-222222222222',
          item_number: 'TOOL-001',
          name: 'Breaker',
          category: 'tools',
        }]}
        offline
        submitting={false}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText(/offline/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
    expect(screen.getByText('Breaker')).toBeInTheDocument();
  });

  it('keeps enlarged carousel controls together and separate from workflow navigation', () => {
    const locationRender = render(
      <YardKioskLocationPager
        direction="take"
        locations={[counterpart]}
        onSelect={vi.fn()}
        onIncludeLegacyQuotesChange={vi.fn(async () => undefined)}
      />,
    );
    const locationNavigation = screen.getByLabelText('Location page navigation');
    const previousLocation = within(locationNavigation)
      .getByRole('button', { name: 'Previous location page' });
    const nextLocation = within(locationNavigation)
      .getByRole('button', { name: 'Next location page' });

    expect(locationNavigation).toHaveAttribute(
      'data-yard-kiosk-pager-navigation',
      'horizontal',
    );
    expect(locationNavigation).toHaveClass('flex-row', 'flex-nowrap');
    expect(previousLocation).toHaveClass('h-14', 'w-14');
    expect(nextLocation).toHaveClass('h-14', 'w-14');
    expect(previousLocation).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Vans' })).toHaveClass('px-1');
    const search = screen.getByRole('searchbox', { name: 'Search locations' });
    const allFilter = screen.getByRole('radio', { name: 'All' });
    const legacySites = screen.getByRole('button', { name: 'Include legacy sites' });
    expect(search).toHaveClass('h-14', 'rounded-2xl', 'border');
    const filterGroup = screen.getByRole('radiogroup', { name: 'Filter locations' });
    expect(filterGroup).toHaveClass('gap-3');
    within(filterGroup).getAllByRole('radio').forEach((filter) => {
      expect(filter).toHaveClass('h-14', 'w-20', 'rounded-2xl', 'border', 'text-center');
    });
    expect(allFilter).toHaveAttribute('aria-checked', 'true');
    expect(legacySites).toHaveClass(
      'h-14',
      'rounded-2xl',
      'border',
      'border-white/10',
      'bg-transparent',
      'text-slate-500',
    );

    locationRender.unmount();

    render(
      <YardKioskItemPicker
        categories={[]}
        items={[{
          kind: 'serialized',
          id: '44444444-4444-4444-8444-444444444444',
          item_number: 'TOOL-001',
          name: 'Breaker',
          category: 'tools',
          check_status: 'ok',
          is_check_blocked: false,
        }]}
        basket={[]}
        searchQuery=""
        activeCategory="all"
        loading={false}
        onSearchChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onAddSerialized={vi.fn()}
        onSetHardwareQuantity={vi.fn()}
      />,
    );
    const itemNavigation = screen.getByLabelText('Item page navigation');

    expect(itemNavigation).toHaveAttribute(
      'data-yard-kiosk-pager-navigation',
      'horizontal',
    );
    expect(itemNavigation).toHaveClass('flex-row', 'flex-nowrap');
    expect(within(itemNavigation).getByRole('button', { name: 'Previous item page' }))
      .toHaveClass('h-14', 'w-14');
    expect(within(itemNavigation).getByRole('button', { name: 'Next item page' }))
      .toHaveClass('h-14', 'w-14');
    expect(within(itemNavigation).getByRole('button', { name: 'Previous item page' }))
      .toBeDisabled();
    expect(screen.getByTestId('yard-kiosk-item-picker'))
      .toHaveClass('min-w-0', 'overflow-hidden');
    expect(screen.getByText('All available stock').parentElement)
      .toHaveClass('px-1');
  });
});
