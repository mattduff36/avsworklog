import { describe, expect, it } from 'vitest';
import { mapIssuedItem } from '@/lib/server/daily-allocation/legacy-adapter';
import {
  applyDistinctJobDaySemantics,
  reconcilePlant,
} from '@/lib/server/daily-allocation/reconciliation';
import {
  collapsePublishedPlantForDay,
  mapV2IssuedItinerary,
  resolveIssuedPublicationHeader,
  selectIssuedItinerary,
  selectLatestPublicationsByDateTeam,
  sortIssuedHistory,
  workDateFromAllocationMessageSubject,
  type PublishedLabourRow,
  type PublishedPlantRow,
  type PublishedVisitRow,
} from '@/lib/server/daily-allocation/reads';
import type { DailyAllocationIssuedItem } from '@/types/daily-allocation';
import type { Database } from '@/types/database';

type LabourItemRow = Database['public']['Tables']['daily_allocation_labour_items']['Row'];

function v1Item(overrides: Partial<LabourItemRow> = {}): LabourItemRow {
  return {
    id: 'item-1',
    publication_id: 'pub-v1',
    profile_id: 'employee-1',
    availability: 'available',
    job_source_type: 'live_quote',
    job_source_id: 'quote-1',
    job_code: 'JOB-100',
    site_address: '1 Test Street',
    customer_name: 'Test Customer',
    title: 'Site works',
    start_time: '07:30',
    meeting_point: 'Yard',
    meet_person: 'Sam',
    notes: 'Bring PPE',
    absence_id: null,
    absence_reason_id: null,
    absence_reason_name: null,
    absence_colour: null,
    absence_is_paid: null,
    absence_is_half_day: null,
    absence_half_day_session: null,
    absence_status: null,
    absence_allocation_behaviour: null,
    created_at: '2026-08-13T08:00:00.000Z',
    ...overrides,
  };
}

function issued(overrides: Partial<DailyAllocationIssuedItem> = {}): DailyAllocationIssuedItem {
  return {
    publication_id: 'pub-1',
    revision_no: 1,
    published_at: '2026-08-13T08:00:00.000Z',
    work_date: '2026-08-14',
    snapshot_version: 1,
    unallocated: false,
    availability: 'available',
    job_code: 'JOB-100',
    site_address: '1 Test Street',
    customer_name: 'Test Customer',
    title: 'Site works',
    instructions: {
      start_time: '07:30',
      meeting_point: 'Yard',
      meet_person: 'Sam',
      notes: null,
    },
    absence: null,
    visits: [],
    ...overrides,
  };
}

function labourRow(overrides: Partial<PublishedLabourRow> = {}): PublishedLabourRow {
  return {
    id: 'labour-1',
    publication_id: 'pub-v2',
    published_visit_id: 'visit-1',
    profile_id: 'employee-1',
    availability: 'available',
    unallocated: false,
    job_source_type: 'live_quote',
    job_source_id: 'quote-1',
    job_code: 'JOB-100',
    site_address: '1 Test Street',
    customer_name: 'Test Customer',
    title: 'Site works',
    starts_at: '2026-08-14T07:00:00.000Z',
    ends_at: '2026-08-14T10:00:00.000Z',
    meeting_point: 'Yard',
    meet_person: 'Sam',
    notes: 'Bring PPE',
    absence_id: null,
    absence_reason_id: null,
    absence_reason_name: null,
    absence_colour: null,
    absence_is_paid: null,
    absence_is_half_day: null,
    absence_half_day_session: null,
    absence_status: null,
    absence_allocation_behaviour: null,
    created_at: '2026-08-13T18:00:00.000Z',
    ...overrides,
  };
}

function visitRow(overrides: Partial<PublishedVisitRow> = {}): PublishedVisitRow {
  return {
    id: 'visit-1',
    publication_id: 'pub-v2',
    sequence_no: 1,
    work_date: '2026-08-14',
    job_code: 'JOB-100',
    site_address: '1 Test Street',
    customer_name: 'Test Customer',
    title: 'Site works',
    starts_at: '2026-08-14T07:00:00.000Z',
    ends_at: '2026-08-14T10:00:00.000Z',
    meeting_point: 'Yard',
    meet_person: 'Sam',
    notes: null,
    ...overrides,
  };
}

