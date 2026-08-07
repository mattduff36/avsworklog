import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  SMALL_TOOLS_CHECK_INTERVAL_DAYS,
  SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS,
  TWELVE_MONTH_CHECK_INTERVAL_DAYS,
} from '@/lib/inventory/check-interval-defaults';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260807180000_inventory_small_tools_check_interval.sql',
  ),
  'utf-8',
);

const runner = readFileSync(
  resolve(process.cwd(), 'scripts/run-inventory-small-tools-check-interval-migration.ts'),
  'utf-8',
);

describe('inventory small tools check interval migration contract', () => {
  it('includes the exact 18-item exception allowlist and 180/360 partition', () => {
    expect(SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS).toHaveLength(18);
    expect(SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS).toContain('AVS572/571');
    expect(SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS).toContain('AVS983984');

    const sqlAllowlistMatch = migration.match(
      /v_exception_numbers TEXT\[] := ARRAY\[([\s\S]*?)\];/,
    );
    expect(sqlAllowlistMatch).toBeTruthy();
    const sqlAllowlist = [...sqlAllowlistMatch![1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(sqlAllowlist).toEqual([...SMALL_TOOLS_TWELVE_MONTH_CHECK_INTERVAL_ITEM_NUMBERS]);

    expect(migration).toContain(`THEN ${TWELVE_MONTH_CHECK_INTERVAL_DAYS}`);
    expect(migration).toContain(`ELSE ${SMALL_TOOLS_CHECK_INTERVAL_DAYS}`);
    expect(migration).toContain('category IS DISTINCT FROM \'minor_plant\'');
    expect(migration).toContain('Minor Plant check_interval_days must remain NULL');
  });

  it('uses category-aware SQL fallbacks and preserves function security contracts', () => {
    expect(migration).toContain(
      'CASE WHEN v_item.category = \'minor_plant\' THEN 30 ELSE 180 END',
    );
    expect(migration).toContain(
      'CASE WHEN item.category = \'minor_plant\' THEN 30 ELSE 180 END',
    );
    expect(migration).not.toContain('COALESCE(v_item.check_interval_days, 30)');
    expect(migration).not.toContain('COALESCE(item.check_interval_days, 30)');

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.inventory_record_check(');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.inventory_kiosk_execute_transfer_basket(',
    );
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain('SET search_path = public');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.inventory_record_check(');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.inventory_kiosk_execute_transfer_basket(',
    );
    expect(migration).toContain('TO service_role;');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.inventory_record_check(');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.inventory_kiosk_execute_transfer_basket(',
    );
  });

  it('captures a private rollback snapshot before applying name and interval changes', () => {
    expect(migration).toContain(
      'private.inventory_small_tools_interval_backfill_20260807',
    );
    expect(migration).toContain('previous_check_interval_days');
    expect(migration).toContain('previous_name');
    expect(migration).toContain('normalize_obvious_inventory_item_name');
    expect(migration).toContain('GENNEY');
    expect(migration).toContain('LAZER');
    expect(migration).toContain('STHIL');
    expect(migration).toContain('CAT4');
    expect(migration).toContain('circle saw');
    expect(runner).toContain('docs_private/inventory-check-interval-backfill');
    expect(runner).toContain('small-tools-check-interval-before-');
  });
});
