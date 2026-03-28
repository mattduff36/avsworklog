import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecentTextValues, recordRecentTextValue } from '@/lib/utils/recentTextValues';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('recentTextValues', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { localStorage: createLocalStorageMock() } as unknown as Window & typeof globalThis);
  });

  it('returns an empty list when nothing is stored', () => {
    expect(getRecentTextValues('user-1', 'timesheet_plant_hirer')).toEqual([]);
  });

  it('records recent values with dedupe and most-recent-first ordering', () => {
    recordRecentTextValue('user-1', 'timesheet_plant_hirer', 'Acme Hire');
    recordRecentTextValue('user-1', 'timesheet_plant_hirer', 'North Site');
    recordRecentTextValue('user-1', 'timesheet_plant_hirer', 'acme hire');

    expect(getRecentTextValues('user-1', 'timesheet_plant_hirer')).toEqual([
      'acme hire',
      'North Site',
    ]);
  });

  it('respects max list length', () => {
    recordRecentTextValue('user-1', 'timesheet_plant_hirer', 'One', 2);
    recordRecentTextValue('user-1', 'timesheet_plant_hirer', 'Two', 2);
    recordRecentTextValue('user-1', 'timesheet_plant_hirer', 'Three', 2);

    expect(getRecentTextValues('user-1', 'timesheet_plant_hirer')).toEqual([
      'Three',
      'Two',
    ]);
  });
});
