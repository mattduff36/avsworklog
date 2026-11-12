import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlantServiceIntervalControl } from '@/components/workshop-tasks/PlantServiceIntervalControl';
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const result = (override: number | null = null) => ({ ok: true, json: async () => ({ globalIntervalHours: 500, overrideIntervalHours: override, effectiveIntervalHours: override ?? 500 }) });
describe('Plant interval override control', () => {
  it('loads global default and saves an individual override', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(result()).mockResolvedValueOnce(result(250));
    vi.stubGlobal('fetch', fetch);
    const onSaved = vi.fn();
    render(<PlantServiceIntervalControl plantId="plant" disabled={false} onSaved={onSaved} />);
    const input = await screen.findByPlaceholderText('Global: 500 hours');
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save interval and close' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ plantId: 'plant', intervalHours: 250 });
  });
  it('clears an override to the global default', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(result(250)).mockResolvedValueOnce(result());
    vi.stubGlobal('fetch', fetch);
    render(<PlantServiceIntervalControl plantId="plant" disabled={false} onSaved={vi.fn()} />);
    const input = await screen.findByDisplayValue('250');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save interval and close' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1][1].body).intervalHours).toBeNull();
  });
  it('prevents a separate interval save from discarding unsaved record changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(result()));
    render(<PlantServiceIntervalControl plantId="plant" disabled onSaved={vi.fn()} />);
    expect(await screen.findByPlaceholderText('Global: 500 hours')).toBeDisabled();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
