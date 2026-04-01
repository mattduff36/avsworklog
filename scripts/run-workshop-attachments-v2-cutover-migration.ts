import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const migrationFile = 'supabase/migrations/20260401_workshop_attachments_remove_legacy_questions_responses.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected');

    const sql = readFileSync(resolve(process.cwd(), migrationFile), 'utf-8');
    console.log(`Running migration: ${migrationFile}`);
    await client.query(sql);
    console.log('Migration completed');

    const { rows: questionsRows } = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'workshop_attachment_questions'`,
    );
    const { rows: responsesRows } = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'workshop_attachment_responses'`,
    );

    console.log(`Verification: workshop_attachment_questions exists = ${questionsRows[0]?.count === 1 ? 'yes' : 'no'}`);
    console.log(`Verification: workshop_attachment_responses exists = ${responsesRows[0]?.count === 1 ? 'yes' : 'no'}`);
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Cutover migration failed:', pgError.message || error);
    if (pgError.detail) console.error('Detail:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
