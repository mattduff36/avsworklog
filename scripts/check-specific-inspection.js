const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const inspectionId = '1fde5bff-999a-4b59-95f8-679908c2cce1';

(async () => {
  console.log(`Checking inspection: ${inspectionId}\n`);
  
  // Get inspection
  const { data: inspection, error: inspectionError } = await supabase
    .from('vehicle_inspections')
    .select(`
      *,
      vehicle:vehicles(reg_number),
      profile:profiles!vehicle_inspections_user_id_fkey(full_name)
    `)
    .eq('id', inspectionId)
    .single();
  
  if (inspectionError) {
    console.error('❌ Inspection error:', inspectionError);
    return;
  }
  
  console.log('✅ Inspection found:', {
    id: inspection.id,
    status: inspection.status,
    vehicle: inspection.vehicle?.reg_number,
    profile: inspection.profile?.full_name
  });
  
  // Get items
  const { data: items, error: itemsError } = await supabase
    .from('inspection_items')
    .select('*')
    .eq('inspection_id', inspectionId);
  
  if (itemsError) {
    console.error('❌ Items error:', itemsError);
    return;
  }
  
  console.log(`✅ Found ${items?.length || 0} items`);
  
  if (items && items.length > 0) {
    console.log('Sample item:', items[0]);
  }
})();

