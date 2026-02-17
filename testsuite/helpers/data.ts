/**
 * Test data helpers — creates TEST-only records and cleans them up.
 *
 * NON-DESTRUCTIVE GUARANTEE:
 * - Every record created is tagged with a unique TESTSUITE prefix.
 * - All mutating operations are scoped ONLY to IDs created in this run.
 * - Cleanup removes only records created by the suite.
 * - We NEVER pick "the first existing record" for mutation.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const RUN_TAG = `TESTSUITE-${Date.now()}`;

interface CreatedRecord {
  table: string;
  id: string;
}

const createdRecords: CreatedRecord[] = [];

function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getRunTag(): string {
  return RUN_TAG;
}

export async function createTestVehicle(overrides?: Record<string, unknown>): Promise<{ id: string; reg_number: string }> {
  const supabase = getAdminClient();
  const regNumber = `TST-${RUN_TAG.slice(-6)}`;

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      reg_number: regNumber,
      nickname: `Test Vehicle ${RUN_TAG}`,
      status: 'active',
      ...overrides,
    })
    .select('id, reg_number')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test vehicle: ${error?.message || 'no data'}`);
  }

  createdRecords.push({ table: 'vehicles', id: data.id });
  return data;
}

export async function createTestWorkshopTask(
  vehicleId: string,
  userId: string,
  overrides?: Record<string, unknown>
): Promise<{ id: string }> {
  const supabase = getAdminClient();

  // Get default category
  const { data: category } = await supabase
    .from('workshop_task_categories')
    .select('id')
    .limit(1)
    .single();

  const { data, error } = await supabase
    .from('actions')
    .insert({
      vehicle_id: vehicleId,
      created_by: userId,
      action_type: 'workshop_task',
      description: `Test task ${RUN_TAG}`,
      notes: RUN_TAG,
      status: 'pending',
      workshop_category_id: category?.id || null,
      ...overrides,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test workshop task: ${error?.message || 'no data'}`);
  }

  createdRecords.push({ table: 'actions', id: data.id });
  return data;
}

export async function cleanupTestData(): Promise<void> {
  const supabase = getAdminClient();

  // Reverse order to respect FK dependencies
  for (const record of [...createdRecords].reverse()) {
    try {
      if (record.table === 'vehicles') {
        // Soft-delete test vehicles
        await supabase
          .from('vehicles')
          .update({ status: 'deleted', deleted_at: new Date().toISOString() })
          .eq('id', record.id);
      } else {
        await supabase
          .from(record.table)
          .delete()
          .eq('id', record.id);
      }
    } catch (err) {
      console.warn(`Cleanup warning: failed to remove ${record.table}/${record.id}:`, err);
    }
  }
  createdRecords.length = 0;
}
