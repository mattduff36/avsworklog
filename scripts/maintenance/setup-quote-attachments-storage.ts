/**
 * Setup script for Quote Attachments Storage Bucket
 * Creates the quote-attachments bucket and manager/admin RLS policies.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:');
  console.error('  - NEXT_PUBLIC_SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!connectionString) {
  console.error('Missing database connection string:');
  console.error('  - POSTGRES_URL_NON_POOLING (preferred)');
  console.error('  - POSTGRES_URL (fallback)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupQuoteAttachmentsStorage() {
  console.log('Setting up Quote Attachments Storage Bucket...\n');

  try {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) {
      throw new Error(`Failed to list buckets: ${listError.message}`);
    }

    const bucketExists = buckets?.some(bucket => bucket.name === 'quote-attachments');
    if (bucketExists) {
      console.log('Bucket "quote-attachments" already exists');
    } else {
      const { error: createError } = await supabase.storage.createBucket('quote-attachments', {
        public: false,
        fileSizeLimit: 26214400,
      });

      if (createError) {
        throw new Error(`Failed to create bucket: ${createError.message}`);
      }

      console.log('Created bucket "quote-attachments"');
    }

    const url = new URL(connectionString as string);
    const client = new Client({
      host: url.hostname,
      port: Number.parseInt(url.port, 10) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();

      await client.query(`
        DROP POLICY IF EXISTS "Managers can upload quote attachments" ON storage.objects;
        DROP POLICY IF EXISTS "Managers can read quote attachments" ON storage.objects;
        DROP POLICY IF EXISTS "Managers can delete quote attachments" ON storage.objects;
      `);

      await client.query(`
        CREATE POLICY "Managers can upload quote attachments" ON storage.objects
        FOR INSERT
        WITH CHECK (
          bucket_id = 'quote-attachments' AND
          effective_is_manager_admin()
        );
      `);

      await client.query(`
        CREATE POLICY "Managers can read quote attachments" ON storage.objects
        FOR SELECT
        USING (
          bucket_id = 'quote-attachments' AND
          effective_is_manager_admin()
        );
      `);

      await client.query(`
        CREATE POLICY "Managers can delete quote attachments" ON storage.objects
        FOR DELETE
        USING (
          bucket_id = 'quote-attachments' AND
          effective_is_manager_admin()
        );
      `);

      console.log('Storage policies configured');
    } finally {
      await client.end();
    }

    console.log('\nQuote attachment storage setup complete.\n');
  } catch (err: unknown) {
    console.error('Error setting up quote attachment storage:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

setupQuoteAttachmentsStorage();
