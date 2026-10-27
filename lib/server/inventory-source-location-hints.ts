import { stat } from 'fs/promises';
import { resolve } from 'path';
import ExcelJS from 'exceljs';
import { normalizeInventoryItemNumber } from '@/lib/server/inventory-auth';

export interface SourceLocationHint {
  readonly locations: readonly string[];
  readonly rows: readonly number[];
}

export interface InventorySourceFileVersion {
  mtimeMs: number;
  size: number;
}

export interface InventorySourceLocationHintOverrides {
  resolvePath: () => string;
  stat: (absolutePath: string) => Promise<InventorySourceFileVersion>;
  readHints: (absolutePath: string) => Promise<Map<string, { locations: readonly string[]; rows: readonly number[] }>>;
}

// Same-file string literal as the previous route read, so server file tracing can see the workbook.
const completeListPath = 'data/COMPLETE LIST 2023.xlsx';

interface MutableSourceLocationHint {
  locations: string[];
  rows: number[];
}

interface CacheState {
  versionKey: string | null;
  hints: ReadonlyMap<string, SourceLocationHint> | null;
  inFlight: {
    versionKey: string;
    epoch: number;
    promise: Promise<ReadonlyMap<string, SourceLocationHint>>;
  } | null;
}

const cache: CacheState = {
  versionKey: null,
  hints: null,
  inFlight: null,
};

let scheduleEpoch = 0;
let newestAcceptedEpoch = 0;

class ReadOnlyHintMap implements ReadonlyMap<string, SourceLocationHint> {
  readonly [Symbol.toStringTag] = 'Map';

  constructor(private readonly inner: Map<string, SourceLocationHint>) {}

  get size(): number {
    return this.inner.size;
  }

  get(key: string): SourceLocationHint | undefined {
    return this.inner.get(key);
  }

  has(key: string): boolean {
    return this.inner.has(key);
  }

  entries(): MapIterator<[string, SourceLocationHint]> {
    return this.inner.entries();
  }

  keys(): MapIterator<string> {
    return this.inner.keys();
  }

  values(): MapIterator<SourceLocationHint> {
    return this.inner.values();
  }

  forEach(
    callback: (value: SourceLocationHint, key: string, map: ReadonlyMap<string, SourceLocationHint>) => void,
    thisArg?: unknown,
  ): void {
    this.inner.forEach((value, key) => {
      callback.call(thisArg, value, key, this);
    });
  }

  [Symbol.iterator](): MapIterator<[string, SourceLocationHint]> {
    return this.entries();
  }
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

function compactLocation(value: string): string {
  return value.trim() || '(blank)';
}

function publishHints(
  source: Map<string, { locations: readonly string[]; rows: readonly number[] }>,
): ReadOnlyHintMap {
  const published = new Map<string, SourceLocationHint>();
  for (const [itemNumber, hint] of source) {
    published.set(itemNumber, Object.freeze({
      locations: Object.freeze([...hint.locations]),
      rows: Object.freeze([...hint.rows]),
    }));
  }
  return new ReadOnlyHintMap(published);
}

function collectCompleteListLocationHints(workbook: ExcelJS.Workbook): Map<string, MutableSourceLocationHint> {
  const worksheet = workbook.getWorksheet('COMPLETE');
  const hints = new Map<string, MutableSourceLocationHint>();
  if (!worksheet) return hints;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const itemNumber = cellText(row.getCell(1).value);
    const name = cellText(row.getCell(2).value);
    const location = compactLocation(cellText(row.getCell(3).value));
    const rawDate = cellText(row.getCell(4).value);
    if (![itemNumber, name, location, rawDate].some(Boolean)) continue;

    const normalizedItemNumber = normalizeInventoryItemNumber(itemNumber);
    if (!normalizedItemNumber || normalizedItemNumber === 'NONUMBER') continue;

    const existing = hints.get(normalizedItemNumber) || { locations: [], rows: [] };
    if (!existing.locations.includes(location)) existing.locations.push(location);
    existing.rows.push(rowNumber);
    hints.set(normalizedItemNumber, existing);
  }

