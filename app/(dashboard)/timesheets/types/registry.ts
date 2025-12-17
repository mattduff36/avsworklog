/**
 * Timesheet Type Registry
 * 
 * This file defines all available timesheet types and maps them to their components.
 * To add a new timesheet type:
 * 1. Create a new folder in /timesheets/types/ (e.g., /plant/)
 * 2. Create the component (e.g., PlantTimesheet.tsx)
 * 3. Import and add to TimesheetRegistry below
 * 4. Add to TimesheetTypeOptions for the admin UI
 * 5. Update the CHECK constraint in the migration if needed
 */

// Placeholder type - will be replaced with actual components in Phase 2
type TimesheetProps = {
  weekEnding: string;
  existingId: string | null;
  userId?: string; // For managers creating for others
};

/**
 * Timesheet Registry
 * Maps timesheet type string to React component
 */
export const TimesheetRegistry: Record<string, React.ComponentType<TimesheetProps>> = {
  // Will be populated in Phase 2:
  // civils: CivilsTimesheet,
  // plant: PlantTimesheet,
};

/**
 * Timesheet Type Options
 * Used in admin UI for role configuration
 */
export const TimesheetTypeOptions = [
  { 
    value: 'civils', 
    label: 'Civils Timesheet (Default)',
    description: 'Standard weekly timesheet for civil engineering work'
  },
  { 
    value: 'plant', 
    label: 'Plant Timesheet',
    description: 'Specialized timesheet for plant operators (Coming soon)'
  },
] as const;

/**
 * Type definitions
 */
export type TimesheetType = 'civils' | 'plant';

export type TimesheetTypeOption = typeof TimesheetTypeOptions[number];

/**
 * Helper function to check if a timesheet type is implemented
 */
export function isTimesheetTypeImplemented(type: string): boolean {
  return type in TimesheetRegistry;
}

/**
 * Helper function to get timesheet type label
 */
export function getTimesheetTypeLabel(type: string): string {
  const option = TimesheetTypeOptions.find(opt => opt.value === type);
  return option?.label || type;
}

/**
 * Default timesheet type
 */
export const DEFAULT_TIMESHEET_TYPE: TimesheetType = 'civils';
