import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_CATEGORY_NAMES,
  categoryAppliesToAsset,
  createMaintenanceCategoryMap,
  getDistanceTypeLabel,
  getMaintenanceCategory,
  getMaintenanceCategoryDisplayName,
  getServiceAlertThresholdMiles,
  getServiceCategoryNameForAsset,
  getVisibleMaintenanceStatuses,
  isMaintenanceCategoryVisibleOnOverview,
  type MaintenanceCategoryConfig,
} from '@/lib/utils/maintenanceCategoryRules';

function category(overrides: Partial<MaintenanceCategoryConfig> = {}): MaintenanceCategoryConfig {
  return {
    name: 'Service Due',
    applies_to: ['van', 'hgv'],
    is_active: true,
    show_on_overview: true,
    ...overrides,
  };
}

describe('maintenance category rules', () => {
  it('uses default rules to keep cambelt off HGVs when the category row is missing', () => {
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.cambelt)).toBe(false);
    expect(categoryAppliesToAsset(undefined, 'van', MAINTENANCE_CATEGORY_NAMES.cambelt)).toBe(true);
  });

  it('respects category visibility and applicability for overview statuses', () => {
    const categoryMap = createMaintenanceCategoryMap([
      category({
        name: 'Engine Service',
        applies_to: ['hgv'],
        show_on_overview: true,
      }),
      category({
        name: 'Cambelt Replacement',
        applies_to: ['van'],
        show_on_overview: true,
      }),
      category({
        name: 'First Aid Kit Expiry',
        applies_to: ['hgv'],
        show_on_overview: false,
      }),
    ]);

    const visibleStatuses = getVisibleMaintenanceStatuses('hgv', categoryMap, [
      { categoryName: MAINTENANCE_CATEGORY_NAMES.engineService, status: { status: 'due_soon' } },
      { categoryName: MAINTENANCE_CATEGORY_NAMES.cambelt, status: { status: 'overdue' } },
      { categoryName: MAINTENANCE_CATEGORY_NAMES.firstAid, status: { status: 'overdue' } },
    ]);

    expect(visibleStatuses).toEqual([{ status: 'due_soon' }]);
  });

  it('maps legacy vehicle applicability to vans', () => {
    const legacyCategory = category({ applies_to: ['vehicle'] });

    expect(isMaintenanceCategoryVisibleOnOverview(legacyCategory, 'van', 'Service Due')).toBe(true);
    expect(isMaintenanceCategoryVisibleOnOverview(legacyCategory, 'hgv', 'Service Due')).toBe(false);
  });

  it('keeps shared Service Due off HGVs while allowing unified HGV Service', () => {
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.service)).toBe(false);
    expect(categoryAppliesToAsset(undefined, 'van', MAINTENANCE_CATEGORY_NAMES.service)).toBe(true);
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.hgvService)).toBe(true);
    // Legacy Engine/Full categories are inactive after unify
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.engineService)).toBe(false);
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.fullService)).toBe(false);
  });

  it('returns contextual distance labels for vans and HGVs', () => {
    expect(getDistanceTypeLabel(['van'])).toBe('Miles');
    expect(getDistanceTypeLabel(['hgv'])).toBe('Kilometres');
    expect(getDistanceTypeLabel(['van', 'hgv'])).toBe('Miles / Kilometres');
  });

  it('normalizes category names in maps', () => {
    const categoryMap = createMaintenanceCategoryMap([category({ name: 'Service Due' })]);

    expect(getMaintenanceCategory(categoryMap, 'service due')?.name).toBe('Service Due');
  });

  it('HGV-LABEL-001 prefers display_name for UI while identity stays on name', () => {
    expect(
      getMaintenanceCategoryDisplayName({ name: 'Service', display_name: 'Service Due' })
    ).toBe('Service Due');
    expect(getMaintenanceCategoryDisplayName({ name: 'Service', display_name: null })).toBe('Service');
    expect(getMaintenanceCategoryDisplayName({ name: 'Service Due' })).toBe('Service Due');
    expect(categoryAppliesToAsset(undefined, 'hgv', MAINTENANCE_CATEGORY_NAMES.hgvService)).toBe(true);
    expect(MAINTENANCE_CATEGORY_NAMES.hgvService).toBe('service');
    expect(MAINTENANCE_CATEGORY_NAMES.service).toBe('service due');
  });

  it('T1 resolves service category name and alert threshold by asset type', () => {
    expect(getServiceCategoryNameForAsset('hgv')).toBe(MAINTENANCE_CATEGORY_NAMES.hgvService);
    expect(getServiceCategoryNameForAsset('van')).toBe(MAINTENANCE_CATEGORY_NAMES.service);
    expect(getServiceCategoryNameForAsset('plant')).toBe(MAINTENANCE_CATEGORY_NAMES.service);

    const categoryMap = createMaintenanceCategoryMap([
      category({
        name: 'Service Due',
        applies_to: ['van'],
        alert_threshold_miles: 1000,
      }),
      category({
        name: 'Service',
        applies_to: ['hgv'],
        alert_threshold_miles: 2500,
      }),
    ]);

    expect(getServiceAlertThresholdMiles(categoryMap, 'hgv')).toBe(2500);
    expect(getServiceAlertThresholdMiles(categoryMap, 'van')).toBe(1000);
    expect(getServiceAlertThresholdMiles(createMaintenanceCategoryMap([]), 'hgv')).toBe(2500);
    expect(getServiceAlertThresholdMiles(createMaintenanceCategoryMap([]), 'van')).toBe(1000);
  });

  it('includes HGV Service status in visible dashboard statuses', () => {
    const categoryMap = createMaintenanceCategoryMap([
      category({
        name: 'Service',
        applies_to: ['hgv'],
        show_on_overview: true,
      }),
      category({
        name: 'Service Due',
        applies_to: ['van'],
        show_on_overview: true,
      }),
    ]);

    const hgvStatuses = getVisibleMaintenanceStatuses('hgv', categoryMap, [
      { categoryName: getServiceCategoryNameForAsset('hgv'), status: { status: 'overdue' } },
      { categoryName: MAINTENANCE_CATEGORY_NAMES.service, status: { status: 'due_soon' } },
    ]);
    expect(hgvStatuses).toEqual([{ status: 'overdue' }]);

    const vanStatuses = getVisibleMaintenanceStatuses('van', categoryMap, [
      { categoryName: getServiceCategoryNameForAsset('van'), status: { status: 'due_soon' } },
    ]);
    expect(vanStatuses).toEqual([{ status: 'due_soon' }]);
  });
});