describe('DA2-COMPAT-001 v1 issued reads stay untimed', () => {
  it('maps a historical v1 publication as one legacy allocation without an end time', () => {
    const mapped = mapIssuedItem(v1Item(), {
      id: 'pub-v1',
      revision_no: 2,
      published_at: '2026-08-13T08:00:00.000Z',
      work_date: '2026-08-14',
    });
    expect(mapped.snapshot_version).toBe(1);
    expect(mapped.visits).toEqual([]);
    expect(mapped.unallocated).toBe(false);
    expect(mapped.instructions.start_time).toBe('07:30');
    expect(mapped).not.toHaveProperty('ends_at');
    expect(JSON.stringify(mapped)).not.toMatch(/ends_at|16:00|end_time/);
  });

  it('keeps v1 history ordered by work date then revision without mixing later v2 timestamps', () => {
    const older = issued({
      publication_id: 'pub-old',
      work_date: '2026-08-14',
      revision_no: 1,
      published_at: '2026-08-13T10:00:00.000Z',
    });
    const newer = issued({
      publication_id: 'pub-new',
      work_date: '2026-08-14',
      revision_no: 2,
      published_at: '2026-08-13T09:00:00.000Z',
    });
    expect([older, newer].sort(sortIssuedHistory).map((item) => item.publication_id))
      .toEqual(['pub-new', 'pub-old']);
  });
});

describe('DA2-COMPAT-001 v2 issued itinerary', () => {
  it('orders timed visits and keeps per-assignment instructions', () => {
    const secondVisit = visitRow({
      id: 'visit-2',
      sequence_no: 2,
      job_code: 'JOB-200',
      starts_at: '2026-08-14T11:00:00.000Z',
      ends_at: '2026-08-14T15:00:00.000Z',
    });
    const mapped = mapV2IssuedItinerary(
      {
        id: 'pub-v2',
        work_date: '2026-08-14',
        revision_no: 3,
        published_at: '2026-08-13T18:00:00.000Z',
      },
      [
        labourRow({ published_visit_id: 'visit-2', job_code: 'JOB-200', meeting_point: 'Gate' }),
        labourRow({ published_visit_id: 'visit-1' }),
      ],
      new Map([['visit-1', visitRow()], ['visit-2', secondVisit]])
    );
    expect(mapped.snapshot_version).toBe(2);
    expect(mapped.unallocated).toBe(false);
    expect(mapped.visits.map((visit) => visit.published_visit_id)).toEqual(['visit-1', 'visit-2']);
    expect(mapped.visits[0]?.instructions.start_time).toMatch(/^\d{2}:\d{2}$/);
    expect(mapped.visits[1]?.instructions.meeting_point).toBe('Gate');
    expect(mapped.job_code).toBeNull();
  });

  it('renders an explicit unallocated snapshot with no inferred times', () => {
    const mapped = mapV2IssuedItinerary(
      {
        id: 'pub-unallocated',
        work_date: '2026-08-14',
        revision_no: 1,
        published_at: '2026-08-13T18:00:00.000Z',
      },
      [labourRow({
        published_visit_id: null,
        unallocated: true,
        job_code: null,
        site_address: null,
        starts_at: null,
        ends_at: null,
      })],
      new Map()
    );
    expect(mapped.unallocated).toBe(true);
    expect(mapped.visits).toEqual([]);
    expect(mapped.job_code).toBeNull();
    expect(mapped.instructions.start_time).toBeNull();
  });

  it('keeps full-day absence as a day snapshot and half-day assigned visits timed', () => {
    const absence = mapV2IssuedItinerary(
      { id: 'pub-abs', work_date: '2026-08-14', revision_no: 1, published_at: '2026-08-13T18:00:00.000Z' },
      [labourRow({
        published_visit_id: null,
        availability: 'full_day_absence',
        unallocated: false,
        job_code: null,
        starts_at: null,
        ends_at: null,
        absence_reason_name: 'Holiday',
        absence_is_half_day: false,
        absence_status: 'approved',
        absence_allocation_behaviour: 'block',
      })],
      new Map()
    );
    expect(absence.availability).toBe('full_day_absence');
    expect(absence.absence?.reason_name).toBe('Holiday');
    expect(absence.visits).toEqual([]);

    const halfDay = mapV2IssuedItinerary(
      { id: 'pub-half', work_date: '2026-08-14', revision_no: 1, published_at: '2026-08-13T18:00:00.000Z' },
      [labourRow({
        availability: 'half_day_absence',
        absence_reason_name: 'Medical',
        absence_is_half_day: true,
        absence_half_day_session: 'AM',
        absence_status: 'approved',
        absence_allocation_behaviour: 'reduce',
      })],
      new Map([['visit-1', visitRow()]])
    );
    expect(halfDay.availability).toBe('half_day_absence');
    expect(halfDay.visits).toHaveLength(1);
    expect(halfDay.absence?.half_day_session).toBe('AM');
  });

  it('uses the real publication header revision when policy access succeeds', () => {
    const header = {
      id: 'pub-v2',
      work_date: '2026-08-14',
      revision_no: 7,
      published_at: '2026-08-13T18:00:00.000Z',
      published_by: 'manager-1',
      scope_team_id: 'team-1',
      snapshot_version: 2 as const,
    };
    const labour = [labourRow()];
    const visits = new Map([['visit-1', visitRow()]]);
    const resolved = resolveIssuedPublicationHeader(
      'pub-v2',
      new Map([['pub-v2', header]]),
      labour,
      [visitRow()],
      { subject: 'Your allocation for 2026-08-14', created_at: '2026-08-13T17:00:00.000Z', daily_allocation_publication_id: 'pub-v2' }
    );
    expect(resolved.revision_no).toBe(7);
    expect(resolved.published_at).toBe('2026-08-13T18:00:00.000Z');
    expect(mapV2IssuedItinerary(resolved, labour, visits).revision_no).toBe(7);
  });

  it('keeps synthesis only as a fallback when the publication header is absent', () => {
    const labour = [labourRow({ publication_id: 'pub-partial' })];
    const fallback = resolveIssuedPublicationHeader(
      'pub-partial',
      new Map(),
      labour,
      [visitRow()],
      { subject: 'Your allocation for 2026-08-14', created_at: '2026-08-13T17:00:00.000Z', daily_allocation_publication_id: 'pub-partial' }
    );
    expect(fallback.revision_no).toBe(0);
    expect(fallback.work_date).toBe('2026-08-14');
  });

  it('selects an immutable publication deep link instead of the latest revision', () => {
    const history = [
      issued({ publication_id: 'pub-latest', revision_no: 7, snapshot_version: 2 }),
      issued({ publication_id: 'pub-old', revision_no: 2, snapshot_version: 2 }),
    ];
    expect(selectIssuedItinerary(history, {})?.publication_id).toBe('pub-latest');
    expect(selectIssuedItinerary(history, { publicationId: 'pub-old' })?.publication_id).toBe('pub-old');
    expect(selectIssuedItinerary(history, { publicationId: 'pub-not-mine' })).toBeNull();
  });

  it('reads the work date from an allocation notification subject when publication rows are hidden', () => {
    expect(workDateFromAllocationMessageSubject('Your allocation for 2026-08-14')).toBe('2026-08-14');
    expect(workDateFromAllocationMessageSubject('Unrelated')).toBeNull();
  });
});

