import { describe, expect, it } from 'vitest';
import {
  formatReferenceId,
  getInspectionHref,
  getReferenceIdSuffix,
  getWorkshopTaskHref,
} from '@/lib/utils/reference-ids';

describe('reference-ids', () => {
  it('formats the last six characters of an id', () => {
    expect(getReferenceIdSuffix('a71bf3e6-92ad-4dbd-9c50-e1a1cc3b4141')).toBe('3b4141');
    expect(formatReferenceId('68fcdf8b-d5ba-476d-99aa-b18f38a1e60f')).toBe('ID a1e60f');
  });

  it('builds inspection detail hrefs by type', () => {
    expect(getInspectionHref('van', 'van-123')).toBe('/van-inspections/van-123');
    expect(getInspectionHref('hgv', 'hgv-123')).toBe('/hgv-inspections/hgv-123');
    expect(getInspectionHref('plant', 'plant-123')).toBe('/plant-inspections/plant-123');
  });

  it('builds workshop task deep links with the right tab', () => {
    expect(getWorkshopTaskHref('task-123', 'plant')).toBe('/workshop-tasks?taskId=task-123&tab=plant');
  });
});
