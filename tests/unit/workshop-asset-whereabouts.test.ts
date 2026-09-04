import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  collectForbiddenWhereaboutsKeys,
  fleetHistoryHref,
  isAssetIdUuid,
  isWorkshopAssetType,
  londonCivilDate,
  mergeWhereaboutsEvents,
  PLANT_INSPECTION_SELECT,
  PROFILE_NAME_SELECT,
  PROFILE_PHONE_SELECT,
  PUBLICATION_SELECT,
  selectLatestWhereaboutsPublications,
  selectNewestSubmittedInspections,
  sortInspectionsNewestFirst,
  trailingLondonWorkDates,
  V1_PLANT_SELECT,
  V2_PLANT_SELECT,
  V2_VISIT_SELECT,
  VEHICLE_INSPECTION_SELECT,
  whereaboutsPublicationScopeKey,
  WHEREABOUTS_FORBIDDEN_RESPONSE_KEYS,
  WHEREABOUTS_INSPECTION_LIMIT,
  WHEREABOUTS_WINDOW_DAYS,
} from '@/lib/server/workshop-tasks/asset-whereabouts';
import {
  applyCatalogueFill,
  catalogueIdentityKey,
  recordUniqueCodeFill,
  resolveCatalogueFill,
} from '@/lib/server/workshop-tasks/job-catalogue-enrich';
import { resolveWorkshopTaskAsset } from '@/lib/workshop-tasks/task-asset';
import {
  isWhereaboutsPayloadForAsset,
  resolveWhereaboutsMapTarget,
} from '@/lib/workshop-tasks/whereabouts-dialog';
import type { WorkshopAssetWhereaboutsEvent } from '@/types/workshop-asset-whereabouts';

function event(
  overrides: Partial<WorkshopAssetWhereaboutsEvent>
): WorkshopAssetWhereaboutsEvent {
  return {
    id: 'e1',
    source: 'inspection',
    occurredAt: '2026-09-04T10:00:00.000Z',
    jobCode: null,
    siteAddress: null,
    customerName: null,
    jobTitle: null,
    driverName: null,
    inspectionId: null,
    ...overrides,
  };
}

