import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function backfillInspectionActions() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
  }

  // Parse connection string and rebuild with explicit SSL config
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
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Step 1: Find all submitted inspections with attention items (defects)
    console.log('🔍 Finding submitted inspections with defects (attention items)...\n');
    
    const inspectionsQuery = `
      SELECT DISTINCT
        vi.id,
        vi.vehicle_id,
        vi.user_id,
        vi.inspection_date,
        v.reg_number,
        p.full_name as inspector_name,
        COUNT(ii.id) as defect_count
      FROM vehicle_inspections vi
      INNER JOIN inspection_items ii ON vi.id = ii.inspection_id
      INNER JOIN vehicles v ON vi.vehicle_id = v.id
      LEFT JOIN profiles p ON vi.user_id = p.id
      WHERE vi.status = 'submitted'
        AND ii.status = 'attention'
      GROUP BY vi.id, vi.vehicle_id, vi.user_id, vi.inspection_date, v.reg_number, p.full_name
      ORDER BY vi.inspection_date DESC;
    `;

    const inspectionsResult = await client.query(inspectionsQuery);
    const inspections = inspectionsResult.rows;

    console.log(`📋 Found ${inspections.length} submitted inspections with attention items:\n`);
    
    if (inspections.length === 0) {
      console.log('✅ No inspections need actions created.\n');
      return;
    }

    inspections.forEach((insp, idx) => {
      console.log(`  ${idx + 1}. ${insp.reg_number} - ${insp.inspection_date} (${insp.defect_count} attention items) - Inspector: ${insp.inspector_name || 'Unknown'}`);
    });

    console.log('\n🔍 Checking which inspections already have actions...\n');

    // Step 2: Check which inspections already have actions
    const actionsQuery = `
      SELECT inspection_id 
      FROM actions 
      WHERE inspection_id = ANY($1);
    `;

    const inspectionIds = inspections.map(i => i.id);
    const actionsResult = await client.query(actionsQuery, [inspectionIds]);
    const existingActionInspections = new Set(actionsResult.rows.map(a => a.inspection_id));

    const inspectionsNeedingActions = inspections.filter(i => !existingActionInspections.has(i.id));

    console.log(`✅ ${existingActionInspections.size} inspections already have actions`);
    console.log(`⚠️  ${inspectionsNeedingActions.length} inspections need actions created\n`);

    if (inspectionsNeedingActions.length === 0) {
      console.log('✅ All inspections already have actions. Nothing to do!\n');
      return;
    }

    console.log('📝 Creating actions for inspections without them:\n');

    // Step 3: Create actions for inspections that don't have them
    let createdCount = 0;
    let errorCount = 0;

    for (const inspection of inspectionsNeedingActions) {
      try {
        // Get attention item (defect) details for the description
        const defectsQuery = `
          SELECT item_number, item_description, comments, day_of_week
          FROM inspection_items
          WHERE inspection_id = $1 AND status = 'attention'
          ORDER BY item_number, day_of_week;
        `;

        const defectsResult = await client.query(defectsQuery, [inspection.id]);
        const defects = defectsResult.rows;

        // Group defects by item_number and description to consolidate duplicates
        const groupedDefects = new Map<string, { 
          item_number: number; 
          item_description: string; 
          days: number[]; 
          comments: string[];
        }>();

        defects.forEach(d => {
          const key = `${d.item_number}-${d.item_description}`;
          if (!groupedDefects.has(key)) {
            groupedDefects.set(key, {
              item_number: d.item_number,
              item_description: d.item_description,
              days: [],
              comments: []
            });
          }
          const group = groupedDefects.get(key)!;
          group.days.push(d.day_of_week);
          if (d.comments) {
            group.comments.push(d.comments);
          }
        });

        // Build consolidated description
        const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const defectsList = Array.from(groupedDefects.values()).map(group => {
          let dayRange: string;
          if (group.days.length === 1) {
            dayRange = dayNames[group.days[0]] || `Day ${group.days[0] + 1}`;
          } else if (group.days.length > 1) {
            const firstDay = dayNames[group.days[0]] || `Day ${group.days[0] + 1}`;
            const lastDay = dayNames[group.days[group.days.length - 1]] || `Day ${group.days[group.days.length - 1] + 1}`;
            dayRange = `${firstDay.substring(0, 3)}-${lastDay.substring(0, 3)}`;
          } else {
            dayRange = 'Unknown';
          }

          const comment = group.comments.length > 0 ? ` - ${group.comments[0]}` : '';
          return `Item ${group.item_number} - ${group.item_description} (${dayRange})${comment}`;
        }).join('\n');

        const description = `Vehicle inspection defects found:\n${defectsList}`;
        const uniqueDefectCount = groupedDefects.size;

        // Create action
        const insertQuery = `
          INSERT INTO actions (
            title,
            description,
            inspection_id,
            status,
            priority,
            created_by,
            created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7
          ) RETURNING id;
        `;

        const title = `${inspection.reg_number} - Inspection Defects (${uniqueDefectCount} issue${uniqueDefectCount > 1 ? 's' : ''})`;
        
        const insertResult = await client.query(insertQuery, [
          title,
          description,
          inspection.id,
          'pending',
          'high',
          inspection.user_id,
          new Date().toISOString()
        ]);

        const actionId = insertResult.rows[0].id;

        console.log(`  ✅ Created action for ${inspection.reg_number} (${inspection.inspection_date.toISOString().split('T')[0]}) - ${uniqueDefectCount} unique defects - Action ID: ${actionId.substring(0, 8)}...`);
        createdCount++;

      } catch (error) {
        console.error(`  ❌ Failed to create action for ${inspection.reg_number}:`, error);
        errorCount++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`  ✅ Successfully created: ${createdCount} actions`);
    if (errorCount > 0) {
      console.log(`  ❌ Failed: ${errorCount} actions`);
    }
    console.log(`  📋 Total inspections processed: ${inspections.length}`);
    console.log(`  🔄 Already had actions: ${existingActionInspections.size}`);

    console.log('\n✅ Backfill completed successfully!');

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

backfillInspectionActions();
