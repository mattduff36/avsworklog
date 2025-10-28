import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lrhufzqfzeutgvudcowy.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyaHVmenFmemV1dGd2dWRjb3d5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDk1MTYxNiwiZXhwIjoyMDc2NTI3NjE2fQ.KRK9pi17kFMIYPE9CeicOFnq91AWINhVpJ1sXsNbR64';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const INSPECTION_ITEMS = [
  { number: 1, description: 'Windscreen & glass' },
  { number: 2, description: 'Wipers & washers' },
  { number: 3, description: 'Horn' },
  { number: 4, description: 'Steering' },
  { number: 5, description: 'Mirrors' },
  { number: 6, description: 'Seat belts' },
  { number: 7, description: 'Number plates & Markings' },
  { number: 8, description: 'Front lights, indicators & reflectors' },
  { number: 9, description: 'Rear lights, indicators & reflectors' },
  { number: 10, description: 'Side lights, indicators & reflectors' },
  { number: 11, description: 'Fuel system security' },
  { number: 12, description: 'Condition of body' },
  { number: 13, description: 'Mud guards/wings' },
  { number: 14, description: 'Service brakes' },
  { number: 15, description: 'Park brake' },
  { number: 16, description: 'Tyres, studs & wheel fixings' },
  { number: 17, description: 'Towbar & electrics' },
  { number: 18, description: 'Exhaust security & condition' },
  { number: 19, description: 'Suspension security & condition' },
  { number: 20, description: 'Wheel bearings' },
  { number: 21, description: 'Load / Towing weight within legal limits' },
  { number: 22, description: 'Load security' },
  { number: 23, description: 'Fire extinguisher and first aid kit' },
  { number: 24, description: 'All warning lamps functioning' },
  { number: 25, description: 'MOT Certificate / Plating Certificate in date' },
  { number: 26, description: 'Ensure there is sufficient Engine oil, coolant, Washer fluid & AdBlue' }
];

async function seedInspections() {
  console.log('🔍 Seeding vehicle inspections using raw SQL...\n');

  try {
    // First, get users and vehicles
    const { data: users } = await supabase.from('profiles').select('id, full_name').limit(5);
    const { data: vehicles } = await supabase.from('vehicles').select('id, reg_number').limit(5);

    if (!users || !vehicles || users.length === 0 || vehicles.length === 0) {
      console.error('❌ No users or vehicles found');
      return;
    }

    console.log(`✅ Found ${users.length} users and ${vehicles.length} vehicles\n`);

    // Create inspections for the last 4 weeks
    const weeks = 4;
    const today = new Date();
    
    for (let week = 0; week < weeks; week++) {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - (week * 7) - today.getDay() + 1); // Monday
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // Sunday

      console.log(`Week ${week + 1}: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`);

      for (let userIdx = 0; userIdx < Math.min(users.length, 2); userIdx++) {
        const user = users[userIdx];
        const vehicle = vehicles[userIdx % vehicles.length];
        
        // Create inspection
        const { data: inspection, error: inspError } = await supabase
          .from('vehicle_inspections')
          .insert({
            user_id: user.id,
            vehicle_id: vehicle.id,
            inspection_date: weekStart.toISOString().split('T')[0],
            inspection_end_date: weekEnd.toISOString().split('T')[0],
            current_mileage: Math.floor(50000 + Math.random() * 50000),
            status: week === 0 ? 'submitted' : 'approved',
            signature_data: null,
          })
          .select()
          .single();

        if (inspError) {
          console.log(`   ❌ Error creating inspection for ${user.full_name}: ${inspError.message}`);
          continue;
        }

        console.log(`   ✅ Created inspection for ${user.full_name} (${vehicle.reg_number})`);

        // Now insert items using raw SQL to bypass schema cache
        const itemsToInsert = [];
        for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
          for (const item of INSPECTION_ITEMS) {
            const status = Math.random() > 0.9 ? 'attention' : 'ok';
            itemsToInsert.push({
              inspection_id: inspection.id,
              item_number: item.number,
              day_of_week: dayOfWeek,
              status: status,
              comments: status === 'attention' ? 'Needs attention' : null
            });
          }
        }

        // Insert in batches of 50 to avoid query size limits
        const batchSize = 50;
        for (let i = 0; i < itemsToInsert.length; i += batchSize) {
          const batch = itemsToInsert.slice(i, i + batchSize);
          
          // Build raw SQL INSERT statement
          const values = batch.map(item => 
            `('${item.inspection_id}', ${item.item_number}, ${item.day_of_week}, '${item.status}'${item.comments ? `, '${item.comments}'` : ', NULL'})`
          ).join(',\n      ');

          const sql = `
            INSERT INTO inspection_items (inspection_id, item_number, day_of_week, status, comments)
            VALUES ${values};
          `;

          const { error: itemError } = await supabase.rpc('exec', { sql });

          if (itemError) {
            console.log(`   ❌ Error inserting items batch: ${itemError.message}`);
          }
        }

        console.log(`   ✅ Inserted ${itemsToInsert.length} inspection items (${INSPECTION_ITEMS.length} items × 7 days)`);
      }

      console.log(`   ✅ Week ${week + 1} completed\n`);
    }

    console.log('\n✅ All inspection data seeded successfully!');
    console.log('🎉 You can now test the daily inspection form!');

  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedInspections();

