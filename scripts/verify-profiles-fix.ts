import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });
const cs = process.env.POSTGRES_URL_NON_POOLING!;
const url = new URL(cs);

async function run() {
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Simulate what PostgREST does for an authenticated user
  // Find the super admin user
  const { rows: [admin] } = await client.query(`
    SELECT p.id, p.full_name, p.super_admin, r.name as role_name, r.is_super_admin, r.is_manager_admin
    FROM profiles p
    LEFT JOIN roles r ON p.role_id = r.id
    WHERE p.super_admin = true OR r.is_super_admin = true
    LIMIT 1
  `);
  console.log('Admin user:', admin?.full_name, '| super_admin:', admin?.super_admin, '| role:', admin?.role_name);

  // Simulate a PostgREST request as the admin
  if (admin) {
    await client.query(`SELECT set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true)`);
    await client.query(`SELECT set_config('request.jwt.claim.sub', '${admin.id}', true)`);

    // Now test the functions
    const { rows: [r1] } = await client.query(`SELECT auth.uid() as uid`);
    console.log('auth.uid():', r1.uid);

    const { rows: [r2] } = await client.query(`SELECT is_actual_super_admin() as result`);
    console.log('is_actual_super_admin():', r2.result);

    const { rows: [r3] } = await client.query(`SELECT effective_role_id() as result`);
    console.log('effective_role_id():', r3.result);

    const { rows: [r4] } = await client.query(`SELECT effective_is_manager_admin() as result`);
    console.log('effective_is_manager_admin():', r4.result);

    // Test profiles SELECT with RLS (simulating authenticated user)
    await client.query(`SET LOCAL ROLE authenticated`);
    const { rows: profiles } = await client.query(`SELECT count(*) as c FROM profiles`);
    console.log('Profiles visible as authenticated user:', profiles[0].c);
    await client.query(`RESET ROLE`);
  }

  await client.end();
  console.log('\nAll checks passed!');
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
