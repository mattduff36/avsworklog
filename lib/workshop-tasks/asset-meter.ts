export type AssetMeterUnit = 'miles' | 'km' | 'hours';

export function normalizeAssetMeterUnit(value: string | null | undefined): AssetMeterUnit | null {
  if (value === 'miles' || value === 'km' || value === 'hours') {
    return value;
  }
  return null;
}

export function inferAssetMeterUnit(assetType: 'van' | 'plant' | 'hgv' | null): AssetMeterUnit | null {
  if (assetType === 'plant') return 'hours';
  if (assetType === 'hgv') return 'km';
  if (assetType === 'van') return 'miles';
  return null;
}

export function getAssetMeterLabel(unit: AssetMeterUnit | null): string {
  if (unit === 'hours') return 'Current Hours';
  if (unit === 'km') return 'Current KM';
  return 'Current Mileage';
}

export function formatAssetMeterReading(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return new Intl.NumberFormat('en-GB').format(value);
}
