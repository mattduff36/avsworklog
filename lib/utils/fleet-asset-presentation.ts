export function getFleetAssetBadgeClassName(
  assetType: 'van' | 'hgv' | 'plant'
): string {
  if (assetType === 'van') {
    return 'border-[hsl(var(--inspection-primary)/0.40)] bg-[hsl(var(--inspection-primary)/0.12)] text-inspection';
  }

  if (assetType === 'hgv') {
    return 'border-[hsl(var(--hgv-inspection-primary)/0.40)] bg-[hsl(var(--hgv-inspection-primary)/0.12)] text-[hsl(var(--hgv-inspection-light))]';
  }

  return 'border-[hsl(var(--plant-inspection-primary)/0.40)] bg-[hsl(var(--plant-inspection-primary)/0.12)] text-[hsl(var(--plant-inspection-light))]';
}

export function formatFleetAssetBadgeAccessibleLabel(
  assetType: 'van' | 'hgv' | 'plant',
  identifier: string
): string {
  const typeLabel = assetType === 'hgv' ? 'HGV' : assetType === 'van' ? 'Van' : 'Plant';
  return `${typeLabel} ${identifier.trim()}`;
}
