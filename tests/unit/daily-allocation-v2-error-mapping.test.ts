import { describe, expect, it } from 'vitest';
import {
  mapDailyAllocationRpcError,
  parseDailyAllocationBoardRange,
  DailyAllocationError,
} from '@/lib/server/daily-allocation/auth';

describe('DA2 board date range validation', () => {
  it('accepts an inclusive seven-day London civil range, including DST', () => {
    const range = parseDailyAllocationBoardRange('2026-03-27', '2026-04-02');
    expect(range.dates).toEqual([
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
    ]);
    expect(range.dates).toHaveLength(7);
  });

  it('rejects inverted, invalid, and eight-day ranges', () => {
    expect(() => parseDailyAllocationBoardRange('2026-08-21', '2026-08-14')).toThrow(DailyAllocationError);
    expect(() => parseDailyAllocationBoardRange('2026-02-31', '2026-03-01')).toThrow(DailyAllocationError);
    expect(() => parseDailyAllocationBoardRange('2026-08-14', '2026-08-21')).toThrowError(
      /7 days or fewer/
    );
    expect(() => parseDailyAllocationBoardRange('', '2026-08-14')).toThrow(DailyAllocationError);
  });
});

describe('DA2-CONC-001 rpc error mapping', () => {
  it('maps stale versions, overlaps, and auth failures to stable HTTP codes', () => {
    expect(mapDailyAllocationRpcError({ message: 'STALE_PLAN_VERSION' })).toMatchObject({
      status: 409,
      code: 'STALE_PLAN_VERSION',
    });
    expect(mapDailyAllocationRpcError({ message: 'STALE_ENTITY_VERSION' })).toMatchObject({
      status: 409,
      code: 'STALE_ENTITY_VERSION',
    });
    expect(mapDailyAllocationRpcError({ code: '23P01', message: 'conflicting key value violates exclusion constraint' })).toMatchObject({
      status: 409,
      code: 'OVERLAP',
    });
    expect(mapDailyAllocationRpcError({ message: 'PLANT_JOB_CONFLICT' })).toMatchObject({
      status: 409,
      code: 'PLANT_JOB_CONFLICT',
    });
    expect(mapDailyAllocationRpcError({ message: 'HARD_CONFLICT' })).toMatchObject({
      status: 409,
      code: 'HARD_CONFLICT',
    });
    expect(mapDailyAllocationRpcError({ message: 'Daily allocation cannot be changed while viewing as another role' })).toMatchObject({
      status: 403,
      code: 'VIEW_AS',
    });
    expect(mapDailyAllocationRpcError({ message: 'Not allowed to convert this daily allocation plan' })).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(mapDailyAllocationRpcError({ message: 'Unauthorized' })).toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(mapDailyAllocationRpcError({ message: 'V2_DISABLED' })).toMatchObject({
      status: 503,
      code: 'V2_DISABLED',
    });
  });
});

describe('DA2-PUB-001/002 rpc error mapping', () => {
  it('maps idempotency and unallocated confirmation to 409', () => {
    expect(mapDailyAllocationRpcError({ message: 'IDEMPOTENCY_CONFLICT' })).toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(mapDailyAllocationRpcError({ message: 'CONFIRM_UNALLOCATED_REQUIRED' })).toMatchObject({
      status: 409,
      code: 'CONFIRM_UNALLOCATED_REQUIRED',
    });
  });
});
