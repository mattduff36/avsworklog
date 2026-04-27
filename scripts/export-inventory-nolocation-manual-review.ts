import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import ExcelJS from 'exceljs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sourcePath = 'data/COMPLETE LIST 2023.xlsx';
const outputPath = 'data/inventory-nolocation-manual-review.csv';

interface CompleteListRow {
  rowNumber: number;
  itemNumber: string;
  itemName: string;
  location: string;
  locationKey: string;
  rawDate: string;
}

interface InventoryItemRow {
  id: string;
  item_number: string;
  item_number_normalized: string;
  name: string;
  category: string;
  last_checked_at: string | Date | null;
  status: string;
  current_location: string;
}

interface InventoryLocationRow {
  id: string;
  name: string;
  linked_van_id: string | null;
  linked_hgv_id: string | null;
  linked_plant_id: string | null;
}

interface VanRow {
  id: string;
  reg_number: string;
  nickname: string | null;
}

interface HgvRow {
  id: string;
  reg_number: string;
  nickname: string | null;
}

interface PlantRow {
  id: string;
  plant_id: string | null;
  reg_number: string | null;
  nickname: string | null;
}

interface AssetAlias {
  key: string;
  label: string;
  bin: string;
  kind: string;
}

interface Suggestion {
  bin: string;
  bestScore: number;
  labels: Set<string>;
}

interface ReviewSummary {
  sourceRows: string;
  completeListLocations: string;
  completeListNames: string;
  completeListDates: string;
  suggestedBin: string;
  suggestionBasis: string;
  confidence: string;
  reviewReason: string;
}

if (!connectionString) {
  console.error('Missing database connection string');
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

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    return JSON.stringify(value);
  }

  return String(value).trim();
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function compactKey(value: string): string {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeItemNumber(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '').trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((token) => token.length >= 3)
  );
}

function overlapScore(source: string, alias: AssetAlias): number {
  const sourceKey = compactKey(source);
  const aliasKey = compactKey(alias.key);
  if (!sourceKey || !aliasKey) return 0;
  if (sourceKey === aliasKey) return 100;
  if (sourceKey.includes(aliasKey) || aliasKey.includes(sourceKey)) return 80;

  const sourceTokens = tokenSet(source);
  const aliasTokens = tokenSet(alias.label);
  const matches = [...sourceTokens].filter((token) => aliasTokens.has(token));
  if (!matches.length) return 0;

  return matches.length === Math.min(sourceTokens.size, aliasTokens.size) ? 70 : 55;
}

function isSoldOrScrap(values: string[]): boolean {
  return /\b(sold|scrap|scrapped)\b/i.test(values.join(' '));
}

function csvEscape(value: string | number | Date | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function readCompleteListRows(): Promise<Map<string, CompleteListRow[]>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(process.cwd(), sourcePath));
  const worksheet = workbook.getWorksheet('COMPLETE');
  if (!worksheet) throw new Error('COMPLETE sheet not found in COMPLETE LIST 2023.xlsx');

  const rowsByItem = new Map<string, CompleteListRow[]>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const itemNumber = cellText(row.getCell(1).value);
    const itemName = cellText(row.getCell(2).value);
    const location = normalizeText(cellText(row.getCell(3).value));
    const rawDate = cellText(row.getCell(4).value);
    if (![itemNumber, itemName, location, rawDate].some(Boolean)) continue;
    if (isSoldOrScrap([itemNumber, itemName, location, rawDate])) continue;

    const itemNumberNormalized = normalizeItemNumber(itemNumber);
    if (!itemNumberNormalized || itemNumberNormalized === 'NONUMBER') continue;

    const existingRows = rowsByItem.get(itemNumberNormalized) || [];
    existingRows.push({
      rowNumber,
      itemNumber,
      itemName,
      location,
      locationKey: compactKey(location),
      rawDate,
    });
    rowsByItem.set(itemNumberNormalized, existingRows);
  }

  return rowsByItem;
}

