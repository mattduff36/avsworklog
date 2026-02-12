import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });

const cs = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!cs) { console.error('No connection string'); process.exit(1); }

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
  console.log('Connected');

  // 1. Check function ownership
  const { rows: fns } = await client.query(`
    SELECT p.proname, pg_catalog.pg_get_userbyid(p.proowner) as owner,
           p.prosecdef as security_definer
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN ('effective_is_manager_admin','effective_role_id','is_actual_super_admin','view_as_role_id')
    ORDER BY p.proname;
  `);
  console.log('\nFunctions:');
  fns.forEach(f => console.log(`  ${f.proname} | owner: ${f.owner} | SECURITY DEFINER: ${f.security_definer}`));

  // 2. Check profiles policies
  const { rows: pols } = await client.query(`
    SELECT polname, polcmd, pg_catalog.pg_get_expr(polqual, polrelid) as qual
    FROM pg_policy
    JOIN pg_class ON pg_policy.polrelid = pg_class.oid
    WHERE relname = 'profiles'
    ORDER BY polname;
  `);
  console.log('\nProfiles policies:');
  pols.forEach(p => console.log(`  ${p.polname} | cmd: ${p.polcmd} | qual: ${(p.qual || '').substring(0, 150)}`));

  // 3. Count profiles (as postgres, bypasses RLS)
  const { rows: cnt } = await client.query(`SELECT count(*) as c FROM profiles`);
  console.log(`\nProfiles count (as postgres): ${cnt[0].c}`);

  // 4. Try calling function directly
  try {
    const { rows } = await client.query(`SELECT effective_is_manager_admin() as result`);
    console.log(`effective_is_manager_admin() = ${rows[0].result}`);
  } catch (e: any) {
    console.log(`effective_is_manager_admin() FAILED: ${e.message}`);
  }

  // 5. Test the profiles SELECT with RLS enabled (as authenticated user simulation)
  try {
    // Try setting role to authenticated to see if policies work
    await client.query(`SET LOCAL ROLE authenticated`);
    const { rows } = await client.query(`SELECT count(*) as c FROM profiles`);
    console.log(`Profiles count (as authenticated): ${rows[0].c}`);
    await client.query(`RESET ROLE`);
  } catch (e: any) {
    console.log(`Profiles query as authenticated FAILED: ${e.message}`);
    await client.query(`RESET ROLE`).catch(() => {});
  }

  await client.end();
  console.log('\nDone');
}

run().catch(e => { console.error(e.message); process.exit(1); });
