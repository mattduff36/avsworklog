import { describe, expect, it } from 'vitest';
import { buildUnresolvedPreviousDefects } from '@/lib/utils/inspectionPreviousDefects';

describe('buildUnresolvedPreviousDefects', () => {
  it('keeps unresolved attention items from the previous inspection', () => {
    const defects = buildUnresolvedPreviousDefects(
      [
        {
          item_number: 1,
          item_description: 'Tyres',
          status: 'attention',
          day_of_week: 1,
        },
        {
          item_number: 1,
          item_description: 'Tyres',
          status: 'attention',
          day_of_week: 3,
        },
        {
          item_number: 2,
          item_description: 'Lights',
          status: 'ok',
          day_of_week: 1,
        },
      ],
      []
    );

    expect(defects.get('1-Tyres')).toEqual({
      item_number: 1,
      item_description: 'Tyres',
      days: [1, 3],
    });
    expect(defects.has('2-Lights')).toBe(false);
  });

  it('drops previous defects that already have a completed workshop task', () => {
    const defects = buildUnresolvedPreviousDefects(
      [
        {
          item_number: 1,
          item_description: 'Tyres',
          status: 'attention',
          day_of_week: 1,
        },
        {
          item_number: 3,
          item_description: 'Mirrors',
          status: 'attention',
          day_of_week: 2,
        },
      ],
      [
        'Inspection defect raised - Item 1 - Tyres (Van)',
      ]
    );

    expect(defects.has('1-Tyres')).toBe(false);
    expect(defects.get('3-Mirrors')).toEqual({
      item_number: 3,
      item_description: 'Mirrors',
      days: [2],
    });
  });
});
