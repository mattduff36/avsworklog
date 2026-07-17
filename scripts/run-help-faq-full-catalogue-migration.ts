import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

const TARGET_PROJECT_REF = 'lrhufzqfzeutgvudcowy';
const SQL_FILE = 'supabase/migrations/20260717_help_faq_full_catalogue.sql';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

if (!connectionString.includes(TARGET_PROJECT_REF)) {
  console.error('Database connection string does not target the approved Supabase project.');
  console.error(`Expected project ref: ${TARGET_PROJECT_REF}`);
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString!);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function runMigration() {
  const client = createClient();

  try {
    console.log('Running Help FAQ full catalogue migration...');
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), SQL_FILE), 'utf-8');
    await client.query(migrationSql);

    const { rows: countRows } = await client.query<{
      category_count: string;
      published_article_count: string;
      gated_category_count: string;
      training_count: string;
      inventory_count: string;
      quotes_count: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM public.faq_categories WHERE is_active = TRUE) AS category_count,
        (SELECT COUNT(*)::text FROM public.faq_articles WHERE is_published = TRUE) AS published_article_count,
        (SELECT COUNT(*)::text FROM public.faq_categories WHERE module_name IS NOT NULL) AS gated_category_count,
        (
          SELECT COUNT(*)::text
          FROM public.faq_articles a
          JOIN public.faq_categories c ON c.id = a.category_id
          WHERE c.slug = 'training' AND a.is_published = TRUE
        ) AS training_count,
        (
          SELECT COUNT(*)::text
          FROM public.faq_articles a
          JOIN public.faq_categories c ON c.id = a.category_id
          WHERE c.slug = 'inventory' AND a.is_published = TRUE
        ) AS inventory_count,
        (
          SELECT COUNT(*)::text
          FROM public.faq_articles a
          JOIN public.faq_categories c ON c.id = a.category_id
          WHERE c.slug = 'quotes' AND a.is_published = TRUE
        ) AS quotes_count
    `);

    const counts = countRows[0];
    console.log(
      `Verified FAQ catalogue: ${counts.category_count} active categories, ` +
        `${counts.published_article_count} published articles, ` +
        `${counts.gated_category_count} gated categories.`
    );
    console.log(
      `Priority coverage: inventory=${counts.inventory_count}, quotes=${counts.quotes_count}, training=${counts.training_count}`
    );
    console.log('Help FAQ full catalogue migration completed successfully.');
  } catch (error) {
    console.error('Help FAQ full catalogue migration failed:');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMigration();
