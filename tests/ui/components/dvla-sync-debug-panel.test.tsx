/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DVLASyncDebugPanel } from '@/app/(dashboard)/debug/components/DVLASyncDebugPanel';

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

describe('DVLASyncDebugPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === '/api/maintenance') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            vehicles: [
              {
                vehicle: {
                  reg_number: 'PL11 CCC',
                  asset_type: 'plant',
                },
                plant_id: 'plant-1',
              },
            ],
          }),
        } as Response;
      }

      if (url === '/api/maintenance/sync-dvla') {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ assetId: 'plant-1', assetType: 'plant' }));

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            total: 1,
            successful: 1,
            failed: 0,
            results: [
              {
                success: true,
                registrationNumber: 'PL11 CCC',
                assetType: 'plant',
                updatedFields: ['tax_due_date', 'mot_due_date'],
              },
            ],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  });

  it('resolves a non-van asset from /api/maintenance and posts the correct sync payload', async () => {
    render(<DVLASyncDebugPanel />);

    fireEvent.change(screen.getByLabelText(/registration number/i), {
      target: { value: 'pl11 ccc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sync$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/maintenance');
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/maintenance/sync-dvla',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: 'plant-1', assetType: 'plant' }),
      })
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Successfully synced PL11 CCC');
    expect(screen.getByText(/PL11 CCC/i)).toBeInTheDocument();
    expect(screen.getByText(/Updated: tax_due_date, mot_due_date/i)).toBeInTheDocument();
  });
});
