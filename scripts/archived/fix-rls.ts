import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixRLS() {
  console.log('🔧 Fixing RLS policies...\n');

  const sql = readFileSync(resolve(process.cwd(), 'supabase/fix-rls-policies.sql'), 'utf-8');
  
  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql_string: sql });
    
    if (error) {
      console.error('❌ Error:', error);
      console.log('\n⚠️  Please run the SQL manually in Supabase Dashboard:');
      console.log('   https://supabase.com/dashboard/project/lrhufzqfzeutgvudcowy/sql/new\n');
    } else {
      console.log('✅ RLS policies fixed successfully!');
    }
  } catch (error) {
    console.error('❌ Error:', error);
    console.log('\n⚠️  Please run supabase/fix-rls-policies.sql manually in Supabase Dashboard\n');
  }
}

fixRLS();

