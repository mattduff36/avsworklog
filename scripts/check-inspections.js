const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

(async () => {
  const { data: inspections } = await supabase
    .from('vehicle_inspections')
    .select('id, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('Remaining inspections:');
  for (const insp of inspections) {
    const { count } = await supabase
      .from('inspection_items')
      .select('*', { count: 'exact', head: true })
      .eq('inspection_id', insp.id);
    
    const shortId = insp.id.substring(0, 8);
    console.log(`  ${shortId}... (${insp.status}): ${count} items`);
  }
})();

