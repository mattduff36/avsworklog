import { config } from 'dotenv';
import { resolve } from 'path';
import ExcelJS from 'exceljs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const spreadsheetPath = 'data/COMPLETE LIST 2023.xlsx';
const spreadsheetSheet = 'COMPLETE';
const isApplyMode = process.argv.includes('--apply');

interface CompleteListRow {
  sourceRow: number;
  itemNumber: string;
  itemNumberNormalized: string;
  name: string;
  location: string;
  locationKey: string;
  rawDate: string;
}

interface InventoryItemRow {
  id: string;
  item_number: string;
  item_number_normalized: string;
  name: string;
  location_id: string;
  location_name: string;
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
  kind: 'van-reg' | 'van-nickname' | 'hgv-reg' | 'hgv-nickname' | 'plant-reg' | 'plant-id' | 'plant-nickname';
  locationId: string;
  locationName: string;
  score?: number;
  isOverride?: boolean;
}

interface MoveCandidate {
  item: InventoryItemRow;
  sourceRows: CompleteListRow[];
  targetLocationId: string;
  targetLocationName: string;
  matchLabel: string;
  matchKind: string;
}

interface ReviewEntry {
  location: string;
  count: number;
  examples: string[];
  reason: string;
  suggestion?: string;
}

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

const explicitAliasKeys = new Map<string, string>([
  ['FRNAKBARLOW', 'FRANKBARLOW'],
  ['FRANK', 'FRANKBARLOW'],
  ['FRANKVAN', 'FRANKBARLOW'],
  ['NATHERNHUBBARD', 'NATHANHUBBARD'],
  ['NATHERN', 'NATHANHUBBARD'],
  ['BRENDON', 'BRENDANBENNETT'],
  ['BRENDONS', 'BRENDANBENNETT'],
]);

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

function normalizeItemNumber(itemNumber: string): string {
  return itemNumber.toUpperCase().replace(/\s+/g, '').trim();
}

function isSoldOrScrap(values: string[]): boolean {
  return /\b(sold|scrap|scrapped)\b/i.test(values.join(' '));
}

function isMissingItemNumber(itemNumberNormalized: string): boolean {
  return !itemNumberNormalized || itemNumberNormalized === 'NONUMBER';
}

function fuzzyScore(sourceKey: string, aliasKey: string): number {
  if (!sourceKey || !aliasKey) return 0;
  if (sourceKey === aliasKey) return 100;
  if (sourceKey.includes(aliasKey) || aliasKey.includes(sourceKey)) return 80;
  return 0;
}

function addLocationReviewEntry(
  map: Map<string, ReviewEntry>,
  location: string,
  item: InventoryItemRow,
  reason: string,
  suggestion?: string
) {
  const key = compactKey(location) || '(blank)';
  const existing = map.get(key) || {
    location: location || '(blank)',
    count: 0,
    examples: [],
    reason,
    suggestion,
  };

  existing.count += 1;
  existing.reason = reason;
  existing.suggestion = suggestion || existing.suggestion;
  if (existing.examples.length < 5) {
    existing.examples.push(`${item.item_number}: ${item.name}`);
  }
  map.set(key, existing);
}

async function readCompleteListRows(): Promise<CompleteListRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(process.cwd(), spreadsheetPath));
  const worksheet = workbook.getWorksheet(spreadsheetSheet);
  if (!worksheet) {
    throw new Error(`${spreadsheetSheet} sheet not found in ${spreadsheetPath}`);
  }

  const rows: CompleteListRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const itemNumber = cellText(row.getCell(1).value);
    const name = cellText(row.getCell(2).value);
    const location = normalizeText(cellText(row.getCell(3).value));
    const rawDate = cellText(row.getCell(4).value);

    if (![itemNumber, name, location, rawDate].some(Boolean)) continue;
    if (isSoldOrScrap([itemNumber, name, location, rawDate])) continue;

    const itemNumberNormalized = normalizeItemNumber(itemNumber);
    if (isMissingItemNumber(itemNumberNormalized)) continue;

    rows.push({
      sourceRow: rowNumber,
      itemNumber,
      itemNumberNormalized,
      name,
      location,
      locationKey: compactKey(location),
      rawDate,
    });
  }

  return rows;
}

