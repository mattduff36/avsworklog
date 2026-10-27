import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadInventorySourceLocationHints,
  parseCompleteListLocationHints,
  resetInventorySourceLocationHintCacheForTests,
  type InventorySourceFileVersion,
  type InventorySourceLocationHintOverrides,
} from '@/lib/server/inventory-source-location-hints';

interface MutableHint {
  locations: string[];
  rows: number[];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function hintsOf(entries: Array<[string, MutableHint]>): Map<string, MutableHint> {
  return new Map(entries);
}

describe('parseCompleteListLocationHints', () => {
  it('keeps joined duplicates, blank cells, rich text, formulas, and row numbers', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('COMPLETE');
    sheet.addRow(['Item', 'Name', 'Location', 'Date']);
    sheet.addRow(['ab 1', 'Hammer', 'Yard', '2023-01-01']);
    sheet.addRow(['AB1', 'Hammer', 'Yard', '2023-01-02']);
    sheet.addRow(['AB1', 'Hammer', '   ', '']);
    sheet.addRow(['no number', 'Skipped', 'Yard', '2023-01-03']);
    sheet.addRow(['', '', '', '']);
    sheet.addRow(['placeholder', 'Bit', 'placeholder', 'placeholder']);
    sheet.getRow(7).getCell(1).value = { richText: [{ text: 'zx' }, { text: ' 9' }] };
    sheet.getRow(7).getCell(2).value = 'Bit';
    sheet.getRow(7).getCell(3).value = { text: 'Bin 2', hyperlink: 'https://example.test/bin' };
    sheet.getRow(7).getCell(4).value = new Date('2024-05-06T00:00:00.000Z');
    sheet.addRow(['cd-4', 'Saw', 'placeholder', '']);
    sheet.getRow(8).getCell(3).value = { formula: 'C2', result: 'Van 8' };
    sheet.addRow(['AB1', 'Hammer', 'Yard', '2023-01-04']);
    sheet.addRow(['   ', 'Ignored', 'Yard', '2023-01-05']);

    const hints = parseCompleteListLocationHints(workbook);

    expect(hints.size).toBe(3);
    expect(hints.get('AB1')).toEqual({ locations: ['Yard', '(blank)'], rows: [2, 3, 4, 9] });
    expect(hints.get('ZX9')).toEqual({ locations: ['Bin 2'], rows: [7] });
    expect(hints.get('CD-4')).toEqual({ locations: ['Van 8'], rows: [8] });
    expect(hints.get('NONUMBER')).toBeUndefined();
  });

  it('returns an empty map when the COMPLETE sheet is missing', () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('OTHER');

    expect(parseCompleteListLocationHints(workbook).size).toBe(0);
  });
});

