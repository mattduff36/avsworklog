/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DemoMutationProvider,
  useDemoMutation,
} from '@/components/demo-ui/demo-mutation-provider';

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}));

function MutationHarness() {
  const { mutationFetch, writeState } = useDemoMutation();

  return (
    <>
      <output aria-label="write state">{writeState}</output>
      <button
        type="button"
        onClick={() =>
          void mutationFetch('/api/customers', {
            method: 'POST',
            body: JSON.stringify({ company_name: 'Test customer' }),
          })
        }
      >
        Mutate
      </button>
    </>
  );
}

describe('DemoMutationProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastError.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('fails closed and dispatches no mutation request in read-only mode', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ readonly: true }), { status: 200 }));

    render(
      <DemoMutationProvider>
        <MutationHarness />
      </DemoMutationProvider>
    );

    await waitFor(() => expect(screen.getByLabelText('write state')).toHaveTextContent('readonly'));
    fireEvent.click(screen.getByRole('button', { name: 'Mutate' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/demo-ui/config', { cache: 'no-store' });
    expect(toastError).toHaveBeenCalledWith('Demo is read-only. No changes were made.');
  });

  it('adds the demo header when writes are enabled', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ readonly: false }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ customer: { id: 'customer-1' } }), { status: 201 })
      );

    render(
      <DemoMutationProvider>
        <MutationHarness />
      </DemoMutationProvider>
    );

    await waitFor(() => expect(screen.getByLabelText('write state')).toHaveTextContent('enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'Mutate' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const mutationInit = fetchMock.mock.calls[1]?.[1];
    expect(new Headers(mutationInit?.headers).get('X-Demo-UI')).toBe('v2');
  });
});
