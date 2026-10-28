import { describe, expect, it } from 'vitest';
import {
  applyServiceTemplateEnrichment,
  createServiceTemplateReads,
  loadMaintenanceServiceTemplateEnrichment,
  resolveServiceWorkshopCategoryId,
  type MaintenanceServiceCategorySource,
  type ServiceTemplateQueryResult,
  type ServiceTemplateReadDb,
  type ServiceTemplateReads,
  type ServiceTemplateVehicleFields,
} from '@/lib/server/maintenance-service-template-enrichment';

interface RecordedCall {
  name: string;
  args: unknown;
}

function ok<T>(data: T[]): ServiceTemplateQueryResult<T> {
  return { data, error: null };
}

function failed<T>(message: string): ServiceTemplateQueryResult<T> {
  return { data: null, error: { message } };
}

function scriptedReads(handlers: {
  names?: ServiceTemplateQueryResult<{ id?: string | null; name?: string | null }>;
  labels?: ServiceTemplateQueryResult<{ template_id?: string | null; compact_label?: string | null }>;
  links?: ServiceTemplateQueryResult<{ category_id?: string | null; template_id?: string | null }>;
  linksByCategory?: Record<string, ServiceTemplateQueryResult<{ template_id?: string | null }>>;
  activeSequence?: ServiceTemplateQueryResult<{ id?: string | null }>[];
}): { reads: ServiceTemplateReads; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let activeCalls = 0;
  const note = (name: string, args: unknown) => {
    calls.push({ name, args });
  };
  const reads: ServiceTemplateReads = {
    listTemplateNames: (templateIds) => {
      note('names', [...templateIds]);
      return Promise.resolve(handlers.names ?? ok([]));
    },
    listCompactLabels: (templateIds) => {
      note('labels', [...templateIds]);
      return Promise.resolve(handlers.labels ?? ok([]));
    },
    listCategoryLinks: (categoryIds) => {
      note('links', [...categoryIds]);
      return Promise.resolve(handlers.links ?? ok([]));
    },
    listCategoryLinksForCategory: (categoryId) => {
      note('links-one', categoryId);
      return Promise.resolve(handlers.linksByCategory?.[categoryId] ?? ok([]));
    },
    listActiveTemplateIds: (templateIds) => {
      note('active', [...templateIds]);
      const result = handlers.activeSequence?.[activeCalls] ?? ok([]);
      activeCalls += 1;
      return Promise.resolve(result);
    },
  };
  return { reads, calls };
}

const threeClassCategories: MaintenanceServiceCategorySource[] = [
  { config_key: 'service_van', workshop_category_id: 'cat-van' },
  { config_key: 'service_hgv', workshop_category_id: 'cat-hgv' },
  { config_key: 'service_plant', workshop_category_id: 'cat-plant' },
  { config_key: 'service_plant', workshop_category_id: 'cat-plant-duplicate' },
];

describe('resolveServiceWorkshopCategoryId', () => {
  it('treats a missing or duplicate config key like maybeSingle', () => {
    expect(resolveServiceWorkshopCategoryId(threeClassCategories, 'service_hgv')).toBe('cat-hgv');
    expect(resolveServiceWorkshopCategoryId(threeClassCategories, 'service_missing')).toBeNull();
    expect(resolveServiceWorkshopCategoryId(threeClassCategories, 'service_plant')).toBeNull();
    expect(resolveServiceWorkshopCategoryId([
      { config_key: 'service_van', workshop_category_id: null },
    ], 'service_van')).toBeNull();
    expect(resolveServiceWorkshopCategoryId([
      { config_key: 'service_van', workshop_category_id: '' },
    ], 'service_van')).toBeNull();
  });
});

