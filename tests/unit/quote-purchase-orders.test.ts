import { describe, expect, it, vi } from 'vitest';
import {
  buildQuotePoCoverageSummary,
  computeQuotePoRollup,
  createQuotePurchaseOrderTransaction,
  formatPurchaseOrderNumbersForEmail,
  mapLineItemIdsAcrossRevision,
  type QuotePoPgClient,
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

  it('preserves an unknown rollup value when every PO value is null', () => {
    expect(computeQuotePoRollup([
      {
        po_number: 'PO-UNKNOWN',
        po_value: null,
        received_at: '2026-07-22T10:00:00.000Z',
        created_at: '2026-07-22T10:00:00.000Z',
      },
    ])).toEqual({
      po_number: 'PO-UNKNOWN',
      po_value: null,
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

  it('commits PO, line links, rollup, and timeline as one transaction', async () => {
    const query = vi.fn(async (text: string) => ({
      rows: text.includes('RETURNING id') ? [{ id: 'po-1' }] : [],
    }));
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      query,
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as QuotePoPgClient;

    await expect(createQuotePurchaseOrderTransaction({
      quoteId: '11111111-1111-1111-1111-111111111111',
      quoteThreadId: '22222222-2222-2222-2222-222222222222',
      quoteReference: 'Q-001',
      actorUserId: '33333333-3333-3333-3333-333333333333',
      poNumber: 'PO-001',
      poValue: 1200,
      notes: null,
      receivedAt: '2026-07-27T12:00:00.000Z',
      lineItemIds: ['44444444-4444-4444-4444-444444444444'],
    }, () => client)).resolves.toBe('po-1');

    const statements = query.mock.calls.map(([text]) => String(text).trim());
    expect(statements[0]).toBe('BEGIN');
    expect(statements.some(text => text.includes('INSERT INTO public.quote_purchase_orders'))).toBe(true);
    expect(statements.some(text => text.includes('INSERT INTO public.quote_purchase_order_lines'))).toBe(true);
    expect(statements.some(text => text.includes('UPDATE public.quotes'))).toBe(true);
    expect(statements.some(text => text.includes('INSERT INTO public.quote_timeline_events'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('rolls back the full PO mutation when a dependent write fails', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('INSERT INTO public.quote_purchase_order_lines')) {
        throw new Error('line insert failed');
      }
      return {
        rows: text.includes('RETURNING id') ? [{ id: 'po-1' }] : [],
      };
    });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      query,
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as QuotePoPgClient;

    await expect(createQuotePurchaseOrderTransaction({
      quoteId: '11111111-1111-1111-1111-111111111111',
      quoteThreadId: '22222222-2222-2222-2222-222222222222',
      quoteReference: 'Q-001',
      actorUserId: '33333333-3333-3333-3333-333333333333',
      poNumber: 'PO-001',
      poValue: 1200,
      notes: null,
      receivedAt: '2026-07-27T12:00:00.000Z',
      lineItemIds: ['44444444-4444-4444-4444-444444444444'],
    }, () => client)).rejects.toThrow('line insert failed');

    const statements = query.mock.calls.map(([text]) => String(text).trim());
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(client.end).toHaveBeenCalledOnce();
  });
});
