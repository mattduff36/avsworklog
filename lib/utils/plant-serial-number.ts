/**
 * Plant Serial Number Utilities
 * 
 * Provides normalization and validation for plant asset serial numbers.
 * 
 * Rules:
 * - Alphanumeric only (A-Z, 0-9)
 * - No spaces
 * - Auto-uppercase
 * - Unique when provided (enforced at DB level)
 * - Optional (nullable)
 */

/**
 * Normalize a plant serial number to the canonical format:
 * - Remove all whitespace
 * - Convert to uppercase
 * - Return null for empty strings
 * 
 * @param raw - Raw input string
 * @returns Normalized serial number or null if empty
 */
export function normalizePlantSerialNumber(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  
  // Remove all whitespace and convert to uppercase
  const normalized = raw.replace(/\s+/g, '').toUpperCase();
  
  // Return null for empty strings
  return normalized.length > 0 ? normalized : null;
}

/**
 * Validate that a serial number contains only alphanumeric characters.
 * Assumes the value has already been normalized (uppercase, no spaces).
 * 
 * @param value - Normalized serial number
 * @returns true if valid (alphanumeric only) or empty/null, false otherwise
 */
export function isValidPlantSerialNumber(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return true; // null/undefined/empty are valid (optional field)
  
  // Must contain only uppercase letters and numbers
  return /^[A-Z0-9]+$/.test(value);
}

/**
 * Validate and normalize a plant serial number in one step.
 * Use for form validation where you want both normalization and validation.
 * 
 * @param raw - Raw input string
 * @returns Object with normalized value and validation result
 */
export function validateAndNormalizePlantSerialNumber(raw: string | null | undefined): {
  value: string | null;
  valid: boolean;
  error?: string;
} {
  const normalized = normalizePlantSerialNumber(raw);
  
  if (!normalized) {
    return { value: null, valid: true }; // Empty is valid (optional)
  }
  
  const valid = isValidPlantSerialNumber(normalized);
  
  return {
    value: normalized,
    valid,
    error: valid ? undefined : 'Serial Number must contain only letters and numbers'
  };
}
