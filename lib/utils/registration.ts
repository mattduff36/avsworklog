/**
 * Utility functions for UK vehicle registration formatting
 * Ensures consistent storage and API usage
 */

/**
 * Format a registration number for storage in database
 * - Preserves UK standard format with space (AA12 AAA)
 * - Converts to uppercase
 * - Trims whitespace
 * 
 * @example
 * formatRegistrationForStorage("bc21yzU") => "BC21 YZU"
 * formatRegistrationForStorage("BC21 YZU") => "BC21 YZU"
 * formatRegistrationForStorage(" bc21  yzu ") => "BC21 YZU"
 */
export function formatRegistrationForStorage(reg: string): string {
  // Remove all whitespace and convert to uppercase
  const cleaned = reg.replace(/\s+/g, '').trim().toUpperCase();
  
  // Check if it matches modern UK format: 2 letters, 2 numbers, 3 letters (7 chars total)
  if (cleaned.length === 7 && /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned)) {
    // Format as AA12 AAA (with space)
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
  }
  
  // For older/non-standard formats, just return cleaned uppercase version
  return cleaned;
}

/**
 * Format a registration number for external API calls (DVLA, MOT)
 * - Removes ALL spaces
 * - Converts to uppercase
 * 
 * @example
 * formatRegistrationForApi("BC21 YZU") => "BC21YZU"
 * formatRegistrationForApi(" bc21  yzu ") => "BC21YZU"
 */
export function formatRegistrationForApi(reg: string): string {
  return reg.replace(/\s+/g, '').trim().toUpperCase();
}

/**
 * Validate UK registration number format (basic validation)
 * 
 * @param reg - Registration number to validate
 * @returns Error message if invalid, null if valid
 */
export function validateRegistrationNumber(reg: string): string | null {
  const cleaned = reg.replace(/\s+/g, '').trim().toUpperCase();
  
  // Check length (UK registrations are typically 2-8 characters without spaces)
  if (cleaned.length < 2 || cleaned.length > 8) {
    return 'Invalid registration number format. UK registrations should be 2-8 characters.';
  }
  
  // Check for invalid characters (only letters and numbers allowed)
  if (!/^[A-Z0-9]+$/.test(cleaned)) {
    return 'Registration number can only contain letters and numbers';
  }
  
  return null; // Valid
}

/**
 * Format a registration number for display in UI
 * This is the same as formatRegistrationForStorage for consistency
 * 
 * @example
 * formatRegistrationForDisplay("BC21YZU") => "BC21 YZU"
 */
export const formatRegistrationForDisplay = formatRegistrationForStorage;

