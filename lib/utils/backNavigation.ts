/**
 * Safe navigation utility for back button functionality
 * Validates and sanitizes the 'from' query parameter to prevent open redirects
 */

/**
 * Check if a path is safe for internal navigation
 * @param path - The path to validate
 * @returns true if the path is safe, false otherwise
 */
export function isSafePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  
  // Must start with /
  if (!path.startsWith('/')) return false;
  
  // Must NOT start with // (protocol-relative URL)
  if (path.startsWith('//')) return false;
  
  // Must NOT contain protocol (http:, https:, javascript:, data:, etc.)
  if (path.includes(':')) return false;
  
  // Additional safety: check for common XSS patterns
  const lowerPath = path.toLowerCase();
  if (lowerPath.includes('javascript') || lowerPath.includes('data:') || lowerPath.includes('vbscript')) {
    return false;
  }
  
  return true;
}

/**
 * Get the safe back navigation URL from query params or fallback to parent
 * @param fromParam - The 'from' query parameter value
 * @param fallbackParent - The fallback parent route
 * @returns The safe navigation URL
 */
export function getBackHref(fromParam: string | string[] | undefined, fallbackParent: string): string {
  // Handle array case (shouldn't happen with 'from' but be safe)
  const from = Array.isArray(fromParam) ? fromParam[0] : fromParam;
  
  // If from param exists and is safe, use it
  if (from && isSafePath(from)) {
    return from;
  }
  
  // Otherwise use the fallback parent
  return fallbackParent;
}
