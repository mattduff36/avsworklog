// Check RLS policies for vehicle_inspections
import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  process.exit(1);
}

const url = new URL(connectionString);

const client = new Client({
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  database: url.pathname.slice(1),
  user: url.username,
  password: url.password,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  await client.connect();
  console.log('Connected to database\n');
  
  // Check RLS policies on vehicle_inspections
  const { rows: policies } = await client.query(`
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies 
    WHERE tablename = 'vehicle_inspections'
    ORDER BY policyname;
  `);
  
  console.log('=== Vehicle Inspections RLS Policies ===\n');
  policies.forEach(p => {
    console.log('Policy:', p.policyname);
    console.log('Command:', p.cmd);
    console.log('USING:', p.qual || 'NULL');
    console.log('WITH CHECK:', p.with_check || 'NULL');
    console.log('---');
  });

  // Check if there's still an old 'role' column in profiles
  const { rows: columns } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name IN ('role', 'role_id');
  `);
  
  console.log('\n=== Profile columns for role ===');
  console.table(columns);
  
  // Total inspections in the database
  const { rows: count } = await client.query('SELECT COUNT(*) as total FROM vehicle_inspections');
  console.log('\nTotal inspections:', count[0].total);
  
  await client.end();
}

check().catch(console.error);

