import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

// Type assertion since we've validated above
const validConnectionString = connectionString as string;

interface FAQCategory {
  slug: string;
  name: string;
  sort_order: number;
  description?: string;
  module_name?: string | null;
}

interface FAQArticle {
  category_slug: string;
  slug: string;
  title: string;
  summary: string;
  content_md: string;
  sort_order?: number;
}

interface FAQData {
  categories: FAQCategory[];
  articles: FAQArticle[];
}

async function seedFAQ() {
  console.log('🚀 Seeding FAQ Content...\n');

  // Parse connection string
  const url = new URL(validConnectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Load FAQ data
    const faqDataPath = resolve(process.cwd(), 'scripts/seed/data/faq-howto.json');
    const faqData: FAQData = JSON.parse(readFileSync(faqDataPath, 'utf-8'));
    
    console.log(`📚 Found ${faqData.categories.length} categories and ${faqData.articles.length} articles\n`);

    // Upsert categories
    console.log('📁 Upserting categories...');
    const categoryIdMap: Record<string, string> = {};
    
    for (const category of faqData.categories) {
      const result = await client.query(`
        INSERT INTO faq_categories (name, slug, description, module_name, sort_order, is_active)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        ON CONFLICT (slug) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          module_name = EXCLUDED.module_name,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
        RETURNING id
      `, [
        category.name,
        category.slug,
        category.description || null,
        category.module_name ?? null,
        category.sort_order,
      ]);
      
      categoryIdMap[category.slug] = result.rows[0].id;
      console.log(`   ✅ ${category.name}`);
    }

    // Upsert articles
    console.log('\n📝 Upserting articles...');
    let articleCount = 0;
    
    for (const article of faqData.articles) {
      const categoryId = categoryIdMap[article.category_slug];
      
      if (!categoryId) {
        console.log(`   ⚠️  Skipping "${article.title}" - category "${article.category_slug}" not found`);
        continue;
      }

      const sortOrder = typeof article.sort_order === 'number' ? article.sort_order : articleCount;
      
      await client.query(`
        INSERT INTO faq_articles (category_id, title, slug, summary, content_md, is_published, sort_order)
        VALUES ($1, $2, $3, $4, $5, TRUE, $6)
        ON CONFLICT (category_id, slug) 
        DO UPDATE SET 
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          content_md = EXCLUDED.content_md,
          sort_order = EXCLUDED.sort_order,
          is_published = TRUE,
          updated_at = NOW()
      `, [categoryId, article.title, article.slug, article.summary, article.content_md, sortOrder]);
      
      articleCount++;
    }
    
    console.log(`   ✅ ${articleCount} articles upserted`);

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ FAQ CONTENT SEEDED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Verify counts
    const { rows: catCount } = await client.query('SELECT COUNT(*) FROM faq_categories');
    const { rows: artCount } = await client.query('SELECT COUNT(*) FROM faq_articles');
    
    console.log('📊 Database now contains:');
    console.log(`   • ${catCount[0].count} FAQ categories`);
    console.log(`   • ${artCount[0].count} FAQ articles\n`);

  } catch (err: unknown) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ SEED FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const msg = err instanceof Error ? err.message : String(err);
    const detail = (err as { detail?: string }).detail;
    console.error('Error:', msg);
    if (detail) {
      console.error('Details:', detail);
    }
    
    if (msg.includes('does not exist')) {
      console.log('\n💡 Tip: Run the migration first:');
      console.log('   npx tsx scripts/migrations/run-faq-suggestions-migration.ts\n');
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

seedFAQ().catch(console.error);
