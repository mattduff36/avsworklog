import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeCurrentFinancialYearBookings,
  undoLatestClosedFinancialYearBookings,
} from '@/lib/services/absence-bank-holiday-sync';

describe('closeCurrentFinancialYearBookings', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the current financial year and returns carryover summary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T09:00:00.000Z'));

    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const supabase = {
      async rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return {
          data: [
            {
              financial_year_start_year: 2025,
              pending_count: 0,
              carryovers_written: 42,
            },
          ],
          error: null,
        };
      },
    };

    const result = await closeCurrentFinancialYearBookings({
      supabase: supabase as never,
      actorProfileId: 'manager-1',
      notes: 'Year-end close',
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      fn: 'close_absence_financial_year_bookings',
      args: {
        p_financial_year_start_year: 2025,
        p_actor_profile_id: 'manager-1',
        p_notes: 'Year-end close',
      },
    });
    expect(result).toEqual({
      closedFinancialYearStartYear: 2025,
      closedFinancialYearLabel: '2025/26',
      pendingCount: 0,
      carryoversWritten: 42,
    });
  });

  it('surfaces pending-booking close errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T09:00:00.000Z'));

    const supabase = {
      async rpc() {
        return {
          data: null,
          error: { message: 'Current year still has pending bookings. Accept or decline these first.' },
        };
      },
    };

    await expect(
      closeCurrentFinancialYearBookings({
        supabase: supabase as never,
        actorProfileId: 'manager-1',
      })
    ).rejects.toMatchObject({
      message: 'Current year still has pending bookings. Accept or decline these first.',
    });
  });
});

describe('undoLatestClosedFinancialYearBookings', () => {
  it('undoes the latest closed financial year and returns restore summary', async () => {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const supabase = {
      async rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return {
          data: [
            {
              financial_year_start_year: 2025,
              restored_carryovers: 38,
            },
          ],
          error: null,
        };
      },
    };

    const result = await undoLatestClosedFinancialYearBookings({
      supabase: supabase as never,
      actorProfileId: 'admin-1',
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      fn: 'undo_close_absence_financial_year_bookings',
      args: {
        p_actor_profile_id: 'admin-1',
      },
    });
    expect(result).toEqual({
      undoneFinancialYearStartYear: 2025,
      undoneFinancialYearLabel: '2025/26',
      restoredCarryovers: 38,
    });
  });

  it('surfaces strict undo guardrail errors', async () => {
    const supabase = {
      async rpc() {
        return {
          data: null,
          error: { message: 'Cannot undo close because this financial year has already ended.' },
        };
      },
    };

    await expect(
      undoLatestClosedFinancialYearBookings({
        supabase: supabase as never,
        actorProfileId: 'admin-1',
      })
    ).rejects.toMatchObject({
      message: 'Cannot undo close because this financial year has already ended.',
    });
  });

  it.each([
    'No closed financial year found to undo.',
    'Cannot undo close because no pre-close snapshot exists for this year.',
    'Cannot undo close because archive data already exists for this year.',
  ])('surfaces undo blocker: %s', async (errorMessage) => {
    const supabase = {
      async rpc() {
        return {
          data: null,
          error: { message: errorMessage },
        };
      },
    };

    await expect(
      undoLatestClosedFinancialYearBookings({
        supabase: supabase as never,
        actorProfileId: 'admin-1',
      })
    ).rejects.toMatchObject({
      message: errorMessage,
    });
  });
});
