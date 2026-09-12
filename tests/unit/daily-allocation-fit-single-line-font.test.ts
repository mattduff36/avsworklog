import { describe, expect, it } from 'vitest';
import { fitSingleLineFontSize } from '@/components/daily-allocation/board/fit-single-line-font';

function fakeTab(clientWidth: number, naturalWidth: number): HTMLElement {
  let fontSize = '';
  const element = {
    clientWidth,
    style: {
      get fontSize() { return fontSize; },
      set fontSize(value: string) { fontSize = value; },
      whiteSpace: '',
    },
    get scrollWidth() {
      const size = Number.parseFloat(fontSize) || 14;
      return naturalWidth * (size / 14);
    },
  };
  return element as HTMLElement;
}

describe('fitSingleLineFontSize', () => {
  it('keeps the default size when the label already fits', () => {
    expect(fitSingleLineFontSize(fakeTab(120, 90))).toBe(14);
  });

  it('shrinks until a long label fits on one line', () => {
    expect(fitSingleLineFontSize(fakeTab(80, 100))).toBe(11);
  });

  it('stops at the minimum size when the label still overflows', () => {
    expect(fitSingleLineFontSize(fakeTab(80, 140))).toBe(9);
  });
});
