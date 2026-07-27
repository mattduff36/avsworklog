import { describe, expect, it } from 'vitest';
import { normalizeQuoteMergeRequest } from '@/lib/server/quote-merge';
import { allocateMergeBillingAmount } from '@/lib/server/quote-merge-resolution';

describe('live quote merge request validation', () => {
  it('normalizes duplicate IDs and preserves the chosen document mode', () => {
    expect(normalizeQuoteMergeRequest({
      quote_ids: ['quote-1', 'quote-2', 'quote-2'],
      survivor_quote_id: 'quote-1',
      merge_mode: 'grouped',
      irreversible_confirmed: true,
    })).toEqual({
      quote_ids: ['quote-1', 'quote-2'],
      survivor_quote_id: 'quote-1',
      merge_mode: 'grouped',
      irreversible_confirmed: true,
    });
  });

  it('requires explicit acknowledgement that the merge is irreversible', () => {
    expect(() => normalizeQuoteMergeRequest({
      quote_ids: ['quote-1', 'quote-2'],
      survivor_quote_id: 'quote-1',
      merge_mode: 'consolidated',
      irreversible_confirmed: false,
    })).toThrow('cannot be undone');
  });

  it('requires the survivor to be one of the selected quotes', () => {
    expect(() => normalizeQuoteMergeRequest({
      quote_ids: ['quote-1', 'quote-2'],
      survivor_quote_id: 'quote-3',
      merge_mode: 'consolidated',
      irreversible_confirmed: true,
    })).toThrow('selected quote number');
  });
});

describe('merged quote billing allocation', () => {
  it('allocates an amount without exceeding each source balance', () => {
    expect(allocateMergeBillingAmount(
      125,
      ['thread-1', 'thread-2'],
      { 'thread-1': 100, 'thread-2': 50 },
    )).toEqual([
      { source_quote_thread_id: 'thread-1', amount: 100 },
      { source_quote_thread_id: 'thread-2', amount: 25 },
    ]);
  });

  it('rejects source selections with insufficient balance', () => {
    expect(() => allocateMergeBillingAmount(
      151,
      ['thread-1', 'thread-2'],
      { 'thread-1': 100, 'thread-2': 50 },
    )).toThrow('enough remaining balance');
  });
});
