/**
 * Scrolls an element into view and applies a subtle validation highlight animation.
 * The highlight is removed when the user focuses or clicks the element.
 */

const VALIDATION_HIGHLIGHT_CLASS = 'animate-validation-glow';
let highlightedElement: Element | null = null;

function clearHighlight(): void {
  if (highlightedElement) {
    highlightedElement.classList.remove(VALIDATION_HIGHLIGHT_CLASS);
    highlightedElement = null;
  }
}

export function scrollAndHighlightValidationTarget(
  element: Element | null,
  stickyNavOffsetPx = 96
): void {
  if (!element) return;

  clearHighlight();

  const rect = element.getBoundingClientRect();
  const targetTop = window.scrollY + rect.top - stickyNavOffsetPx;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });

  element.classList.add(VALIDATION_HIGHLIGHT_CLASS);
  highlightedElement = element;

  const removeHighlight = (): void => {
    clearHighlight();
    element.removeEventListener('focusin', removeHighlight);
    element.removeEventListener('click', removeHighlight);
  };

  element.addEventListener('focusin', removeHighlight, { once: true });
  element.addEventListener('click', removeHighlight, { once: true });
}
