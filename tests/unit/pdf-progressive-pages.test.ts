import { describe, expect, it, vi } from 'vitest';
import type { PDFPageProxy } from 'pdfjs-dist';
import { bufferedPdfPages, readPdfPageSizes } from '@/components/pdf/PDFCanvasRenderer';

describe('progressive PDF page planning', () => {
  it('keeps only visible pages and one neighbouring page on either side', () => {
    expect(bufferedPdfPages([1, 2], 100)).toEqual([1, 2, 3]);
    expect(bufferedPdfPages([40], 100)).toEqual([39, 40, 41]);
    expect(bufferedPdfPages([99, 100], 100)).toEqual([98, 99, 100]);
    expect(bufferedPdfPages([], 100)).toEqual([]);
    expect(bufferedPdfPages([4, 4, 5], 10)).toEqual([3, 4, 5, 6]);
  });

  it('reads mixed-size/rotated metadata in bounded groups without rasterizing', async () => {
    let active = 0;
    let maximum = 0;
    const render = vi.fn(() => { throw new Error('Metadata must not rasterize'); });
    const cleanup = vi.fn();
    const sizes = await readPdfPageSizes({
      numPages: 11,
      getPage: async (number) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return { getViewport: () => number % 2 ? { width: 600, height: 800 } : { width: 800, height: 600 }, cleanup, render } as unknown as PDFPageProxy;
      },
    });
    expect(maximum).toBe(4);
    expect(sizes).toHaveLength(11);
    expect(sizes.slice(0, 2)).toEqual([{ width: 600, height: 800 }, { width: 800, height: 600 }]);
    expect(render).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(11);
  });

  it('stops requesting metadata after the current batch when cancelled', async () => {
    let calls = 0;
    const getPage = vi.fn(async () => {
      calls += 1;
      return { getViewport: () => ({ width: 600, height: 800 }), cleanup: () => {} } as unknown as PDFPageProxy;
    });
    expect(await readPdfPageSizes({ numPages: 100, getPage }, () => calls >= 4)).toEqual([]);
    expect(getPage).toHaveBeenCalledTimes(4);
  });
});
