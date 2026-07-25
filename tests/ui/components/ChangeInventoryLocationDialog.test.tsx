/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ChangeInventoryLocationDialog } from '@/app/(dashboard)/inventory/components/ChangeInventoryLocationDialog';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@/app/(dashboard)/inventory/components/InventoryLocationSelect', () => ({
  InventoryLocationSelect: ({
    onValueChange,
  }: {
    onValueChange: (value: string) => void;
  }) => (
    <button type="button" onClick={() => onValueChange('location-1')}>
      Choose test location
    </button>
  ),
}));

describe('ChangeInventoryLocationDialog', () => {
  it('handles location update failures without an unhandled rejection', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Location update failed'));

    render(
      <ChangeInventoryLocationDialog
        open
        locations={[]}
        userLocation={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose test location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Location' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Location update failed',
        { id: 'inventory-location-update-error' },
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save Location' })).toBeEnabled();
  });
});
