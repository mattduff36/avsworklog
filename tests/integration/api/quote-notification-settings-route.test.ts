import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockIsEffectiveRoleAdminOrSuper,
  mockListQuoteAccountsNotificationRecipientOptions,
  mockGetSelectedQuoteInvoiceNotificationRecipientIds,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockIsEffectiveRoleAdminOrSuper: vi.fn(),
  mockListQuoteAccountsNotificationRecipientOptions: vi.fn(),
  mockGetSelectedQuoteInvoiceNotificationRecipientIds: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/server/sensitive-module-access', () => ({
  requireSensitiveModuleAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/utils/rbac', () => ({
  isEffectiveRoleAdminOrSuper: mockIsEffectiveRoleAdminOrSuper,
}));

vi.mock('@/lib/server/quote-workflow', () => ({
  getSelectedQuoteInvoiceNotificationRecipientIds: mockGetSelectedQuoteInvoiceNotificationRecipientIds,
  listQuoteAccountsNotificationRecipientOptions: mockListQuoteAccountsNotificationRecipientOptions,
}));

describe('/api/quotes/notification-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'admin-1' } },
          error: null,
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({});
    mockIsEffectiveRoleAdminOrSuper.mockResolvedValue(true);
    mockListQuoteAccountsNotificationRecipientOptions.mockResolvedValue([
      { id: 'accounts-1', full_name: 'Accounts One', employee_id: 'A1', team_id: 'accounts' },
    ]);
    mockGetSelectedQuoteInvoiceNotificationRecipientIds.mockResolvedValue(['accounts-1']);
  });

  it('returns eligible Accounts recipients and filters stale saved selections', async () => {
    const { GET } = await import('@/app/api/quotes/notification-settings/route');
    mockGetSelectedQuoteInvoiceNotificationRecipientIds.mockResolvedValue(['accounts-1', 'stale-user']);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      can_manage: true,
      eligible_recipients: [
        { id: 'accounts-1', full_name: 'Accounts One', employee_id: 'A1', team_id: 'accounts' },
      ],
      selected_recipient_ids: ['accounts-1'],
    });
  });

  it('rejects saving recipients outside the eligible Accounts list', async () => {
    const { PUT } = await import('@/app/api/quotes/notification-settings/route');

    const response = await PUT(new NextRequest('http://localhost/api/quotes/notification-settings', {
      method: 'PUT',
      body: JSON.stringify({ recipient_ids: ['other-user'] }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Selected recipients must be Accounts team users with Quotes access.');
  });

  it('saves the selected Accounts recipients', async () => {
    const { PUT } = await import('@/app/api/quotes/notification-settings/route');
    const insert = vi.fn().mockResolvedValue({ error: null });
    const deleteRows = vi.fn(() => ({
      not: vi.fn().mockResolvedValue({ error: null }),
    }));
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'quote_invoice_notification_recipients') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          delete: deleteRows,
          insert,
        };
      }),
    });

    const response = await PUT(new NextRequest('http://localhost/api/quotes/notification-settings', {
      method: 'PUT',
      body: JSON.stringify({ recipient_ids: ['accounts-1'] }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith([{
      profile_id: 'accounts-1',
      created_by: 'admin-1',
      updated_by: 'admin-1',
    }]);
    expect(payload.selected_recipient_ids).toEqual(['accounts-1']);
  });
});
