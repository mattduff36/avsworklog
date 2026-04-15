import { describe, expect, it } from 'vitest';
import { buildInspectionPdfCommentsText } from '@/lib/utils/inspection-pdf-comments';

describe('buildInspectionPdfCommentsText', () => {
  it('includes inspection-wide inspector comments ahead of defect lines', () => {
    const text = buildInspectionPdfCommentsText({
      inspectorComments: 'Rear door catches when opening.',
      items: [
        {
          id: 'item-1',
          inspection_id: 'inspection-1',
          item_number: 3,
          item_description: 'Rear doors',
          status: 'attention',
          comments: 'Latch looks bent',
          created_at: '2026-04-15T09:00:00Z',
          day_of_week: 3,
        },
      ],
    });

    expect(text).toContain('Inspector comment: Rear door catches when opening.');
    expect(text).toContain('3. Rear doors (Wed) [FAIL]: Latch looks bent');
    expect(text.indexOf('Inspector comment:')).toBeLessThan(text.indexOf('3. Rear doors'));
  });

  it('falls back to item comments when no inspection-wide comment exists', () => {
    const text = buildInspectionPdfCommentsText({
      inspectorComments: null,
      items: [
        {
          id: 'item-2',
          inspection_id: 'inspection-1',
          item_number: 1,
          item_description: 'Tyres',
          status: 'ok',
          comments: 'Checked tread depth',
          created_at: '2026-04-15T09:00:00Z',
          day_of_week: 1,
        },
      ],
    });

    expect(text).toBe('1. Tyres (Mon) [PASS]: Checked tread depth');
  });

  it('returns an empty string when there are no relevant comments', () => {
    const text = buildInspectionPdfCommentsText({
      inspectorComments: '   ',
      items: [
        {
          id: 'item-3',
          inspection_id: 'inspection-1',
          item_number: 2,
          item_description: 'Lights',
          status: 'ok',
          comments: null,
          created_at: '2026-04-15T09:00:00Z',
          day_of_week: 2,
        },
      ],
    });

    expect(text).toBe('');
  });
});
