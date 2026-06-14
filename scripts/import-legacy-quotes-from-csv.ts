import { createHash } from 'crypto';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { normalizeJobNumberInput } from '../lib/utils/timesheet-job-codes';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const importFile = 'data/quotes_summary_with_comments_csv.csv';
const dryRun = process.argv.includes('--dry-run');

const HEADER_MAP = {
  quoteReference: 'Legacy Quote Number',
  customer: 'Customer',
  title: 'Title',
  quoteDate: 'Quote Date',
  manager: 'Quote Manager / Owner',
  quoteValue: 'Quote Value / Total Amount',
  comments: 'Comments',
} as const;

interface ParsedLegacyQuoteCsvRow {
  'Legacy Quote Number': string;
  Customer: string;
  Title: string;
  'Quote Date': string;
  'Quote Manager / Owner': string;
  'Quote Value / Total Amount': string;
  Comments: string;
}

interface LegacyQuoteImportRow {
  sourceRow: number;
  sourceHash: string;
  quoteReference: string | null;
  quoteNumber: number | null;
  quoteSuffix: string | null;
  customerName: string;
  title: string;
  quoteDate: string | null;
  quoteDateRaw: string | null;
  quoteManagerName: string;
  quoteManagerInitials: string | null;
  quoteValueText: string | null;
  quoteValueAmount: number | null;
  comments: string | null;
  rawData: ParsedLegacyQuoteCsvRow;
}

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Set POSTGRES_URL_NON_POOLING (preferred) or POSTGRES_URL in .env.local');
  process.exit(1);
}

function createClient() {
  const url = new URL(connectionString as string);

  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

function cleanValue(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\ufffd/g, '')
    .replace(/\u00c2/g, '')
    .trim();
}

function parseCsvLine(line: string): string[] {
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

function parseCsv(csv: string): ParsedLegacyQuoteCsvRow[] {
  const [headerLine, ...dataLines] = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(headerLine);
  const requiredHeaders = Object.values(HEADER_MAP);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    throw new Error(`Legacy quotes CSV is missing required columns: ${missingHeaders.join(', ')}`);
  }

  return dataLines.map((line, index) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(
      headers.map((header, headerIndex) => [header, values[headerIndex] || ''])
    ) as unknown as ParsedLegacyQuoteCsvRow;

    if (!row[HEADER_MAP.quoteReference]) {
      throw new Error(`CSV row ${index + 2} is missing a legacy quote number`);
    }

    return row;
  });
}

