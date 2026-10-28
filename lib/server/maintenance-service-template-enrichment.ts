export const SERVICE_ASSET_TYPES = ['van', 'hgv', 'plant'] as const;

export type ServiceAssetType = (typeof SERVICE_ASSET_TYPES)[number];

const SERVICE_CONFIG_KEY: Record<ServiceAssetType, string> = {
  van: 'service_van',
  hgv: 'service_hgv',
  plant: 'service_plant',
};

const TEMPLATE_TABLE = 'workshop_attachment_templates';
const LINK_TABLE = 'workshop_category_attachment_templates';

export interface MaintenanceServiceCategorySource {
  id?: string;
  config_key?: string | null;
  workshop_category_id?: string | null;
}

export interface ServiceTemplateQueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface ServiceTemplateNameRow {
  id?: string | null;
  name?: string | null;
}

export interface ServiceTemplateLabelRow {
  template_id?: string | null;
  compact_label?: string | null;
}

export interface ServiceTemplateLinkRow {
  category_id?: string | null;
  template_id?: string | null;
}

export interface ServiceTemplateIdRow {
  id?: string | null;
}

/**
 * Reads used by service-template enrichment.
 * Callers skip these when the id list is empty; implementations may assume a non-empty `.in`.
 */
export interface ServiceTemplateReads {
  listTemplateNames(
    templateIds: readonly string[],
  ): PromiseLike<ServiceTemplateQueryResult<ServiceTemplateNameRow>>;
  listCompactLabels(
    templateIds: readonly string[],
  ): PromiseLike<ServiceTemplateQueryResult<ServiceTemplateLabelRow>>;
  listCategoryLinks(
    categoryIds: readonly string[],
  ): PromiseLike<ServiceTemplateQueryResult<ServiceTemplateLinkRow>>;
  listCategoryLinksForCategory(
    categoryId: string,
  ): PromiseLike<ServiceTemplateQueryResult<ServiceTemplateLinkRow>>;
  listActiveTemplateIds(
    templateIds: readonly string[],
  ): PromiseLike<ServiceTemplateQueryResult<ServiceTemplateIdRow>>;
}

type ServiceTemplateReadRow = ServiceTemplateNameRow &
  ServiceTemplateLabelRow &
  ServiceTemplateLinkRow &
  ServiceTemplateIdRow;

interface ServiceTemplateFilter<T> extends PromiseLike<ServiceTemplateQueryResult<T>> {
  eq(column: string, value: boolean): PromiseLike<ServiceTemplateQueryResult<T>>;
}

export interface ServiceTemplateReadDb {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: readonly string[]): ServiceTemplateFilter<ServiceTemplateReadRow>;
      eq(column: string, value: string): PromiseLike<ServiceTemplateQueryResult<ServiceTemplateLinkRow>>;
    };
  };
}

export interface ServiceTemplateEnrichment {
  templateNameById: Map<string, string>;
  compactLabelByTemplateId: Map<string, string>;
  linkedCountByAssetType: Map<ServiceAssetType, number>;
}

