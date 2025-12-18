/**
 * Maintenance Calculations Utility
 * Calculates due dates, mileage, and alert status for vehicle maintenance
 */

import type { 
  MaintenanceStatus, 
  MaintenanceItemStatus
} from '@/types/maintenance';

// ============================================================================
// Date-based calculations
// ============================================================================

/**
 * Calculate days until a due date
 * Returns negative if overdue
 */
export function getDaysUntilDue(dueDate: string | null): number | null {
  if (!dueDate) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const target = new Date(dueDate);
  target.setHours(0, 0, 0, 0);
  
  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

/**
 * Calculate maintenance status based on days until due
 */
export function getDateBasedStatus(
  dueDate: string | null,
  thresholdDays: number
): MaintenanceItemStatus {
  if (!dueDate) {
    return { status: 'not_set' };
  }
  
  const daysUntil = getDaysUntilDue(dueDate);
  
  if (daysUntil === null) {
    return { status: 'not_set' };
  }
  
  if (daysUntil < 0) {
    return {
      status: 'overdue',
      days_until: daysUntil,
      due_date: dueDate
    };
  }
  
  if (daysUntil <= thresholdDays) {
    return {
      status: 'due_soon',
      days_until: daysUntil,
      due_date: dueDate
    };
  }
  
  return {
    status: 'ok',
    days_until: daysUntil,
    due_date: dueDate
  };
}

// ============================================================================
// Mileage-based calculations
// ============================================================================

/**
 * Calculate miles until due
 * Returns negative if overdue
 */
export function getMilesUntilDue(
  currentMileage: number | null,
  dueMileage: number | null
): number | null {
  if (currentMileage === null || dueMileage === null) return null;
  
  return dueMileage - currentMileage;
}

/**
 * Calculate maintenance status based on mileage
 */
export function getMileageBasedStatus(
  currentMileage: number | null,
  dueMileage: number | null,
  thresholdMiles: number
): MaintenanceItemStatus {
  if (!dueMileage) {
    return { status: 'not_set' };
  }
  
  if (currentMileage === null) {
    // No current mileage data - show as not set
    return { status: 'not_set' };
  }
  
  const milesUntil = getMilesUntilDue(currentMileage, dueMileage);
  
  if (milesUntil === null) {
    return { status: 'not_set' };
  }
  
  if (milesUntil < 0) {
    return {
      status: 'overdue',
      miles_until: milesUntil,
      due_mileage: dueMileage
    };
  }
  
  if (milesUntil <= thresholdMiles) {
    return {
      status: 'due_soon',
      miles_until: milesUntil,
      due_mileage: dueMileage
    };
  }
  
  return {
    status: 'ok',
    miles_until: milesUntil,
    due_mileage: dueMileage
  };
}

// ============================================================================
// Status color helpers for UI
// ============================================================================

/**
 * Get Tailwind color classes for maintenance status
 */
export function getStatusColorClass(status: MaintenanceStatus): string {
  switch (status) {
    case 'overdue':
      return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    case 'due_soon':
      return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
    case 'ok':
      return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
    case 'not_set':
      return 'text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/20 border-slate-200 dark:border-slate-700';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

/**
 * Get badge color for dashboard
 */
export function getStatusBadgeColor(status: MaintenanceStatus): string {
  switch (status) {
    case 'overdue':
      return 'bg-red-500 text-white';
    case 'due_soon':
      return 'bg-amber-500 text-white';
    default:
      return 'bg-slate-400 text-white';
  }
}

// ============================================================================
// Alert summary calculations
// ============================================================================

export interface AlertCounts {
  overdue: number;
  due_soon: number;
  ok: number;
  not_set: number;
}

/**
 * Calculate alert counts for a vehicle's maintenance items
 */
export function calculateAlertCounts(
  statuses: (MaintenanceItemStatus | undefined)[]
): AlertCounts {
  const counts: AlertCounts = {
    overdue: 0,
    due_soon: 0,
    ok: 0,
    not_set: 0
  };
  
  statuses.forEach(status => {
    if (status) {
      counts[status.status]++;
    }
  });
  
  return counts;
}

// ============================================================================
// Formatting helpers
// ============================================================================

/**
 * Format days until due for display
 */
export function formatDaysUntil(daysUntil: number | null | undefined): string {
  if (daysUntil === null || daysUntil === undefined) return 'Not Set';
  
  if (daysUntil < 0) {
    const absDays = Math.abs(daysUntil);
    return `${absDays} day${absDays !== 1 ? 's' : ''} overdue`;
  }
  
  if (daysUntil === 0) return 'Due today';
  if (daysUntil === 1) return 'Due tomorrow';
  
  return `Due in ${daysUntil} days`;
}

/**
 * Format miles until due for display
 */
export function formatMilesUntil(milesUntil: number | null | undefined): string {
  if (milesUntil === null || milesUntil === undefined) return 'Not Set';
  
  if (milesUntil < 0) {
    const absMiles = Math.abs(milesUntil);
    return `${absMiles.toLocaleString()} miles overdue`;
  }
  
  return `${milesUntil.toLocaleString()} miles remaining`;
}

/**
 * Format mileage for display
 */
export function formatMileage(mileage: number | null | undefined): string {
  if (mileage === null || mileage === undefined) return 'Not Set';
  return mileage.toLocaleString();
}

/**
 * Format date for display (UK format)
 */
export function formatMaintenanceDate(date: string | null | undefined): string {
  if (!date) return 'Not Set';
  
  try {
    const d = new Date(date);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return 'Invalid Date';
  }
}

/**
 * Format date for input (YYYY-MM-DD)
 */
export function formatDateForInput(date: string | null | undefined): string {
  if (!date) return '';
  
  try {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  } catch {
    return '';
  }
}
