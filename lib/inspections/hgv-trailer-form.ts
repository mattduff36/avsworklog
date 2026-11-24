import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import type { HgvTrailerSelection } from '@/lib/checklists/hgv-trailer-swap';
import { HGV_ARTIC_ONLY_END_ITEM, HGV_ARTIC_ONLY_START_ITEM } from '@/lib/checklists/vehicle-checklists';

export type HgvCheckAsset = {
  id: string;
  reg_number: string;
  nickname: string | null;
  current_mileage: number | null;
  classification: 'artic' | 'rigid' | 'unknown' | 'trailer';
};

export function classifyCheckAsset(category?: string | null, wheelplan?: string | null): HgvCheckAsset['classification'] {
  if (category?.trim().toLowerCase() === 'trailer') return 'trailer';
  if (/\bARTIC(?:ULATED)?\b/i.test(wheelplan ?? '')) return 'artic';
  if (/\bRIGID\b/i.test(wheelplan ?? '')) return 'rigid';
  return 'unknown';
}

export function trailerDefectQuery(hgvId: string, trailer?: HgvTrailerSelection | null, swap = false) {
  const query = new URLSearchParams({ hgvId });
  if (trailer?.kind === 'fleet') query.set('trailerHgvId', trailer.trailerHgvId);
  if (trailer?.kind === 'hired') {
    query.set('hiredTrailerId', trailer.hiredTrailerId);
    query.set('hiredTrailerCompany', trailer.hiredTrailerCompany);
  }
  if (swap) query.set('context', 'swap');
  return query.toString();
}

export function formatTrailerSelection(selection: HgvTrailerSelection, assets: HgvCheckAsset[]) {
  if (selection.kind === 'none') return 'No trailer attached';
  if (selection.kind === 'hired') return `Hired trailer · ${selection.hiredTrailerId} (${selection.hiredTrailerCompany})`;
  const asset = assets.find(asset => asset.id === selection.trailerHgvId);
  return asset ? formatFleetAssetLabel({ identifier: asset.reg_number, nickname: asset.nickname }) : 'Previously selected fleet trailer';
}

export function restoreTrailerSelection(row: {trailer_kind?: string | null; trailer_hgv_id?: string | null; hired_trailer_id?: string | null; hired_trailer_company?: string | null}): HgvTrailerSelection | null {
  if (row.trailer_kind === 'fleet' && row.trailer_hgv_id) return {kind: 'fleet', trailerHgvId: row.trailer_hgv_id};
  if (row.trailer_kind === 'hired') return {kind: 'hired', hiredTrailerId: row.hired_trailer_id ?? '', hiredTrailerCompany: row.hired_trailer_company ?? ''};
  return row.trailer_kind === 'none' ? {kind: 'none'} : null;
}

export function isArticItemNumber(itemNumber: number) {
  return itemNumber >= HGV_ARTIC_ONLY_START_ITEM && itemNumber <= HGV_ARTIC_ONLY_END_ITEM;
}

export function clearArticAnswers<T>(answers: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(answers).filter(([number]) => !isArticItemNumber(Number(number))));
}

export function applyArticNA<T extends string>(answers: Record<string, T>): Record<string, T | 'na'> {
  const updated: Record<string, T | 'na'> = { ...answers };
  for (let n = HGV_ARTIC_ONLY_START_ITEM; n <= HGV_ARTIC_ONLY_END_ITEM; n++) updated[n] = 'na';
  return updated;
}

export async function fetchHgvCheckAssets(): Promise<HgvCheckAsset[]> {
  const response = await fetch('/api/hgv-inspections/assets', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the HGV and trailer list. Refresh to try again.');
  const { assets } = await response.json() as { assets: HgvCheckAsset[] };
  return assets;
}
