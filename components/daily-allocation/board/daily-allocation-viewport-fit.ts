export const DAILY_ALLOCATION_BOARD_MIN_SCALE = 0.6;
/** Fallback when the board has not been measured yet. Fits nowrap title rows plus the 350px Resources column. */
export const DAILY_ALLOCATION_BOARD_MIN_CONTENT_WIDTH_PX = 1480;
export const DAILY_ALLOCATION_MOBILE_MAX_WIDTH_PX = 767;

const RESOURCES_COLUMN_PX = 350;
const GRID_GAP_PX = 16;
const CARD_X_PADDING_PX = 48;

export type DailyAllocationViewportFitMode = 'full' | 'scaled' | 'blocked';

export interface DailyAllocationViewportFit {
  mode: DailyAllocationViewportFitMode;
  scale: number;
}

export function getDailyAllocationViewportFit(input: {
  availableWidth: number;
  minContentWidth: number;
  isMobile: boolean;
  isCoarsePointer?: boolean;
}): DailyAllocationViewportFit {
  if (input.isMobile) return { mode: 'blocked', scale: 0 };
  if (input.isCoarsePointer) return { mode: 'full', scale: 1 };
  if (input.availableWidth <= 0) return { mode: 'full', scale: 1 };
  const scale = input.availableWidth / Math.max(1, input.minContentWidth);
  if (scale < DAILY_ALLOCATION_BOARD_MIN_SCALE) return { mode: 'blocked', scale };
  if (scale >= 1) return { mode: 'full', scale: 1 };
  return { mode: 'scaled', scale };
}

export function getDailyAllocationRemainingViewportHeight(input: {
  top: number;
  viewportHeight: number;
  bottomInset: number;
}): number {
  return Math.max(0, Math.floor(input.viewportHeight - input.top - input.bottomInset));
}

export function readDailyAllocationMainBottomInset(element: HTMLElement): number {
  const main = element.closest('main');
  if (!main || typeof window.getComputedStyle !== 'function') return 0;
  const value = Number.parseFloat(window.getComputedStyle(main).paddingBottom);
  return Number.isFinite(value) ? value : 0;
}

export function getDailyAllocationElementVisualScale(element: HTMLElement): number {
  const layoutWidth = element.offsetWidth;
  if (layoutWidth <= 0) return 1;
  const scale = element.getBoundingClientRect().width / layoutWidth;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function measureFlexChildrenWidth(el: HTMLElement, gapPx: number): number {
  const children = Array.from(el.children) as HTMLElement[];
  if (children.length === 0) {
    return Math.ceil(el.scrollWidth);
  }
  const childrenWidth = children.reduce((sum, child) => sum + child.offsetWidth, 0);
  return Math.ceil(childrenWidth + gapPx * Math.max(0, children.length - 1));
}

export function measureDailyAllocationMinContentWidth(root: HTMLElement): number {
  const titleRow = root.querySelector<HTMLElement>('[data-testid="daily-allocation-board-title-row"]');
  const boardMin = titleRow
    ? measureFlexChildrenWidth(titleRow, 12) + CARD_X_PADDING_PX + RESOURCES_COLUMN_PX + GRID_GAP_PX
    : 0;
  return Math.max(DAILY_ALLOCATION_BOARD_MIN_CONTENT_WIDTH_PX, boardMin);
}
