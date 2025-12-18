/**
 * Migration Script: Convert Draft Van Inspections from 26-point to 14-point Checklist
 * 
 * This script migrates existing draft Van inspections that were created with the old
 * 26-point truck checklist to use the new 14-point Van checklist.
 * 
 * Mapping Rules:
 * - Old items 1, 6, 7 (Fuel, Oil, Water) → New item 1 (Oil, Fuel & Coolant) - ANY checked = new checked
 * - Old item 2 (Mirrors) → New item 5 (Mirrors)
 * - Old item 9 (Tyres) → New item 3 (Tyres)
 * - Old item 10 (Brakes) → New item 13 (Parking Brake) AND New item 14 (Brake Test)
 * - Old item 11 (Steering) → New item 12 (Steering)
 * - Old item 12, 14 (Lights, Indicators) → New item 7 (Lights/Flashing Beacons) - ANY checked = new checked
 * - Old item 15, 16 (Wipers, Washers) → New item 4 (Windows & Wipers) - ANY checked = new checked
 * - Old item 17 (Horn) → New item 8 (Instrument Gauges/Horns)
 * 
 * New items created empty:
 * - Item 2: Wheels & Nuts
 * - Item 6: Visual Body Condition
 * - Item 9: Seat Belt
 * - Item 10: Visual Interior Condition
 * - Item 11: Locking Devices
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// New Van checklist items
const VAN_CHECKLIST = [
  'Oil, Fuel & Coolant Levels/Leaks',      // 1
  'Wheels & Nuts',                          // 2
  'Tyres',                                  // 3
  'Windows & Wipers',                       // 4
  'Mirrors',                                // 5
  'Visual Body Condition',                  // 6
  'Lights/Flashing Beacons',               // 7
  'Instrument Gauges/Horns',               // 8
  'Seat Belt',                              // 9
  'Visual Interior Condition',              // 10
  'Locking Devices',                        // 11
  'Steering',                               // 12
  'Parking Brake',                          // 13
  'Brake Test',                             // 14
];

interface InspectionItem {
  id: string;
  inspection_id: string;
  item_number: number;
  item_description: string;
  day_of_week: number;
  status: 'ok' | 'attention' | 'na';
  comments: string | null;
}

/**
 * Determine the new status for a mapped item based on old item(s)
 * Priority: attention > ok > na
 */
function mergeStatuses(statuses: ('ok' | 'attention' | 'na')[]): 'ok' | 'attention' | 'na' {
  if (statuses.includes('attention')) return 'attention';
  if (statuses.includes('ok')) return 'ok';
  return 'na';
}

/**
 * Map old inspection items to new Van checklist structure
 */
function mapOldItemsToNew(oldItems: InspectionItem[]): Map<string, InspectionItem> {
  const newItemsMap = new Map<string, InspectionItem>();
  
  // Group old items by day_of_week for easier processing
  const itemsByDay = new Map<number, InspectionItem[]>();
  oldItems.forEach(item => {
    const dayItems = itemsByDay.get(item.day_of_week) || [];
    dayItems.push(item);
    itemsByDay.set(item.day_of_week, dayItems);
  });
  
  // Process each day
  for (const [dayOfWeek, dayItems] of itemsByDay.entries()) {
    const itemsByNumber = new Map(dayItems.map(item => [item.item_number, item]));
    
    // Mapping 1: Old items 1, 6, 7 → New item 1 (Oil, Fuel & Coolant)
    const fuelStatus = itemsByNumber.get(1)?.status;
    const oilStatus = itemsByNumber.get(6)?.status;
    const waterStatus = itemsByNumber.get(7)?.status;
    if (fuelStatus || oilStatus || waterStatus) {
      const statuses = [fuelStatus, oilStatus, waterStatus].filter(Boolean) as ('ok' | 'attention' | 'na')[];
      newItemsMap.set(`${dayOfWeek}-1`, {
        id: '', // Will be generated
        inspection_id: oldItems[0].inspection_id,
        item_number: 1,
        item_description: VAN_CHECKLIST[0],
        day_of_week: dayOfWeek,
        status: mergeStatuses(statuses),
        comments: null,
      });
    }
    
    // Mapping 2: Old item 2 → New item 5 (Mirrors)
    const mirrorsItem = itemsByNumber.get(2);
    if (mirrorsItem) {
      newItemsMap.set(`${dayOfWeek}-5`, {
        ...mirrorsItem,
        item_number: 5,
        item_description: VAN_CHECKLIST[4],
      });
    }
    
    // Mapping 3: Old item 9 → New item 3 (Tyres)
    const tyresItem = itemsByNumber.get(9);
    if (tyresItem) {
      newItemsMap.set(`${dayOfWeek}-3`, {
        ...tyresItem,
        item_number: 3,
        item_description: VAN_CHECKLIST[2],
      });
    }
    
    // Mapping 4: Old item 10 → New item 13 (Parking Brake) AND New item 14 (Brake Test)
    const brakesItem = itemsByNumber.get(10);
    if (brakesItem) {
      newItemsMap.set(`${dayOfWeek}-13`, {
        ...brakesItem,
        item_number: 13,
        item_description: VAN_CHECKLIST[12],
      });
      newItemsMap.set(`${dayOfWeek}-14`, {
        ...brakesItem,
        item_number: 14,
        item_description: VAN_CHECKLIST[13],
      });
    }
    
    // Mapping 5: Old item 11 → New item 12 (Steering)
    const steeringItem = itemsByNumber.get(11);
    if (steeringItem) {
      newItemsMap.set(`${dayOfWeek}-12`, {
        ...steeringItem,
        item_number: 12,
        item_description: VAN_CHECKLIST[11],
      });
    }
    
    // Mapping 6: Old items 12, 14 → New item 7 (Lights/Flashing Beacons)
    const lightsStatus = itemsByNumber.get(12)?.status;
    const indicatorsStatus = itemsByNumber.get(14)?.status;
    if (lightsStatus || indicatorsStatus) {
      const statuses = [lightsStatus, indicatorsStatus].filter(Boolean) as ('ok' | 'attention' | 'na')[];
      newItemsMap.set(`${dayOfWeek}-7`, {
        id: '',
        inspection_id: oldItems[0].inspection_id,
        item_number: 7,
        item_description: VAN_CHECKLIST[6],
        day_of_week: dayOfWeek,
        status: mergeStatuses(statuses),
        comments: null,
      });
    }
    
    // Mapping 7: Old items 15, 16 → New item 4 (Windows & Wipers)
    const wipersStatus = itemsByNumber.get(15)?.status;
    const washersStatus = itemsByNumber.get(16)?.status;
    if (wipersStatus || washersStatus) {
      const statuses = [wipersStatus, washersStatus].filter(Boolean) as ('ok' | 'attention' | 'na')[];
      newItemsMap.set(`${dayOfWeek}-4`, {
        id: '',
        inspection_id: oldItems[0].inspection_id,
        item_number: 4,
        item_description: VAN_CHECKLIST[3],
        day_of_week: dayOfWeek,
        status: mergeStatuses(statuses),
        comments: null,
      });
    }
    
    // Mapping 8: Old item 17 → New item 8 (Instrument Gauges/Horns)
    const hornItem = itemsByNumber.get(17);
    if (hornItem) {
      newItemsMap.set(`${dayOfWeek}-8`, {
        ...hornItem,
        item_number: 8,
        item_description: VAN_CHECKLIST[7],
      });
    }
    
    // Create new empty items for Van-specific checks (items 2, 6, 9, 10, 11)
    const newEmptyItems = [2, 6, 9, 10, 11];
    for (const itemNum of newEmptyItems) {
      if (!newItemsMap.has(`${dayOfWeek}-${itemNum}`)) {
        newItemsMap.set(`${dayOfWeek}-${itemNum}`, {
          id: '',
          inspection_id: oldItems[0].inspection_id,
          item_number: itemNum,
          item_description: VAN_CHECKLIST[itemNum - 1],
          day_of_week: dayOfWeek,
          status: 'na',
          comments: null,
        });
      }
    }
  }
  
  return newItemsMap;
}

