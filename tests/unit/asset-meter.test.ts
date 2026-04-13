import { describe, expect, it } from 'vitest';
import {
  formatAssetMeterReading,
  getAssetMeterLabel,
  inferAssetMeterUnit,
  normalizeAssetMeterUnit,
} from '@/lib/workshop-tasks/asset-meter';

describe('asset meter helpers', () => {
  it('infers the correct unit from asset type', () => {
    expect(inferAssetMeterUnit('van')).toBe('miles');
    expect(inferAssetMeterUnit('hgv')).toBe('km');
    expect(inferAssetMeterUnit('plant')).toBe('hours');
    expect(inferAssetMeterUnit(null)).toBeNull();
  });

  it('normalizes only supported units', () => {
    expect(normalizeAssetMeterUnit('miles')).toBe('miles');
    expect(normalizeAssetMeterUnit('km')).toBe('km');
    expect(normalizeAssetMeterUnit('hours')).toBe('hours');
    expect(normalizeAssetMeterUnit('mile')).toBeNull();
    expect(normalizeAssetMeterUnit(null)).toBeNull();
  });

  it('returns the correct PDF label for each unit', () => {
    expect(getAssetMeterLabel('miles')).toBe('Current Mileage');
    expect(getAssetMeterLabel('km')).toBe('Current KM');
    expect(getAssetMeterLabel('hours')).toBe('Current Hours');
    expect(getAssetMeterLabel(null)).toBe('Current Mileage');
  });

  it('formats readings with grouping separators', () => {
    expect(formatAssetMeterReading(84215)).toBe('84,215');
    expect(formatAssetMeterReading(1450)).toBe('1,450');
    expect(formatAssetMeterReading(null)).toBe('');
  });
});
