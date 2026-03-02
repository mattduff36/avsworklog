// @ts-nocheck
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

// Create admin client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function setupStorage() {
  console.log('🚀 Setting up Supabase Storage...\n');

  try {
    // Check if bucket already exists
    const { data: existingBuckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      throw listError;
    }

    const bucketExists = existingBuckets?.some(bucket => bucket.name === 'inspection-photos');

    if (bucketExists) {
      console.log('✅ Bucket "inspection-photos" already exists');
    } else {
      // Create the bucket
      console.log('📦 Creating bucket "inspection-photos"...');
      const { data: bucket, error: createError } = await supabase.storage.createBucket('inspection-photos', {
        public: true,
        fileSizeLimit: 5242880, // 5MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
      });

      if (createError) {
        throw createError;
      }

      console.log('✅ Bucket created successfully');
    }

    console.log('\n📋 Bucket Configuration:');
    console.log('   Name: inspection-photos');
    console.log('   Public: Yes ✓');
    console.log('   Max File Size: 5MB');
    console.log('   Allowed Types: PNG, JPEG, WebP');

    console.log('\n🎉 Storage setup complete!');
    console.log('\nYou can now:');
    console.log('   ✓ Upload photos in vehicle inspections');
    console.log('   ✓ View photos in the inspection details page');
    console.log('   ✓ Delete photos as needed');

  } catch (error) {
    console.error('\n❌ Error setting up storage:', error);
    process.exit(1);
  }
}

setupStorage();

