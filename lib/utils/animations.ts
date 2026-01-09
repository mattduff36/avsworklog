/**
 * Reusable animation utilities for UI components
 */

/**
 * Triggers a shake animation on an element
 * Useful for indicating invalid actions or blocked interactions
 * 
 * @param element - The HTML element to shake
 * @param duration - Duration of the shake animation in milliseconds (default: 500ms)
 */
export function triggerShakeAnimation(element: HTMLElement | null, duration: number = 500) {
  if (!element) return;

  // Add shake animation class
  element.classList.add('animate-shake');

  // Remove the class after animation completes
  setTimeout(() => {
    element.classList.remove('animate-shake');
  }, duration);
}

/**
 * CSS keyframe animation for shake effect
 * Add this to your globals.css:
 * 
 * @keyframes shake {
 *   0%, 100% { transform: translateX(0); }
 *   10%, 30%, 50%, 70%, 90% { transform: translateX(-10px); }
 *   20%, 40%, 60%, 80% { transform: translateX(10px); }
 * }
 * 
 * .animate-shake {
 *   animation: shake 0.5s ease-in-out;
 * }
 */
