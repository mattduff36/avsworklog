import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl!, supabaseServiceKey!, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function clearInspections() {
  console.log('🗑️  Clearing all inspection data...\n');

  try {
    // Delete inspection items first (due to foreign key constraints)
    const { error: itemsError } = await supabase
      .from('inspection_items')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (itemsError) {
      console.error('❌ Error deleting inspection items:', itemsError);
      throw itemsError;
    }
    console.log('✅ Deleted all inspection items');

    // Delete van inspections
    const { error: vanInspectionsError } = await supabase
      .from('van_inspections')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (vanInspectionsError) {
      console.error('❌ Error deleting van inspections:', vanInspectionsError);
      throw vanInspectionsError;
    }
    console.log('✅ Deleted all van inspections');

    // Delete plant inspections
    const { error: plantInspectionsError } = await supabase
      .from('plant_inspections')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (plantInspectionsError) {
      console.error('❌ Error deleting plant inspections:', plantInspectionsError);
      throw plantInspectionsError;
    }
    console.log('✅ Deleted all plant inspections');

    // Delete actions related to inspections
    const { error: actionsError } = await supabase
      .from('actions')
      .delete()
      .not('inspection_id', 'is', null);

    if (actionsError) {
      console.error('❌ Error deleting inspection actions:', actionsError);
      throw actionsError;
    }
    console.log('✅ Deleted all inspection-related actions');

    console.log('\n✅ All inspection data cleared successfully!');
  } catch (err: unknown) {
    console.error('❌ Error clearing inspection data:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

clearInspections();

