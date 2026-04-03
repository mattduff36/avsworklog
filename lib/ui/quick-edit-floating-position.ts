export interface FloatingRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface FloatingViewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

export interface FloatingPositionOptions {
  triggerRect: FloatingRect;
  panelSize: FloatingSize;
  viewport: FloatingViewport;
  edgePadding?: number;
  gap?: number;
}

export interface FloatingPositionResult {
  top: number;
  left: number;
  maxHeight: number;
  verticalPlacement: 'below' | 'above';
  horizontalPlacement: 'right' | 'left';
}

export function computeQuickEditFloatingPosition({
  triggerRect,
  panelSize,
  viewport,
  edgePadding = 8,
  gap = 6,
}: FloatingPositionOptions): FloatingPositionResult {
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);

  const constrainedMaxHeight = Math.max(120, viewportHeight - edgePadding * 2);
  const constrainedHeight = Math.min(panelSize.height, constrainedMaxHeight);
  const constrainedWidth = Math.min(panelSize.width, Math.max(120, viewportWidth - edgePadding * 2));

  const hasRoomBelow = triggerRect.bottom + gap + constrainedHeight + edgePadding <= viewportHeight;
  const hasRoomRight = triggerRect.left + constrainedWidth + edgePadding <= viewportWidth;

  const verticalPlacement: 'below' | 'above' = hasRoomBelow ? 'below' : 'above';
  const horizontalPlacement: 'right' | 'left' = hasRoomRight ? 'right' : 'left';

  const preferredTop = verticalPlacement === 'below'
    ? triggerRect.bottom + gap
    : triggerRect.top - constrainedHeight - gap;
  const preferredLeft = horizontalPlacement === 'right'
    ? triggerRect.left
    : triggerRect.right - constrainedWidth;

  const minTop = edgePadding;
  const maxTop = Math.max(edgePadding, viewportHeight - constrainedHeight - edgePadding);
  const minLeft = edgePadding;
  const maxLeft = Math.max(edgePadding, viewportWidth - constrainedWidth - edgePadding);

  const top = Math.min(Math.max(preferredTop, minTop), maxTop);
  const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);

  return {
    top,
    left,
    maxHeight: constrainedMaxHeight,
    verticalPlacement,
    horizontalPlacement,
  };
}