function buildAliases(locations: InventoryLocationRow[], vans: VanRow[], hgvs: HgvRow[], plant: PlantRow[]): AssetAlias[] {
  const locationByVanId = new Map(locations.filter((location) => location.linked_van_id).map((location) => [location.linked_van_id!, location]));
  const locationByHgvId = new Map(locations.filter((location) => location.linked_hgv_id).map((location) => [location.linked_hgv_id!, location]));
  const locationByPlantId = new Map(locations.filter((location) => location.linked_plant_id).map((location) => [location.linked_plant_id!, location]));
  const aliases: AssetAlias[] = [];

  for (const van of vans) {
    const location = locationByVanId.get(van.id);
    if (!location) continue;
    aliases.push({ key: compactKey(van.reg_number), label: van.reg_number, bin: location.name, kind: 'van-reg' });
    if (van.nickname) aliases.push({ key: compactKey(van.nickname), label: `${van.nickname} (${van.reg_number})`, bin: location.name, kind: 'van-nickname' });
  }

  for (const hgv of hgvs) {
    const location = locationByHgvId.get(hgv.id);
    if (!location) continue;
    aliases.push({ key: compactKey(hgv.reg_number), label: hgv.reg_number, bin: location.name, kind: 'hgv-reg' });
    if (hgv.nickname) aliases.push({ key: compactKey(hgv.nickname), label: `${hgv.nickname} (${hgv.reg_number})`, bin: location.name, kind: 'hgv-nickname' });
  }

  for (const asset of plant) {
    const location = locationByPlantId.get(asset.id);
    if (!location) continue;
    if (asset.reg_number) aliases.push({ key: compactKey(asset.reg_number), label: asset.reg_number, bin: location.name, kind: 'plant-reg' });
    if (asset.plant_id) aliases.push({ key: compactKey(asset.plant_id), label: asset.plant_id, bin: location.name, kind: 'plant-id' });
    if (asset.nickname) aliases.push({ key: compactKey(asset.nickname), label: asset.nickname, bin: location.name, kind: 'plant-nickname' });
  }

  return aliases.filter((alias) => alias.key);
}

function summarizeReview(sourceRows: CompleteListRow[] | undefined, aliases: AssetAlias[]): ReviewSummary {
  if (!sourceRows?.length) {
    return {
      sourceRows: '',
      completeListLocations: '',
      completeListNames: '',
      completeListDates: '',
      suggestedBin: '',
      suggestionBasis: '',
      confidence: 'none',
      reviewReason: 'No matching row in COMPLETE LIST 2023.xlsx; likely imported from another source',
    };
  }

  const sourceRowsText = [...new Set(sourceRows.map((row) => row.rowNumber))].join(' | ');
  const names = [...new Set(sourceRows.map((row) => row.itemName).filter(Boolean))].join(' | ');
  const dates = [...new Set(sourceRows.map((row) => row.rawDate).filter(Boolean))].join(' | ');
  const nonYardLocations = [
    ...new Set(sourceRows.map((row) => row.location || '(blank)').filter((location) => compactKey(location) !== 'YARD')),
  ];
  const locations = nonYardLocations.join(' | ');

  if (!nonYardLocations.length) {
    return {
      sourceRows: sourceRowsText,
      completeListLocations: 'Yard only',
      completeListNames: names,
      completeListDates: dates,
      suggestedBin: '',
      suggestionBasis: '',
      confidence: 'none',
      reviewReason: 'COMPLETE LIST row is Yard only; no NoLocation move suggested',
    };
  }

  const suggestionsByBin = new Map<string, Suggestion>();
  for (const location of nonYardLocations) {
    if (location === '(blank)') continue;
    for (const alias of aliases) {
      const score = overlapScore(location, alias);
      if (score < 55) continue;

      const existing = suggestionsByBin.get(alias.bin) || { bin: alias.bin, bestScore: 0, labels: new Set<string>() };
      existing.bestScore = Math.max(existing.bestScore, score);
      existing.labels.add(alias.label);
      suggestionsByBin.set(alias.bin, existing);
    }
  }

  const suggestions = [...suggestionsByBin.values()].sort((a, b) => b.bestScore - a.bestScore || a.bin.localeCompare(b.bin));
  if (!suggestions.length) {
    return {
      sourceRows: sourceRowsText,
      completeListLocations: locations,
      completeListNames: names,
      completeListDates: dates,
      suggestedBin: '',
      suggestionBasis: '',
      confidence: 'none',
      reviewReason: locations === '(blank)' ? 'Blank location in COMPLETE LIST' : 'No matching linked bin or nickname found',
    };
  }

  const topScore = suggestions[0].bestScore;
  const topSuggestions = suggestions.filter((suggestion) => suggestion.bestScore === topScore);

  return {
    sourceRows: sourceRowsText,
    completeListLocations: locations,
    completeListNames: names,
    completeListDates: dates,
    suggestedBin: topSuggestions.map((suggestion) => suggestion.bin).join(' | '),
    suggestionBasis: topSuggestions
      .map((suggestion) => `${suggestion.bin} via ${[...suggestion.labels].slice(0, 3).join(' / ')} (${suggestion.bestScore})`)
      .join(' | '),
    confidence: topScore >= 80 && topSuggestions.length === 1 ? 'review-suggested' : 'low-review',
    reviewReason: topSuggestions.length > 1
      ? 'Multiple possible linked bins; manual check required'
      : 'Possible linked bin suggestion; below auto-move confidence or conflicted source data',
  };
}

