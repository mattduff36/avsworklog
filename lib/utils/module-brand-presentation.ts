import { ALL_MODULES, MODULE_CSS_VAR, type ModuleName } from '@/types/roles';

export interface ModuleBrandSurfaceClasses {
  card: string;
  cardHover: string;
  thumbnail: string;
}

const SURFACE_BY_CSS_VAR: Record<string, ModuleBrandSurfaceClasses> = {
  '--timesheet-primary': {
    card: 'border-[hsl(var(--timesheet-primary)/0.35)] bg-[hsl(var(--timesheet-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--timesheet-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--timesheet-primary)/0.35)] bg-[hsl(var(--timesheet-primary)/0.40)] text-timesheet',
  },
  '--inspection-primary': {
    card: 'border-[hsl(var(--inspection-primary)/0.35)] bg-[hsl(var(--inspection-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--inspection-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--inspection-primary)/0.35)] bg-[hsl(var(--inspection-primary)/0.40)] text-inspection',
  },
  '--hgv-inspection-primary': {
    card: 'border-[hsl(var(--hgv-inspection-primary)/0.35)] bg-[hsl(var(--hgv-inspection-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--hgv-inspection-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--hgv-inspection-primary)/0.35)] bg-[hsl(var(--hgv-inspection-primary)/0.40)] text-hgv-inspection',
  },
  '--plant-inspection-primary': {
    card: 'border-[hsl(var(--plant-inspection-primary)/0.35)] bg-[hsl(var(--plant-inspection-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--plant-inspection-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--plant-inspection-primary)/0.35)] bg-[hsl(var(--plant-inspection-primary)/0.40)] text-plant-inspection',
  },
  '--rams-primary': {
    card: 'border-[hsl(var(--rams-primary)/0.35)] bg-[hsl(var(--rams-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--rams-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--rams-primary)/0.35)] bg-[hsl(var(--rams-primary)/0.40)] text-rams',
  },
  '--absence-primary': {
    card: 'border-[hsl(var(--absence-primary)/0.35)] bg-[hsl(var(--absence-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--absence-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--absence-primary)/0.35)] bg-[hsl(var(--absence-primary)/0.40)] text-absence',
  },
  '--maintenance-primary': {
    card: 'border-[hsl(var(--maintenance-primary)/0.35)] bg-[hsl(var(--maintenance-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--maintenance-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--maintenance-primary)/0.35)] bg-[hsl(var(--maintenance-primary)/0.40)] text-maintenance',
  },
  '--inventory-primary': {
    card: 'border-[hsl(var(--inventory-primary)/0.35)] bg-[hsl(var(--inventory-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--inventory-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--inventory-primary)/0.35)] bg-[hsl(var(--inventory-primary)/0.40)] text-inventory',
  },
  '--workshop-primary': {
    card: 'border-[hsl(var(--workshop-primary)/0.35)] bg-[hsl(var(--workshop-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--workshop-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--workshop-primary)/0.35)] bg-[hsl(var(--workshop-primary)/0.40)] text-workshop',
  },
  '--fleet-primary': {
    card: 'border-[hsl(var(--fleet-primary)/0.35)] bg-[hsl(var(--fleet-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--fleet-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--fleet-primary)/0.35)] bg-[hsl(var(--fleet-primary)/0.40)] text-fleet',
  },
  '--reminders-primary': {
    card: 'border-[hsl(var(--reminders-primary)/0.35)] bg-[hsl(var(--reminders-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--reminders-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--reminders-primary)/0.35)] bg-[hsl(var(--reminders-primary)/0.40)] text-reminders',
  },
  '--daily-allocation-primary': {
    card: 'border-[hsl(var(--daily-allocation-primary)/0.35)] bg-[hsl(var(--daily-allocation-primary)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--daily-allocation-primary)/0.16)]',
    thumbnail: 'border-[hsl(var(--daily-allocation-primary)/0.35)] bg-[hsl(var(--daily-allocation-primary)/0.40)] text-daily-allocation',
  },
  '--avs-yellow': {
    card: 'border-[hsl(var(--avs-yellow)/0.35)] bg-[hsl(var(--avs-yellow)/0.10)]',
    cardHover: 'hover:bg-[hsl(var(--avs-yellow)/0.16)]',
    thumbnail: 'border-[hsl(var(--avs-yellow)/0.35)] bg-[hsl(var(--avs-yellow)/0.40)] text-avs-yellow',
  },
};

function isModuleName(value: string): value is ModuleName {
  return (ALL_MODULES as readonly string[]).includes(value);
}

/**
 * Brand surface classes for module cards/tiles.
 * Uses MODULE_CSS_VAR so Permissions Guide and Profile stay aligned.
 */
export function getModuleBrandSurfaceClasses(moduleName: string): ModuleBrandSurfaceClasses {
  const cssVar = isModuleName(moduleName) ? MODULE_CSS_VAR[moduleName] : '--avs-yellow';
  return SURFACE_BY_CSS_VAR[cssVar] || SURFACE_BY_CSS_VAR['--avs-yellow'];
}
