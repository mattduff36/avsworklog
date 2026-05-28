import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const csvPath = 'docs_private/Customer List for App.csv';
const isDryRun = process.argv.includes('--dry-run');

interface CsvCustomerRow {
  companyName: string;
  location: string;
  email: string;
  contactName: string;
}

interface ParsedCsvLine {
  Customer: string;
  Location: string;
  Email: string;
  Name: string;
}

const SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'in', 'to', 'a', 'an']);
const UPPERCASE_WORDS = new Set(['UK', 'SPS']);
const LEGAL_SUFFIXES: Record<string, string> = {
  LIMITED: 'Limited',
  LTD: 'Ltd',
  'LTD.': 'Ltd.',
};

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString as string);

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

function cleanValue(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\ufffd/g, '')
    .replace(/\u00c2/g, '')
    .trim();
}

function titleCaseBareToken(token: string, index: number) {
  const upper = token.toUpperCase();

  if (LEGAL_SUFFIXES[upper]) {
    return LEGAL_SUFFIXES[upper];
  }

  if (UPPERCASE_WORDS.has(upper)) {
    return upper;
  }

  if (index > 0 && SMALL_WORDS.has(token.toLowerCase())) {
    return token.toLowerCase();
  }

  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function titleCaseToken(token: string, index: number) {
  const cleaned = cleanValue(token);
  const leading = cleaned.match(/^[^A-Za-z0-9]+/)?.[0] ?? '';
  const trailing = cleaned.match(/[^A-Za-z0-9.]+$/)?.[0] ?? '';
  const bareToken = cleaned.slice(leading.length, cleaned.length - trailing.length);

  if (!bareToken) {
    return cleaned;
  }

  return `${leading}${titleCaseBareToken(bareToken, index)}${trailing}`;
}

function titleCaseText(value: string) {
  return cleanValue(value)
    .split(/\s+/)
    .map((word, index) => word
      .split('-')
      .map((part, partIndex) => titleCaseToken(part, index + partIndex))
      .join('-'))
    .join(' ');
}

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ',' && !insideQuotes) {
      fields.push(cleanValue(current));
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(cleanValue(current));
  return fields;
}

function readCustomerRows(): CsvCustomerRow[] {
  const csv = readFileSync(resolve(process.cwd(), csvPath), 'utf-8');
  const [headerLine, ...dataLines] = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(headerLine);

  return dataLines.map((line, index) => {
    const values = parseCsvLine(line);
    const parsed = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] || ''])) as unknown as ParsedCsvLine;
    const email = cleanValue(parsed.Email).toLowerCase();

    if (!parsed.Customer || !parsed.Location || !parsed.Name || !email) {
      throw new Error(`CSV row ${index + 2} is missing a required customer, location, email, or name value`);
    }

    return {
      companyName: titleCaseText(parsed.Customer),
      location: titleCaseText(parsed.Location),
      email,
      contactName: titleCaseText(parsed.Name),
    };
  });
}

function assertUniqueEmails(rows: CsvCustomerRow[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  rows.forEach((row) => {
    if (seen.has(row.email)) {
      duplicates.add(row.email);
    }
    seen.add(row.email);
  });

  if (duplicates.size > 0) {
    throw new Error(`CSV contains duplicate contact emails: ${Array.from(duplicates).join(', ')}`);
  }
}

async function importCustomers() {
  const rows = readCustomerRows();
  assertUniqueEmails(rows);

  const client = createClient();
  await client.connect();

  let inserted = 0;
  let updated = 0;

  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const existing = await client.query<{ id: string }>(
        `
        SELECT id
        FROM customers
        WHERE lower(regexp_replace(contact_email, '[^A-Za-z0-9@._%+-]', '', 'g')) = $1
        ORDER BY created_at ASC
        LIMIT 1
        `,
        [row.email]
      );

      if (existing.rowCount && existing.rows[0]) {
        updated += 1;
        await client.query(
          `
          UPDATE customers
          SET
            company_name = $1,
            short_name = NULL,
            contact_name = $2,
            contact_email = $3,
            city = $4,
            status = 'active',
            payment_terms_days = COALESCE(payment_terms_days, 30),
            default_validity_days = COALESCE(default_validity_days, 30)
          WHERE id = $5
          `,
          [row.companyName, row.contactName, row.email, row.location, existing.rows[0].id]
        );
      } else {
        inserted += 1;
        await client.query(
          `
          INSERT INTO customers (
            company_name,
            short_name,
            contact_name,
            contact_email,
            city,
            status,
            payment_terms_days,
            default_validity_days
          )
          VALUES ($1, NULL, $2, $3, $4, 'active', 30, 30)
          `,
          [row.companyName, row.contactName, row.email, row.location]
        );
      }
    }

    if (isDryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    const importedEmails = rows.map((row) => row.email);
    const verification = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM customers WHERE lower(contact_email) = ANY($1::text[])',
      [importedEmails]
    );

    console.log(`${isDryRun ? 'Dry run complete' : 'Customer import complete'}.`);
    console.log(`CSV rows: ${rows.length}`);
    console.log(`Inserted: ${inserted}`);
    console.log(`Updated: ${updated}`);
    console.log(`Verified rows by email: ${verification.rows[0]?.count ?? '0'}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

importCustomers().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Customer import failed:', message);
  process.exit(1);
});