async function migrateVanInspections() {
  console.log('🚐 Starting Van Inspection Migration...\n');
  
  try {
    // Step 1: Find all draft Van inspections
    console.log('📋 Step 1: Finding draft Van inspections...');
    const { data: inspections, error: inspectionsError } = await supabase
      .from('vehicle_inspections')
      .select(`
        id,
        vehicle_id,
        inspection_date,
        vehicles!inner (
          reg_number,
          vehicle_type,
          vehicle_categories (name)
        )
      `)
      .eq('status', 'draft');
    
    if (inspectionsError) throw inspectionsError;
    
    // Filter to only Van inspections
    const vanInspections = inspections?.filter(insp => {
      const vehicle = insp.vehicles as any;
      const categoryName = vehicle?.vehicle_categories?.name || vehicle?.vehicle_type;
      return categoryName === 'Van';
    }) || [];
    
    console.log(`   Found ${vanInspections.length} draft Van inspection(s)\n`);
    
    if (vanInspections.length === 0) {
      console.log('✅ No Van inspections to migrate. Exiting.');
      return;
    }
    
    // Step 2: Process each inspection
    let migrated = 0;
    let failed = 0;
    
    for (const inspection of vanInspections) {
      const vehicle = inspection.vehicles as any;
      const regNumber = vehicle?.reg_number || 'Unknown';
      
      console.log(`\n🔄 Processing: ${regNumber} (${inspection.id.slice(0, 8)}...)`);
      
      try {
        // Get old inspection items
        const { data: oldItems, error: oldItemsError } = await supabase
          .from('inspection_items')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('item_number');
        
        if (oldItemsError) throw oldItemsError;
        
        console.log(`   Old items: ${oldItems?.length || 0}`);
        
        if (!oldItems || oldItems.length === 0) {
          console.log('   ⚠️  No items found, skipping...');
          continue;
        }
        
        // Map old items to new structure
        const newItemsMap = mapOldItemsToNew(oldItems as InspectionItem[]);
        const newItems = Array.from(newItemsMap.values());
        
        console.log(`   New items: ${newItems.length}`);
        
        // Delete old items
        const { error: deleteError } = await supabase
          .from('inspection_items')
          .delete()
          .eq('inspection_id', inspection.id);
        
        if (deleteError) throw deleteError;
        console.log('   ✓ Deleted old items');
        
        // Insert new items
        const { error: insertError } = await supabase
          .from('inspection_items')
          .insert(newItems.map(item => ({
            inspection_id: item.inspection_id,
            item_number: item.item_number,
            item_description: item.item_description,
            day_of_week: item.day_of_week,
            status: item.status,
            comments: item.comments,
          })));
        
        if (insertError) throw insertError;
        console.log('   ✓ Inserted new items');
        
        migrated++;
        console.log(`   ✅ Migration complete for ${regNumber}`);
        
      } catch (error) {
        failed++;
        console.error(`   ❌ Failed to migrate ${regNumber}:`, error);
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully migrated: ${migrated}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📝 Total processed: ${vanInspections.length}`);
    console.log('='.repeat(60) + '\n');
    
    if (migrated > 0) {
      console.log('✨ Migration completed successfully!');
      console.log('👉 Users can now continue their draft Van inspections with the new 14-point checklist.\n');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
migrateVanInspections()
  .then(() => {
    console.log('🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });

