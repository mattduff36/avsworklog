import { describe, expect, it } from 'vitest';
import {
  buildQuotePoCoverageSummary,
  computeQuotePoRollup,
  formatPurchaseOrderNumbersForEmail,
  mapLineItemIdsAcrossRevision,
} from '@/lib/server/quote-purchase-orders';

describe('quote purchase order helpers', () => {
  it('computes rollup from chronologically first PO number and summed values', () => {
    expect(computeQuotePoRollup([
      {
        po_number: '4503546341',
        po_value: 6450,
        received_at: '2026-07-22T10:00:00.000Z',
        created_at: '2026-07-22T10:00:00.000Z',
      },
      {
        po_number: '4503999999',
        po_value: 1000,
        received_at: '2026-07-25T10:00:00.000Z',
        created_at: '2026-07-25T10:00:00.000Z',
      },
    ])).toEqual({
      po_number: '4503546341',
      po_value: 7450,
      po_received_at: '2026-07-22T10:00:00.000Z',
    });
  });

  it('builds coverage summary from line ticks', () => {
    expect(buildQuotePoCoverageSummary({
      quoteTotal: 10000,
      lineItemIds: ['line-1', 'line-2', 'line-3'],
      purchaseOrders: [
        {
          po_value: 6450,
          lines: [{ quote_line_item_id: 'line-1' }, { quote_line_item_id: 'line-2' }],
        },
        {
          po_value: 1000,
          lines: [{ quote_line_item_id: 'line-2' }],
        },
      ],
    })).toEqual({
      quoteTotal: 10000,
      poTotal: 7450,
      remaining: 2550,
      coveredLineCount: 2,
      totalLineCount: 3,
      purchaseOrderCount: 2,
    });
  });

  it('formats multiple PO numbers for email templates', () => {
    expect(formatPurchaseOrderNumbersForEmail([
      {
        po_number: 'PO-B',
        received_at: '2026-07-23T00:00:00.000Z',
        created_at: '2026-07-23T00:00:00.000Z',
      },
      {
        po_number: 'PO-A',
        received_at: '2026-07-21T00:00:00.000Z',
        created_at: '2026-07-21T00:00:00.000Z',
      },
    ])).toBe('PO-A, PO-B');
  });

  it('remaps line links across revision by sort order then description', () => {
    const mapped = mapLineItemIdsAcrossRevision(
      [
        { id: 'old-1', description: 'Handrail', sort_order: 0 },
        { id: 'old-2', description: 'Walkway', sort_order: 1 },
        { id: 'old-3', description: 'Gate', sort_order: 2 },
      ],
      [
        { id: 'new-1', description: 'Handrail', sort_order: 0 },
        { id: 'new-2', description: 'Walkway', sort_order: 1 },
        { id: 'new-3', description: 'Gate', sort_order: 2 },
      ],
      ['old-1', 'old-3']
    );

    expect(mapped).toEqual(['new-1', 'new-3']);
  });
});
