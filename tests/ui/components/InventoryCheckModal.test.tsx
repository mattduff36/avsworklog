import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryCheckModal } from '@/app/(dashboard)/inventory/components/InventoryCheckModal';
import {
  INVENTORY_SERVICE_CHECKLIST_ITEMS,
  INVENTORY_SERVICE_CHECKLIST_VERSION,
} from '@/lib/checklists/inventory-service-checklist';

const definition = {
  version: INVENTORY_SERVICE_CHECKLIST_VERSION,
  label: 'Service',
  modalTitle: 'Service Check',
  modalDescription: 'Complete every item.',
  pdfTitle: 'Service checklist',
  pdfSubtitle: 'Service checklist',
  items: INVENTORY_SERVICE_CHECKLIST_ITEMS.slice(0, 1),
};

describe('INV-CHECK-UI-001 InventoryCheckModal future confirmation', () => {
  it('asks for confirmation on future dates and submits only after confirm', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <InventoryCheckModal
        open
        onOpenChange={vi.fn()}
        itemName="Test Item"
        itemNumber="AVS1"
        checklistDefinition={definition}
        initialCheckedAt="2026-08-07"
        saving={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Check Date'), {
      target: { value: '2026-12-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Check' }));

    expect(await screen.findByText('Confirm future check date')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm future date' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      checked_at: '2026-12-01',
      confirm_future_date: true,
    });
    expect(onSubmit.mock.calls[0][0].submission_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('cancels future confirmation without submitting', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <InventoryCheckModal
        open
        onOpenChange={vi.fn()}
        itemName="Test Item"
        itemNumber="AVS1"
        checklistDefinition={definition}
        initialCheckedAt="2026-08-07"
        saving={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText('Check Date'), {
      target: { value: '2026-12-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Check' }));
    expect(await screen.findByText('Confirm future check date')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByText('Confirm future check date')).toBeNull();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