describe('loadMaintenanceServiceTemplateEnrichment', () => {
  it('keeps distinct class counts, last non-empty labels, and Option C visibility', async () => {
    const { reads, calls } = scriptedReads({
      names: ok([
        { id: 't-van', name: 'Van Full' },
        { id: 't-shared', name: 'Shared' },
        { id: 't-van', name: '' },
        { id: 't-blank', name: null },
      ]),
      labels: ok([
        { template_id: 't-van', compact_label: 'A' },
        { template_id: 't-van', compact_label: '' },
        { template_id: 't-van', compact_label: 'B' },
        { template_id: 't-shared', compact_label: null },
        { template_id: 't-shared', compact_label: 'HG' },
        { template_id: 't-plant', compact_label: 'P' },
      ]),
      links: ok([
        { category_id: 'cat-van', template_id: 't-shared' },
        { category_id: 'cat-van', template_id: 't-shared' },
        { category_id: 'cat-van', template_id: 't-off' },
        { category_id: 'cat-van', template_id: 't-van' },
        { category_id: 'cat-hgv', template_id: 't-shared' },
        { category_id: 'cat-plant-duplicate', template_id: 't-should-ignore' },
      ]),
      activeSequence: [ok([{ id: 't-shared' }, { id: 't-van' }, { id: 't-shared' }])],
    });

    const enrichment = await loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: threeClassCategories,
      templateIds: ['t-van', 't-shared', 't-plant', 't-van', ''],
    });
    const vehicles: ServiceTemplateVehicleFields[] = [
      { next_service_template_id: 't-van' },
      { hgv_id: 'hgv-1', next_service_template_id: 't-shared' },
      { is_plant: true, next_service_template_id: 't-plant' },
      { next_service_template_id: null },
    ];
    applyServiceTemplateEnrichment(vehicles, enrichment);

    expect(enrichment.linkedCountByAssetType.get('van')).toBe(2);
    expect(enrichment.linkedCountByAssetType.get('hgv')).toBe(1);
    expect(enrichment.linkedCountByAssetType.get('plant')).toBe(0);
    expect(vehicles.map((vehicle) => ({
      name: vehicle.next_service_template_name,
      label: vehicle.next_service_compact_label,
      badge: vehicle.show_service_type_badge,
    }))).toEqual([
      { name: 'Van Full', label: 'B', badge: true },
      { name: 'Shared', label: 'HG', badge: false },
      { name: null, label: 'P', badge: false },
      { name: null, label: null, badge: true },
    ]);
    expect(calls.map((call) => call.name)).toEqual(['names', 'labels', 'links', 'active']);
    expect(calls.find((call) => call.name === 'links')?.args).toEqual(['cat-van', 'cat-hgv']);
    expect(calls.find((call) => call.name === 'active')?.args).toEqual(['t-shared', 't-off', 't-van']);
    expect(calls.find((call) => call.name === 'names')?.args).toEqual(['t-van', 't-shared', 't-plant']);
  });

  it('counts one shared workshop category once per class from a single link batch', async () => {
    const { reads, calls } = scriptedReads({
      links: ok([
        { category_id: 'cat-shared', template_id: 't-shared' },
        { category_id: 'cat-shared', template_id: 't-shared' },
      ]),
      activeSequence: [ok([{ id: 't-shared' }])],
    });
    const enrichment = await loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: [
        { config_key: 'service_van', workshop_category_id: 'cat-shared' },
        { config_key: 'service_hgv', workshop_category_id: 'cat-shared' },
        { config_key: 'service_plant', workshop_category_id: null },
      ],
      templateIds: [],
    });

    expect(enrichment.linkedCountByAssetType.get('van')).toBe(1);
    expect(enrichment.linkedCountByAssetType.get('hgv')).toBe(1);
    expect(enrichment.linkedCountByAssetType.get('plant')).toBe(0);
    expect(calls.map((call) => [call.name, call.args])).toEqual([
      ['links', ['cat-shared']],
      ['active', ['t-shared']],
    ]);
  });

  it('skips link and active reads when no class has links', async () => {
    const { reads, calls } = scriptedReads({
      links: ok([]),
    });
    const enrichment = await loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: [
        { config_key: 'service_van', workshop_category_id: 'cat-van' },
        { config_key: 'service_hgv', workshop_category_id: 'cat-hgv' },
        { config_key: 'service_plant', workshop_category_id: 'cat-plant' },
      ],
      templateIds: ['t-van'],
    });

    expect([...enrichment.linkedCountByAssetType.values()]).toEqual([0, 0, 0]);
    expect(calls.map((call) => call.name)).toEqual(['names', 'labels', 'links']);
  });

  it('does not query when every class lacks a single workshop category and no template ids are known', async () => {
    const { reads, calls } = scriptedReads({});
    const enrichment = await loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: [],
      templateIds: [''],
    });

    expect([...enrichment.linkedCountByAssetType.values()]).toEqual([0, 0, 0]);
    expect(calls).toEqual([]);
  });

  it('falls back per class when the batched link read fails', async () => {
    const { reads, calls } = scriptedReads({
      links: failed('links unavailable'),
      linksByCategory: {
        'cat-van': ok([{ template_id: 't1' }, { template_id: 't1' }, { template_id: 't2' }]),
        'cat-hgv': failed('hgv links unavailable'),
        'cat-plant': ok([{ template_id: 't3' }]),
      },
      activeSequence: [
        ok([{ id: 't1' }, { id: 't2' }]),
        ok([{ id: 't3' }]),
      ],
    });
    const enrichment = await loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: [
        { config_key: 'service_van', workshop_category_id: 'cat-van' },
        { config_key: 'service_hgv', workshop_category_id: 'cat-hgv' },
        { config_key: 'service_plant', workshop_category_id: 'cat-plant' },
      ],
      templateIds: [],
    });

    expect(enrichment.linkedCountByAssetType.get('van')).toBe(2);
    expect(enrichment.linkedCountByAssetType.get('hgv')).toBe(0);
    expect(enrichment.linkedCountByAssetType.get('plant')).toBe(1);
    expect(calls.filter((call) => call.name === 'links')).toHaveLength(1);
    expect(calls.filter((call) => call.name === 'links-one').map((call) => call.args)).toEqual([
      'cat-van',
      'cat-hgv',
      'cat-plant',
    ]);
    expect(calls.filter((call) => call.name === 'active').map((call) => call.args)).toEqual([
      ['t1', 't2'],
      ['t3'],
    ]);
  });

  it('falls back per class when the batched active read fails', async () => {
    const { reads, calls } = scriptedReads({
      links: ok([
        { category_id: 'cat-van', template_id: 't1' },
        { category_id: 'cat-van', template_id: 't2' },
        { category_id: 'cat-hgv', template_id: 't3' },
        { category_id: 'cat-plant', template_id: 't4' },
      ]),
      activeSequence: [
        failed('active unavailable'),
        ok([{ id: 't1' }, { id: 't2' }]),
        failed('hgv active unavailable'),
        ok([{ id: 't4' }]),
      ],
    });
    const enrichment = await loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: [
        { config_key: 'service_van', workshop_category_id: 'cat-van' },
        { config_key: 'service_hgv', workshop_category_id: 'cat-hgv' },
        { config_key: 'service_plant', workshop_category_id: 'cat-plant' },
      ],
      templateIds: [],
    });

    expect(enrichment.linkedCountByAssetType.get('van')).toBe(2);
    expect(enrichment.linkedCountByAssetType.get('hgv')).toBe(0);
    expect(enrichment.linkedCountByAssetType.get('plant')).toBe(1);
    expect(calls.filter((call) => call.name === 'links-one')).toEqual([]);
    expect(calls.filter((call) => call.name === 'active').map((call) => call.args)).toEqual([
      ['t1', 't2', 't3', 't4'],
      ['t1', 't2'],
      ['t3'],
      ['t4'],
    ]);
  });

  it('keeps a tolerated name or label error from rejecting enrichment', async () => {
    const { reads } = scriptedReads({
      names: failed('names unavailable'),
      labels: ok([{ template_id: 't-van', compact_label: 'B' }]),
      links: ok([{ category_id: 'cat-van', template_id: 't-van' }]),
      activeSequence: [ok([{ id: 't-van' }])],
    });
    const enrichment = await loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: [{ config_key: 'service_van', workshop_category_id: 'cat-van' }],
      templateIds: ['t-van'],
    });
    const [vehicle] = applyServiceTemplateEnrichment<ServiceTemplateVehicleFields>([
      { next_service_template_id: 't-van' },
    ], enrichment);

    expect(vehicle?.next_service_template_name).toBeNull();
    expect(vehicle?.next_service_compact_label).toBe('B');
    expect(vehicle?.show_service_type_badge).toBe(false);
  });

  it('rejects when a read throws, without using the per-class fallback', async () => {
    const calls: string[] = [];
    const reads: ServiceTemplateReads = {
      listTemplateNames: () => {
        calls.push('names');
        return Promise.resolve(ok([]));
      },
      listCompactLabels: () => {
        calls.push('labels');
        return Promise.resolve(ok([]));
      },
      listCategoryLinks: () => {
        calls.push('links');
        return Promise.reject(new Error('links down'));
      },
      listCategoryLinksForCategory: () => {
        calls.push('links-one');
        return Promise.resolve(ok([]));
      },
      listActiveTemplateIds: () => {
        calls.push('active');
        return Promise.resolve(ok([]));
      },
    };

    await expect(loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: [{ config_key: 'service_van', workshop_category_id: 'cat-van' }],
      templateIds: ['t-van'],
    })).rejects.toThrow('links down');
    expect(calls).not.toContain('links-one');
  });

  it('starts name and label reads with the link batch, then one active read', async () => {
    const calls: string[] = [];
    let resolveNames: (value: ServiceTemplateQueryResult<{ id: string; name: string }>) => void = () => undefined;
    let resolveLabels: (value: ServiceTemplateQueryResult<{ template_id: string; compact_label: string }>) => void = () => undefined;
    let resolveLinks: (value: ServiceTemplateQueryResult<{ category_id: string; template_id: string }>) => void = () => undefined;
    let resolveActive: (value: ServiceTemplateQueryResult<{ id: string }>) => void = () => undefined;
    const names = new Promise<ServiceTemplateQueryResult<{ id: string; name: string }>>((resolve) => {
      resolveNames = resolve;
    });
    const labels = new Promise<ServiceTemplateQueryResult<{ template_id: string; compact_label: string }>>((resolve) => {
      resolveLabels = resolve;
    });
    const links = new Promise<ServiceTemplateQueryResult<{ category_id: string; template_id: string }>>((resolve) => {
      resolveLinks = resolve;
    });
    const active = new Promise<ServiceTemplateQueryResult<{ id: string }>>((resolve) => {
      resolveActive = resolve;
    });
    const reads: ServiceTemplateReads = {
      listTemplateNames: () => {
        calls.push('names');
        return names;
      },
      listCompactLabels: () => {
        calls.push('labels');
        return labels;
      },
      listCategoryLinks: (categoryIds) => {
        calls.push(`links:${categoryIds.join(',')}`);
        return links;
      },
      listCategoryLinksForCategory: () => Promise.resolve(ok([])),
      listActiveTemplateIds: (templateIds) => {
        calls.push(`active:${templateIds.join(',')}`);
        return active;
      },
    };

    const pending = loadMaintenanceServiceTemplateEnrichment(reads, {
      categories: [
        { config_key: 'service_van', workshop_category_id: 'cat-van' },
        { config_key: 'service_hgv', workshop_category_id: 'cat-hgv' },
        { config_key: 'service_plant', workshop_category_id: 'cat-plant' },
      ],
      templateIds: ['t1'],
    });
    await Promise.resolve();
    expect(calls).toEqual(['names', 'labels', 'links:cat-van,cat-hgv,cat-plant']);

    resolveLinks(ok([
      { category_id: 'cat-van', template_id: 't1' },
      { category_id: 'cat-hgv', template_id: 't1' },
      { category_id: 'cat-plant', template_id: 't2' },
      { category_id: 'cat-plant', template_id: 't2' },
    ]));
    await Promise.resolve();
    expect(calls).toEqual([
      'names',
      'labels',
      'links:cat-van,cat-hgv,cat-plant',
      'active:t1,t2',
    ]);

    resolveNames(ok([{ id: 't1', name: 'One' }]));
    resolveLabels(ok([
      { template_id: 't1', compact_label: 'First' },
      { template_id: 't1', compact_label: 'Last' },
    ]));
    resolveActive(ok([{ id: 't1' }]));
    const enrichment = await pending;
    expect(enrichment.templateNameById.get('t1')).toBe('One');
    expect(enrichment.compactLabelByTemplateId.get('t1')).toBe('Last');
    expect(enrichment.linkedCountByAssetType.get('van')).toBe(1);
    expect(enrichment.linkedCountByAssetType.get('hgv')).toBe(1);
    expect(enrichment.linkedCountByAssetType.get('plant')).toBe(0);
  });
});

