import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function checkInspectionDefects() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
  }

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
    console.log('🔌 Connecting to database...\n');
    await client.connect();

    // Check inspection statuses
    console.log('📊 Inspection Statuses:');
    const statusQuery = `
      SELECT status, COUNT(*) as count
      FROM vehicle_inspections
      GROUP BY status
      ORDER BY count DESC;
    `;
    const statusResult = await client.query(statusQuery);
    statusResult.rows.forEach(row => {
      console.log(`  ${row.status}: ${row.count}`);
    });

    // Check inspection_items statuses
    console.log('\n📊 Inspection Item Statuses:');
    const itemStatusQuery = `
      SELECT status, COUNT(*) as count
      FROM inspection_items
      GROUP BY status
      ORDER BY count DESC;
    `;
    const itemStatusResult = await client.query(itemStatusQuery);
    itemStatusResult.rows.forEach(row => {
      console.log(`  ${row.status}: ${row.count}`);
    });

    // Check submitted inspections
    console.log('\n📋 Submitted Inspections:');
    const submittedQuery = `
      SELECT 
        vi.id,
        vi.inspection_date,
        v.reg_number,
        p.full_name,
        COUNT(CASE WHEN ii.status = 'defect' THEN 1 END) as defects,
        COUNT(CASE WHEN ii.status = 'attention' THEN 1 END) as attention,
        COUNT(ii.id) as total_items
      FROM vehicle_inspections vi
      LEFT JOIN vehicles v ON vi.vehicle_id = v.id
      LEFT JOIN profiles p ON vi.user_id = p.id
      LEFT JOIN inspection_items ii ON vi.id = ii.inspection_id
      WHERE vi.status = 'submitted'
      GROUP BY vi.id, vi.inspection_date, v.reg_number, p.full_name
      ORDER BY vi.inspection_date DESC
      LIMIT 10;
    `;
    const submittedResult = await client.query(submittedQuery);
    
    if (submittedResult.rows.length === 0) {
      console.log('  No submitted inspections found.');
    } else {
      submittedResult.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. ${row.reg_number} - ${row.inspection_date}`);
        console.log(`     Inspector: ${row.full_name || 'Unknown'}`);
        console.log(`     Items: ${row.total_items} total, ${row.defects} defects, ${row.attention} attention`);
      });
    }

    // Check actions
    console.log('\n📋 Actions Count:');
    const actionsQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(inspection_id) as with_inspection
      FROM actions;
    `;
    const actionsResult = await client.query(actionsQuery);
    const actions = actionsResult.rows[0];
    console.log(`  Total actions: ${actions.total}`);
    console.log(`  Actions linked to inspections: ${actions.with_inspection}`);

    // Check for submitted inspections with attention items but no actions
    console.log('\n🔍 Submitted Inspections with "attention" items (no actions):');
    const attentionQuery = `
      SELECT 
        vi.id,
        vi.inspection_date,
        v.reg_number,
        p.full_name,
        COUNT(ii.id) as attention_count
      FROM vehicle_inspections vi
      INNER JOIN inspection_items ii ON vi.id = ii.inspection_id
      LEFT JOIN vehicles v ON vi.vehicle_id = v.id
      LEFT JOIN profiles p ON vi.user_id = p.id
      LEFT JOIN actions a ON vi.id = a.inspection_id
      WHERE vi.status = 'submitted'
        AND ii.status = 'attention'
        AND a.id IS NULL
      GROUP BY vi.id, vi.inspection_date, v.reg_number, p.full_name
      ORDER BY vi.inspection_date DESC;
    `;
    const attentionResult = await client.query(attentionQuery);
    
    if (attentionResult.rows.length === 0) {
      console.log('  ✅ No submitted inspections with attention items missing actions.');
    } else {
      console.log(`  ⚠️  Found ${attentionResult.rows.length} inspections:\n`);
      attentionResult.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. ${row.reg_number} - ${row.inspection_date} (${row.attention_count} attention items)`);
        console.log(`     Inspector: ${row.full_name || 'Unknown'}`);
      });
    }

  } catch (error) {
    console.error('❌ Check failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

checkInspectionDefects();
