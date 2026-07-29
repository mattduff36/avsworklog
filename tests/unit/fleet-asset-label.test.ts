import { describe, expect, it } from 'vitest';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';

describe('formatFleetAssetLabel', () => {
  it('formats identifier with nickname only', () => {
    expect(
      formatFleetAssetLabel({ identifier: 'AB12 CDE', nickname: 'Jeff Mark' })
    ).toBe('AB12 CDE (Jeff Mark)');
  });

  it('formats van filter/select with nickname and category', () => {
    expect(
      formatFleetAssetLabel({
        identifier: 'TE57 VAN',
        nickname: 'Service Van',
        category: 'Van',
      })
    ).toBe('TE57 VAN (Service Van Van)');
  });

  it('formats van filter/select with category only when nickname missing', () => {
    expect(
      formatFleetAssetLabel({
        identifier: 'TE57 VAN',
        nickname: null,
        category: 'Van',
      })
    ).toBe('TE57 VAN (Van)');
  });

  it('returns bare identifier when nickname and category are absent', () => {
    expect(formatFleetAssetLabel({ identifier: 'AB12 CDE' })).toBe('AB12 CDE');
    expect(
      formatFleetAssetLabel({ identifier: 'PLANT-01', nickname: '', category: '' })
    ).toBe('PLANT-01');
  });

  it('trims whitespace and ignores whitespace-only modifiers', () => {
    expect(
      formatFleetAssetLabel({
        identifier: '  AB12 CDE  ',
        nickname: '  Jeff  ',
      })
    ).toBe('AB12 CDE (Jeff)');
    expect(
      formatFleetAssetLabel({
        identifier: 'AB12 CDE',
        nickname: '   ',
        category: '   ',
      })
    ).toBe('AB12 CDE');
    expect(
      formatFleetAssetLabel({
        identifier: 'AB12 CDE',
        nickname: '   ',
        category: 'Van',
      })
    ).toBe('AB12 CDE (Van)');
  });

  it('supports plant_id identifiers', () => {
    expect(
      formatFleetAssetLabel({ identifier: 'EXC-01', nickname: 'Big Yellow' })
    ).toBe('EXC-01 (Big Yellow)');
  });
});
