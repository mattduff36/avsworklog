import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  INVENTORY_PAT_CHECKLIST_ITEMS,
  INVENTORY_PAT_CHECKLIST_VERSION,
  INVENTORY_SERVICE_CHECKLIST_ITEMS,
  INVENTORY_SERVICE_CHECKLIST_VERSION,
} from '@/lib/checklists/inventory-service-checklist';
import { FUTURE_CHECK_CONFIRMATION_REQUIRED } from '@/lib/inventory/check-dates';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { POST } from '@/app/api/inventory/[id]/checks/route';

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/inventory/item-1/checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildChecklist(
  status: 'ok' | 'attention' | 'na' = 'ok',
  items = INVENTORY_SERVICE_CHECKLIST_ITEMS,
) {
  return items.map((item) => ({
    ...item,
    status,
    comment: status === 'attention' ? 'Failed check details' : null,
  }));
}

describe('INV-CHECK-ROUTE inventory check route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
    });
  });

  it('INV-CHECK-ROUTE-001 rejects incomplete structured checklists before touching the database', async () => {
    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_items: buildChecklist().slice(0, -1),
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Checklist is incomplete' });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('INV-CHECK-ROUTE-001 rejects unsupported checklist versions before touching the database', async () => {
    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_version: 'unsupported-checklist-v1',
        checklist_items: buildChecklist(),
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unsupported checklist version' });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('INV-CHECK-ROUTE-001 requires comments for failed checklist items', async () => {
    const checklist = buildChecklist();
    checklist[0] = { ...checklist[0], status: 'attention', comment: null };

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_items: checklist,
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Checklist item 1 requires a fail comment' });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('INV-CHECK-ROUTE-001 rejects impossible calendar dates', async () => {
    const response = await POST(
      buildRequest({
        checked_at: '2026-02-31',
        checklist_items: buildChecklist(),
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Check date must be a valid YYYY-MM-DD date',
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('INV-CHECK-ROUTE-001 requires future-date confirmation without writing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00+01:00'));

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-02',
        checklist_items: buildChecklist(),
        submission_id: '11111111-1111-4111-8111-111111111111',
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: FUTURE_CHECK_CONFIRMATION_REQUIRED,
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('INV-CHECK-ROUTE-001 stores canonical checklist data through the transactional RPC', async () => {
    const rpcCalls: Array<Record<string, unknown>> = [];
    const admin = {
      async rpc(fn: string, args: Record<string, unknown>) {
        expect(fn).toBe('inventory_record_check');
        rpcCalls.push(args);
        return {
          data: [{
            id: 'check-1',
            item_id: 'item-1',
            checked_at: args.p_checked_at,
            interval_days: 30,
            note: args.p_note,
            checklist_version: args.p_checklist_version,
            checklist_items: args.p_checklist_items,
            overall_status: args.p_overall_status,
            checked_by: args.p_checked_by,
            submission_id: args.p_submission_id,
          }],
          error: null,
        };
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const checklist = buildChecklist();
    checklist[0] = { ...checklist[0], status: 'attention', comment: 'Replace spark plug' };

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_version: INVENTORY_SERVICE_CHECKLIST_VERSION,
        checklist_items: checklist,
        submission_id: '11111111-1111-4111-8111-111111111111',
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(201);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      p_item_id: 'item-1',
      p_checked_at: '2026-06-01',
      p_checked_by: 'user-1',
      p_checklist_version: INVENTORY_SERVICE_CHECKLIST_VERSION,
      p_overall_status: 'fail',
      p_confirm_future_date: false,
      p_submission_id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('INV-CHECK-IDEMP-001 and PAT checks pass confirm_future_date and submission ids through the RPC', async () => {
    const rpcCalls: Array<Record<string, unknown>> = [];
    const admin = {
      async rpc(_fn: string, args: Record<string, unknown>) {
        rpcCalls.push(args);
        return {
          data: [{
            id: 'check-1',
            item_id: 'item-1',
            checked_at: args.p_checked_at,
            interval_days: 30,
            note: args.p_note,
            checklist_version: args.p_checklist_version,
            checklist_items: args.p_checklist_items,
            overall_status: args.p_overall_status,
            checked_by: args.p_checked_by,
            submission_id: args.p_submission_id,
          }],
          error: null,
        };
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-01',
        checklist_version: INVENTORY_PAT_CHECKLIST_VERSION,
        checklist_items: buildChecklist('ok', INVENTORY_PAT_CHECKLIST_ITEMS),
        note: 'PAT complete',
        confirm_future_date: true,
        submission_id: '22222222-2222-4222-8222-222222222222',
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(201);
    expect(rpcCalls[0]).toMatchObject({
      p_checklist_version: INVENTORY_PAT_CHECKLIST_VERSION,
      p_overall_status: 'pass',
      p_confirm_future_date: true,
      p_submission_id: '22222222-2222-4222-8222-222222222222',
      p_note: 'PAT complete',
    });
  });

  it('INV-CHECK-ROUTE-001 records an explicitly confirmed future check date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00+01:00'));

    const rpcCalls: Array<Record<string, unknown>> = [];
    const admin = {
      async rpc(_fn: string, args: Record<string, unknown>) {
        rpcCalls.push(args);
        return {
          data: [{
            id: 'check-future',
            item_id: 'item-1',
            checked_at: args.p_checked_at,
            interval_days: 30,
            note: null,
            checklist_version: args.p_checklist_version,
            checklist_items: args.p_checklist_items,
            overall_status: args.p_overall_status,
            checked_by: args.p_checked_by,
            submission_id: args.p_submission_id,
          }],
          error: null,
        };
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await POST(
      buildRequest({
        checked_at: '2026-06-02',
        checklist_items: buildChecklist(),
        confirm_future_date: true,
        submission_id: '33333333-3333-4333-8333-333333333333',
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(201);
    expect(rpcCalls[0]).toMatchObject({
      p_checked_at: '2026-06-02',
      p_confirm_future_date: true,
    });
    vi.useRealTimers();
  });
});
