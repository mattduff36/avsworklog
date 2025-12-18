/**
 * Setup script for Toolbox Talk PDF Storage Bucket
 * Creates the toolbox-talk-pdfs bucket in Supabase Storage with RLS policies
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   - NEXT_PUBLIC_SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!connectionString) {
  console.error('❌ Missing database connection string:');
  console.error('   - POSTGRES_URL_NON_POOLING (preferred)');
  console.error('   - POSTGRES_URL (fallback)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupToolboxTalkStorage() {
  console.log('🚀 Setting up Toolbox Talk PDF Storage Bucket...\n');

  try {
    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      throw new Error(`Failed to list buckets: ${listError.message}`);
    }

    const bucketExists = buckets?.some(bucket => bucket.name === 'toolbox-talk-pdfs');

    if (bucketExists) {
      console.log('✅ Bucket "toolbox-talk-pdfs" already exists');
    } else {
      // Create bucket
      const { data: bucket, error: createError } = await supabase.storage.createBucket('toolbox-talk-pdfs', {
        public: false,
        fileSizeLimit: 10485760, // 10MB in bytes
        allowedMimeTypes: [
          'application/pdf'
        ]
      });

      if (createError) {
        throw new Error(`Failed to create bucket: ${createError.message}`);
      }

      console.log('✅ Created bucket "toolbox-talk-pdfs"');
    }

    console.log('\n📋 Bucket Configuration:');
    console.log('   - Name: toolbox-talk-pdfs');
    console.log('   - Public: No (authenticated access only)');
    console.log('   - Max file size: 10MB');
    console.log('   - Allowed types: PDF only');

    // Now create storage policies using SQL
    console.log('\n🔒 Creating Storage RLS Policies...\n');

    const url = new URL(connectionString);
    const client = new Client({
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: {
        rejectUnauthorized: false
      }
    });

    try {
      await client.connect();

      // Drop existing policies if they exist
      await client.query(`
        DROP POLICY IF EXISTS "Managers can upload toolbox talk PDFs" ON storage.objects;
        DROP POLICY IF EXISTS "Users can download assigned toolbox talk PDFs" ON storage.objects;
        DROP POLICY IF EXISTS "Managers can delete toolbox talk PDFs" ON storage.objects;
      `);

      // Create INSERT policy (upload)
      console.log('   📤 Creating upload policy...');
      await client.query(`
        CREATE POLICY "Managers can upload toolbox talk PDFs" ON storage.objects
        FOR INSERT 
        WITH CHECK (
          bucket_id = 'toolbox-talk-pdfs' AND
          EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() 
            AND role IN ('admin', 'manager')
          )
        );
      `);
      console.log('      ✅ Upload policy created');

      // Create SELECT policy (download)
      console.log('   📥 Creating download policy...');
      await client.query(`
        CREATE POLICY "Users can download assigned toolbox talk PDFs" ON storage.objects
        FOR SELECT 
        USING (
          bucket_id = 'toolbox-talk-pdfs' AND (
            -- Managers can access all
            EXISTS (
              SELECT 1 FROM profiles 
              WHERE id = auth.uid() 
              AND role IN ('admin', 'manager')
            ) OR
            -- Employees can access PDFs from messages assigned to them
            EXISTS (
              SELECT 1 FROM message_recipients mr
              JOIN messages m ON m.id = mr.message_id
              WHERE m.pdf_file_path = name
              AND mr.user_id = auth.uid()
            )
          )
        );
      `);
      console.log('      ✅ Download policy created');

      // Create DELETE policy
      console.log('   🗑️  Creating delete policy...');
      await client.query(`
        CREATE POLICY "Managers can delete toolbox talk PDFs" ON storage.objects
        FOR DELETE 
        USING (
          bucket_id = 'toolbox-talk-pdfs' AND
          EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() 
            AND role IN ('admin', 'manager')
          )
        );
      `);
      console.log('      ✅ Delete policy created');

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✨ Toolbox Talk PDF Storage setup complete!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('✅ Storage bucket created');
      console.log('✅ RLS policies configured');
      console.log('✅ Upload permissions set (managers/admins only)');
      console.log('✅ Download permissions set (assigned users + managers)');
      console.log('✅ Delete permissions set (managers/admins only)\n');

    } catch (policyError: any) {
      console.error('\n⚠️  Warning: Could not create storage policies via SQL');
      console.error('Error:', policyError.message);
      
      if (policyError.message?.includes('already exists')) {
        console.log('\n✅ Policies already exist - no action needed!\n');
      } else {
        console.log('\n📝 Manual policy creation may be required.');
        console.log('See the SQL statements in the script for reference.\n');
      }
    } finally {
      await client.end();
    }

  } catch (error) {
    console.error('❌ Error setting up Toolbox Talk PDF storage:', error);
    process.exit(1);
  }
}

setupToolboxTalkStorage();

