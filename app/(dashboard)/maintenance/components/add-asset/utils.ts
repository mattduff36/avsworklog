export type NewAssetType = 'van' | 'plant' | 'hgv';

export interface VehicleCategoryOption {
  id: string;
  name: string;
  applies_to?: string[] | null;
}

export interface HgvCategoryOption {
  id: string;
  name: string;
}

export function formatRegistrationForInput(value: string): string {
  const upper = value.toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  const cleaned = upper.replace(/\s/g, '');

  if (cleaned.length >= 4 && !upper.includes(' ')) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`.trim();
  }

  return upper;
}

export function formatRegistrationForStorage(registration: string): string {
  const cleaned = registration.replace(/\s/g, '').toUpperCase();
  if (cleaned.length === 7 && /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned))
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;

  return cleaned;
}

export function parseMileage(value: string): number | null {
  if (!value.trim()) return null;
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric)) return null;
  return numeric;
}

export function isApplicableToType(appliesTo: string[] | null | undefined, assetType: NewAssetType): boolean {
  if (!appliesTo || appliesTo.length === 0) return assetType === 'van';
  if (assetType === 'van') {
    return appliesTo.includes('van') || appliesTo.includes('vehicle');
  }
  if (assetType === 'plant') return appliesTo.includes('plant');
  return appliesTo.includes('hgv');
}

