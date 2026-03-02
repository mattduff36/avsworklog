/**
 * Audit how vehicle registrations are stored in the database
 * Check for inconsistent formatting
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function auditRegistrationFormats() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found');
    process.exit(1);
  }

  const url = new URL(connectionString);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    console.log('🔍 Auditing Vehicle Registration Formats');
    console.log('='.repeat(70));

    // Get all vehicles
    const result = await client.query(`
      SELECT 
        id,
        reg_number,
        status,
        created_at
      FROM vehicles
      ORDER BY reg_number
    `);

    console.log(`\n📊 Found ${result.rows.length} vehicles total\n`);

    // Categorize by format
    const withSpace: string[] = [];
    const withoutSpace: string[] = [];
    const nonStandard: string[] = [];

    for (const vehicle of result.rows) {
      const reg = vehicle.reg_number;
      const regTrimmed = reg.trim();
      
      // Check if it matches UK format with space (e.g., "AA12 AAA")
      if (/^[A-Z]{2}\d{2}\s[A-Z]{3}$/.test(regTrimmed)) {
        withSpace.push(reg);
      }
      // Check if it matches UK format without space (e.g., "AA12AAA")
      else if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(regTrimmed)) {
        withoutSpace.push(reg);
      }
      // Everything else (older formats, custom plates, etc.)
      else {
        nonStandard.push(reg);
      }
    }

    // Report findings
    console.log('📋 Format Analysis:\n');
    console.log(`✅ Modern UK format WITH space (AA12 AAA): ${withSpace.length} vehicles`);
    if (withSpace.length > 0 && withSpace.length <= 10) {
      withSpace.forEach(reg => console.log(`   - ${reg}`));
    } else if (withSpace.length > 10) {
      withSpace.slice(0, 5).forEach(reg => console.log(`   - ${reg}`));
      console.log(`   ... and ${withSpace.length - 5} more`);
    }

    console.log(`\n⚠️  Modern UK format WITHOUT space (AA12AAA): ${withoutSpace.length} vehicles`);
    if (withoutSpace.length > 0) {
      withoutSpace.forEach(reg => console.log(`   - ${reg}`));
    }

    console.log(`\n📝 Non-standard/older formats: ${nonStandard.length} vehicles`);
    if (nonStandard.length > 0 && nonStandard.length <= 15) {
      nonStandard.forEach(reg => console.log(`   - ${reg}`));
    } else if (nonStandard.length > 15) {
      nonStandard.slice(0, 10).forEach(reg => console.log(`   - ${reg}`));
      console.log(`   ... and ${nonStandard.length - 10} more`);
    }

    // Analysis
    console.log('\n' + '='.repeat(70));
    console.log('\n🎯 ANALYSIS:\n');

    if (withoutSpace.length === 0 && withSpace.length > 0) {
      console.log('✅ GOOD: All modern plates are stored WITH spaces');
      console.log('   This is the correct UK standard format');
      console.log('   External APIs will need spaces stripped before calling');
    } else if (withSpace.length === 0 && withoutSpace.length > 0) {
      console.log('⚠️  All modern plates are stored WITHOUT spaces');
      console.log('   This works for API calls but not ideal for display');
      console.log('   Frontend should add spaces for display');
    } else if (withSpace.length > 0 && withoutSpace.length > 0) {
      console.log('❌ INCONSISTENT: Some plates have spaces, some don\'t');
      console.log('   This could cause issues with:');
      console.log('   - Duplicate detection');
      console.log('   - Vehicle lookups');
      console.log('   - API calls');
      console.log('\n💡 RECOMMENDATION: Standardize to WITH spaces in database');
      console.log('   - Easier to read');
      console.log('   - UK standard format');
      console.log('   - Strip spaces before external API calls');
    }

    // Check for potential duplicates (ignoring spaces)
    console.log('\n\n🔄 Checking for potential duplicates (ignoring spaces)...\n');
    
    const normalizedMap = new Map<string, string[]>();
    for (const vehicle of result.rows) {
      const normalized = vehicle.reg_number.replace(/\s+/g, '').toUpperCase();
      if (!normalizedMap.has(normalized)) {
        normalizedMap.set(normalized, []);
      }
      normalizedMap.get(normalized)!.push(vehicle.reg_number);
    }

    const duplicates = Array.from(normalizedMap.entries()).filter(([_, regs]) => regs.length > 1);
    
    if (duplicates.length > 0) {
      console.log('⚠️  Found potential duplicates:\n');
      duplicates.forEach(([normalized, regs]) => {
        console.log(`   ${normalized}:`);
        regs.forEach(reg => console.log(`     - "${reg}"`));
      });
    } else {
      console.log('✅ No duplicates found (even when ignoring spaces)');
    }

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

auditRegistrationFormats();

