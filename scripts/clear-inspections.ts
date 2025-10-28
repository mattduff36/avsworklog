import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
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

    // Delete vehicle inspections
    const { error: inspectionsError } = await supabase
      .from('vehicle_inspections')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (inspectionsError) {
      console.error('❌ Error deleting vehicle inspections:', inspectionsError);
      throw inspectionsError;
    }
    console.log('✅ Deleted all vehicle inspections');

    // Delete actions related to inspections
    const { error: actionsError } = await supabase
      .from('actions')
      .delete()
      .eq('source_type', 'inspection');

    if (actionsError) {
      console.error('❌ Error deleting inspection actions:', actionsError);
      throw actionsError;
    }
    console.log('✅ Deleted all inspection-related actions');

    console.log('\n✅ All inspection data cleared successfully!');
  } catch (error) {
    console.error('❌ Error clearing inspection data:', error);
    process.exit(1);
  }
}

clearInspections();