describe('workshop asset whereabouts helpers', () => {
  it('WT-WHERE-WINDOW uses trailing 14 Europe/London civil dates', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    const window = trailingLondonWorkDates(now);
    expect(WHEREABOUTS_WINDOW_DAYS).toBe(14);
    expect(window.end).toBe(londonCivilDate(now));
    expect(window.dates).toHaveLength(14);
    expect(window.dates[0]).toBe(window.start);
    expect(window.dates.at(-1)).toBe(window.end);
    expect(window.start).toBe('2026-08-22');
    expect(window.end).toBe('2026-09-04');
  });

  it('WT-WHERE-DRAFT-HIDDEN keeps only the latest revision per date and null-team scope', () => {
    const latest = selectLatestWhereaboutsPublications([
      {
        id: 'old-null',
        work_date: '2026-09-01',
        revision_no: 1,
        published_at: '2026-09-01T08:00:00.000Z',
        scope_team_id: null,
      },
      {
        id: 'new-null',
        work_date: '2026-09-01',
        revision_no: 2,
        published_at: '2026-09-01T09:00:00.000Z',
        scope_team_id: null,
      },
      {
        id: 'team-old',
        work_date: '2026-09-01',
        revision_no: 4,
        published_at: '2026-09-01T10:00:00.000Z',
        scope_team_id: 'team-a',
      },
      {
        id: 'team-new',
        work_date: '2026-09-01',
        revision_no: 5,
        published_at: '2026-09-01T11:00:00.000Z',
        scope_team_id: 'team-a',
      },
    ]);

    expect(whereaboutsPublicationScopeKey({ work_date: '2026-09-01', scope_team_id: null })).toBe(
      '2026-09-01:legacy-null'
    );
    expect(latest.map((row) => row.id).sort()).toEqual(['new-null', 'team-new']);
  });

  it('sorts newest first and keeps allocation plus inspection', () => {
    const ordered = mergeWhereaboutsEvents([
      event({
        id: 'allocation:older',
        source: 'allocation',
        occurredAt: '2026-09-01T12:00:00.000Z',
        jobCode: '11111-AA',
      }),
      event({
        id: 'inspection:newer',
        source: 'inspection',
        occurredAt: '2026-09-03T12:00:00.000Z',
        jobCode: '22222-BB',
        inspectionId: 'insp-2',
      }),
      event({
        id: 'allocation:mid',
        source: 'allocation',
        occurredAt: '2026-09-02T12:00:00.000Z',
        jobCode: '33333-CC',
      }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual([
      'inspection:newer',
      'allocation:mid',
      'allocation:older',
    ]);
    expect(ordered.some((row) => row.source === 'allocation')).toBe(true);
    expect(ordered.some((row) => row.source === 'inspection')).toBe(true);
  });

  it('leaves van/hgv payloads without allocation events', () => {
    const vanEvents = mergeWhereaboutsEvents([
      event({
        id: 'inspection:van',
        source: 'inspection',
        jobCode: null,
        siteAddress: null,
      }),
    ]);
    expect(vanEvents.every((row) => row.source === 'inspection')).toBe(true);
    expect(vanEvents.every((row) => row.jobCode === null && row.siteAddress === null)).toBe(true);
    expect(resolveWorkshopTaskAsset({ van_id: 'van-1' })?.assetType).toBe('van');
    expect(resolveWorkshopTaskAsset({ hgv_id: 'hgv-1' })?.assetType).toBe('hgv');
  });

  it('WT-WHERE-CATALOGUE fills missing customer/title/site without overriding snapshots', () => {
    const filled = applyCatalogueFill(
      {
        customerName: 'Snapshot Customer',
        jobTitle: null,
        siteAddress: 'Yard A',
      },
      {
        customerName: 'Catalogue Customer',
        jobTitle: 'Trenching',
        siteAddress: 'Catalogue Site',
      }
    );
    expect(filled.customerName).toBe('Snapshot Customer');
    expect(filled.jobTitle).toBe('Trenching');
    expect(filled.siteAddress).toBe('Yard A');

    const fills = new Map([
      [
        'code:12345-AB',
        { customerName: 'Acme', jobTitle: 'Job title', siteAddress: '1 High St' },
      ],
    ]);
    expect(resolveCatalogueFill(fills, { jobCode: '12345-AB', sourceType: null, sourceId: null })).toEqual({
      customerName: 'Acme',
      jobTitle: 'Job title',
      siteAddress: '1 High St',
    });

    const uniqueCodes = new Map<string, { customerName: string | null; jobTitle: string | null; siteAddress: string | null }>();
    const codeIdentities = new Map<string, string>();
    const ambiguousCodes = new Set<string>();
    recordUniqueCodeFill(uniqueCodes, codeIdentities, ambiguousCodes, 'AMBIG', {
      customerName: 'First',
      jobTitle: 'One',
      siteAddress: 'A',
    }, 'live_quote:one');
    recordUniqueCodeFill(uniqueCodes, codeIdentities, ambiguousCodes, 'AMBIG', {
      customerName: 'Second',
      jobTitle: 'Two',
      siteAddress: 'B',
    }, 'live_quote:two');
    expect(uniqueCodes.has('code:AMBIG')).toBe(false);
    expect(resolveCatalogueFill(uniqueCodes, { jobCode: 'AMBIG', sourceType: null, sourceId: null })).toBeNull();
    expect(
      resolveCatalogueFill(
        new Map([
          [
            'id:live_quote:quote-1',
            { customerName: 'Exact', jobTitle: 'Exact job', siteAddress: 'Exact site' },
          ],
        ]),
        { jobCode: 'AMBIG', sourceType: 'live_quote', sourceId: 'quote-1' }
      )
    ).toEqual({
      customerName: 'Exact',
      jobTitle: 'Exact job',
      siteAddress: 'Exact site',
    });
  });

  it('WL-CAT-001 prefers V2 exact job_source identity over code-only fill', () => {
    const fills = new Map([
      [
        'id:live_quote:visit-quote',
        { customerName: 'Visit customer', jobTitle: 'Visit job', siteAddress: 'Visit site' },
      ],
      [
        'code:12345-AB',
        { customerName: 'Code customer', jobTitle: 'Code job', siteAddress: 'Code site' },
      ],
    ]);
    expect(
      resolveCatalogueFill(fills, {
        jobCode: '12345-AB',
        sourceType: 'live_quote',
        sourceId: 'visit-quote',
      })
    ).toEqual({
      customerName: 'Visit customer',
      jobTitle: 'Visit job',
      siteAddress: 'Visit site',
    });
    expect(V2_PLANT_SELECT).toContain('job_source_type');
    expect(V2_PLANT_SELECT).toContain('job_source_id');
    expect(V2_VISIT_SELECT).toContain('job_source_type');
    expect(V2_VISIT_SELECT).toContain('job_source_id');
  });

  it('WL-CAT-002 treats distinct catalogue identities as ambiguous even when display values match', () => {
    const fills = new Map<string, { customerName: string | null; jobTitle: string | null; siteAddress: string | null }>();
    const identities = new Map<string, string>();
    const ambiguous = new Set<string>();
    const sameFill = { customerName: 'Acme', jobTitle: 'Trench', siteAddress: 'Yard' };
    recordUniqueCodeFill(
      fills,
      identities,
      ambiguous,
      '12345-AB',
      sameFill,
      catalogueIdentityKey('live_quote', 'quote-a')
    );
    recordUniqueCodeFill(
      fills,
      identities,
      ambiguous,
      '12345-AB',
      sameFill,
      catalogueIdentityKey('live_quote', 'quote-b')
    );
    expect(fills.has('code:12345-AB')).toBe(false);
    expect(ambiguous.has('12345-AB')).toBe(true);
    recordUniqueCodeFill(
      fills,
      identities,
      ambiguous,
      '99999-ZZ',
      sameFill,
      catalogueIdentityKey('live_quote', 'quote-same')
    );
    recordUniqueCodeFill(
      fills,
      identities,
      ambiguous,
      '99999-ZZ',
      sameFill,
      catalogueIdentityKey('live_quote', 'quote-same')
    );
    expect(fills.get('code:99999-ZZ')).toEqual(sameFill);
  });

  it('WL-INSP-001 keeps a newer null submitted_at inspection ahead of ten older dated rows', () => {
    const older = Array.from({ length: 11 }, (_, index) => ({
      id: `old-${index}`,
      submitted_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      inspection_date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    }));
    const newestNull = {
      id: 'new-null',
      submitted_at: null,
      inspection_date: '2026-09-04',
    };
    const selected = selectNewestSubmittedInspections(
      older.slice(0, WHEREABOUTS_INSPECTION_LIMIT),
      [newestNull]
    );
    expect(selected[0]?.id).toBe('new-null');
    expect(selected).toHaveLength(WHEREABOUTS_INSPECTION_LIMIT);
    expect(selected.some((row) => row.id === 'old-0')).toBe(false);
  });

  it('WT-WHERE-PHONE keeps phone only for the newest submitted inspector', () => {
    const newest = sortInspectionsNewestFirst([
      {
        id: 'insp-older-submit',
        submitted_at: '2026-09-01T18:00:00.000Z',
        inspection_date: '2026-09-04',
      },
      {
        id: 'insp-newer-submit',
        submitted_at: '2026-09-03T16:00:00.000Z',
        inspection_date: '2026-09-02',
      },
    ])[0];
    expect(newest?.id).toBe('insp-newer-submit');

    const payload = {
      lastDriverPhone: '02222 222222',
      events: [
        event({ id: `inspection:${newest?.id}`, driverName: 'Submit Driver' }),
        event({ id: 'inspection:insp-older-submit', driverName: 'Date Driver' }),
      ],
    };
    expect(collectForbiddenWhereaboutsKeys(payload)).toEqual([]);
    expect(payload.events.every((row) => !('phone_number' in row) && !('lastDriverPhone' in row))).toBe(true);
  });

  it('WT-WHERE-DATA-MIN rejects tracker, commercial, and older-phone keys', () => {
    expect(
      collectForbiddenWhereaboutsKeys({
        tracker_id: 'x',
        speed: 12,
        commercial_status: 'won',
        notes: 'secret',
        events: [{ phone_number: '1' }],
      }).sort()
    ).toEqual(['commercial_status', 'notes', 'phone_number', 'speed', 'tracker_id']);
    expect(WHEREABOUTS_FORBIDDEN_RESPONSE_KEYS).toContain('phone_number');
  });

  it('WL-TEST-001 proves query selections exclude forbidden columns and isolate phone', () => {
    const privilegedSelects = [
      PUBLICATION_SELECT,
      V1_PLANT_SELECT,
      V2_PLANT_SELECT,
      V2_VISIT_SELECT,
      PLANT_INSPECTION_SELECT,
      VEHICLE_INSPECTION_SELECT,
      PROFILE_NAME_SELECT,
    ];
    for (const select of privilegedSelects) {
      for (const key of WHEREABOUTS_FORBIDDEN_RESPONSE_KEYS) {
        expect(select.includes(key), `${select} leaked ${key}`).toBe(false);
      }
    }
    expect(PROFILE_PHONE_SELECT).toBe('phone_number');
    expect(PROFILE_NAME_SELECT).not.toContain('phone_number');
  });

  it('WT-WHERE-TRACKER-INDEPENDENT keeps the loader free of telematics imports', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'lib/server/workshop-tasks/asset-whereabouts.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/fleetsmart|velocityfleet|all-locations/i);
    expect(isWorkshopAssetType('plant')).toBe(true);
    expect(isAssetIdUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(fleetHistoryHref('plant', 'p1')).toBe('/fleet/plant/p1/history');
  });

  it('FD-WHERE-VERIFY-001 keeps required whereabouts IDs in executed unit files', () => {
    const manifest = readFileSync(
      path.join(process.cwd(), 'scripts/automation/workflow-evidence-manifest.ts'),
      'utf8'
    );
    expect(manifest).toContain("normalized.startsWith('tests/unit/')");
    expect(manifest).toContain("normalized.startsWith('tests/regression/')");

    const requiredIds = [
      'WT-WHERE-401',
      'WT-WHERE-403',
      'WT-WHERE-404',
      'WT-WHERE-PLANT-ORDER',
      'WT-WHERE-VAN-NO-ALLOC',
      'WT-WHERE-DRAFT-HIDDEN',
      'WT-WHERE-PHONE',
      'WT-WHERE-CATALOGUE',
      'WT-WHERE-UI-STOP',
      'WT-WHERE-VIEW-AS',
      'WT-WHERE-WINDOW',
      'WT-WHERE-DATA-MIN',
      'WT-WHERE-TRACKER-AUTH',
      'WT-WHERE-TRACKER-INDEPENDENT',
      'WT-WHERE-UI-LAZY-FLEET',
      'WT-WHERE-TRACKER-STALE',
    ];

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });

    const testFiles = walk(path.join(process.cwd(), 'tests')).filter((file) =>
      /\.test\.(ts|tsx)$/u.test(file)
    );
    for (const file of testFiles) {
      const relative = path.relative(process.cwd(), file).replace(/\\/g, '/');
      const text = readFileSync(file, 'utf8');
      for (const id of requiredIds) {
        if (new RegExp(`(^|[^A-Za-z0-9_-])${id}(?![A-Za-z0-9_-])`, 'u').test(text)) {
          expect(relative.startsWith('tests/unit/'), `${id} leaked into ${relative}`).toBe(true);
        }
      }
    }
  });

  it('FD-WHERE-VERIFY-002 proves HGV skip, newest-inspector selection, and asset-switch match', () => {
    expect(resolveWorkshopTaskAsset({ hgv_id: 'hgv-1' })?.assetType).toBe('hgv');
    const newest = sortInspectionsNewestFirst([
      { id: 'old', submitted_at: '2026-09-01T10:00:00.000Z', inspection_date: '2026-09-04' },
      { id: 'new', submitted_at: '2026-09-02T10:00:00.000Z', inspection_date: '2026-09-01' },
    ])[0];
    expect(newest?.id).toBe('new');

    const plantAsset = { assetType: 'plant' as const, assetId: 'plant-1' };
    const vanPayload = {
      asset: { id: 'van-1', type: 'van' as const, label: 'Van', plantId: null, regNumber: 'AB12CDE' },
      lastCheckAt: null,
      lastDriverName: 'Van Driver',
      lastDriverPhone: null,
      meter: null,
      fleetHistoryHref: '/fleet/vans/van-1/history',
      canOpenFleetHistory: false,
      events: [],
    };
    expect(isWhereaboutsPayloadForAsset(vanPayload, plantAsset)).toBe(false);
    expect(resolveWhereaboutsMapTarget(plantAsset, vanPayload)).toBeNull();
  });
});
