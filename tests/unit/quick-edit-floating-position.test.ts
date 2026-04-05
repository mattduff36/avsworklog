import { describe, expect, it } from 'vitest';
import { computeQuickEditFloatingPosition } from '@/lib/ui/quick-edit-floating-position';

describe('computeQuickEditFloatingPosition', () => {
  it('flips above when there is not enough room below', () => {
    const result = computeQuickEditFloatingPosition({
      triggerRect: { top: 580, left: 120, right: 220, bottom: 610, width: 100, height: 30 },
      panelSize: { width: 300, height: 260 },
      viewport: { width: 1280, height: 640, scrollX: 0, scrollY: 0 },
    });

    expect(result.verticalPlacement).toBe('above');
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.top + 260).toBeLessThanOrEqual(640 - 8);
  });

  it('flips left when there is not enough room to the right', () => {
    const result = computeQuickEditFloatingPosition({
      triggerRect: { top: 200, left: 1120, right: 1200, bottom: 232, width: 80, height: 32 },
      panelSize: { width: 320, height: 240 },
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    });

    expect(result.horizontalPlacement).toBe('left');
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left + 320).toBeLessThanOrEqual(1280 - 8);
  });

  it('keeps bottom-right trigger popup fully visible with clamping', () => {
    const result = computeQuickEditFloatingPosition({
      triggerRect: { top: 700, left: 1160, right: 1240, bottom: 736, width: 80, height: 36 },
      panelSize: { width: 320, height: 320 },
      viewport: { width: 1280, height: 744, scrollX: 0, scrollY: 0 },
    });

    expect(result.verticalPlacement).toBe('above');
    expect(result.horizontalPlacement).toBe('left');
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.top + 320).toBeLessThanOrEqual(744 - 8);
    expect(result.left + 320).toBeLessThanOrEqual(1280 - 8);
  });

  it('recomputes safely for resize-driven smaller viewport', () => {
    const initial = computeQuickEditFloatingPosition({
      triggerRect: { top: 260, left: 520, right: 600, bottom: 292, width: 80, height: 32 },
      panelSize: { width: 320, height: 260 },
      viewport: { width: 1440, height: 900, scrollX: 0, scrollY: 0 },
    });
    const resized = computeQuickEditFloatingPosition({
      triggerRect: { top: 260, left: 520, right: 600, bottom: 292, width: 80, height: 32 },
      panelSize: { width: 320, height: 260 },
      viewport: { width: 700, height: 420, scrollX: 0, scrollY: 0 },
    });

    expect(initial.left).not.toBe(resized.left);
    expect(resized.left).toBeGreaterThanOrEqual(8);
    expect(resized.top).toBeGreaterThanOrEqual(8);
    expect(resized.left + 320).toBeLessThanOrEqual(700 - 8);
    expect(resized.top + 260).toBeLessThanOrEqual(420 - 8);
  });

  it('recomputes safely for scroll-driven trigger movement', () => {
    const beforeScroll = computeQuickEditFloatingPosition({
      triggerRect: { top: 420, left: 200, right: 280, bottom: 452, width: 80, height: 32 },
      panelSize: { width: 320, height: 240 },
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 200 },
    });
    const afterScroll = computeQuickEditFloatingPosition({
      triggerRect: { top: 620, left: 200, right: 280, bottom: 652, width: 80, height: 32 },
      panelSize: { width: 320, height: 240 },
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 600 },
    });

    expect(beforeScroll.verticalPlacement).toBe('below');
    expect(afterScroll.verticalPlacement).toBe('above');
    expect(afterScroll.top).toBeGreaterThanOrEqual(8);
    expect(afterScroll.top + 240).toBeLessThanOrEqual(720 - 8);
  });

  it('caps height and keeps panel inside viewport when panel is taller than viewport', () => {
    const result = computeQuickEditFloatingPosition({
      triggerRect: { top: 200, left: 40, right: 140, bottom: 232, width: 100, height: 32 },
      panelSize: { width: 320, height: 1200 },
      viewport: { width: 1024, height: 500, scrollX: 0, scrollY: 0 },
    });

    expect(result.maxHeight).toBe(484);
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(500 - 8);
  });

  it('limits maxHeight based on final clamped top for short panels', () => {
    const result = computeQuickEditFloatingPosition({
      triggerRect: { top: 360, left: 220, right: 300, bottom: 392, width: 80, height: 32 },
      panelSize: { width: 320, height: 100 },
      viewport: { width: 1024, height: 500, scrollX: 0, scrollY: 0 },
    });

    // Old behavior returned viewport max (484), which can overflow when top > edge padding.
    expect(result.top).toBe(254);
    expect(result.maxHeight).toBe(238);
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(500 - 8);
  });
});
