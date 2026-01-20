/**
 * Mileage sanity check utility
 * 
 * Validates entered mileage against the vehicle's last recorded mileage
 * to catch potential typos or errors.
 */

// Tunable constants for sanity checks
export const MILEAGE_SANITY_CONFIG = {
  // Warn if mileage decreases by more than this amount
  MAX_DECREASE_ALLOWED: 1000,
  // Warn if mileage increases by more than this amount in one go
  MAX_INCREASE_THRESHOLD: 5000,
  // For vehicles under this baseline, also warn if mileage doubles
  DOUBLING_CHECK_THRESHOLD: 100000,
};

export interface MileageSanityResult {
  isValid: boolean;
  warning?: string;
  warningType?: 'decrease' | 'large_increase';
}

/**
 * Check if entered mileage is reasonable compared to baseline
 * 
 * @param enteredMileage - The mileage entered by the user
 * @param baselineMileage - The last recorded mileage for the vehicle (can be null if unknown)
 * @returns Object indicating if valid and any warning message
 */
export function checkMileageSanity(
  enteredMileage: number,
  baselineMileage: number | null
): MileageSanityResult {
  // If no baseline exists, any positive mileage is valid
  if (baselineMileage === null || baselineMileage === undefined) {
    return { isValid: true };
  }

  // Validate inputs
  if (enteredMileage < 0) {
    return {
      isValid: false,
      warning: 'Mileage cannot be negative',
    };
  }

  // Check for significant decrease (potential typo)
  const decrease = baselineMileage - enteredMileage;
  if (decrease > MILEAGE_SANITY_CONFIG.MAX_DECREASE_ALLOWED) {
    return {
      isValid: true, // Valid but needs confirmation
      warning: `The entered mileage (${enteredMileage.toLocaleString()}) is ${decrease.toLocaleString()} miles lower than the last recorded value (${baselineMileage.toLocaleString()}). Please check this is correct.`,
      warningType: 'decrease',
    };
  }

  // Check for unrealistically large increase
  const increase = enteredMileage - baselineMileage;
  
  // Large absolute increase
  if (increase > MILEAGE_SANITY_CONFIG.MAX_INCREASE_THRESHOLD) {
    // Also check for doubling (for lower-mileage vehicles)
    const isDoubling = baselineMileage < MILEAGE_SANITY_CONFIG.DOUBLING_CHECK_THRESHOLD && 
                       enteredMileage >= baselineMileage * 2;
    
    if (isDoubling) {
      return {
        isValid: true, // Valid but needs confirmation
        warning: `The entered mileage (${enteredMileage.toLocaleString()}) is more than double the last recorded value (${baselineMileage.toLocaleString()}). This may indicate a typo. Please verify.`,
        warningType: 'large_increase',
      };
    }
    
    return {
      isValid: true, // Valid but needs confirmation
      warning: `The entered mileage (${enteredMileage.toLocaleString()}) is ${increase.toLocaleString()} miles higher than the last recorded value (${baselineMileage.toLocaleString()}). Please check this is correct.`,
      warningType: 'large_increase',
    };
  }

  // All checks passed
  return { isValid: true };
}

/**
 * Format mileage for display
 */
export function formatMileage(mileage: number | null | undefined): string {
  if (mileage === null || mileage === undefined) {
    return 'Unknown';
  }
  return `${mileage.toLocaleString()} miles`;
}
