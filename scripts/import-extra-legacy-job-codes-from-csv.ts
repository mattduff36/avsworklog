import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { config } from 'dotenv';
import { normalizeCatalogJobCode } from '../lib/utils/timesheet-job-codes';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const importFile = 'data/quotes_summary_EXTRA_csv.csv';
const sourceRowOffset = 2_000_000;
const dryRun = process.argv.includes('--dry-run');

interface ParsedExtraLegacyJobCodeCsvRow {
  'Job Number': string;
  Name: string;
  Customer: string;
}

interface ExtraLegacyJobCodeImportRow {
  sourceRow: number;
  sourceHash: string;
  quoteReference: string;
  customerName: string;
  title: string;
  rawData: ParsedExtraLegacyJobCodeCsvRow;
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
    ssl: { rejectUnauthorized: false },
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

function parseCsv(csv: string): ParsedExtraLegacyJobCodeCsvRow[] {
  const [headerLine, ...dataLines] = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(headerLine);
  const requiredHeaders = ['Job Number', 'Name', 'Customer'];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length > 0) {
    throw new Error(`Extra legacy job-code CSV is missing required columns: ${missingHeaders.join(', ')}`);
  }

  return dataLines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, headerIndex) => [header, values[headerIndex] || ''])
    ) as unknown as ParsedExtraLegacyJobCodeCsvRow;
  });
}

function buildImportRows(rows: ParsedExtraLegacyJobCodeCsvRow[]): ExtraLegacyJobCodeImportRow[] {
  return rows.map((row, index) => {
    const quoteReference = normalizeCatalogJobCode(row['Job Number']);
    const rowHash = createHash('sha256')
      .update(JSON.stringify(row))
      .digest('hex');

    return {
      sourceRow: sourceRowOffset + index + 2,
      sourceHash: rowHash,
      quoteReference,
      customerName: cleanValue(row.Customer),
      title: cleanValue(row.Name),
      rawData: row,
    };
  }).filter((row) => row.quoteReference);
}

async function importExtraLegacyJobCodes() {
  const csv = readFileSync(resolve(process.cwd(), importFile), 'utf-8');
  const importHash = createHash('sha256').update(csv).digest('hex');
  const parsedRows = parseCsv(csv);
  const rows = buildImportRows(parsedRows);
  const skippedBlankCodes = parsedRows.length - rows.length;

  console.log(`Extra legacy job-code rows parsed: ${parsedRows.length}`);
  console.log(`Rows without usable job codes: ${skippedBlankCodes}`);

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
        skippedBlankCodes,
        JSON.stringify({
          headers: ['Job Number', 'Name', 'Customer'],
          dryRun,
          mode: 'append_missing_only',
          sourceRowOffset,
        }),
      ]
    );

    const importBatchId = batchResult.rows[0]?.id;
    if (!importBatchId) throw new Error('Failed to create extra legacy job-code import batch');

    const existingResult = await client.query<{ quote_reference: string }>(
      `
        SELECT quote_reference
        FROM public.legacy_quotes
        WHERE quote_reference IS NOT NULL
      `
    );
    const existingReferences = new Set(
      existingResult.rows.map((row) => normalizeCatalogJobCode(row.quote_reference))
    );
    const seenInFile = new Set<string>();
    let insertedCount = 0;
    let skippedExistingCount = 0;
    let skippedDuplicateCount = 0;

    for (const row of rows) {
      if (seenInFile.has(row.quoteReference)) {
        skippedDuplicateCount += 1;
        continue;
      }
      seenInFile.add(row.quoteReference);

      if (existingReferences.has(row.quoteReference)) {
        skippedExistingCount += 1;
        continue;
      }

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
            $1, $2, $3, $4, NULL, NULL, $5, $6, NULL, NULL, 'Supplemental Legacy Codes', NULL, NULL, NULL, NULL, $7::JSONB
          )
          ON CONFLICT (source_row) DO NOTHING
        `,
        [
          importBatchId,
          row.sourceRow,
          row.sourceHash,
          row.quoteReference,
          row.customerName,
          row.title,
          JSON.stringify(row.rawData),
        ]
      );

      existingReferences.add(row.quoteReference);
      insertedCount += 1;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run complete. No changes were committed.');
    } else {
      await client.query('COMMIT');
      console.log('Extra legacy job-code import complete.');
    }

    console.log(`Rows inserted: ${insertedCount}`);
    console.log(`Rows skipped because code already exists: ${skippedExistingCount}`);
    console.log(`Rows skipped as duplicates within extra CSV: ${skippedDuplicateCount}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

importExtraLegacyJobCodes().catch((error) => {
  console.error('Extra legacy job-code import failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
