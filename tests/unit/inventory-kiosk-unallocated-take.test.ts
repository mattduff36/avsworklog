import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import {
  isReminderActionActioned,
  isReminderActionActive,
} from '@/lib/utils/reminder-action-filters';
import { canIgnoreReminderAction } from '@/lib/utils/reminder-action-permissions';
import { buildActionsSummaryStats } from '@/lib/utils/actions-summary';
import type { ReminderActionWithAsset } from '@/types/reminders';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260819143000_inventory_kiosk_unallocated_take.sql'),
  'utf8',
);
const reviewMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260819151500_inventory_kiosk_unallocated_take_review.sql'),
  'utf8',
);
const takeRunner = readFileSync(
  resolve(process.cwd(), 'scripts/run-inventory-kiosk-unallocated-take-migration.ts'),
  'utf8',
);
const reviewRunner = readFileSync(
  resolve(process.cwd(), 'scripts/run-inventory-kiosk-unallocated-take-review-migration.ts'),
  'utf8',
);
const ignoreRoute = readFileSync(
  resolve(process.cwd(), 'app/api/actions/[id]/ignore/route.ts'),
  'utf8',
);
const assignRoute = readFileSync(
  resolve(process.cwd(), 'app/api/actions/assign/route.ts'),
  'utf8',
);
const allocateApi = readFileSync(
  resolve(process.cwd(), 'app/api/actions/allocate-kiosk-take/route.ts'),
  'utf8',
);
const kioskServer = readFileSync(
  resolve(process.cwd(), 'lib/server/inventory-kiosk.ts'),
  'utf8',
);
const remoteServer = readFileSync(
  resolve(process.cwd(), 'lib/server/inventory-kiosk-remote.ts'),
  'utf8',
);

function makeAction(overrides: Partial<ReminderActionWithAsset> = {}): ReminderActionWithAsset {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workflow_key: INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY,
    source_type: 'system_generated',
    dedupe_key: 'inventory_kiosk_unallocated_take:batch',
    status: 'open',
    priority: 'medium',
    title: 'Allocate yard take: Job van',
    description: 'Job van',
    asset_type: null,
    van_id: null,
    plant_id: null,
    hgv_id: null,
    metadata: { location_details: 'Job van' },
    created_by: null,
    resolved_by: null,
    ignored_until: null,
    ignored_forever: false,
    ignored_at: null,
    ignored_by: null,
    first_detected_at: '2026-08-19T00:00:00.000Z',
    last_detected_at: '2026-08-19T00:00:00.000Z',
    due_at: null,
    resolved_at: null,
    created_at: '2026-08-19T00:00:00.000Z',
    updated_at: '2026-08-19T00:00:00.000Z',
    asset_label: null,
    asset_route: null,
    reminders_count: { total: 0, pending: 0, actioned: 0, cancelled: 0 },
    ...overrides,
  };
}

