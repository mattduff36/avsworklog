const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Check the specific inspection from the PDF
const inspectionId = '1fde5bff-999a-4b59-95f8-679908c2cce1';

(async () => {
  console.log(`Checking items for inspection: ${inspectionId}\n`);
  
  // Get items
  const { data: items, error: itemsError } = await supabase
    .from('inspection_items')
    .select('*')
    .eq('inspection_id', inspectionId)
    .order('item_number', { ascending: true })
    .order('day_of_week', { ascending: true })
    .limit(10);
  
  if (itemsError) {
    console.error('❌ Items error:', itemsError);
    return;
  }
  
  console.log(`Found ${items.length} items (showing first 10):\n`);
  
  items.forEach(item => {
    console.log(`Item ${item.item_number}, Day ${item.day_of_week}: ${item.status}`);
  });
  
  console.log('\n---');
  console.log('Sample item object:', JSON.stringify(items[0], null, 2));
})();