function buildAssetAliases(params: {
  locations: InventoryLocationRow[];
  vans: VanRow[];
  hgvs: HgvRow[];
  plant: PlantRow[];
}): AssetAlias[] {
  const locationByVanId = new Map(
    params.locations.filter((location) => location.linked_van_id).map((location) => [location.linked_van_id!, location])
  );
  const locationByHgvId = new Map(
    params.locations.filter((location) => location.linked_hgv_id).map((location) => [location.linked_hgv_id!, location])
  );
  const locationByPlantId = new Map(
    params.locations.filter((location) => location.linked_plant_id).map((location) => [location.linked_plant_id!, location])
  );
  const aliases: AssetAlias[] = [];

  for (const van of params.vans) {
    const location = locationByVanId.get(van.id);
    if (!location) continue;
    aliases.push({
      key: compactKey(van.reg_number),
      label: van.reg_number,
      kind: 'van-reg',
      locationId: location.id,
      locationName: location.name,
    });
    if (van.nickname) {
      aliases.push({
        key: compactKey(van.nickname),
        label: `${van.nickname} (${van.reg_number})`,
        kind: 'van-nickname',
        locationId: location.id,
        locationName: location.name,
      });
    }
  }

  for (const hgv of params.hgvs) {
    const location = locationByHgvId.get(hgv.id);
    if (!location) continue;
    aliases.push({
      key: compactKey(hgv.reg_number),
      label: hgv.reg_number,
      kind: 'hgv-reg',
      locationId: location.id,
      locationName: location.name,
    });
    if (hgv.nickname) {
      aliases.push({
        key: compactKey(hgv.nickname),
        label: `${hgv.nickname} (${hgv.reg_number})`,
        kind: 'hgv-nickname',
        locationId: location.id,
        locationName: location.name,
      });
    }
  }

  for (const plant of params.plant) {
    const location = locationByPlantId.get(plant.id);
    if (!location) continue;
    if (plant.reg_number) {
      aliases.push({
        key: compactKey(plant.reg_number),
        label: plant.reg_number,
        kind: 'plant-reg',
        locationId: location.id,
        locationName: location.name,
      });
    }
    if (plant.plant_id) {
      aliases.push({
        key: compactKey(plant.plant_id),
        label: plant.plant_id,
        kind: 'plant-id',
        locationId: location.id,
        locationName: location.name,
      });
    }
    if (plant.nickname) {
      aliases.push({
        key: compactKey(plant.nickname),
        label: plant.nickname,
        kind: 'plant-nickname',
        locationId: location.id,
        locationName: location.name,
      });
    }
  }

  return aliases.filter((alias) => alias.key);
}

function resolveLocationAlias(locationKey: string, aliases: AssetAlias[]): AssetAlias[] {
  const explicitAliasKey = explicitAliasKeys.get(locationKey);
  if (explicitAliasKey) {
    return aliases
      .filter((alias) => alias.key === explicitAliasKey)
      .map((alias) => ({ ...alias, score: 95, isOverride: true }));
  }

  return aliases
    .map((alias) => ({ ...alias, score: fuzzyScore(locationKey, alias.key) }))
    .filter((alias) => alias.score >= 80)
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind));
}