describe('Yard kiosk unallocated take contract', () => {
  it('YK-DB-001 creates the immutable transfer singleton and allocation RPCs', () => {
    expect(migration).toContain("location_type = 'transfer'");
    expect(migration).toContain("'In transfer'");
    expect(migration).toContain('Conflicting In transfer location already exists');
    expect(migration).toContain('The In transfer location is a reserved system location');
    expect(migration).toContain('inventory_locations_one_active_transfer_idx');
    expect(takeRunner).toContain('Expected exactly one active In transfer location');
    expect(reviewRunner).toContain('YK-DB-001');
  });

  it('YK-TAKE-001 atomically creates stock, batch and open action in one RPC', () => {
    expect(migration).toContain('inventory_kiosk_execute_unallocated_take');
    expect(migration).toContain("'inventory_kiosk_unallocated_take:' || v_kiosk_batch_id::TEXT");
    expect(migration).toContain('INSERT INTO public.reminder_actions');
    expect(migration).toContain('INSERT INTO public.inventory_kiosk_transfer_batches');
    expect(migration).toContain('public.inventory_transfer_items(');
    expect(migration).toContain('public.inventory_transfer_hardware_stock(');
    expect(kioskServer).toContain('inventory_kiosk_execute_unallocated_take');
    expect(kioskServer).not.toContain('p_counterpart_location_id: payload.unallocated');
  });

  it('YK-GUARD-001 rejects ordinary transfer stock mutation', () => {
    expect(migration).toContain('In transfer stock can only be moved by Yard allocation');
    expect(migration).toContain('Hardware at In transfer can only be moved by Yard allocation');
    expect(migration).toContain('In transfer cannot be assigned as a user location');
    expect(migration).toContain("location_type NOT IN ('yard', 'unknown', 'transfer')");
    expect(migration).toContain("inventory.transfer_mutation");
  });

  it('YK-ALLOC-001 reconstructs the original basket and writes allocation audit columns', () => {
    expect(migration).toContain('FROM public.inventory_item_movements AS movement');
    expect(migration).toContain('FROM public.inventory_hardware_transactions AS txn');
    expect(migration).toContain('allocated_location_id');
    expect(migration).toContain('allocation_movement_batch_id');
    expect(migration).toContain('allocation_hardware_batch_id');
    expect(migration).toContain("'kiosk_allocate'");
    expect(migration.slice(migration.indexOf('inventory_allocate_unallocated_kiosk_take')))
      .not.toContain('SET movement_batch_id');
  });

  it('YK-ALLOC-003 locks the action then batch and fails already-allocated races', () => {
    const allocateSql = migration.slice(migration.indexOf('inventory_allocate_unallocated_kiosk_take'));
    expect(allocateSql).toContain('FOR UPDATE');
    expect(allocateSql).toContain('Yard take already allocated:');
    expect(allocateSql.indexOf('FROM public.reminder_actions')).toBeLessThan(
      allocateSql.indexOf('FROM public.inventory_kiosk_transfer_batches'),
    );
  });

  it('YK-ACTION-001 blocks ignore, assignment and workflow_key escape', () => {
    expect(canIgnoreReminderAction(INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY)).toBe(false);
    expect(ignoreRoute).toContain('canIgnoreReminderAction(action.workflow_key)');
    expect(assignRoute).toContain('Yard transfer actions are allocated, not assigned');
    expect(migration).toContain('Yard transfer actions cannot have reminders');
    expect(reviewMigration).toContain('NEW.workflow_key IS DISTINCT FROM OLD.workflow_key');
    expect(reviewRunner).toContain('YK-ACTION-001');
  });

  it('YK-AUTH-001 keeps RPCs service_role only and derives reserved locations server-side', () => {
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.inventory_kiosk_execute_unallocated_take');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION private.inventory_require_transfer_location() TO service_role');
    expect(reviewMigration).toContain('GRANT USAGE ON SCHEMA private TO service_role');
    expect(allocateApi).toContain("canEffectiveRoleAccessModule('actions')");
    expect(kioskServer).not.toContain('p_transfer_location_id');
    expect(reviewRunner).toContain('YK-AUTH-001');
  });

  it('YK-AUTH-002 and YK-LOC-001 keep allocate on Actions and location create on that dialog only', () => {
    const actionsPage = readFileSync(
      resolve(process.cwd(), 'app/(dashboard)/actions/page.tsx'),
      'utf8',
    );
    const locationsRoute = readFileSync(
      resolve(process.cwd(), 'app/api/inventory/locations/route.ts'),
      'utf8',
    );
    const allocateServer = readFileSync(
      resolve(process.cwd(), 'lib/server/inventory-kiosk-allocate.ts'),
      'utf8',
    );
    const actionedPanel = readFileSync(
      resolve(process.cwd(), 'app/(dashboard)/actions/components/ActionedActionsPanel.tsx'),
      'utf8',
    );

    expect(actionsPage).toContain("usePermissionCheck('actions'");
    expect(actionedPanel).toContain('INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY');
    expect(actionsPage).toContain('canViewActions');
    expect(allocateApi).toContain("canEffectiveRoleAccessModule('actions')");
    expect(allocateApi).not.toContain('requireInventoryManagerAccess');
    expect(locationsRoute).toContain('requireInventoryManagerAccess');
    expect(allocateServer).toContain("admin.rpc('inventory_allocate_unallocated_kiosk_take'");
    expect(allocateServer).not.toContain(".from('inventory_locations')\n    .insert(");
  });

  it('YK-REMOTE-001 accepts snapshot v1 during rollout and validates v2 typed-path controls', () => {
    expect(remoteServer).toContain('snapshot.schema_version !== 1 && snapshot.schema_version !== 2');
    expect(remoteServer).toContain("type === 'select_unallocated_location'");
    expect(remoteServer).toContain("type === 'set_unallocated_details'");
    expect(remoteServer).toContain("type === 'confirm_unallocated_details'");
    expect(remoteServer).toContain('schema_version === 2');
  });

  it('YK-INVAR-001 and YK-SUMMARY-001 keep open/resolved semantics and live orphan checks', () => {
    const openAction = makeAction();
    const resolvedAction = makeAction({ status: 'resolved' });

    expect(isReminderActionActive(openAction)).toBe(true);
    expect(isReminderActionActioned(openAction)).toBe(false);
    expect(isReminderActionActive(resolvedAction)).toBe(false);
    expect(isReminderActionActioned(resolvedAction)).toBe(true);
    expect(buildActionsSummaryStats([openAction])).toEqual({
      openActions: 1,
      pendingReminders: 0,
      unassigned: 1,
    });
    expect(reviewRunner).toContain('pending_without_open_action');
    expect(reviewRunner).toContain('YK-INVAR-001');
  });

  it('YK-RISK-003 runs take and allocate on disposable PGlite instead of production', () => {
    const runtimeTest = readFileSync(
      resolve(process.cwd(), 'tests/db/inventory-kiosk-unallocated-take-runtime.test.ts'),
      'utf8',
    );
    const harness = readFileSync(
      resolve(process.cwd(), 'tests/db/inventory-kiosk-unallocated-take-pglite-harness.ts'),
      'utf8',
    );
    expect(reviewRunner).not.toContain('inventory_kiosk_execute_unallocated_take(');
    expect(runtimeTest).toContain('YK-RPC-TAKE-001');
    expect(runtimeTest).toContain('YK-RPC-ALLOC-001');
    expect(runtimeTest).toContain('YK-RPC-ALLOC-003');
    expect(harness).toContain('inventory_kiosk_execute_unallocated_take');
    expect(harness).toContain('inventory_allocate_unallocated_kiosk_take');
    expect(harness).toContain('new PGlite');
    expect(harness).not.toContain('POSTGRES_URL');
    expect(runtimeTest).not.toContain('POSTGRES_URL');
  });
});
