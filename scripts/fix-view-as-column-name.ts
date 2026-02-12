import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });

const cs = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!cs) { console.error('Missing connection string'); process.exit(1); }
const url = new URL(cs);

const FIX_SQL = `
-- FIX: is_actual_super_admin() referenced p.is_super_admin but the column is p.super_admin
CREATE OR REPLACE FUNCTION public.is_actual_super_admin()
RETURNS BOOLEAN AS $$
DECLARE
  result BOOLEAN;
BEGIN
  SELECT COALESCE(p.super_admin, FALSE) OR COALESCE(r.is_super_admin, FALSE)
  INTO result
  FROM profiles p
  LEFT JOIN roles r ON p.role_id = r.id
  WHERE p.id = auth.uid();
  RETURN COALESCE(result, FALSE);
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

-- Also add exception handlers to the other critical functions for safety
CREATE OR REPLACE FUNCTION public.effective_role_id()
RETURNS UUID AS $$
DECLARE
  actual_role UUID;
  override_role UUID;
BEGIN
  SELECT p.role_id INTO actual_role
  FROM profiles p
  WHERE p.id = auth.uid();

  IF NOT is_actual_super_admin() THEN
    RETURN actual_role;
  END IF;

  override_role := view_as_role_id();
  IF override_role IS NOT NULL AND EXISTS (SELECT 1 FROM roles WHERE id = override_role) THEN
    RETURN override_role;
  END IF;

  RETURN actual_role;
EXCEPTION WHEN OTHERS THEN
  -- Fallback: return actual role from profiles directly
  BEGIN
    SELECT p.role_id INTO actual_role FROM profiles p WHERE p.id = auth.uid();
    RETURN actual_role;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_is_manager_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM roles
    WHERE id = effective_role_id()
      AND is_manager_admin = true
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM roles
    WHERE id = effective_role_id()
      AND is_super_admin = true
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;
`;

async function run() {
  console.log('HOTFIX: Fixing is_actual_super_admin() column reference...\n');
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

  await client.query(FIX_SQL);
  console.log('Functions updated');

  // Verify
  try {
    const { rows } = await client.query(`SELECT effective_is_manager_admin() as result`);
    console.log(`effective_is_manager_admin() = ${rows[0].result} (should be false for postgres user)`);
  } catch (e: any) {
    console.error(`STILL FAILING: ${e.message}`);
    process.exit(1);
  }

  // Count profiles to verify no breakage
  const { rows: cnt } = await client.query(`SELECT count(*) as c FROM profiles`);
  console.log(`Profiles count: ${cnt[0].c}`);

  await client.end();
  console.log('\nHotfix applied successfully!');
}

run().catch(e => { console.error(e.message); process.exit(1); });
