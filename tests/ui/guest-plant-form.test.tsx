/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GuestPlantCheckForm } from '@/app/guest-plant-checks/GuestPlantCheckForm';
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';

const fixture = vi.hoisted(() => ({ signature: `data:image/png;base64,${'A'.repeat(100)}` }));
vi.mock('@/components/forms/SignaturePad', () => ({ SignaturePad: ({ onSave, disabled }: { onSave: (value: string) => void; disabled: boolean }) => <button disabled={disabled} onClick={() => onSave(fixture.signature)}>Test sign</button> }));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const asset = { id, plant_id: 'P001', nickname: 'Test excavator', category: 'Excavator' };
const job = { sourceType: 'live_quote', sourceId: jobId, code: '12345', title: 'Test site', customerName: 'Example customer' };
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
let submissions: Array<Record<string, unknown>>;
let failSubmit: boolean;
let lockedFirst: boolean;
let failPhoto: boolean;
let searchHandler: ((query: string) => Promise<Response>) | undefined;

beforeEach(() => {
  submissions = []; failSubmit = false; lockedFirst = false; failPhoto = false; searchHandler = undefined;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/photos')) return failPhoto ? response({ error: 'Photo upload failed' }, 503) : response({ id: jobId, itemNumber: 1 });
    if (options?.method === 'POST') {
      submissions.push(JSON.parse(options.body as string));
      return failSubmit ? response({ error: 'Connection lost. Retry.' }, 503) : response({ id, date: '2026-11-16' });
    }
    if (url.includes('?plantId=')) return response({ date: '2026-11-16', currentHours: 100, defects: PLANT_INSPECTION_ITEMS.map((_, i) => ({ number: i + 1, locked: lockedFirst && i === 0, recentlyCompleted: false })) });
    if (url.includes('?search=')) return searchHandler ? searchHandler(decodeURIComponent(url.split('?search=')[1])) : response({ jobs: [job] });
    return response({ assets: [asset], date: '2026-11-16' });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function openForm() {
  render(<GuestPlantCheckForm />);
  fireEvent.click(await screen.findByRole('button', { name: /P001/ }));
  await waitFor(() => expect(screen.queryByText('Checking existing defects…')).not.toBeInTheDocument());
}
async function chooseJob() {
  fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
  fireEvent.change(screen.getByPlaceholderText('Search code, customer, or name'), { target: { value: 'Example' } });
  fireEvent.click(await screen.findByRole('button', { name: /12345 Example customer/ }));
}
async function completeForm() {
  await openForm();
  fireEvent.change(screen.getByLabelText(/Your full name/), { target: { value: 'Temporary Worker' } });
  fireEvent.change(screen.getByLabelText(/Current Hours/), { target: { value: '100' } });
  await chooseJob();
  for (const item of PLANT_INSPECTION_ITEMS) fireEvent.click(within(screen.getAllByRole('group', { name: `${item} result` })[0]).getByRole('button', { name: 'Pass' }));
}

describe('guest Plant form with the existing Plant layout', () => {
  it('uses explicit job selection and ignores an obsolete search response', async () => {
    await openForm();
    expect(screen.getByText('Daily Check Details')).toBeInTheDocument();
    expect(screen.getByText('23-Point Plant Safety Check')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('?search='))).toBe(false);
    let finishOld: (value: Response) => void = () => {};
    searchHandler = query => query === 'Old' ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(response({ jobs: [job] }));
    fireEvent.click(screen.getByRole('button', { name: 'Select job code' }));
    const search = screen.getByPlaceholderText('Search code, customer, or name');
    fireEvent.change(search, { target: { value: 'Old' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('?search=Old'), expect.anything()));
    fireEvent.change(search, { target: { value: 'Example' } });
    const option = await screen.findByRole('button', { name: /12345 Example customer/ });
    finishOld(response({ jobs: [{ ...job, code: '99999', title: 'Obsolete' }] }));
    await waitFor(() => expect(screen.queryByText('99999')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(option);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selected job code 12345' })).toBeInTheDocument();
  });

  it('validates before signing and retries the identical signed request after an uncertain response', async () => {
    await completeForm();
    const first = within(screen.getAllByRole('group', { name: `${PLANT_INSPECTION_ITEMS[0]} result` })[0]);
    fireEvent.click(first.getByRole('button', { name: 'Fail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review and sign' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Describe each defect.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText(`Defect comments for ${PLANT_INSPECTION_ITEMS[0]}`)[0], { target: { value: 'Test defect' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review and sign' }));
    failSubmit = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Test sign' }));
    await screen.findAllByText('Connection lost. Retry.');
    expect(submissions).toHaveLength(1);
    expect(screen.getByLabelText(/Your full name/)).toBeDisabled();
    failSubmit = false;
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retry submission' }));
    await screen.findByText('Daily check submitted');
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0]).toMatchObject({ jobNumber: '12345', jobSourceId: jobId, signature: fixture.signature, name: 'Temporary Worker' });
  });

  it('keeps existing defects locked and prevents signing while a photo awaits retry', async () => {
    lockedFirst = true; await openForm();
    expect(within(screen.getAllByRole('group', { name: `${PLANT_INSPECTION_ITEMS[0]} result` })[0]).getByRole('button', { name: 'Pass' })).toBeDisabled();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    failPhoto = true;
    fireEvent.change(screen.getAllByLabelText(`Add photo for ${PLANT_INSPECTION_ITEMS[0]}`)[0], { target: { files: [new File(['image'], 'test.png', { type: 'image/png' })] } });
    await screen.findAllByRole('button', { name: 'Retry photo upload' });
    expect(screen.getByRole('button', { name: 'Review and sign' })).toBeDisabled();
    failPhoto = false;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry photo upload' })[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review and sign' })).toBeEnabled());
    const uploads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/photos'));
    expect((uploads[0][1]?.body as FormData).get('uploadId')).toEqual((uploads[1][1]?.body as FormData).get('uploadId'));
  });
});
