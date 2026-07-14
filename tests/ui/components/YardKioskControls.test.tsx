/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { YardKioskBasket } from '@/app/yard-kiosk/components/YardKioskBasket';
import { YardKioskModeSelect } from '@/app/yard-kiosk/components/YardKioskModeSelect';

const counterpart = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Van AB12 CDE',
  description: null,
  location_type: 'van' as const,
  external_reference: null,
};

describe('Yard kiosk touch controls', () => {
  it('starts Take or Return with one large action', () => {
    const onSelect = vi.fn();
    render(<YardKioskModeSelect yardName="Yard" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /take/i }));
    fireEvent.click(screen.getByRole('button', { name: /return/i }));

    expect(onSelect).toHaveBeenNthCalledWith(1, 'take');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'return');
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
});
