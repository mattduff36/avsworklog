import { describe, expect, it } from 'vitest';
import {
  formatFleetAssetBadgeAccessibleLabel,
  getFleetAssetBadgeClassName,
} from '@/lib/utils/fleet-asset-presentation';

describe('getFleetAssetBadgeClassName', () => {
  it('uses the daily-check colour tokens for road fleet assets', () => {
    expect(getFleetAssetBadgeClassName('van')).toContain('--inspection-primary');
    expect(getFleetAssetBadgeClassName('hgv')).toContain('--hgv-inspection-primary');
  });

  it('keeps plant assignments on the plant daily-check colour token', () => {
    expect(getFleetAssetBadgeClassName('plant')).toContain('--plant-inspection-primary');
  });

  it('provides the hidden asset type without repeating a nickname', () => {
    expect(formatFleetAssetBadgeAccessibleLabel('van', ' BN26 VDG ')).toBe('Van BN26 VDG');
    expect(formatFleetAssetBadgeAccessibleLabel('hgv', 'YK24 HGV')).toBe('HGV YK24 HGV');
  });
});