function resolveMoveCandidate(
  item: InventoryItemRow,
  sourceRows: CompleteListRow[],
  aliases: AssetAlias[],
  reviewMap: Map<string, ReviewEntry>
): MoveCandidate | null {
  const nonYardRows = sourceRows.filter((row) => row.locationKey && row.locationKey !== 'YARD');
  if (nonYardRows.length === 0) return null;

  const resolvedRows = nonYardRows.map((row) => {
    const matches = resolveLocationAlias(row.locationKey, aliases);
    const top = matches[0];
    const second = matches[1];
    const isSingleTarget = top && (!second || top.score! > second.score! || top.locationId === second.locationId);

    return {
      sourceRow: row,
      matches,
      target: isSingleTarget ? top : null,
    };
  });

  const unresolved = resolvedRows.filter((row) => !row.target);
  if (unresolved.length > 0) {
    for (const row of unresolved) {
      const suggestion = row.matches.length
        ? row.matches.slice(0, 4).map((match) => `${match.locationName} via ${match.label}`).join(' | ')
        : undefined;
      addLocationReviewEntry(
        reviewMap,
        row.sourceRow.location,
        item,
        row.matches.length ? 'Ambiguous asset/nickname match' : 'No confident linked asset match',
        suggestion
      );
    }
    return null;
  }

  const targetLocationIds = new Set(resolvedRows.map((row) => row.target!.locationId));
  if (targetLocationIds.size !== 1) {
    for (const row of resolvedRows) {
      addLocationReviewEntry(
        reviewMap,
        row.sourceRow.location,
        item,
        'Conflicting target bins across duplicate spreadsheet rows',
        row.target?.locationName
      );
    }
    return null;
  }

  const target = resolvedRows[0].target!;
  return {
    item,
    sourceRows: nonYardRows,
    targetLocationId: target.locationId,
    targetLocationName: target.locationName,
    matchLabel: target.label,
    matchKind: target.isOverride ? 'moderate-explicit-alias' : target.kind,
  };
}

function printReviewSection(title: string, entries: ReviewEntry[]) {
  console.log(`\n${title}`);
  if (entries.length === 0) {
    console.log('  None');
    return;
  }

  for (const entry of entries) {
    const suggestion = entry.suggestion ? ` | suggested: ${entry.suggestion}` : '';
    console.log(`  - ${entry.location}: ${entry.count} item(s) | ${entry.reason}${suggestion}`);
    console.log(`    examples: ${entry.examples.join('; ')}`);
  }
}

