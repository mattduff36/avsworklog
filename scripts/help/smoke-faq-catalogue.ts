import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('Missing database connection string');
}

const url = new URL(connectionString);
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port) || 5432,
  database: url.pathname.slice(1),
  user: url.username,
  password: url.password,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  const cats = await client.query(`
    SELECT c.sort_order, c.name, c.slug, c.module_name,
           COUNT(a.id) FILTER (WHERE a.is_published) AS articles
    FROM faq_categories c
    LEFT JOIN faq_articles a ON a.category_id = c.id
    WHERE c.is_active
    GROUP BY c.id
    ORDER BY c.sort_order
  `);

  for (const row of cats.rows) {
    console.log(
      `${String(row.sort_order).padStart(2)}. ${row.slug.padEnd(22)} gate=${String(row.module_name ?? 'public').padEnd(18)} articles=${row.articles}`
    );
  }

  const samples = await client.query(`
    SELECT slug, title
    FROM faq_articles
    WHERE slug IN (
      'inventory-yard-kiosk-use',
      'quote-financial-adjustments',
      'training-overview',
      'suggestions-manage-overview',
      'reminders-overview',
      'sensitive-module-pin'
    )
    ORDER BY slug
  `);

  console.log('\nSample articles:');
  for (const row of samples.rows) {
    console.log(`- ${row.slug}: ${row.title}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