describe('loadInventorySourceLocationHints', () => {
  beforeEach(() => {
    resetInventorySourceLocationHintCacheForTests();
  });

  it('parses once for repeated and concurrent reads of the same source version', async () => {
    let reads = 0;
    let seenPath = '';
    let releaseRead!: (value: Map<string, MutableHint>) => void;
    const version = { path: 'D:\\synthetic\\complete-list-a.xlsx', mtimeMs: 10, size: 100 };
    const overrides: InventorySourceLocationHintOverrides = {
      resolvePath: () => version.path,
      stat: async () => ({ mtimeMs: version.mtimeMs, size: version.size }),
      readHints: (absolutePath) => {
        reads += 1;
        seenPath = absolutePath;
        return new Promise((resolve) => {
          releaseRead = resolve;
        });
      },
    };

    const first = loadInventorySourceLocationHints(overrides);
    const second = loadInventorySourceLocationHints(overrides);
    await nextTurn();
    expect(reads).toBe(1);
    expect(seenPath).toBe(version.path);

    releaseRead(hintsOf([['AB1', { locations: ['Yard'], rows: [2] }]]));
    const [left, right] = await Promise.all([first, second]);
    const third = await loadInventorySourceLocationHints(overrides);

    expect(reads).toBe(1);
    expect(left.get('AB1')).toBe(right.get('AB1'));
    expect(third.get('AB1')).toBe(left.get('AB1'));
    expect(() => {
      const locations = left.get('AB1')?.locations as string[];
      locations.push('Mutated');
    }).toThrow(TypeError);
    expect(third.get('AB1')?.locations).toEqual(['Yard']);
  });

  it('reads again when the resolved path, mtime, or size changes', async () => {
    let reads = 0;
    const version = { path: 'D:\\synthetic\\complete-list-a.xlsx', mtimeMs: 10, size: 100 };
    const overrides: InventorySourceLocationHintOverrides = {
      resolvePath: () => version.path,
      stat: async () => ({ mtimeMs: version.mtimeMs, size: version.size }),
      readHints: async () => {
        reads += 1;
        return hintsOf([['AB1', { locations: [`read-${reads}`], rows: [reads] }]]);
      },
    };

    const first = await loadInventorySourceLocationHints(overrides);
    expect(first.get('AB1')).toEqual({ locations: ['read-1'], rows: [1] });

    version.mtimeMs = 11;
    const changedMtime = await loadInventorySourceLocationHints(overrides);
    expect(changedMtime.get('AB1')).toEqual({ locations: ['read-2'], rows: [2] });

    version.size = 101;
    const changedSize = await loadInventorySourceLocationHints(overrides);
    expect(changedSize.get('AB1')).toEqual({ locations: ['read-3'], rows: [3] });

    version.path = 'D:\\synthetic\\complete-list-b.xlsx';
    const changedPath = await loadInventorySourceLocationHints(overrides);
    expect(changedPath.get('AB1')).toEqual({ locations: ['read-4'], rows: [4] });
    expect(reads).toBe(4);

    const reused = await loadInventorySourceLocationHints(overrides);
    expect(reused.get('AB1')).toBe(changedPath.get('AB1'));
    expect(reads).toBe(4);
  });

  it('retries after a rejected read instead of caching the failure', async () => {
    let reads = 0;
    let fail = true;
    const overrides: InventorySourceLocationHintOverrides = {
      resolvePath: () => 'D:\\synthetic\\complete-list-a.xlsx',
      stat: async () => ({ mtimeMs: 1, size: 1 }),
      readHints: async () => {
        reads += 1;
        if (fail) throw new Error('unreadable');
        return hintsOf([['AB1', { locations: ['Yard'], rows: [2] }]]);
      },
    };

    await expect(loadInventorySourceLocationHints(overrides)).rejects.toThrow('unreadable');
    await expect(loadInventorySourceLocationHints(overrides)).rejects.toThrow('unreadable');
    expect(reads).toBe(2);

    fail = false;
    const recovered = await loadInventorySourceLocationHints(overrides);
    expect(recovered.get('AB1')).toEqual({ locations: ['Yard'], rows: [2] });
    await loadInventorySourceLocationHints(overrides);
    expect(reads).toBe(3);
  });

  it('keeps a newer in-flight load when an older load completes or fails', async () => {
    const stats = [deferred<InventorySourceFileVersion>(), deferred<InventorySourceFileVersion>()];
    let statCalls = 0;
    const reads: Array<ReturnType<typeof deferred<Map<string, MutableHint>>>> = [];
    const current = { mtimeMs: 2, size: 20 };
    const overrides: InventorySourceLocationHintOverrides = {
      resolvePath: () => 'D:\\synthetic\\complete-list-a.xlsx',
      stat: () => {
        statCalls += 1;
        if (statCalls <= stats.length) return stats[statCalls - 1].promise;
        return Promise.resolve(current);
      },
      readHints: () => {
        const pending = deferred<Map<string, MutableHint>>();
        reads.push(pending);
        return pending.promise;
      },
    };

    const older = loadInventorySourceLocationHints(overrides);
    const newer = loadInventorySourceLocationHints(overrides);
    const olderResult = older.then((hints) => hints, (error: unknown) => error);

    stats[1].resolve({ mtimeMs: 2, size: 20 });
    await nextTurn();
    expect(reads).toHaveLength(1);

    stats[0].resolve({ mtimeMs: 1, size: 10 });
    await nextTurn();
    expect(reads).toHaveLength(2);

    reads[1].resolve(hintsOf([['OLD', { locations: ['Old shed'], rows: [2] }]]));
    await nextTurn();
    const olderHints = await olderResult;
    expect(olderHints).not.toBeInstanceOf(Error);
    expect((olderHints as ReadonlyMap<string, MutableHint>).get('OLD')).toEqual({
      locations: ['Old shed'],
      rows: [2],
    });

    const joined = loadInventorySourceLocationHints(overrides);
    const joinedResult = joined.then((hints) => hints, (error: unknown) => error);
    await nextTurn();
    expect(reads).toHaveLength(2);
    expect(await Promise.race([
      joinedResult.then(() => 'settled'),
      Promise.resolve('pending'),
    ])).toBe('pending');

    reads[0].resolve(hintsOf([['NEW', { locations: ['New shed'], rows: [8] }]]));
    const newerHints = await newer;
    const joinedHints = await joinedResult;
    expect(newerHints.get('NEW')).toEqual({ locations: ['New shed'], rows: [8] });
    expect(joinedHints).toBe(newerHints);

    const cached = await loadInventorySourceLocationHints(overrides);
    expect(reads).toHaveLength(2);
    expect(cached.get('NEW')).toBe(newerHints.get('NEW'));
    expect(cached.get('OLD')).toBeUndefined();
  });

  it('retries the current version when a newer read fails after an older read failed', async () => {
    const stats = [deferred<InventorySourceFileVersion>(), deferred<InventorySourceFileVersion>()];
    let statCalls = 0;
    const reads: Array<ReturnType<typeof deferred<Map<string, MutableHint>>>> = [];
    const overrides: InventorySourceLocationHintOverrides = {
      resolvePath: () => 'D:\\synthetic\\complete-list-a.xlsx',
      stat: () => {
        statCalls += 1;
        if (statCalls <= stats.length) return stats[statCalls - 1].promise;
        return Promise.resolve({ mtimeMs: 2, size: 20 });
      },
      readHints: () => {
        const pending = deferred<Map<string, MutableHint>>();
        reads.push(pending);
        return pending.promise;
      },
    };

    const older = loadInventorySourceLocationHints(overrides);
    const newer = loadInventorySourceLocationHints(overrides);
    const olderResult = older.then((hints) => hints, (error: unknown) => error);
    const newerResult = newer.then((hints) => hints, (error: unknown) => error);

    stats[1].resolve({ mtimeMs: 2, size: 20 });
    await nextTurn();
    stats[0].resolve({ mtimeMs: 1, size: 10 });
    await nextTurn();
    expect(reads).toHaveLength(2);

    reads[1].reject(new Error('old unreadable'));
    await nextTurn();

    const joined = loadInventorySourceLocationHints(overrides);
    const joinedResult = joined.then((hints) => hints, (error: unknown) => error);
    await nextTurn();
    expect(reads).toHaveLength(2);

    reads[0].reject(new Error('new unreadable'));
    await expect(newerResult).resolves.toMatchObject({ message: 'new unreadable' });
    await expect(joinedResult).resolves.toMatchObject({ message: 'new unreadable' });
    await expect(olderResult).resolves.toMatchObject({ message: 'old unreadable' });

    const recovered = loadInventorySourceLocationHints(overrides);
    await nextTurn();
    expect(reads).toHaveLength(3);
    reads[2].resolve(hintsOf([['NEW', { locations: ['Recovered'], rows: [9] }]]));
    const recoveredHints = await recovered;
    expect(recoveredHints.get('NEW')).toEqual({ locations: ['Recovered'], rows: [9] });

    await loadInventorySourceLocationHints(overrides);
    expect(reads).toHaveLength(3);
  });

  it.each(['success', 'failure'] as const)(
    'keeps the newer cached version after an older registered load ends with %s',
    async (olderOutcome) => {
      let currentVersion = { mtimeMs: 1, size: 10 };
      const reads: Array<ReturnType<typeof deferred<Map<string, MutableHint>>>> = [];
      const overrides: InventorySourceLocationHintOverrides = {
        resolvePath: () => 'D:/synthetic/complete-list-race.xlsx',
        stat: async () => ({ ...currentVersion }),
        readHints: () => {
          const pending = deferred<Map<string, MutableHint>>();
          reads.push(pending);
          return pending.promise;
        },
      };

      const older = loadInventorySourceLocationHints(overrides);
      const olderResult = older.then(() => 'success', () => 'failure');
      await nextTurn();
      expect(reads).toHaveLength(1);

      currentVersion = { mtimeMs: 2, size: 20 };
      const newer = loadInventorySourceLocationHints(overrides);
      await nextTurn();
      expect(reads).toHaveLength(2);

      reads[1].resolve(hintsOf([
        ['NEW', { locations: ['New shed'], rows: [8] }],
      ]));
      const newerHints = await newer;

      if (olderOutcome === 'success') {
        reads[0].resolve(hintsOf([
          ['OLD', { locations: ['Old shed'], rows: [2] }],
        ]));
      } else {
        reads[0].reject(new Error('old unreadable'));
      }
      expect(await olderResult).toBe(olderOutcome);

      const reused = loadInventorySourceLocationHints(overrides);
      await nextTurn();
      expect(reads).toHaveLength(2);
      const cached = await reused;
      expect(cached.get('NEW')).toBe(newerHints.get('NEW'));
      expect(cached.get('OLD')).toBeUndefined();
    },
  );
});
