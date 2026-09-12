export const DAILY_ALLOCATION_TAB_FONT_MAX_PX = 14;
export const DAILY_ALLOCATION_TAB_FONT_MIN_PX = 9;

export function fitSingleLineFontSize(
  element: HTMLElement,
  options?: { maxPx?: number; minPx?: number },
): number {
  const maxPx = options?.maxPx ?? DAILY_ALLOCATION_TAB_FONT_MAX_PX;
  const minPx = options?.minPx ?? DAILY_ALLOCATION_TAB_FONT_MIN_PX;
  let size = maxPx;
  element.style.whiteSpace = 'nowrap';
  element.style.fontSize = `${size}px`;
  while (size > minPx && element.scrollWidth > element.clientWidth + 0.5) {
    size -= 0.5;
    element.style.fontSize = `${size}px`;
  }
  return size;
}
