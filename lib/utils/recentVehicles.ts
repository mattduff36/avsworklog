/**
 * Recent Vehicles Utility
 * 
 * Provides localStorage-backed storage of recently selected vehicles per user.
 * Used to show a "Recent" section at the top of vehicle dropdowns for quick access.
 */

const STORAGE_KEY_PREFIX = 'recent_vehicles_';
const DEFAULT_MAX_RECENT = 3;

/**
 * Get the localStorage key for a specific user
 */
function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/**
 * Safely read from localStorage (handles SSR, private browsing, errors)
 */
function safeLocalStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  
  try {
    return localStorage.getItem(key);
  } catch {
    // localStorage can throw in private browsing mode or when storage is full
    return null;
  }
}

/**
 * Safely write to localStorage (handles SSR, private browsing, errors)
 */
function safeLocalStorageSet(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // localStorage can throw in private browsing mode or when storage is full
    return false;
  }
}

/**
 * Get the list of recent vehicle IDs for a user
 * 
 * @param userId - The user's ID
 * @returns Array of vehicle IDs, newest first (max 3)
 */
export function getRecentVehicleIds(userId: string): string[] {
  if (!userId) return [];
  
  const raw = safeLocalStorageGet(getStorageKey(userId));
  if (!raw) return [];
  
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Filter to only valid strings and limit to max
      return parsed
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(0, DEFAULT_MAX_RECENT);
    }
    return [];
  } catch {
    // Invalid JSON - return empty array
    return [];
  }
}

/**
 * Record a vehicle selection, adding it to the recent list
 * 
 * @param userId - The user's ID
 * @param vehicleId - The vehicle ID to record
 * @param max - Maximum number of recent vehicles to keep (default: 3)
 * @returns The updated list of recent vehicle IDs
 */
export function recordRecentVehicleId(
  userId: string, 
  vehicleId: string, 
  max: number = DEFAULT_MAX_RECENT
): string[] {
  if (!userId || !vehicleId) return getRecentVehicleIds(userId);
  
  // Get current list
  const current = getRecentVehicleIds(userId);
  
  // Remove the vehicle if it already exists (to move it to front)
  const filtered = current.filter(id => id !== vehicleId);
  
  // Add to front and limit to max
  const updated = [vehicleId, ...filtered].slice(0, max);
  
  // Save to localStorage
  safeLocalStorageSet(getStorageKey(userId), JSON.stringify(updated));
  
  return updated;
}

/**
 * Clear all recent vehicles for a user
 * 
 * @param userId - The user's ID
 */
export function clearRecentVehicles(userId: string): void {
  if (!userId) return;
  
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem(getStorageKey(userId));
  } catch {
    // Ignore errors
  }
}

/**
 * Helper type for vehicle with recent status
 */
export interface VehicleWithRecent {
  id: string;
  reg_number: string;
  [key: string]: unknown;
}

/**
 * Split vehicles into recent and other groups
 * 
 * @param vehicles - Full list of vehicles
 * @param recentIds - List of recent vehicle IDs
 * @returns Object with recentVehicles and otherVehicles arrays
 */
export function splitVehiclesByRecent<T extends VehicleWithRecent>(
  vehicles: T[],
  recentIds: string[]
): { recentVehicles: T[]; otherVehicles: T[] } {
  if (!recentIds.length) {
    return { recentVehicles: [], otherVehicles: vehicles };
  }
  
  // Create a map for O(1) lookup
  const recentIdSet = new Set(recentIds);
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]));
  
  // Build recent vehicles in the order of recentIds (most recent first)
  const recentVehicles: T[] = [];
  for (const id of recentIds) {
    const vehicle = vehicleMap.get(id);
    if (vehicle) {
      recentVehicles.push(vehicle);
    }
  }
  
  // Other vehicles are those not in recent list
  const otherVehicles = vehicles.filter(v => !recentIdSet.has(v.id));
  
  return { recentVehicles, otherVehicles };
}
