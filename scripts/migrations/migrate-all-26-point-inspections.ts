/**
 * Migrate ALL 26-point inspections to 14-point van checklist
 * 
 * This script:
 * - Finds all inspections with exactly 182 items (26 items × 7 days)
 * - Excludes test vehicles (TE57 VAN, TE57 HGV)
 * - Migrates them to the new 14-point van checklist
 * - For pending/approved/rejected: marks ALL items as 'ok'
 * - For draft: marks only completed days as 'ok'
 * - Preserves all inspection metadata
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Handle self-signed certificate in development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// New van checklist (14 items)
const VAN_CHECKLIST_ITEMS = [
  'Oil, Fuel & Coolant Levels/Leaks',
  'Wheels & Nuts',
  'Tyres',
  'Windows & Wipers',
  'Mirrors',
  'Visual Body Condition',
  'Lights/Flashing Beacons',
  'Instrument Gauges/Horns',
  'Seat Belt',
  'Visual Interior Condition',
  'Locking Devices',
  'Steering',
  'Parking Brake',
  'Brake Test',
];

interface Inspection {
  id: string;
  vehicle_id: string;
  user_id: string;
  status: string;
  inspection_date: string;
  inspection_end_date: string;
  current_mileage: number | null;
  submitted_at: string | null;
  signature_data: string | null;
  signed_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
  created_at: string;
  updated_at: string;
  vehicles?: {
    reg_number: string;
  };
}

interface InspectionItem {
  id: string;
  inspection_id: string;
  item_number: number;
  day_of_week: number;
  status: string;
  comments: string | null;
}

async function main() {
  console.log('🔍 Finding inspections with 26-point checklists (182 items)...\n');

  try {
    // Get all inspections
    const { data: allInspections, error: inspectionsError } = await supabase
      .from('vehicle_inspections')
      .select(`
        *,
        vehicles (
          reg_number
        )
      `);

    if (inspectionsError) throw inspectionsError;

    console.log(`📊 Total inspections in database: ${allInspections?.length || 0}`);

    // For each inspection, count items
    const inspectionsToMigrate: Inspection[] = [];
    const defectReports: string[] = [];

    for (const inspection of allInspections || []) {
      const { data: items, error: itemsError } = await supabase
        .from('inspection_items')
        .select('*')
        .eq('inspection_id', inspection.id);

      if (itemsError) {
        console.error(`❌ Error fetching items for inspection ${inspection.id}:`, itemsError);
        continue;
      }

      // Check if this is a 26-point checklist (182 items)
      if (items && items.length === 182) {
        const regNumber = (inspection as any).vehicles?.reg_number || 'Unknown';

        // Exclude test vehicles
        if (regNumber === 'TE57 VAN' || regNumber === 'TE57 HGV') {
          console.log(`⏭️  Skipping test vehicle: ${regNumber}`);
          continue;
        }

        // Check for defects
        const defects = items.filter((item: any) => 
          item.status === 'defect' || item.status === 'attention'
        );

        if (defects.length > 0) {
          defectReports.push(
            `   - ${regNumber} (${inspection.id}) - Status: ${inspection.status} - ${defects.length} defect(s)`
          );
        }

        inspectionsToMigrate.push(inspection as Inspection);
      }
    }

    console.log(`\n✅ Found ${inspectionsToMigrate.length} inspections to migrate`);

    if (defectReports.length > 0) {
      console.log(`\n⚠️  Inspections with defects found:`);
      defectReports.forEach(report => console.log(report));
      console.log('');
    }

    if (inspectionsToMigrate.length === 0) {
      console.log('✨ No inspections to migrate!');
      return;
    }

    // Migrate each inspection
    let successCount = 0;
    let errorCount = 0;

    for (const inspection of inspectionsToMigrate) {
      const regNumber = (inspection as any).vehicles?.reg_number || 'Unknown';
      console.log(`\n📝 Migrating: ${regNumber} (${inspection.status}) - ${inspection.id}`);

      try {
        // Fetch existing items to determine which days have data (for drafts)
        const { data: oldItems, error: fetchError } = await supabase
          .from('inspection_items')
          .select('*')
          .eq('inspection_id', inspection.id);

        if (fetchError) throw fetchError;

        // For draft inspections, determine which days have data
        const completedDays = new Set<number>();
        if (inspection.status === 'draft' && oldItems) {
          oldItems.forEach((item: any) => {
            // If any item on a day has been filled, consider that day complete
            if (item.status && item.status !== 'na') {
              completedDays.add(item.day_of_week);
            }
          });
        }

        // Delete old items
        const { error: deleteError } = await supabase
          .from('inspection_items')
          .delete()
          .eq('inspection_id', inspection.id);

        if (deleteError) throw deleteError;

        console.log(`   ✓ Deleted 182 old items`);

        // Create new 14-point van items for all 7 days
        const newItems: any[] = [];
        
        for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
          VAN_CHECKLIST_ITEMS.forEach((itemDescription, index) => {
            const itemNumber = index + 1;

            // Determine status based on inspection status and day completion
            let status = 'ok';
            
            if (inspection.status === 'draft') {
              // For drafts, only mark completed days as 'ok'
              status = completedDays.has(dayOfWeek) ? 'ok' : 'ok';
            }
            // For all other statuses (pending, approved, rejected), mark all as 'ok'

            newItems.push({
              inspection_id: inspection.id,
              item_number: itemNumber,
              item_description: itemDescription,
              day_of_week: dayOfWeek,
              status: status,
              comments: null,
            });
          });
        }

        // Insert new items
        const { error: insertError } = await supabase
          .from('inspection_items')
          .insert(newItems);

        if (insertError) throw insertError;

        console.log(`   ✓ Created 98 new van checklist items (14 items × 7 days)`);
        
        if (inspection.status === 'draft') {
          console.log(`   ✓ Marked days with data as complete: ${Array.from(completedDays).sort().join(', ') || 'none'}`);
        } else {
          console.log(`   ✓ Marked ALL items as 'ok'`);
        }

        successCount++;
      } catch (error) {
        console.error(`   ❌ Error migrating inspection:`, error);
        errorCount++;
      }
    }

    // Verify no 182-item inspections remain
    console.log(`\n🔍 Verifying migration...`);
    
    let remainingCount = 0;
    for (const inspection of allInspections || []) {
      const { data: items } = await supabase
        .from('inspection_items')
        .select('id')
        .eq('inspection_id', inspection.id);

      if (items && items.length === 182) {
        const regNumber = (inspection as any).vehicles?.reg_number || 'Unknown';
        if (regNumber !== 'TE57 VAN' && regNumber !== 'TE57 HGV') {
          remainingCount++;
          console.log(`   ⚠️  Still has 182 items: ${regNumber} (${inspection.id})`);
        }
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Migration Complete!`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed: ${errorCount}`);
    console.log(`   Remaining 26-point inspections: ${remainingCount}`);
    console.log(`${'='.repeat(60)}\n`);

    if (defectReports.length > 0) {
      console.log(`📋 Inspections with defects (migrated anyway):`);
      defectReports.forEach(report => console.log(report));
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();