export interface ServiceTemplateVehicleFields {
  is_plant?: boolean;
  hgv_id?: string | null;
  next_service_template_id?: string | null;
  next_service_template_name?: string | null;
  next_service_compact_label?: string | null;
  show_service_type_badge?: boolean;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

function presentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function rowsOf<T>(data: T[] | null): T[] {
  return data ?? [];
}

/**
 * Same outcome as `.eq('config_key', key).maybeSingle()`:
 * missing and duplicate rows both yield no workshop category.
 */
export function resolveServiceWorkshopCategoryId(
  categories: readonly MaintenanceServiceCategorySource[],
  configKey: string,
): string | null {
  const matches = categories.filter((category) => category.config_key === configKey);
  if (matches.length !== 1) return null;
  const workshopCategoryId = matches[0]?.workshop_category_id;
  return presentString(workshopCategoryId) ? workshopCategoryId : null;
}

export function createServiceTemplateReads(db: unknown): ServiceTemplateReads {
  const client = db as ServiceTemplateReadDb;
  return {
    listTemplateNames(templateIds) {
      return client.from(TEMPLATE_TABLE).select('id, name').in('id', templateIds);
    },
    listCompactLabels(templateIds) {
      return client.from(LINK_TABLE).select('template_id, compact_label').in('template_id', templateIds);
    },
    listCategoryLinks(categoryIds) {
      return client.from(LINK_TABLE).select('category_id, template_id').in('category_id', categoryIds);
    },
    listCategoryLinksForCategory(categoryId) {
      return client.from(LINK_TABLE).select('template_id').eq('category_id', categoryId);
    },
    listActiveTemplateIds(templateIds) {
      return client
        .from(TEMPLATE_TABLE)
        .select('id')
        .in('id', templateIds)
        .eq('is_active', true);
    },
  };
}

function rememberNames(
  templateNameById: Map<string, string>,
  data: ServiceTemplateNameRow[] | null,
): void {
  for (const template of rowsOf(data)) {
    if (presentString(template.id) && presentString(template.name)) {
      templateNameById.set(template.id, template.name);
    }
  }
}

function rememberCompactLabels(
  compactLabelByTemplateId: Map<string, string>,
  data: ServiceTemplateLabelRow[] | null,
): void {
  for (const link of rowsOf(data)) {
    if (presentString(link.template_id) && presentString(link.compact_label)) {
      compactLabelByTemplateId.set(link.template_id, link.compact_label);
    }
  }
}

async function loadTemplateNamesAndLabels(
  reads: ServiceTemplateReads,
  templateIds: readonly string[],
): Promise<Pick<ServiceTemplateEnrichment, 'templateNameById' | 'compactLabelByTemplateId'>> {
  const templateNameById = new Map<string, string>();
  const compactLabelByTemplateId = new Map<string, string>();
  if (templateIds.length === 0) {
    return { templateNameById, compactLabelByTemplateId };
  }

  const [templates, labels] = await Promise.all([
    reads.listTemplateNames(templateIds),
    reads.listCompactLabels(templateIds),
  ]);
  rememberNames(templateNameById, templates.data);
  rememberCompactLabels(compactLabelByTemplateId, labels.data);
  return { templateNameById, compactLabelByTemplateId };
}

function emptyLinkedCounts(): Map<ServiceAssetType, number> {
  return new Map(SERVICE_ASSET_TYPES.map((assetType) => [assetType, 0]));
}

function categoryIdsByAsset(
  categories: readonly MaintenanceServiceCategorySource[],
): Map<ServiceAssetType, string> {
  const categoryIdByAsset = new Map<ServiceAssetType, string>();
  for (const assetType of SERVICE_ASSET_TYPES) {
    const categoryId = resolveServiceWorkshopCategoryId(categories, SERVICE_CONFIG_KEY[assetType]);
    if (categoryId) categoryIdByAsset.set(assetType, categoryId);
  }
  return categoryIdByAsset;
}

function groupTemplateIds(
  rows: readonly ServiceTemplateLinkRow[],
  categoryIds: readonly string[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const categoryId of categoryIds) {
    grouped.set(
      categoryId,
      uniqueStrings(
        rows
          .filter((row) => row.category_id === categoryId)
          .map((row) => row.template_id),
      ),
    );
  }
  return grouped;
}

function countReturnedTemplateIds(data: ServiceTemplateIdRow[] | null): number {
  return new Set(rowsOf(data).map((row) => row.id).filter(presentString)).size;
}

async function countActiveTemplates(
  reads: ServiceTemplateReads,
  templateIds: readonly string[],
): Promise<number> {
  if (templateIds.length === 0) return 0;
  const active = await reads.listActiveTemplateIds(templateIds);
  return countReturnedTemplateIds(active.data);
}

async function countActiveTemplatesForCategory(
  reads: ServiceTemplateReads,
  categoryId: string,
): Promise<number> {
  const linked = await reads.listCategoryLinksForCategory(categoryId);
  const templateIds = uniqueStrings(rowsOf(linked.data).map((row) => row.template_id));
  return countActiveTemplates(reads, templateIds);
}

async function applyPerCategoryFallback(
  reads: ServiceTemplateReads,
  categoryIdByAsset: ReadonlyMap<ServiceAssetType, string>,
  counts: Map<ServiceAssetType, number>,
): Promise<void> {
  await Promise.all(SERVICE_ASSET_TYPES.map(async (assetType) => {
    const categoryId = categoryIdByAsset.get(assetType);
    if (!categoryId) return;
    counts.set(assetType, await countActiveTemplatesForCategory(reads, categoryId));
  }));
}

async function applyPerClassActiveFallback(
  reads: ServiceTemplateReads,
  categoryIdByAsset: ReadonlyMap<ServiceAssetType, string>,
  templateIdsByCategory: ReadonlyMap<string, readonly string[]>,
  counts: Map<ServiceAssetType, number>,
): Promise<void> {
  await Promise.all(SERVICE_ASSET_TYPES.map(async (assetType) => {
    const categoryId = categoryIdByAsset.get(assetType);
    if (!categoryId) return;
    const templateIds = templateIdsByCategory.get(categoryId) ?? [];
    counts.set(assetType, await countActiveTemplates(reads, templateIds));
  }));
}

async function loadLinkedCounts(
  reads: ServiceTemplateReads,
  categories: readonly MaintenanceServiceCategorySource[],
): Promise<Map<ServiceAssetType, number>> {
  const counts = emptyLinkedCounts();
  const categoryIdByAsset = categoryIdsByAsset(categories);
  const categoryIds = uniqueStrings([...categoryIdByAsset.values()]);
  if (categoryIds.length === 0) return counts;

  const linked = await reads.listCategoryLinks(categoryIds);
  if (linked.error) {
    await applyPerCategoryFallback(reads, categoryIdByAsset, counts);
    return counts;
  }

  const templateIdsByCategory = groupTemplateIds(rowsOf(linked.data), categoryIds);
  const templateIds = uniqueStrings([...templateIdsByCategory.values()].flat());
  if (templateIds.length === 0) return counts;

  const active = await reads.listActiveTemplateIds(templateIds);
  if (active.error) {
    await applyPerClassActiveFallback(reads, categoryIdByAsset, templateIdsByCategory, counts);
    return counts;
  }

  const activeIds = new Set(rowsOf(active.data).map((row) => row.id).filter(presentString));
  for (const [assetType, categoryId] of categoryIdByAsset) {
    const ids = templateIdsByCategory.get(categoryId) ?? [];
    counts.set(assetType, ids.filter((id) => activeIds.has(id)).length);
  }
  return counts;
}

export async function loadMaintenanceServiceTemplateEnrichment(
  reads: ServiceTemplateReads,
  input: {
    categories: readonly MaintenanceServiceCategorySource[];
    templateIds: readonly string[];
  },
): Promise<ServiceTemplateEnrichment> {
  const templateIds = uniqueStrings(input.templateIds);
  const [labels, linkedCountByAssetType] = await Promise.all([
    loadTemplateNamesAndLabels(reads, templateIds),
    loadLinkedCounts(reads, input.categories),
  ]);
  return { ...labels, linkedCountByAssetType };
}

export function applyServiceTemplateEnrichment<T extends ServiceTemplateVehicleFields>(
  vehicles: T[],
  enrichment: ServiceTemplateEnrichment,
): T[] {
  for (const vehicle of vehicles) {
    const assetType: ServiceAssetType = vehicle.is_plant ? 'plant' : vehicle.hgv_id ? 'hgv' : 'van';
    const templateId = vehicle.next_service_template_id || null;
    vehicle.next_service_template_name = templateId
      ? enrichment.templateNameById.get(templateId) || null
      : null;
    vehicle.next_service_compact_label = templateId
      ? enrichment.compactLabelByTemplateId.get(templateId) || null
      : null;
    vehicle.show_service_type_badge = (enrichment.linkedCountByAssetType.get(assetType) || 0) >= 2;
  }
  return vehicles;
}
