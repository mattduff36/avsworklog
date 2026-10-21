import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobLabourReport } from '@/components/reports/JobLabourReport';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const props = { dateFrom: '2026-06-01', dateTo: '2026-10-15' };
const result = { filters: { ...props, hoursPerDay: 8, jobCodes: ['40065-GH'] },
  summary: [{ jobCode: '40065-GH', allocatedHours: 12, manDays: 1.5, entryCount: 2 }],
  detail: [], totals: { allocatedHours: 12, manDays: 1.5, entryCount: 2 }, unmatchedJobCodes: [] };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Job labour report controls', () => {
  it('generates a preview for selected jobs/dates and shows numeric totals', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result)));
    render(<JobLabourReport {...props} />);
    fireEvent.change(screen.getByLabelText('Job codes'), { target: { value: '40065-gh, 40053-GH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(screen.getByText('Calculating job labour…')).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Job labour summary' });
    const url = new URL(fetchMock.mock.calls[0][0], 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...props, hoursPerDay: '8', jobCodes: '40065-GH,40053-GH', format: 'json' });
    expect(screen.getAllByText('1.50')).toHaveLength(2);
  });
  it('rejects blank/zero day lengths and invalid date ranges without a request', () => {
    const { rerender } = render(<JobLabourReport {...props} />);
    fireEvent.change(screen.getByLabelText('Hours per man-day'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Generate report' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download Excel' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Hours per man-day'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Generate report' })).toBeDisabled();
    rerender(<JobLabourReport dateFrom="2027-01-01" dateTo="2026-01-01" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reports no matching approved entries and unmatched codes explicitly', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...result, summary: [], unmatchedJobCodes: ['40053-GH'] })));
    render(<JobLabourReport {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    await screen.findByText('No matching worked entries found within your report permissions.');
    expect(screen.getByText(/This does not establish that no work took place/)).toBeInTheDocument();
  });
  it('shows API failure and allows another attempt', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Reports access is required.' }), { status: 403 }));
    render(<JobLabourReport {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reports access is required.');
    expect(screen.getByRole('button', { name: 'Generate report' })).toBeEnabled();
  });
  it('ignores an older response after date filters change and clears previous results', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const { rerender } = render(<JobLabourReport {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    rerender(<JobLabourReport {...props} dateTo="2026-09-30" />);
    await act(async () => resolve(new Response(JSON.stringify(result))));
    expect(screen.queryByRole('table', { name: 'Job labour summary' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate report' })).toBeEnabled();
  });
  it('downloads with the selected hours-per-day and revokes its object URL', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['xlsx'])));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<JobLabourReport {...props} />);
    fireEvent.change(screen.getByLabelText('Hours per man-day'), { target: { value: '7.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams.get('hoursPerDay')).toBe('7.5');
    expect(fetchMock.mock.calls[0][0]).toContain('format=xlsx');
    expect(create).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:fixture');
  });
});