  return hints;
}

export function parseCompleteListLocationHints(
  workbook: ExcelJS.Workbook,
): ReadonlyMap<string, SourceLocationHint> {
  return publishHints(collectCompleteListLocationHints(workbook));
}

function packagedCompleteListPath(): string {
  return resolve(process.cwd(), completeListPath);
}

async function statPackagedCompleteList(): Promise<InventorySourceFileVersion> {
  const fileStat = await stat(resolve(process.cwd(), completeListPath));
  return { mtimeMs: fileStat.mtimeMs, size: fileStat.size };
}

async function readPackagedCompleteListHints(): Promise<Map<string, MutableSourceLocationHint>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(process.cwd(), completeListPath));
  return collectCompleteListLocationHints(workbook);
}

function resolveLoader(overrides?: InventorySourceLocationHintOverrides): InventorySourceLocationHintOverrides {
  if (!overrides) {
    return {
      resolvePath: packagedCompleteListPath,
      stat: statPackagedCompleteList,
      readHints: readPackagedCompleteListHints,
    };
  }

  return overrides;
}

function sourceVersionKey(absolutePath: string, fileVersion: InventorySourceFileVersion): string {
  return JSON.stringify([absolutePath, fileVersion.mtimeMs, fileVersion.size]);
}

function rememberSuccessfulLoad(
  promise: Promise<ReadonlyMap<string, SourceLocationHint>>,
  versionKey: string,
  hints: ReadOnlyHintMap,
): ReadOnlyHintMap {
  if (cache.inFlight?.promise === promise) {
    cache.versionKey = versionKey;
    cache.hints = hints;
    cache.inFlight = null;
  }
  return hints;
}

function forgetFailedLoad(
  promise: Promise<ReadonlyMap<string, SourceLocationHint>>,
  error: unknown,
): never {
  if (cache.inFlight?.promise === promise) {
    cache.inFlight = null;
  }
  throw error;
}

function readCachedOrLoad(
  versionKey: string,
  epoch: number,
  load: () => Promise<Map<string, { locations: readonly string[]; rows: readonly number[] }>>,
): Promise<ReadonlyMap<string, SourceLocationHint>> {
  if (cache.versionKey === versionKey && cache.hints) {
    return Promise.resolve(cache.hints);
  }
  if (cache.inFlight?.versionKey === versionKey) {
    return cache.inFlight.promise;
  }
  // A stat that started earlier must not replace the current version's load or entry.
  if (epoch < newestAcceptedEpoch) {
    return load().then((hints) => publishHints(hints));
  }

  newestAcceptedEpoch = epoch;
  const registered: { promise: Promise<ReadonlyMap<string, SourceLocationHint>> | null } = { promise: null };
  const promise = load()
    .then((hints) => {
      if (!registered.promise) throw new Error('Inventory hint load was not registered');
      return rememberSuccessfulLoad(registered.promise, versionKey, publishHints(hints));
    })
    .catch((error: unknown) => {
      if (!registered.promise) throw error;
      return forgetFailedLoad(registered.promise, error);
    });
  registered.promise = promise;
  cache.inFlight = { versionKey, epoch, promise };
  return promise;
}

export async function loadInventorySourceLocationHints(
  overrides?: InventorySourceLocationHintOverrides,
): Promise<ReadonlyMap<string, SourceLocationHint>> {
  const epoch = ++scheduleEpoch;
  const loader = resolveLoader(overrides);
  const absolutePath = loader.resolvePath();
  const fileVersion = await loader.stat(absolutePath);
  return readCachedOrLoad(
    sourceVersionKey(absolutePath, fileVersion),
    epoch,
    () => loader.readHints(absolutePath),
  );
}

export function resetInventorySourceLocationHintCacheForTests(): void {
  cache.versionKey = null;
  cache.hints = null;
  cache.inFlight = null;
  scheduleEpoch = 0;
  newestAcceptedEpoch = 0;
}
