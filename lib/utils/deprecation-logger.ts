/**
 * Deprecation Logger
 * 
 * Logs deprecation warnings to the console and error_logs table so they can be tracked and addressed.
 * This helps identify legacy code paths that need to be updated.
 */

interface DeprecationContext {
  feature: string;
  location: string;
  replacement: string;
  value?: any;
}

/**
 * Logs a deprecation warning to console and optionally to error_logs
 * 
 * @param context - Information about the deprecated feature
 * @example
 * logDeprecationWarning({
 *   feature: 'vehicle_type column',
 *   location: 'inspections/page.tsx line 375',
 *   replacement: 'Use vehicle_categories.name instead',
 *   value: 'Van'
 * });
 */
export function logDeprecationWarning(context: DeprecationContext): void {
  // Always log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.warn(`🚨 DEPRECATION WARNING:`, {
      feature: context.feature,
      location: context.location,
      replacement: context.replacement,
      value: context.value,
    });
  }

  // In production, log to error reporting (future enhancement)
  // For now, we'll just console.warn which will be picked up by error-logger.ts
  if (process.env.NODE_ENV === 'production') {
    console.error(`DEPRECATED: ${context.feature} accessed at ${context.location}. ${context.replacement}`, {
      value: context.value,
    });
  }
}

/**
 * Wrapper for accessing deprecated vehicle_type field
 * Logs a warning and returns the value
 * 
 * @param vehicle - Vehicle object with vehicle_type
 * @param location - Where in the code this is being accessed
 * @returns The vehicle_type value (for backward compatibility)
 * 
 * @example
 * const type = getDeprecatedVehicleType(vehicle, 'reports/defects line 91');
 */
export function getDeprecatedVehicleType(
  vehicle: { vehicle_type?: string | null; vehicle_categories?: { name: string } | null },
  location: string
): string | null {
  // Log the deprecation warning
  logDeprecationWarning({
    feature: 'vehicle_type column',
    location,
    replacement: 'Use vehicle.vehicle_categories?.name instead',
    value: vehicle.vehicle_type,
  });

  // Return the value for backward compatibility
  return vehicle.vehicle_type || null;
}

/**
 * Helper to get vehicle category name with proper fallback
 * This is the CORRECT way to get vehicle type information
 * 
 * @param vehicle - Vehicle object
 * @returns The category name from vehicle_categories, or 'Uncategorized' as fallback
 * 
 * @example
 * const categoryName = getVehicleCategoryName(vehicle); // Returns 'Van', 'HGV', etc.
 */
export function getVehicleCategoryName(
  vehicle: { vehicle_categories?: { name: string } | null; vehicle_type?: string | null }
): string {
  // Prefer vehicle_categories.name (the correct source)
  if (vehicle.vehicle_categories?.name) {
    return vehicle.vehicle_categories.name;
  }

  // Fallback to vehicle_type ONLY if categories is null (legacy data)
  // This will trigger a deprecation warning if used
  if (vehicle.vehicle_type) {
    logDeprecationWarning({
      feature: 'vehicle_type fallback',
      location: 'getVehicleCategoryName helper',
      replacement: 'Ensure vehicle has category_id set in database',
      value: vehicle.vehicle_type,
    });
    return vehicle.vehicle_type;
  }

  return 'Uncategorized';
}
