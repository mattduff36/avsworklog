import { describe, expect, it } from 'vitest';
import { formatInvoiceMonth, getQuoteInvoiceMonths, getQuoteInvoiceStartDate, normalizeInvoiceMonth } from '@/lib/quotes/quote-invoice-month';

describe('quote invoice months', () => {
  it('includes both boundary months in newest-first order across years', () => {
    expect(getQuoteInvoiceMonths('2025-11-30T12:00:00Z', new Date('2026-02-01T00:00:00Z')))
      .toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });
  it('offers the creation month for a quote created this month', () => {
    expect(getQuoteInvoiceMonths('2026-11-18T09:00:00Z', new Date('2026-11-18T12:00:00Z'))).toEqual(['2026-11']);
  });
  it('uses London calendar months around BST midnight', () => {
    expect(getQuoteInvoiceMonths('2026-03-31T23:30:00Z', new Date('2026-04-30T23:30:00Z'))).toEqual(['2026-05', '2026-04']);
  });
  it('offers all months for old quotes and none for invalid/future creation dates', () => {
    expect(getQuoteInvoiceMonths('2020-01-01', new Date('2026-11-18'))).toHaveLength(83);
    expect(getQuoteInvoiceMonths('invalid')).toEqual([]);
    expect(getQuoteInvoiceMonths('2027-01-01', new Date('2026-11-18'))).toEqual([]);
  });
  it('uses the first version in the relevant quote thread', () => {
    const quote = { created_at: '2026-11-18', quote_thread_id: 'a' };
    const versions = [quote, { created_at: '2026-03-24', quote_thread_id: 'a' }, { created_at: '2025-01-01', quote_thread_id: 'b' }];
    expect(getQuoteInvoiceStartDate(quote, versions)).toBe('2026-03-24');
    expect(getQuoteInvoiceStartDate(quote, versions, ['b'])).toBe('2025-01-01');
  });
  it('normalizes new selections while displaying historical dates by their saved month', () => {
    expect(normalizeInvoiceMonth('2026-03')).toBe('2026-03-01');
    expect(normalizeInvoiceMonth('2026-03-24')).toBe('2026-03-01');
    expect(formatInvoiceMonth('2026-03-24')).toBe('March 2026');
    for (const value of ['', '2026-00', '2026-13', '2026-02-30', '2026-03-24junk']) expect(normalizeInvoiceMonth(value)).toBeNull();
  });
});
