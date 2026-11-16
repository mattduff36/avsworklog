/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HgvCheckUpdates } from '@/components/inspections/HgvCheckUpdates';
import { londonDate } from '@/lib/inspections/hgv-updates';
import { requestHgvInspectionSave } from '@/lib/client/hgv-inspection-save';

vi.mock('@/lib/client/hgv-inspection-save', () => ({ requestHgvInspectionSave: vi.fn() }));
vi.mock('@/components/forms/PhotoUpload', () => ({ default: () => null }));
vi.mock('@/components/forms/SignaturePad', () => ({ default: ({ onSave }: { onSave: (value: string) => void }) => <button onClick={() => onSave('signed-test')}>Test sign</button> }));
const check = { id: 'check', hgv_id: 'hgv', user_id: 'owner', status: 'submitted', inspection_date: londonDate(), submitted_at: new Date().toISOString(), current_mileage: 120, inspector_comments: null, revision: 0 };
const items = [{ item_number: 1, item_description: 'Fuel', day_of_week: 1, status: 'ok' as const, comments: null }];
const history = { updatesEnabled: true, versions: [], observations: [], reports: [] };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => history }));
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(requestHgvInspectionSave).mockResolvedValue({ id: check.id, status: 'submitted', items: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('HGV update form', () => {
  it('keeps disabled production updates and other users read-only', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ ...history, updatesEnabled: false }) } as Response);
    const view = render(<HgvCheckUpdates check={check} items={items} actorId="owner" onUpdated={() => {}} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Report a new defect' })).not.toBeInTheDocument();
    view.rerender(<HgvCheckUpdates check={{ ...check, id: 'another' }} items={items} actorId="other" onUpdated={() => {}} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: /Correct my check/ })).not.toBeInTheDocument();
  });

  it('edits inline, validates required comments and retains correction payload and signature', async () => {
    const updated = vi.fn();
    render(<HgvCheckUpdates check={check} items={items} actorId="owner" onUpdated={updated} />);
    fireEvent.click(await screen.findByRole('button', { name: /Correct my check/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Fuel result' })).getByRole('button', { name: 'Fail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review and sign' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Describe each defect.');
    fireEvent.change(screen.getByLabelText('Describe the defect (required)'), { target: { value: 'Fuel leak' } });
    fireEvent.change(screen.getByLabelText('Reason for correction (required)'), { target: { value: 'Incorrect original answer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review and sign' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test sign' }));
    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
    expect(requestHgvInspectionSave).toHaveBeenCalledWith(expect.objectContaining({ hintInspectionId: 'check', currentMileage: 120, correctionReason: 'Incorrect original answer', expectedRevision: 0, signatureData: 'signed-test', items: [expect.objectContaining({ status: 'attention', comments: 'Fuel leak' })] }));
  });
});
