/**
 * Clear All Error Logs
 * 
 * Clears the entire error_logs table for a fresh start
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function clearAllErrorLogs() {
  console.log('🧹 CLEARING ALL ERROR LOGS');
  console.log('==========================\n');

  try {
    // Count current errors
    const { data: current } = await supabase
      .from('error_logs')
      .select('id');

    const currentCount = current?.length || 0;

    if (currentCount === 0) {
      console.log('✅ Error log is already empty!\n');
      return;
    }

    console.log(`Found ${currentCount} error log entries to clear\n`);

    // Delete all
    const { error } = await supabase
      .from('error_logs')
      .delete()
      .gte('timestamp', '1970-01-01');

    if (error) {
      console.error('❌ Error clearing logs:', error);
      return;
    }

    console.log(`✅ Cleared all ${currentCount} error log entries\n`);
    console.log('Fresh start! 🎉\n');

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

clearAllErrorLogs()
  .then(() => {
    console.log('Complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
