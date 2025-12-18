#!/usr/bin/env node
/**
 * Clear duplicate "Failed to fetch" network errors from error logs
 * These are expected errors when dev server is stopped
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function clearNetworkErrors() {
  try {
    console.log('🔍 Finding duplicate "Failed to fetch" network errors...\n');

    // Find all network errors with "Failed to fetch"
    const { data: errors, error: fetchError } = await supabase
      .from('error_logs')
      .select('*')
      .ilike('error_message', '%Failed to fetch%')
      .ilike('error_message', '%/api/messages/notifications%')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Error fetching error logs:', fetchError);
      process.exit(1);
    }

    if (!errors || errors.length === 0) {
      console.log('✅ No network errors found to clear!');
      return;
    }

    console.log(`📊 Found ${errors.length} duplicate network error(s):`);
    console.log(`   First: ${new Date(errors[errors.length - 1].created_at).toLocaleString()}`);
    console.log(`   Last:  ${new Date(errors[0].created_at).toLocaleString()}`);
    console.log(`   User:  ${errors[0].user_email || 'Unknown'}\n`);

    // Delete these errors
    const errorIds = errors.map(e => e.id);
    const { error: deleteError } = await supabase
      .from('error_logs')
      .delete()
      .in('id', errorIds);

    if (deleteError) {
      console.error('❌ Error deleting error logs:', deleteError);
      process.exit(1);
    }

    console.log(`✅ Successfully cleared ${errors.length} network error log(s)!`);
    console.log('🎉 Error log is now clean!\n');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Run the cleanup
clearNetworkErrors().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

