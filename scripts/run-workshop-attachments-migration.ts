import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260122_workshop_attachments.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

// Seed data for Full Service template
const fullServiceQuestions = [
  'Vehicle details recorded',
  'Mileage recorded',
  'Service date recorded',
  'Engine oil drained',
  'Engine oil replaced',
  'Oil filter replaced',
  'Air filter inspected',
  'Air filter replaced',
  'Fuel filter replaced',
  'Cabin filter replaced',
  'Spark plugs inspected or replaced',
  'Glow plugs tested if diesel',
  'Cooling system inspected',
  'Coolant level checked',
  'Coolant condition checked',
  'Brake fluid level checked',
  'Brake fluid condition checked',
  'Power steering fluid checked',
  'Washer fluid topped up',
  'Auxiliary drive belt inspected',
  'Timing belt service status checked',
  'Battery health tested',
  'Battery terminals cleaned',
  'Brake pads inspected front',
  'Brake pads inspected rear',
  'Brake discs inspected',
  'Brake lines inspected',
  'Tyres inspected for wear',
  'Tyre pressures set',
  'Spare tyre inspected',
  'Steering components inspected',
  'Suspension components inspected',
  'Exhaust system inspected',
  'Lights checked exterior',
  'Lights checked interior',
  'Wipers inspected',
  'Wiper blades replaced',
  'Horn tested',
  'OBD fault codes scanned',
  'Service indicator reset',
  'Road test completed',
  'Service checklist signed off',
];

// Seed data for Basic Service template
const basicServiceQuestions = [
  'Vehicle details recorded',
  'Mileage recorded',
  'Service date recorded',
  'Engine oil replaced',
  'Oil filter replaced',
  'Fluid levels checked',
  'Coolant level checked',
  'Brake fluid level checked',
  'Washer fluid topped up',
  'Tyres inspected',
  'Tyre pressures set',
  'Brake pads visually inspected',
  'Lights checked exterior',
  'Wipers inspected',
  'Battery visual check',
  'OBD fault codes scanned',
  'Service indicator reset',
  'Road test completed',
  'Service checklist signed off',
];

async function runMigration() {
  console.log('🚀 Running Workshop Attachments Migration...\n');

  // Parse connection string with SSL config
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
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📋 Summary:');
    console.log('   - Created workshop_attachment_templates table');
    console.log('   - Created workshop_attachment_questions table');
    console.log('   - Created workshop_task_attachments table');
    console.log('   - Created workshop_attachment_responses table');
    console.log('   - Added RLS policies for all tables');
    console.log('   - Created indexes for performance');
    console.log('   - Added updated_at triggers\n');

    // Seed the starter templates
    console.log('🌱 Seeding starter templates...\n');

    // Create Full Service template
    const fullServiceResult = await client.query(`
      INSERT INTO workshop_attachment_templates (name, description, is_active)
      VALUES ($1, $2, true)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, ['Vehicle Van Full Service', 'Comprehensive vehicle service checklist covering all major systems and components']);

    if (fullServiceResult.rows.length > 0) {
      const fullServiceId = fullServiceResult.rows[0].id;
      console.log('   ✅ Created "Vehicle Van Full Service" template');

      // Insert questions
      for (let i = 0; i < fullServiceQuestions.length; i++) {
        await client.query(`
          INSERT INTO workshop_attachment_questions (template_id, question_text, question_type, is_required, sort_order)
          VALUES ($1, $2, 'checkbox', false, $3)
          ON CONFLICT DO NOTHING
        `, [fullServiceId, fullServiceQuestions[i], i + 1]);
      }
      console.log(`   ✅ Added ${fullServiceQuestions.length} questions to Full Service template`);
    } else {
      console.log('   ⏭️  Full Service template already exists, skipping');
    }

    // Create Basic Service template
    const basicServiceResult = await client.query(`
      INSERT INTO workshop_attachment_templates (name, description, is_active)
      VALUES ($1, $2, true)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, ['Vehicle Van Basic Service', 'Core safety and maintenance checklist for basic vehicle services']);

    if (basicServiceResult.rows.length > 0) {
      const basicServiceId = basicServiceResult.rows[0].id;
      console.log('   ✅ Created "Vehicle Van Basic Service" template');

      // Insert questions
      for (let i = 0; i < basicServiceQuestions.length; i++) {
        await client.query(`
          INSERT INTO workshop_attachment_questions (template_id, question_text, question_type, is_required, sort_order)
          VALUES ($1, $2, 'checkbox', false, $3)
          ON CONFLICT DO NOTHING
        `, [basicServiceId, basicServiceQuestions[i], i + 1]);
      }
      console.log(`   ✅ Added ${basicServiceQuestions.length} questions to Basic Service template`);
    } else {
      console.log('   ⏭️  Basic Service template already exists, skipping');
    }

    console.log('\n🎉 Workshop Attachments feature is ready!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
