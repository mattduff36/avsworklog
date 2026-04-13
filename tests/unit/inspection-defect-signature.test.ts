import { describe, expect, it } from 'vitest';
import {
  buildInspectionDefectSignature,
  extractInspectionDefectSignature,
  normalizeInspectionDefectSignature,
} from '@/lib/utils/inspectionDefectSignature';

describe('inspectionDefectSignature', () => {
  it('normalizes item descriptions when building signatures', () => {
    expect(buildInspectionDefectSignature({
      item_number: 3,
      item_description: '  Tyres   and   Wheels  ',
    })).toBe('3-tyres and wheels');
  });

  it('extracts the same signature format from stored task descriptions', () => {
    expect(
      extractInspectionDefectSignature(
        'HGV inspection defect found:\nItem 3 - Tyres and Wheels (Sunday)\nComment: Signs of wear'
      )
    ).toBe('3-tyres and wheels');
  });

  it('returns null when the description does not contain an inspection item signature', () => {
    expect(extractInspectionDefectSignature('General workshop notes only')).toBeNull();
  });

  it('normalizes raw signature strings from route payloads', () => {
    expect(normalizeInspectionDefectSignature(' 3 -   TYRES  ')).toBe('3-tyres');
  });
});
