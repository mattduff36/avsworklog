import { config } from 'dotenv';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile =
  'supabase/migrations/20260811150436_inventory_check_warning_override.sql';
const functionSignature =
  'public.inventory_kiosk_execute_transfer_basket(uuid,text,uuid,uuid[],jsonb,text)';
const priorCheckGuard = 'Inventory check required before leaving Yard';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

interface FunctionVerificationRow {
  function_count: number;
  prosecdef: boolean;
  proconfig: string[] | null;
  definition: string;
  service_role_execute: boolean;
  public_execute: boolean;
  anon_execute: boolean;
  authenticated_execute: boolean;
}

async function runMigration() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();

    const { rows: beforeRows } = await client.query<{ definition: string }>(
      `
        SELECT pg_get_functiondef(to_regprocedure($1)) AS definition
      `,
      [functionSignature],
    );
    const priorDefinition = beforeRows[0]?.definition;
    if (!priorDefinition) {
      throw new Error('Could not capture the existing Yard kiosk transfer function');
    }

    const snapshotDirectory = resolve(
      process.cwd(),
      'docs_private/migration-snapshots',
    );
    mkdirSync(snapshotDirectory, { recursive: true });
    const snapshotPath = resolve(
      snapshotDirectory,
      `inventory-check-warning-override-before-${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.sql`,
    );
    writeFileSync(
      snapshotPath,
      [
        '-- Rollback snapshot captured immediately before the warning override migration.',
        priorDefinition.trim(),
        '',
      ].join('\n'),
      'utf-8',
    );

    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows } = await client.query<FunctionVerificationRow>(
      `
        WITH target AS (
          SELECT
            p.oid,
            p.prosecdef,
            p.proconfig,
            pg_get_functiondef(p.oid) AS definition
          FROM pg_proc AS p
          JOIN pg_namespace AS n ON n.oid = p.pronamespace
          WHERE p.oid = to_regprocedure($1)
        )
        SELECT
          (
            SELECT COUNT(*)::INTEGER
            FROM pg_proc AS p
            JOIN pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = 'inventory_kiosk_execute_transfer_basket'
          ) AS function_count,
          target.prosecdef,
          target.proconfig,
          target.definition,
          has_function_privilege('service_role', target.oid, 'EXECUTE')
            AS service_role_execute,
          has_function_privilege('public', target.oid, 'EXECUTE')
            AS public_execute,
          has_function_privilege('anon', target.oid, 'EXECUTE')
            AS anon_execute,
          has_function_privilege('authenticated', target.oid, 'EXECUTE')
            AS authenticated_execute
        FROM target
      `,
      [functionSignature],
    );

    const verification = rows[0];
    if (!verification) {
      throw new Error('The Yard kiosk transfer function was not found after migration');
    }
    if (verification.function_count !== 1) {
      throw new Error(
        `Expected one Yard kiosk transfer function, found ${verification.function_count}`,
      );
    }
    if (verification.prosecdef) {
      throw new Error('Yard kiosk transfer function must remain SECURITY INVOKER');
    }
    if (!verification.proconfig?.includes('search_path=public')) {
      throw new Error('Yard kiosk transfer function must keep search_path=public');
    }
    if (
      !verification.service_role_execute
      || verification.public_execute
      || verification.anon_execute
      || verification.authenticated_execute
    ) {
      throw new Error('Yard kiosk transfer function privileges are not restricted');
    }

    const requiredClauses = [
      'Yard kiosk access denied',
      'FOR UPDATE',
      'unavailable at the source location',
      'inventory_transfer_items',
      'inventory_transfer_hardware_stock',
      'Serialized Inventory basket changed before it could be committed',
    ];
    for (const clause of requiredClauses) {
      if (!verification.definition.includes(clause)) {
        throw new Error(`Yard kiosk transfer function is missing: ${clause}`);
      }
    }
    if (
      verification.definition.includes(priorCheckGuard)
      || verification.definition.includes('v_blocked_count')
    ) {
      throw new Error('The database inventory-check hard stop is still present');
    }

    let rollbackDefinition = priorDefinition;
    if (!rollbackDefinition.includes(priorCheckGuard)) {
      const priorSnapshotName = readdirSync(snapshotDirectory)
        .filter((name) => (
          name.startsWith('inventory-check-warning-override-before-')
          && name.endsWith('.sql')
        ))
        .sort()
        .reverse()
        .find((name) => (
          readFileSync(resolve(snapshotDirectory, name), 'utf-8')
            .includes(priorCheckGuard)
        ));
      if (!priorSnapshotName) {
        throw new Error('No prior guarded function snapshot is available for rollback proof');
      }
      rollbackDefinition = readFileSync(
        resolve(snapshotDirectory, priorSnapshotName),
        'utf-8',
      );
    }

    await client.query('BEGIN');
    try {
      await client.query(rollbackDefinition);
      const { rows: rollbackRows } = await client.query<{ definition: string }>(
        'SELECT pg_get_functiondef(to_regprocedure($1)) AS definition',
        [functionSignature],
      );
      const restoredDefinition = rollbackRows[0]?.definition || '';
      if (
        !restoredDefinition.includes(priorCheckGuard)
        || !restoredDefinition.includes('FOR UPDATE')
      ) {
        throw new Error('Rollback snapshot did not restore the guarded transfer function');
      }
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const { rows: postRollbackRows } = await client.query<{ definition: string }>(
      'SELECT pg_get_functiondef(to_regprocedure($1)) AS definition',
      [functionSignature],
    );
    if (postRollbackRows[0]?.definition !== verification.definition) {
      throw new Error('Rollback proof transaction did not leave the forward function intact');
    }

    console.log(`Rollback snapshot: ${snapshotPath}`);
    console.log('Inventory check warning override migration verified.');
    console.log('Rollback restoration verified in a rollback-only transaction.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Inventory check warning override migration failed:', message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