describe('DA2-PLANT-001 latest revision and job/day isolation', () => {
  it('selects latest publications per team/date without mixing snapshot versions', () => {
    const latest = selectLatestPublicationsByDateTeam([
      {
        id: 'v1-old',
        work_date: '2026-08-14',
        revision_no: 1,
        published_at: '2026-08-13T08:00:00.000Z',
        scope_team_id: 'team-1',
        snapshot_version: 1,
      },
      {
        id: 'v2-latest',
        work_date: '2026-08-14',
        revision_no: 3,
        published_at: '2026-08-13T18:00:00.000Z',
        scope_team_id: 'team-1',
        snapshot_version: 2,
      },
      {
        id: 'team-2',
        work_date: '2026-08-14',
        revision_no: 9,
        published_at: '2026-08-13T18:00:00.000Z',
        scope_team_id: 'team-2',
        snapshot_version: 1,
      },
    ]);
    expect(latest.map((row) => row.id).sort()).toEqual(['team-2', 'v2-latest']);
    expect(latest.find((row) => row.id === 'v2-latest')?.snapshot_version).toBe(2);
    expect(latest.find((row) => row.id === 'v1-old')).toBeUndefined();
  });

  it('collapses multiple same-job visits into one planned plant row and flags distinct jobs', () => {
    const sameJob: PublishedPlantRow[] = [
      {
        id: 'p1',
        publication_id: 'pub-v2',
        published_visit_id: 'visit-1',
        plant_kind: 'registered',
        plant_id: 'plant-1',
        hired_serial: null,
        hired_description: null,
        hired_company: null,
        hired_serial_normalized: null,
        hired_company_normalized: null,
        owner_team_id: 'team-1',
        job_code: 'JOB-100',
        site_address: '1 Test Street',
        notes: null,
      },
      {
        id: 'p2',
        publication_id: 'pub-v2',
        published_visit_id: 'visit-2',
        plant_kind: 'registered',
        plant_id: 'plant-1',
        hired_serial: null,
        hired_description: null,
        hired_company: null,
        hired_serial_normalized: null,
        hired_company_normalized: null,
        owner_team_id: 'team-1',
        job_code: 'JOB-100',
        site_address: '1 Test Street',
        notes: null,
      },
    ];
    expect(collapsePublishedPlantForDay(sameJob)).toEqual([expect.objectContaining({
      plant_id: 'plant-1',
      job_code: 'JOB-100',
      distinct_job_codes: ['JOB-100'],
    })]);

    const mixed = collapsePublishedPlantForDay([
      sameJob[0],
      { ...sameJob[1], job_code: 'JOB-200' },
    ]);
    expect(mixed[0]?.distinct_job_codes).toEqual(['JOB-100', 'JOB-200']);
    const rows = applyDistinctJobDaySemantics(
      reconcilePlant(mixed, [], new Map([['plant-1', { plant_id: 'EX-01', nickname: 'Digger' }]]), '2026-08-14'),
      mixed
    );
    expect(rows[0]?.status).toBe('job_conflict');
  });
});
