import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enrichHgvInspectionList,
  type HgvInspectionActionRow,
  type HgvInspectionDefectRow,
  type HgvInspectionListLookups,
  type HgvInspectionListQueryResult,
  type HgvInspectionProfileRow,
  type HgvInspectionVehicleRow,
} from '@/lib/utils/hgv-inspection-list-enrichment';

const HGV_A = '11111111-1111-4111-8111-111111111111';
const HGV_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';

interface FixtureRow {
  id: string;
  user_id: string;
  hgv_id: string | null;
  inspection_date: string;
  inspection_end_date: string | null;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function row(overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    id: 'insp-1',
    user_id: USER_A,
    hgv_id: HGV_A,
    inspection_date: '2026-04-01',
    inspection_end_date: '2026-04-03',
    status: 'submitted',
    submitted_at: '2026-04-03T09:00:00.000Z',
    ...overrides,
  };
}

function emptyResult<T>(): HgvInspectionListQueryResult<T> {
  return { data: [], error: null };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enrichHgvInspectionList', () => {
  it('starts every independent lookup before any of them completes', async () => {
    const started: string[] = [];
    const hgvs = deferred<HgvInspectionListQueryResult<HgvInspectionVehicleRow>>();
    const profiles = deferred<HgvInspectionListQueryResult<HgvInspectionProfileRow>>();
    const defects = deferred<HgvInspectionListQueryResult<HgvInspectionDefectRow>>();
    const actions = deferred<HgvInspectionListQueryResult<HgvInspectionActionRow>>();
    let settled = false;

    const pending = enrichHgvInspectionList([row()], {
      loadHgvs: () => {
        started.push('hgvs');
        return hgvs.promise;
      },
      loadProfiles: () => {
        started.push('profiles');
        return profiles.promise;
      },
      loadDefects: () => {
        started.push('defects');
        return defects.promise;
      },
      loadActions: () => {
        started.push('actions');
        return actions.promise;
      },
    }).then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );

    expect(started).toEqual(['hgvs', 'profiles', 'defects', 'actions']);
    expect(settled).toBe(false);

    hgvs.resolve(emptyResult());
    await flush();
    expect(settled).toBe(false);

    profiles.resolve(emptyResult());
    defects.resolve(emptyResult());
    await flush();
    expect(settled).toBe(false);

    actions.resolve(emptyResult());
    const enriched = await pending;
    expect(settled).toBe(true);
    expect(enriched).toEqual([
      {
        ...row(),
        hgv: null,
        profile: null,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      },
    ]);
  });

  it('skips lookups for an empty list and for rows with no usable ids', async () => {
    const lookups: HgvInspectionListLookups = {
      loadHgvs: vi.fn(),
      loadProfiles: vi.fn(),
      loadDefects: vi.fn(),
      loadActions: vi.fn(),
    };

    await expect(enrichHgvInspectionList([], lookups)).resolves.toEqual([]);
    await expect(enrichHgvInspectionList([
      row({ id: '', user_id: 'not-a-uuid', hgv_id: null }),
    ], lookups)).resolves.toEqual([
      {
        ...row({ id: '', user_id: 'not-a-uuid', hgv_id: null }),
        hgv: null,
        profile: null,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      },
    ]);

    expect(lookups.loadHgvs).not.toHaveBeenCalled();
    expect(lookups.loadProfiles).not.toHaveBeenCalled();
    expect(lookups.loadDefects).not.toHaveBeenCalled();
    expect(lookups.loadActions).not.toHaveBeenCalled();
  });

  it('dedupes ids and keeps defect, action, and missing-relation output', async () => {
    const requested = {
      hgvs: [] as string[][],
      profiles: [] as string[][],
      defects: [] as string[][],
      actions: [] as string[][],
    };
    const rows = [
      row(),
      row(),
      row({
        id: 'insp-2',
        user_id: USER_B,
        hgv_id: HGV_B,
        inspection_date: '2026-03-01',
        inspection_end_date: null,
        status: 'draft',
        submitted_at: null,
      }),
      row({
        id: 'insp-3',
        user_id: 'owner-not-uuid',
        hgv_id: 'vehicle-not-uuid',
        inspection_end_date: '2026-04-02',
        status: 'draft',
        submitted_at: null,
      }),
      row({
        id: 'insp-4',
        inspection_date: '2026-02-01',
        inspection_end_date: '2026-02-08',
        status: 'submitted',
        submitted_at: '2026-02-08T12:00:00.000Z',
      }),
    ];

    const enriched = await enrichHgvInspectionList(rows, {
      loadHgvs: (ids) => {
        requested.hgvs.push([...ids]);
        return Promise.resolve({
          data: [
            { id: HGV_A, reg_number: 'AB12 CDE', nickname: null },
            { id: '', reg_number: 'IGNORED', nickname: 'Skip' },
          ],
          error: null,
        });
      },
      loadProfiles: (ids) => {
        requested.profiles.push([...ids]);
        return Promise.resolve({
          data: [
            { id: USER_A, full_name: 'Ada Owner' },
            { id: USER_B, full_name: null },
            { id: '', full_name: 'Ignored' },
          ],
          error: null,
        });
      },
      loadDefects: (ids) => {
        requested.defects.push([...ids]);
        return Promise.resolve({
          data: [
            { inspection_id: 'insp-1', status: 'defect' },
            { inspection_id: 'insp-1', status: 'attention' },
            { inspection_id: 'insp-4', status: 'defect' },
            { inspection_id: null, status: 'defect' },
          ],
          error: null,
        });
      },
      loadActions: (ids) => {
        requested.actions.push([...ids]);
        return Promise.resolve({
          data: [
            { inspection_id: 'insp-1' },
            { inspection_id: 'insp-3' },
            { inspection_id: null },
          ],
          error: null,
        });
      },
    });

    expect(requested).toEqual({
      hgvs: [[HGV_A, HGV_B]],
      profiles: [[USER_A, USER_B]],
      defects: [['insp-1', 'insp-2', 'insp-3', 'insp-4']],
      actions: [['insp-1', 'insp-2', 'insp-3', 'insp-4']],
    });
    expect(enriched).toEqual([
      {
        ...rows[0],
        hgv: { reg_number: 'AB12 CDE', nickname: null },
        profile: { full_name: 'Ada Owner' },
        has_reported_defect: true,
        has_inform_workshop_task: true,
      },
      {
        ...rows[1],
        hgv: { reg_number: 'AB12 CDE', nickname: null },
        profile: { full_name: 'Ada Owner' },
        has_reported_defect: true,
        has_inform_workshop_task: true,
      },
      {
        ...rows[2],
        hgv: null,
        profile: null,
        has_reported_defect: false,
        has_inform_workshop_task: false,
      },
      {
        ...rows[3],
        hgv: null,
        profile: null,
        has_reported_defect: false,
        has_inform_workshop_task: true,
      },
      {
        ...rows[4],
        hgv: { reg_number: 'AB12 CDE', nickname: null },
        profile: { full_name: 'Ada Owner' },
        has_reported_defect: true,
        has_inform_workshop_task: false,
      },
    ]);
  });

  it('keeps successful relations when other lookups resolve with errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vehicleError = { code: 'vehicle' };
    const actionError = { code: 'action' };

    const enriched = await enrichHgvInspectionList([row()], {
      loadHgvs: () => Promise.resolve({ data: [{ id: HGV_A, reg_number: 'AB12 CDE', nickname: 'Unit' }], error: vehicleError }),
      loadProfiles: () => Promise.resolve({ data: [{ id: USER_A, full_name: 'Ada Owner' }], error: null }),
      loadDefects: () => Promise.resolve({ data: [{ inspection_id: 'insp-1', status: 'attention' }], error: null }),
      loadActions: () => Promise.resolve({ data: [{ inspection_id: 'insp-1' }], error: actionError }),
    });

    expect(enriched).toEqual([
      {
        ...row(),
        hgv: null,
        profile: { full_name: 'Ada Owner' },
        has_reported_defect: true,
        has_inform_workshop_task: false,
      },
    ]);
    expect(warn).toHaveBeenCalledWith('Unable to load HGV inspection vehicle details:', vehicleError);
    expect(warn).toHaveBeenCalledWith('Unable to determine workshop-task status for HGV inspection icons:', actionError);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('rejects a thrown lookup after the other independent reads have started', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const started: string[] = [];
    const failure = new Error('workshop lookup failed');
    const defectError = { code: 'defect' };
    const profiles = deferred<HgvInspectionListQueryResult<HgvInspectionProfileRow>>();

    const pending = enrichHgvInspectionList([row()], {
      loadHgvs: () => {
        started.push('hgvs');
        throw failure;
      },
      loadProfiles: () => {
        started.push('profiles');
        return profiles.promise;
      },
      loadDefects: () => {
        started.push('defects');
        return Promise.resolve({ data: null, error: defectError });
      },
      loadActions: () => {
        started.push('actions');
        return Promise.reject(new Error('later action failure'));
      },
    });

    expect(started).toEqual(['hgvs', 'profiles', 'defects', 'actions']);
    profiles.resolve({ data: [{ id: USER_A, full_name: 'Ada Owner' }], error: null });

    await expect(pending).rejects.toBe(failure);
    expect(warn).toHaveBeenCalledWith('Unable to determine defect status for HGV inspection icons:', defectError);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