function formatDate(value: string | Date | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

async function main() {
  const rowsByItem = await readCompleteListRows();
  const client = createClient();
  await client.connect();

  try {
    const [itemsResult, locationsResult, vansResult, hgvsResult, plantResult] = await Promise.all([
      client.query<InventoryItemRow>(`
        SELECT
          i.id,
          i.item_number,
          i.item_number_normalized,
          i.name,
          i.category,
          i.last_checked_at,
          i.status,
          l.name AS current_location
        FROM public.inventory_items i
        JOIN public.inventory_locations l ON l.id = i.location_id
        WHERE i.status = 'active'
          AND LOWER(l.name) = 'nolocation'
        ORDER BY i.item_number
      `),
      client.query<InventoryLocationRow>(`
        SELECT id, name, linked_van_id, linked_hgv_id, linked_plant_id
        FROM public.inventory_locations
        WHERE is_active = TRUE
      `),
      client.query<VanRow>(`
        SELECT id, reg_number, nickname
        FROM public.vans
        WHERE COALESCE(status, 'active') = 'active'
      `),
      client.query<HgvRow>(`
        SELECT id, reg_number, nickname
        FROM public.hgvs
        WHERE COALESCE(status, 'active') = 'active'
      `),
      client.query<PlantRow>(`
        SELECT id, plant_id, reg_number, nickname
        FROM public.plant
        WHERE status = 'active'
      `),
    ]);

    const aliases = buildAliases(locationsResult.rows, vansResult.rows, hgvsResult.rows, plantResult.rows);
    const headers = [
      'review_status',
      'item_number',
      'item_name',
      'category',
      'last_checked_at',
      'current_location',
      'complete_list_source_rows',
      'complete_list_location_values',
      'complete_list_item_names',
      'complete_list_checked_dates',
      'suggested_bin_for_manual_check',
      'suggestion_basis',
      'confidence',
      'review_reason',
      'inventory_item_id',
    ];
    const lines = [headers.join(',')];

    for (const item of itemsResult.rows) {
      const review = summarizeReview(rowsByItem.get(item.item_number_normalized), aliases);
      lines.push(
        [
          'needs_manual_review',
          item.item_number,
          item.name,
          item.category,
          formatDate(item.last_checked_at),
          item.current_location,
          review.sourceRows,
          review.completeListLocations,
          review.completeListNames,
          review.completeListDates,
          review.suggestedBin,
          review.suggestionBasis,
          review.confidence,
          review.reviewReason,
          item.id,
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    writeFileSync(resolve(process.cwd(), outputPath), `${lines.join('\n')}\n`, 'utf8');
    console.log(`Wrote ${outputPath}`);
    console.log(`Rows: ${itemsResult.rows.length}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Inventory manual review export failed:', error);
  process.exit(1);
});
