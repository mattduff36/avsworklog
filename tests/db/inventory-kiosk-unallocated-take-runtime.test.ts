import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allocateUnallocatedTake,
  createYardUnallocatedTakePglite,
  executeUnallocatedTake,
  seedYardUnallocatedTakeFixture,
  YK_ACTORS,
  YK_IDS,
} from './inventory-kiosk-unallocated-take-pglite-harness';

describe('Yard unallocated take RPC runtime', () => {
  let pg: PGlite | undefined;

  afterEach(async () => {
    await pg?.close();
    pg = undefined;
  });

  async function startFixture() {
    pg = await createYardUnallocatedTakePglite();
    await seedYardUnallocatedTakeFixture(pg);
    return pg;
  }

  it('YK-RPC-TAKE-001 parks serialized and hardware stock at In transfer with one open action', async () => {
    const db = await startFixture();
    const take = await executeUnallocatedTake(db);
    const row = take.rows[0];

    expect(row.serialized_count).toBe(1);
    expect(row.hardware_line_count).toBe(1);
    expect(row.reminder_action_id).toBeTruthy();

    const state = await db.query<{
      item_location_type: string;
      yard_hardware: number;
      transfer_hardware: number;
      action_status: string;
      allocation_status: string;
      location_details: string;
    }>(
      `
        SELECT
          loc.location_type AS item_location_type,
          COALESCE((
            SELECT quantity
            FROM public.inventory_hardware_balances
            WHERE hardware_item_id = $1
              AND location_id = $2
          ), 0) AS yard_hardware,
          COALESCE((
            SELECT quantity
            FROM public.inventory_hardware_balances
            WHERE hardware_item_id = $1
              AND location_id = transfer.id
          ), 0) AS transfer_hardware,
          action.status AS action_status,
          batch.allocation_status,
          batch.location_details
        FROM public.inventory_items AS item
        JOIN public.inventory_locations AS loc ON loc.id = item.location_id
        JOIN public.inventory_locations AS transfer
          ON transfer.location_type = 'transfer'
          AND transfer.is_active = TRUE
        JOIN public.reminder_actions AS action ON action.id = $3
        JOIN public.inventory_kiosk_transfer_batches AS batch
          ON batch.reminder_action_id = action.id
        WHERE item.id = $4
      `,
      [YK_IDS.hardware, YK_IDS.yard, row.reminder_action_id, YK_IDS.item],
    );

    expect(state.rows[0]).toMatchObject({
      item_location_type: 'transfer',
      yard_hardware: 3,
      transfer_hardware: 2,
      action_status: 'open',
      allocation_status: 'pending',
      location_details: 'Job van on site',
    });
  }, 60_000);

  it('YK-RPC-ALLOC-001 moves the reconstructed basket to an existing location', async () => {
    const db = await startFixture();
    const take = await executeUnallocatedTake(db);
    const allocated = await allocateUnallocatedTake(db, take.rows[0].reminder_action_id);
    expect(allocated.rows[0].created_location).toBe(false);
    expect(allocated.rows[0].allocated_location_id).toBe(YK_IDS.vanLocation);

    const state = await db.query<{
      item_location_id: string;
      van_hardware: number;
      transfer_hardware: number;
      action_status: string;
      allocation_status: string;
      allocated_location_id: string;
    }>(
      `
        SELECT
          item.location_id AS item_location_id,
          COALESCE((
            SELECT quantity
            FROM public.inventory_hardware_balances
            WHERE hardware_item_id = $1
              AND location_id = $2
          ), 0) AS van_hardware,
          COALESCE((
            SELECT quantity
            FROM public.inventory_hardware_balances
            WHERE hardware_item_id = $1
              AND location_id = transfer.id
          ), 0) AS transfer_hardware,
          action.status AS action_status,
          batch.allocation_status,
          batch.allocated_location_id
        FROM public.inventory_items AS item
        JOIN public.inventory_locations AS transfer
          ON transfer.location_type = 'transfer'
          AND transfer.is_active = TRUE
        JOIN public.reminder_actions AS action ON action.id = $3
        JOIN public.inventory_kiosk_transfer_batches AS batch
          ON batch.reminder_action_id = action.id
        WHERE item.id = $4
      `,
      [YK_IDS.hardware, YK_IDS.vanLocation, take.rows[0].reminder_action_id, YK_IDS.item],
    );

    expect(state.rows[0]).toMatchObject({
      item_location_id: YK_IDS.vanLocation,
      van_hardware: 2,
      transfer_hardware: 0,
      action_status: 'resolved',
      allocation_status: 'allocated',
      allocated_location_id: YK_IDS.vanLocation,
    });
  }, 60_000);

  it('YK-RPC-ALLOC-002 creates a manual location only inside the allocate RPC', async () => {
    const db = await startFixture();
    const take = await executeUnallocatedTake(db);
    const allocated = await allocateUnallocatedTake(db, take.rows[0].reminder_action_id, {
      locationId: null,
      newLocation: {
        name: 'Typed site cabin',
        description: 'Job van on site',
        linked_asset_type: 'none',
      },
    });

    expect(allocated.rows[0].created_location).toBe(true);
    const created = await db.query<{ location_type: string; source_type: string; name: string }>(
      `
        SELECT location_type, source_type, name
        FROM public.inventory_locations
        WHERE id = $1
      `,
      [allocated.rows[0].allocated_location_id],
    );
    expect(created.rows[0]).toEqual({
      location_type: 'manual',
      source_type: 'manual',
      name: 'Typed site cabin',
    });
  }, 60_000);

  it('YK-RPC-ALLOC-003 rejects a second allocate of the same action', async () => {
    const db = await startFixture();
    const take = await executeUnallocatedTake(db);
    await allocateUnallocatedTake(db, take.rows[0].reminder_action_id);

    await expect(
      allocateUnallocatedTake(db, take.rows[0].reminder_action_id),
    ).rejects.toThrow(/Yard take already allocated/i);
  }, 60_000);

  it('YK-RPC-GUARD-001 blocks ordinary moves of In transfer stock', async () => {
    const db = await startFixture();
    await executeUnallocatedTake(db);

    await expect(
      db.query(
        `
          SELECT *
          FROM public.inventory_transfer_items(
            ARRAY[$1]::uuid[],
            $2::uuid,
            'ordinary move',
            $3::uuid,
            NULL
          )
        `,
        [YK_IDS.item, YK_IDS.vanLocation, YK_IDS.yard],
      ),
    ).rejects.toThrow(/In transfer stock can only be moved by Yard allocation/i);

    const hardware = await db.query<{ id: string }>(
      `SELECT id FROM public.inventory_locations WHERE location_type = 'transfer'`,
    );
    await expect(
      db.query(
        `SELECT public.inventory_transfer_hardware_stock($1::jsonb, 'ordinary', $2::uuid)`,
        [
          JSON.stringify([{
            item_id: YK_IDS.hardware,
            from_location_id: hardware.rows[0].id,
            to_location_id: YK_IDS.vanLocation,
            quantity: 1,
          }]),
          YK_ACTORS.manager,
        ],
      ),
    ).rejects.toThrow(/Hardware at In transfer can only be moved by Yard allocation/i);
  }, 60_000);

  it('YK-RPC-GUARD-002 rejects a normal kiosk basket that uses In transfer as counterpart', async () => {
    const db = await startFixture();
    const transfer = await db.query<{ id: string }>(
      `SELECT id FROM public.inventory_locations WHERE location_type = 'transfer'`,
    );

    await expect(
      db.query(
        `
          SELECT *
          FROM public.inventory_kiosk_execute_transfer_basket(
            $1::uuid,
            'take',
            $2::uuid,
            ARRAY[$3]::uuid[],
            '[]'::jsonb,
            NULL
          )
        `,
        [YK_ACTORS.kiosk, transfer.rows[0].id, YK_IDS.item],
      ),
    ).rejects.toThrow(/Active non-Yard counterpart location not found/i);
  }, 60_000);

  it('YK-RPC-TAKE-002 rejects empty location details', async () => {
    const db = await startFixture();
    await expect(executeUnallocatedTake(db, { details: '   ' })).rejects.toThrow(
      /Location details must be between 1 and 500 characters/i,
    );
  }, 60_000);
});