async function applyMoves(client: pg.Client, candidates: MoveCandidate[]) {
  await client.query('BEGIN');
  try {
    for (const candidate of candidates) {
      await client.query(
        `
          UPDATE public.inventory_items
          SET location_id = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [candidate.item.id, candidate.targetLocationId]
      );

      const sourceLocations = Array.from(new Set(candidate.sourceRows.map((row) => row.location))).join(', ');
      await client.query(
        `
          INSERT INTO public.inventory_item_movements (
            item_id,
            from_location_id,
            to_location_id,
            note
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          candidate.item.id,
          candidate.item.location_id,
          candidate.targetLocationId,
          `Reconciled from COMPLETE LIST 2023.xlsx location: ${sourceLocations}`,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const completeListRows = await readCompleteListRows();
  const rowsByItemNumber = new Map<string, CompleteListRow[]>();
  for (const row of completeListRows) {
    const existing = rowsByItemNumber.get(row.itemNumberNormalized) || [];
    existing.push(row);
    rowsByItemNumber.set(row.itemNumberNormalized, existing);
  }

  const client = createClient();
  await client.connect();

  try {
    const [locationsResult, itemsResult, vansResult, hgvsResult, plantResult, noLocationCountBefore] = await Promise.all([
      client.query<InventoryLocationRow>(`
        SELECT id, name, linked_van_id, linked_hgv_id, linked_plant_id
        FROM public.inventory_locations
        WHERE is_active = TRUE
        ORDER BY name
      `),
      client.query<InventoryItemRow>(`
        SELECT
          i.id,
          i.item_number,
          i.item_number_normalized,
          i.name,
          i.location_id,
          l.name AS location_name
        FROM public.inventory_items i
        JOIN public.inventory_locations l ON l.id = i.location_id
        WHERE i.status = 'active'
          AND LOWER(l.name) = 'nolocation'
        ORDER BY i.item_number
      `),
      client.query<VanRow>(`
        SELECT id, reg_number, nickname
        FROM public.vans
        WHERE COALESCE(status, 'active') = 'active'
        ORDER BY reg_number
      `),
      client.query<HgvRow>(`
        SELECT id, reg_number, nickname
        FROM public.hgvs
        WHERE COALESCE(status, 'active') = 'active'
        ORDER BY reg_number
      `),
      client.query<PlantRow>(`
        SELECT id, plant_id, reg_number, nickname
        FROM public.plant
        WHERE status = 'active'
        ORDER BY plant_id
      `),
      client.query<{ count: string }>(`
        SELECT COUNT(*)::TEXT AS count
        FROM public.inventory_items i
        JOIN public.inventory_locations l ON l.id = i.location_id
        WHERE i.status = 'active'
          AND LOWER(l.name) = 'nolocation'
      `),
    ]);

    const aliases = buildAssetAliases({
      locations: locationsResult.rows,
      vans: vansResult.rows,
      hgvs: hgvsResult.rows,
      plant: plantResult.rows,
    });
    const reviewMap = new Map<string, ReviewEntry>();
    const noSpreadsheetRows: ReviewEntry[] = [];
    const candidates: MoveCandidate[] = [];

    for (const item of itemsResult.rows) {
      const sourceRows = rowsByItemNumber.get(item.item_number_normalized);
      if (!sourceRows?.length) {
        noSpreadsheetRows.push({
          location: '(not in COMPLETE LIST 2023.xlsx)',
          count: 1,
          examples: [`${item.item_number}: ${item.name}`],
          reason: 'No matching spreadsheet row',
        });
        continue;
      }

      const candidate = resolveMoveCandidate(item, sourceRows, aliases, reviewMap);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    const reviewEntries = Array.from(reviewMap.values()).sort((a, b) => b.count - a.count || a.location.localeCompare(b.location));
    const beforeNoLocation = Number.parseInt(noLocationCountBefore.rows[0]?.count || '0', 10);

    console.log(`Inventory COMPLETE LIST reconciliation (${isApplyMode ? 'APPLY' : 'DRY RUN'})`);
    console.log(`Spreadsheet rows considered: ${completeListRows.length}`);
    console.log(`NoLocation items before: ${beforeNoLocation}`);
    console.log(`High-confidence move candidates: ${candidates.length}`);

    console.log('\nMove candidates');
    if (candidates.length === 0) {
      console.log('  None');
    } else {
      for (const candidate of candidates) {
        const sourceLocations = Array.from(new Set(candidate.sourceRows.map((row) => row.location))).join(', ');
        console.log(
          `  - ${candidate.item.item_number}: ${candidate.item.name} | ${sourceLocations} -> ${candidate.targetLocationName} (${candidate.matchLabel}, ${candidate.matchKind})`
        );
      }
    }

    printReviewSection('Manual review: ambiguous or unmatched spreadsheet locations', reviewEntries);
    printReviewSection('Manual review: active NoLocation items not found in COMPLETE LIST', noSpreadsheetRows);

    if (isApplyMode) {
      await applyMoves(client, candidates);
      const afterResult = await client.query<{ count: string }>(`
        SELECT COUNT(*)::TEXT AS count
        FROM public.inventory_items i
        JOIN public.inventory_locations l ON l.id = i.location_id
        WHERE i.status = 'active'
          AND LOWER(l.name) = 'nolocation'
      `);
      const afterNoLocation = Number.parseInt(afterResult.rows[0]?.count || '0', 10);
      console.log('\nApply complete');
      console.log(`Moved items: ${candidates.length}`);
      console.log(`NoLocation items after: ${afterNoLocation}`);
    } else {
      console.log('\nDry run only. Re-run with --apply to move high-confidence candidates.');
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Inventory reconciliation failed:', error);
  process.exit(1);
});
