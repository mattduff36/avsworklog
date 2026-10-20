import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), bundle: vi.fn(), create: vi.fn(), activity: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/server/quote-sage-access', () => ({ canManageQuoteSage: mocks.access }));
vi.mock('@/lib/server/quote-workflow', () => ({ fetchQuoteBundle: mocks.bundle }));
vi.mock('@/lib/server/quote-financial-adjustments', () => ({ createFinancialAdjustment: mocks.create }));
vi.mock('@/lib/server/quote-financial-activity', () => ({ recordMutationActivity: mocks.activity }));
import { creditEntrySchema, recordNegativeInvoice } from '@/lib/server/quote-credit-entry';
const invoiceId = '11111111-1111-4111-8111-111111111111';
const input = { credited_invoice_id: invoiceId, invoice_number: '35361', invoice_date: '2026-10-14', amount: -1600, comments: 'Credit of invoice 34940' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue(true);
  mocks.bundle.mockResolvedValue({ invoices: [{ id: invoiceId, quote_id: 'original-version' }] });
  mocks.create.mockResolvedValue({ adjustment: { id: 'credit' } });
});
describe('Negative invoice credit shortcut', () => {
  it('records the screenshot example once through the existing ledger, using original invoice version', async () => {
    expect((await recordNegativeInvoice('latest-version', input, 'actor')).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ quote_id: 'original-version', invoice_id: invoiceId, adjustment_type: 'credit_note', amount: 1600, effective_date: '2026-10-14', reason: input.comments, external_reference: '35361' }, 'actor', { creditEntry: true });
    expect(mocks.activity).toHaveBeenCalledOnce();
  });
  it('denies non-Accounts effective roles before reading financial data', async () => {
    mocks.access.mockResolvedValue(false);
    expect((await recordNegativeInvoice('quote', input, 'actor')).status).toBe(403);
    expect(mocks.bundle).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects unrelated invoices, linked requests, invalid dates, zero and sub-penny amounts', async () => {
    for (const patch of [{ amount: 0 }, { amount: -0.001 }, { invoice_date: '2026-02-30' }, { comments: '' }, { invoice_request_id: invoiceId }, { extra: true }]) expect(creditEntrySchema.safeParse({ ...input, ...patch }).success).toBe(false);
    mocks.bundle.mockResolvedValue({ invoices: [] });
    expect((await recordNegativeInvoice('quote', input, 'actor')).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('preserves the committed result if secondary activity fails', async () => {
    mocks.activity.mockRejectedValue(new Error('unavailable'));
    const response = await recordNegativeInvoice('quote', input, 'actor');
    expect(response.status).toBe(201); expect((await response.json()).warning).toBeTruthy();
  });
  it('does not expose database errors', async () => {
    mocks.create.mockRejectedValue(new Error('postgresql://secret'));
    const response = await recordNegativeInvoice('quote', input, 'actor');
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
  it('requires explicit confirmation when the existing ledger detects a variance', async () => {
    mocks.create.mockRejectedValueOnce(Object.assign(new Error('variance'), { code: 'VARIANCE_CONFIRMATION_REQUIRED' }));
    expect((await recordNegativeInvoice('quote', input, 'actor')).status).toBe(409);
    expect(mocks.activity).not.toHaveBeenCalled();
    expect((await recordNegativeInvoice('quote', { ...input, confirm_variance: true }, 'actor')).status).toBe(201);
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ confirm_variance: true }), 'actor', { creditEntry: true });
  });
});
