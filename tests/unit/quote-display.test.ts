import { describe, expect, it } from 'vitest';
import { withoutDeletedQuoteManager } from '@/lib/server/quote-display';

describe('quote manager display', () => {
  const quote = {
    requester_id: 'old-manager',
    manager_name: 'Former Manager',
    manager_email: 'former@example.test',
    signoff_name: 'Former Manager',
  };

  it('keeps a quote but omits its deleted requester identity', () => {
    const masked = withoutDeletedQuoteManager({
      ...quote,
      requester_profile: { full_name: 'Former Manager', deleted_at: '2026-11-25T09:00:00Z' },
    });
    expect(masked).toEqual({
      requester_id: 'old-manager', manager_name: null, manager_email: null, signoff_name: null,
    });
  });

  it('handles profiles hidden by row security and preserves an independent signatory', () => {
    expect(withoutDeletedQuoteManager({
      ...quote, requester_profile: null, signoff_name: 'Other Signatory',
    })).toMatchObject({ manager_name: null, manager_email: null, signoff_name: 'Other Signatory' });
  });

  it('keeps an active requester visible', () => {
    expect(withoutDeletedQuoteManager({
      ...quote, requester_profile: { full_name: 'Former Manager', deleted_at: null },
    })).toEqual(quote);
  });
});
