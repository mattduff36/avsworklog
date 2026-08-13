import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { ALL_MODULES } from '../types/roles';

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

  const { rows: roles } = await client.query(`
    SELECT id, name, display_name, hierarchy_rank, is_manager_admin, is_super_admin
    FROM public.roles
    ORDER BY hierarchy_rank DESC, name
  `);

  console.log('=== ALL ROLES ===');
  for (const role of roles) {
    console.log(
      `  L${role.hierarchy_rank} ${role.display_name} (${role.name})`
      + ` | manager_admin: ${role.is_manager_admin} | super_admin: ${role.is_super_admin}`
    );
  }

  const { rows: modules } = await client.query(`
    SELECT
      pm.module_name,
      pm.access_mode,
      public.module_enforced_minimum_access_level(pm.module_name)
        AS enforced_minimum_access_level,
      public.module_requires_full_access_role(pm.module_name)
        AS requires_full_access_role,
      pm.requires_sensitive_pin,
      role.display_name AS minimum_role_name
    FROM public.permission_modules pm
    LEFT JOIN public.roles role ON role.id = pm.minimum_role_id
    ORDER BY pm.sort_order, pm.module_name
  `);

  console.log('\n=== PERMISSION MODULES ===');
  for (const moduleDefinition of modules) {
    console.log(
      `  ${moduleDefinition.module_name} | mode: ${moduleDefinition.access_mode}`
      + ` | minimum: L${moduleDefinition.enforced_minimum_access_level} ${moduleDefinition.minimum_role_name || ''}`
      + ` | full-role-only: ${moduleDefinition.requires_full_access_role}`
      + ` | sensitive PIN: ${moduleDefinition.requires_sensitive_pin}`
    );
  }

  const databaseModules = new Set(
    modules.map((moduleDefinition) => String(moduleDefinition.module_name))
  );
  const missingModules = ALL_MODULES.filter((module) => !databaseModules.has(module));
  const unexpectedModules = [...databaseModules].filter(
    (module) => !ALL_MODULES.includes(module as (typeof ALL_MODULES)[number])
  );
  if (missingModules.length > 0) {
    console.log(`  ⚠️  Missing database modules: ${missingModules.join(', ')}`);
  }
  if (unexpectedModules.length > 0) {
    console.log(`  ⚠️  Database modules missing from ALL_MODULES: ${unexpectedModules.join(', ')}`);
  }

  const { rows: teamDefaults } = await client.query(`
    SELECT
      team.id AS team_id,
      team.name AS team_name,
      COUNT(*) FILTER (WHERE permissions.enabled) AS enabled_count,
      ARRAY_AGG(permissions.module_name ORDER BY permissions.module_name)
        FILTER (WHERE permissions.enabled) AS enabled_modules
    FROM public.org_teams team
    LEFT JOIN public.team_module_permissions permissions ON permissions.team_id = team.id
    WHERE team.active
    GROUP BY team.id, team.name
    ORDER BY team.name
  `);

  console.log('\n=== ENABLED TEAM DEFAULTS ===');
  for (const team of teamDefaults) {
    console.log(
      `  ${team.team_name} [${team.team_id}] (${team.enabled_count}):`
      + ` ${team.enabled_modules?.join(', ') || '(none)'}`
    );
  }

  const { rows: userOverrides } = await client.query(`
    SELECT
      profile.full_name,
      override.user_id,
      override.module_name,
      override.access_level,
      public.user_module_access_level(
        profile.id,
        profile.role_id,
        profile.team_id,
        override.module_name
      ) AS effective_access_level
    FROM public.user_module_permissions override
    INNER JOIN public.profiles profile ON profile.id = override.user_id
    ORDER BY profile.full_name, override.module_name
  `);

  console.log('\n=== EXPLICIT USER OVERRIDES ===');
  for (const override of userOverrides) {
    console.log(
      `  ${override.full_name} [${override.user_id}] | ${override.module_name}:`
      + ` L${override.access_level} (effective L${override.effective_access_level})`
    );
  }
  if (userOverrides.length === 0) {
    console.log('  (none)');
  }

  const { rows: [integrity] } = await client.query(`
    SELECT
      (
        SELECT COUNT(*)
        FROM public.team_module_permissions permissions
        LEFT JOIN public.org_teams team ON team.id = permissions.team_id
        LEFT JOIN public.permission_modules module ON module.module_name = permissions.module_name
        WHERE team.id IS NULL OR module.module_name IS NULL
      ) AS orphan_team_rows,
      (
        SELECT COUNT(*)
        FROM public.user_module_permissions permissions
        LEFT JOIN public.profiles profile ON profile.id = permissions.user_id
        LEFT JOIN public.permission_modules module ON module.module_name = permissions.module_name
        WHERE profile.id IS NULL
           OR module.module_name IS NULL
           OR permissions.access_level < 0
           OR permissions.access_level > 5
      ) AS invalid_user_rows
  `);
  console.log('\n=== INTEGRITY ===');
  console.log(`  Orphan team rows: ${integrity.orphan_team_rows}`);
  console.log(`  Orphan/invalid user rows: ${integrity.invalid_user_rows}`);

  await client.end();
  console.log('\nDone');
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
