/**
 * Cleanup Test Data
 *
 * Removes all test inspections and tasks containing "TEST19"
 * Affects: TE57 VAN, TE57 HGV, TE57 PNT
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type FleetDef = { name: string; table: string; regCol: string; idCol: string; inspTable: string; inspIdCol: string };

const fleet: FleetDef[] = [
  { name: 'TE57 VAN', table: 'vans',  regCol: 'reg_number', idCol: 'van_id',   inspTable: 'van_inspections',   inspIdCol: 'van_id' },
  { name: 'TE57 HGV', table: 'hgvs',  regCol: 'reg_number', idCol: 'hgv_id',   inspTable: 'hgv_inspections',   inspIdCol: 'hgv_id' },
  { name: 'TE57 PNT', table: 'plant', regCol: 'plant_id',   idCol: 'plant_id', inspTable: 'plant_inspections', inspIdCol: 'plant_id' },
];

async function cleanup() {
  console.log('🧹 Cleaning up test data (TEST19)...\n');

  for (const def of fleet) {
    console.log(`\n📋 Cleaning: ${def.name}`);

    const { data: asset } = await supabase
      .from(def.table)
      .select('id')
      .eq(def.regCol, def.name)
      .single();

    if (!asset) {
      console.log(`   ❌ Asset not found`);
      continue;
    }

    const { data: tasks } = await supabase
      .from('actions')
      .select('id')
      .eq(def.idCol, asset.id)
      .or('description.ilike.%TEST19%,workshop_comments.ilike.%TEST19%,logged_comment.ilike.%TEST19%');

    if (tasks && tasks.length > 0) {
      await supabase
        .from('actions')
        .delete()
        .in('id', tasks.map(t => t.id));

      console.log(`   ✅ Deleted ${tasks.length} test task(s)`);
    } else {
      console.log(`   ℹ️  No test tasks to delete`);
    }

    const { data: inspections } = await supabase
      .from(def.inspTable)
      .select('id')
      .eq(def.inspIdCol, asset.id)
      .gte('inspection_date', '2026-01-19');

    if (inspections && inspections.length > 0) {
      await supabase
        .from(def.inspTable)
        .delete()
        .in('id', inspections.map(i => i.id));

      console.log(`   ✅ Deleted ${inspections.length} test inspection(s)`);
    } else {
      console.log(`   ℹ️  No test inspections to delete`);
    }
  }

  console.log('\n✅ Cleanup complete\n');
}

cleanup();