describe('createServiceTemplateReads', () => {
  it('issues one category-link in() and one active in() for the normal path', async () => {
    const queries: { table: string; columns: string; filters: string[] }[] = [];
    const db: ServiceTemplateReadDb = {
      from(table) {
        return {
          select(columns) {
            return {
              in(column, values) {
                const query = { table, columns, filters: [`in:${column}:${values.join(',')}`] };
                queries.push(query);
                const promise = Promise.resolve(ok(
                  table === 'workshop_category_attachment_templates'
                    ? [{ category_id: 'cat-van', template_id: 't1' }, { category_id: 'cat-hgv', template_id: 't1' }]
                    : [{ id: 't1', name: 'One' }],
                ));
                return {
                  eq(eqColumn, value) {
                    query.filters.push(`eq:${eqColumn}:${String(value)}`);
                    return promise;
                  },
                  then: promise.then.bind(promise),
                };
              },
              eq(column, value) {
                queries.push({ table, columns, filters: [`eq:${column}:${value}`] });
                return Promise.resolve(ok([]));
              },
            };
          },
        };
      },
    };

    const enrichment = await loadMaintenanceServiceTemplateEnrichment(createServiceTemplateReads(db), {
      categories: [
        { config_key: 'service_van', workshop_category_id: 'cat-van' },
        { config_key: 'service_hgv', workshop_category_id: 'cat-hgv' },
        { config_key: 'service_plant', workshop_category_id: 'cat-plant' },
      ],
      templateIds: ['t1'],
    });

    expect(enrichment.linkedCountByAssetType.get('van')).toBe(1);
    expect(enrichment.linkedCountByAssetType.get('hgv')).toBe(1);
    expect(enrichment.linkedCountByAssetType.get('plant')).toBe(0);
    expect(queries).toEqual([
      {
        table: 'workshop_attachment_templates',
        columns: 'id, name',
        filters: ['in:id:t1'],
      },
      {
        table: 'workshop_category_attachment_templates',
        columns: 'template_id, compact_label',
        filters: ['in:template_id:t1'],
      },
      {
        table: 'workshop_category_attachment_templates',
        columns: 'category_id, template_id',
        filters: ['in:category_id:cat-van,cat-hgv,cat-plant'],
      },
      {
        table: 'workshop_attachment_templates',
        columns: 'id',
        filters: ['in:id:t1', 'eq:is_active:true'],
      },
    ]);
  });
});
