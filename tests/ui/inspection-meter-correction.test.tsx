import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectionMeterCorrectionDialog } from '@/components/inspections/InspectionMeterCorrectionDialog';
import { VanInspectionsListTable, DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY } from '@/app/(dashboard)/van-inspections/components/VanInspectionsListTable';
import { PlantInspectionsListTable, DEFAULT_PLANT_INSPECTIONS_COLUMN_VISIBILITY } from '@/app/(dashboard)/plant-inspections/components/PlantInspectionsListTable';
import { HgvInspectionsListTable, DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY } from '@/app/(dashboard)/hgv-inspections/components/HgvInspectionsListTable';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
const id = '11111111-1111-4111-8111-111111111111';
const commonRow = { id, user_id: id, current_mileage: 0, status: 'submitted' as const, inspection_date: '2026-11-02', inspection_end_date: null, submitted_at: '2026-11-02T12:00:00Z', profile: { full_name: 'Test inspector' } };
const props = { downloadingId: null, deleting: false, deletingId: null, getInspectionHref: () => '/check', canDeleteInspection: () => false, onDownloadPDF: vi.fn(), onOpenDeleteDialog: vi.fn(), onDeleteInspection: vi.fn() };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Daily Check lists', () => {
  it.each(['van', 'plant', 'hgv'])('shows %s reading to viewers and offers a separate manager action', assetType => {
    const edit = vi.fn();
    const draw = (allowed: boolean) => {
      if (assetType === 'van') return <VanInspectionsListTable {...props} inspections={[{ ...commonRow, vans: null }]} columnVisibility={DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY} canCorrectReadings={allowed} onEditReading={edit} />;
      if (assetType === 'plant') return <PlantInspectionsListTable {...props} inspections={[{ ...commonRow, is_hired_plant: false, plant: null }]} columnVisibility={DEFAULT_PLANT_INSPECTIONS_COLUMN_VISIBILITY} canCorrectReadings={allowed} onEditReading={edit} />;
      return <HgvInspectionsListTable {...props} inspections={[{ ...commonRow, hgv: null }]} columnVisibility={DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY} canCorrectReadings={allowed} onEditReading={edit} />;
    };
    const { rerender } = render(draw(false));
    expect(screen.getByText(`0 ${assetType === 'van' ? 'miles' : assetType === 'plant' ? 'hours' : 'km'}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit reading/ })).not.toBeInTheDocument();
    rerender(draw(true));
    fireEvent.click(screen.getByRole('button', { name: /Edit reading/ }));
    expect(edit).toHaveBeenCalledWith(id);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('reading correction dialog', () => {
  const target = { id, label: 'Test asset · 02/11/2026' };
  const snapshot = { reading: 100, version: 'db-version', history: [{ id: 'history', created_at: '2026-11-01T12:00:00Z', actor_name: 'Test manager', changes: { old_reading: 110, new_reading: 100, comment: 'Previous typo' } }] };
  it('loads a fresh reading and submits a zero correction with no comment', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => snapshot })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reading: 0 }) });
    vi.stubGlobal('fetch', fetch);
    const saved = vi.fn();
    const close = vi.fn();
    render(<InspectionMeterCorrectionDialog assetType="van" target={target} onSaved={saved} onClose={close} />);
    const input = await screen.findByLabelText('Correct reading (miles)');
    expect(input).toHaveValue(100);
    expect(screen.getByText('Previous typo')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(id, 0));
    const sent = JSON.parse(fetch.mock.calls[1][1].body);
    expect(sent).toEqual({ assetType: 'van', inspectionId: id, reading: 0, expectedReading: 100, expectedVersion: 'db-version', comment: '' });
    expect(close).toHaveBeenCalled();
  });
  it('keeps a rejected stale correction open with an actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => snapshot })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'This check changed. Close and reopen Edit reading.' }) }));
    const close = vi.fn();
    const saved = vi.fn();
    render(<InspectionMeterCorrectionDialog assetType="plant" target={target} onSaved={saved} onClose={close} />);
    fireEvent.change(await screen.findByLabelText('Correct reading (hours)'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Close and reopen');
    expect(saved).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
