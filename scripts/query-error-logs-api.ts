/**
 * Query error logs from the database using API
 * This script queries errors from December 8th, 2025 11am onwards
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function queryErrorLogs() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Not set');
    console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? 'Set' : 'Not set');
    process.exit(1);
  }

  try {
    // Use fetch to query via REST API
    const response = await fetch(
      `${supabaseUrl}/rest/v1/error_logs?timestamp=gte.2025-12-08T11:00:00&order=timestamp.desc`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    console.log(`\nFound ${data.length} error(s) from 08/12/2025 11:00 onwards:\n`);
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error querying error logs:', error);
    process.exit(1);
  }
}

queryErrorLogs();