function parseQuoteDate(value: string): string | null {
  const trimmed = cleanValue(value);
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function getInitialsFromName(value: string): string | null {
  const initials = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
    .slice(0, 3);

  return initials || null;
}

function normalizeQuoteManagerName(value: string): string {
  const cleaned = cleanValue(value).replace(/\s+/g, ' ');
  if (/^geroge\s+healey$/i.test(cleaned)) return 'George Healey';
  return cleaned;
}

function extractQuoteValueText(value: string): string | null {
  const directValue = cleanValue(value);
  if (directValue) return directValue;
  return null;
}

function parseQuoteValueAmount(value: string | null): number | null {
  if (!value) return null;
  if (/rates?|various|#?\s*n\s*\/?\s*a/i.test(value)) return null;

  const normalized = value
    .replace(/£/g, '')
    .replace(/,/g, '')
    .trim();

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeQuoteReference(value: string): {
  quoteReference: string | null;
  quoteNumber: number | null;
  quoteSuffix: string | null;
} {
  const quoteReference = normalizeJobNumberInput(value);
  const match = quoteReference.match(/^(\d{4,5})-([A-Z]{2})$/);

  if (!match) {
    return {
      quoteReference: null,
      quoteNumber: null,
      quoteSuffix: null,
    };
  }

  return {
    quoteReference,
    quoteNumber: Number.parseInt(match[1], 10),
    quoteSuffix: match[2],
  };
}

function buildLegacyQuoteImportRows(rows: ParsedLegacyQuoteCsvRow[]): LegacyQuoteImportRow[] {
  return rows.map((row, index) => {
    const sourceRow = index + 2;
    const referenceParts = normalizeQuoteReference(row[HEADER_MAP.quoteReference]);
    const comments = cleanValue(row[HEADER_MAP.comments]);
    const quoteValueText = extractQuoteValueText(row[HEADER_MAP.quoteValue]);
    const quoteManagerName = normalizeQuoteManagerName(row[HEADER_MAP.manager]);
    const rowHash = createHash('sha256')
      .update(JSON.stringify(row))
      .digest('hex');

    return {
      sourceRow,
      sourceHash: rowHash,
      ...referenceParts,
      customerName: cleanValue(row[HEADER_MAP.customer]),
      title: cleanValue(row[HEADER_MAP.title]),
      quoteDate: parseQuoteDate(row[HEADER_MAP.quoteDate]),
      quoteDateRaw: cleanValue(row[HEADER_MAP.quoteDate]) || null,
      quoteManagerName,
      quoteManagerInitials: getInitialsFromName(quoteManagerName),
      quoteValueText,
      quoteValueAmount: parseQuoteValueAmount(quoteValueText),
      comments: comments || null,
      rawData: row,
    };
  });
}

async function importLegacyQuotes() {
  const csv = readFileSync(resolve(process.cwd(), importFile), 'utf-8');
  const importHash = createHash('sha256').update(csv).digest('hex');
  const parsedRows = parseCsv(csv);
  const rows = buildLegacyQuoteImportRows(parsedRows);
  const invalidReferenceCount = rows.filter((row) => !row.quoteReference).length;

  console.log(`Legacy quote rows parsed: ${rows.length}`);
  console.log(`Rows without valid quote references: ${invalidReferenceCount}`);

  const client = createClient();
  await client.connect();

  try {
    await client.query('BEGIN');

    const batchResult = await client.query<{ id: string }>(
      `
        INSERT INTO public.legacy_quote_import_batches (
          source_file,
          source_hash,
          imported_at,
          record_count,
          invalid_reference_count,
          metadata
        )
        VALUES ($1, $2, NOW(), $3, $4, $5::JSONB)
        ON CONFLICT (source_hash) DO UPDATE
        SET imported_at = NOW(),
            record_count = EXCLUDED.record_count,
            invalid_reference_count = EXCLUDED.invalid_reference_count,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        RETURNING id
      `,
      [
        importFile,
        importHash,
        rows.length,
        invalidReferenceCount,
        JSON.stringify({
          headers: Object.values(HEADER_MAP),
          dryRun,
        }),
      ]
    );

    const importBatchId = batchResult.rows[0]?.id;
    if (!importBatchId) throw new Error('Failed to create legacy quote import batch');

    for (const row of rows) {
      await client.query(
        `
          INSERT INTO public.legacy_quotes (
            import_batch_id,
            source_row,
            source_hash,
            quote_reference,
            quote_number,
            quote_suffix,
            customer_name,
            title,
            quote_date,
            quote_date_raw,
            quote_manager_name,
            quote_manager_initials,
            quote_value_text,
            quote_value_amount,
            comments,
            raw_data
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9::DATE, $10, $11, $12, $13, $14, $15, $16::JSONB
          )
          ON CONFLICT (source_row) DO UPDATE
          SET import_batch_id = EXCLUDED.import_batch_id,
              source_hash = EXCLUDED.source_hash,
              quote_reference = EXCLUDED.quote_reference,
              quote_number = EXCLUDED.quote_number,
              quote_suffix = EXCLUDED.quote_suffix,
              customer_name = EXCLUDED.customer_name,
              title = EXCLUDED.title,
              quote_date = EXCLUDED.quote_date,
              quote_date_raw = EXCLUDED.quote_date_raw,
              quote_manager_name = EXCLUDED.quote_manager_name,
              quote_manager_initials = EXCLUDED.quote_manager_initials,
              quote_value_text = EXCLUDED.quote_value_text,
              quote_value_amount = EXCLUDED.quote_value_amount,
              comments = EXCLUDED.comments,
              raw_data = EXCLUDED.raw_data,
              updated_at = NOW()
        `,
        [
          importBatchId,
          row.sourceRow,
          row.sourceHash,
          row.quoteReference,
          row.quoteNumber,
          row.quoteSuffix,
          row.customerName,
          row.title,
          row.quoteDate,
          row.quoteDateRaw,
          row.quoteManagerName,
          row.quoteManagerInitials,
          row.quoteValueText,
          row.quoteValueAmount,
          row.comments,
          JSON.stringify(row.rawData),
        ]
      );
    }

    const deleteResult = await client.query(
      `
        DELETE FROM public.legacy_quotes
        WHERE import_batch_id IS DISTINCT FROM $1
      `,
      [importBatchId]
    );

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run complete. No changes were committed.');
    } else {
      await client.query('COMMIT');
      console.log('Legacy quotes import complete.');
    }

    console.log(`Rows upserted: ${rows.length}`);
    console.log(`Stale rows removed: ${deleteResult.rowCount || 0}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

importLegacyQuotes().catch((error) => {
  console.error('Legacy quotes import failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
