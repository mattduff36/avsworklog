import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export const YK_TAKE_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260819143000_inventory_kiosk_unallocated_take.sql',
);
export const YK_REVIEW_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260819151500_inventory_kiosk_unallocated_take_review.sql',
);
export const YK_PGLITE_BASE_PATH = resolve(
  process.cwd(),
  'tests/db/inventory-kiosk-unallocated-take-pglite-base.sql',
);

export const YK_ACTORS = {
  kiosk: '11111111-1111-4111-8111-111111111111',
  manager: '22222222-2222-4222-8222-222222222222',
} as const;

export const YK_IDS = {
  yard: '33333333-3333-4333-8333-333333333333',
  vanLocation: '44444444-4444-4444-8444-444444444444',
  item: '55555555-5555-4555-8555-555555555555',
  hardware: '66666666-6666-4666-8666-666666666666',
  van: '77777777-7777-4777-8777-777777777777',
} as const;

export async function createYardUnallocatedTakePglite(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  `);
  await pg.exec(readFileSync(YK_PGLITE_BASE_PATH, 'utf8'));
  await pg.exec(readFileSync(YK_TAKE_MIGRATION_PATH, 'utf8'));
  await pg.exec(readFileSync(YK_REVIEW_MIGRATION_PATH, 'utf8'));
  return pg;
}

export async function seedYardUnallocatedTakeFixture(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO public.profiles (id, full_name) VALUES
      ('${YK_ACTORS.kiosk}', 'Yard kiosk'),
      ('${YK_ACTORS.manager}', 'Workshop manager');

    INSERT INTO public.vans (id, reg_number, nickname, status)
    VALUES ('${YK_IDS.van}', 'AB12 CDE', 'Job van', 'active');

    INSERT INTO public.inventory_locations (
      id, name, description, location_type, source_type, sync_status, is_active
    ) VALUES
      ('${YK_IDS.yard}', 'Yard', 'Yard', 'yard', 'system', 'manual', TRUE),
      (
        '${YK_IDS.vanLocation}',
        'Job van',
        'Existing van location',
        'van',
        'fleet',
        'synced',
        TRUE
      );

    INSERT INTO public.inventory_kiosk_config (id, kiosk_user_id, is_enabled)
    VALUES (1, '${YK_ACTORS.kiosk}', TRUE);

    INSERT INTO public.inventory_items (
      id, item_number, item_number_normalized, name, location_id, status
    ) VALUES (
      '${YK_IDS.item}', 'ST-1', 'ST-1', 'Drill', '${YK_IDS.yard}', 'active'
    );

    INSERT INTO public.inventory_hardware_items (id, name, is_active, sort_order)
    VALUES ('${YK_IDS.hardware}', 'Cable ties', TRUE, 1);

    INSERT INTO public.inventory_hardware_balances (
      hardware_item_id, location_id, quantity
    ) VALUES ('${YK_IDS.hardware}', '${YK_IDS.yard}', 5);
  `);
}

export async function executeUnallocatedTake(
  pg: PGlite,
  options?: {
    itemIds?: string[];
    hardwareQuantity?: number;
    details?: string;
  },
) {
  const itemIds = options?.itemIds ?? [YK_IDS.item];
  const hardwareQuantity = options?.hardwareQuantity ?? 2;
  const details = options?.details ?? 'Job van on site';
  return pg.query<{
    kiosk_batch_id: string;
    movement_batch_id: string | null;
    hardware_batch_id: string | null;
    reminder_action_id: string;
    serialized_count: number;
    hardware_line_count: number;
  }>(
    `
      SELECT *
      FROM public.inventory_kiosk_execute_unallocated_take(
        $1::uuid,
        $2::uuid[],
        $3::jsonb,
        $4,
        NULL
      )
    `,
    [
      YK_ACTORS.kiosk,
      itemIds,
      JSON.stringify([{ item_id: YK_IDS.hardware, quantity: hardwareQuantity }]),
      details,
    ],
  );
}

export async function allocateUnallocatedTake(
  pg: PGlite,
  actionId: string,
  destination?: { locationId?: string | null; newLocation?: Record<string, unknown> | null },
) {
  const creating = Boolean(destination?.newLocation);
  return pg.query<{
    kiosk_batch_id: string;
    allocated_location_id: string;
    allocation_movement_batch_id: string | null;
    allocation_hardware_batch_id: string | null;
    created_location: boolean;
  }>(
    `
      SELECT *
      FROM public.inventory_allocate_unallocated_kiosk_take(
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::jsonb
      )
    `,
    [
      YK_ACTORS.manager,
      actionId,
      creating ? null : (destination?.locationId ?? YK_IDS.vanLocation),
      creating ? JSON.stringify(destination?.newLocation) : null,
    ],
  );
}
