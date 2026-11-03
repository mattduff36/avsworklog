import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectionMeterCorrectionDialog } from '@/components/inspections/InspectionMeterCorrectionDialog';
import { VanInspectionsListTable, DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY } from '@/app/(dashboard)/van-inspections/components/VanInspectionsListTable';
import { PlantInspectionsListTable, DEFAULT_PLANT_INSPECTIONS_COLUMN_VISIBILITY } from '@/app/(dashboard)/plant-inspections/components/PlantInspectionsListTable';
import { HgvInspectionsListTable, DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY } from '@/app/(dashboard)/hgv-inspections/components/HgvInspectionsListTable';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
const id = '11111111-1111-4111-8111-111111111111';
const commonRow = { id, user_id: id, current_mileage: 0, status: 'submitted' as const, inspection_date: '2026-11-02', inspection_end_date: null, submitted_at: '2026-11-02T12:00:00Z', profile: { full_name: 'Test inspector', employee_id: 'EMP-42' } };
const props = { downloadingId: null, deleting: false, deletingId: null, getInspectionHref: () => '/check', canDeleteInspection: () => false, onDownloadPDF: vi.fn(), onOpenDeleteDialog: vi.fn(), onDeleteInspection: vi.fn() };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Daily Check lists', () => {
  it.each(['van', 'plant', 'hgv'])('shows %s reading to viewers and offers a separate manager action', assetType => {
    const edit = vi.fn();
    const draw = (allowed: boolean, employeeId = true, status: 'draft' | 'submitted' = 'submitted') => {
      const row = { ...commonRow, status };
      if (assetType === 'van') return <VanInspectionsListTable {...props} inspections={[{ ...row, vans: { reg_number: 'VAN-1', van_categories: { name: 'Redundant van category' } } }]} columnVisibility={{ ...DEFAULT_VAN_INSPECTIONS_COLUMN_VISIBILITY, employeeId }} canCorrectReadings={allowed} onEditReading={edit} />;
      if (assetType === 'plant') return <PlantInspectionsListTable {...props} inspections={[{ ...row, is_hired_plant: false, job_code: 'JOB-1', plant: { plant_id: 'PLANT-1', nickname: null, serial_number: null, van_categories: { name: 'Excavator' } } }]} columnVisibility={{ ...DEFAULT_PLANT_INSPECTIONS_COLUMN_VISIBILITY, employeeId }} canCorrectReadings={allowed} onEditReading={edit} />;
      return <HgvInspectionsListTable {...props} inspections={[{ ...row, hgv: { reg_number: 'HGV-1', nickname: null } }]} columnVisibility={{ ...DEFAULT_HGV_INSPECTIONS_COLUMN_VISIBILITY, employeeId }} canCorrectReadings={allowed} onEditReading={edit} />;
    };
    const { rerender } = render(draw(false));
    const expectedHeaders = assetType === 'plant'
      ? ['Employee', 'Plant', 'Job', 'Date', 'Hours', 'Status', 'Actions']
      : ['Employee', assetType === 'van' ? 'Van' : 'HGV', 'Date', assetType === 'van' ? 'Mileage (miles)' : 'Mileage (km)', 'Status', 'Actions'];
    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(expectedHeaders);
    expect(screen.queryByRole('columnheader', { name: 'Submitted' })).not.toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(within(screen.getByText('Test inspector').closest('td')!).getByText('EMP-42')).toHaveClass('text-xs', 'text-muted-foreground');
    if (assetType === 'plant') {
      expect(within(screen.getByText('PLANT-1').closest('td')!).getByText('Excavator')).toHaveClass('text-xs', 'text-muted-foreground');
      expect(screen.getByText('JOB-1')).toBeInTheDocument();
    }
    expect(screen.queryByText('Redundant van category')).not.toBeInTheDocument();
    expect(screen.getByText(`0 ${assetType === 'van' ? 'miles' : assetType === 'plant' ? 'hours' : 'km'}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Daily Check/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeInTheDocument();
    rerender(draw(true));
    const editButton = screen.getByRole('button', { name: 'Edit Daily Check on 2026-11-02' });
    expect(editButton).toHaveTextContent(/^Edit$/);
    expect(editButton).toHaveClass('px-2', 'gap-1');
    fireEvent.click(editButton);
    expect(edit).toHaveBeenCalledWith(id);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(props.onDownloadPDF).toHaveBeenCalledWith(expect.anything(), id);
    expect(push).not.toHaveBeenCalled();
    rerender(draw(true, false));
    expect(screen.queryByText('EMP-42')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(expectedHeaders);
    rerender(draw(true, true, 'draft'));
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Daily Check/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
  });

  it('keeps hired Plant metadata together and respects the stored category toggle', () => {
    const inspection = {
      ...commonRow, is_hired_plant: true, plant: null,
      hired_plant_id_serial: 'HIRED-1', hired_plant_hiring_company: 'Hire company',
      hired_plant_description: 'Tracked excavator', job_code: 'JOB-2',
    };
    const draw = (category: boolean) => <PlantInspectionsListTable {...props}
      inspections={[inspection]} columnVisibility={{ ...DEFAULT_PLANT_INSPECTIONS_COLUMN_VISIBILITY, category }}
      canCorrectReadings={false} onEditReading={vi.fn()} />;
    const { rerender } = render(draw(true));
    const plantCell = screen.getByText('Hired - HIRED-1').closest('td')!;
    expect(within(plantCell).getByText('Hire company - Tracked excavator')).toHaveClass('text-xs', 'text-muted-foreground');
    expect(screen.getByText('JOB-2')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Category' })).not.toBeInTheDocument();
    rerender(draw(false));
    expect(screen.queryByText('Hire company - Tracked excavator')).not.toBeInTheDocument();
    expect(screen.getByText('Hired - HIRED-1')).toBeInTheDocument();
    expect(screen.getByText('JOB-2')).toBeInTheDocument();
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
