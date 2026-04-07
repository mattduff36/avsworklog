import type { MaintenanceCategory } from '@/types/maintenance';

export type MaintenanceCategoryType = 'date' | 'mileage' | 'hours';
export type MaintenancePeriodUnit = 'weeks' | 'months' | 'miles' | 'hours';

function pluralize(unit: MaintenancePeriodUnit, value: number): string {
  if (value === 1) {
    return unit === 'miles' ? 'mile' : unit.slice(0, -1);
  }
  return unit;
}

export function getDefaultPeriodUnit(type: MaintenanceCategoryType): MaintenancePeriodUnit {
  if (type === 'date') return 'months';
  if (type === 'mileage') return 'miles';
  return 'hours';
}

export function normalizePeriodUnit(
  type: MaintenanceCategoryType,
  periodUnit?: string | null
): MaintenancePeriodUnit {
  const fallback = getDefaultPeriodUnit(type);

  if (!periodUnit) {
    return fallback;
  }

  if (type === 'date' && (periodUnit === 'weeks' || periodUnit === 'months')) {
    return periodUnit;
  }

  if (type === 'mileage' && periodUnit === 'miles') {
    return periodUnit;
  }

  if (type === 'hours' && periodUnit === 'hours') {
    return periodUnit;
  }

  return fallback;
}

export function formatPeriodValue(value: number, unit: MaintenancePeriodUnit): string {
  return `${value.toLocaleString()} ${pluralize(unit, value)}`;
}

export function formatCategoryPeriod(category: Pick<MaintenanceCategory, 'type' | 'period_value' | 'period_unit'>): string {
  return formatPeriodValue(
    category.period_value,
    normalizePeriodUnit(category.type, category.period_unit)
  );
}

export function describePeriod(category: Pick<MaintenanceCategory, 'type' | 'period_value' | 'period_unit'>): string {
  const normalizedUnit = normalizePeriodUnit(category.type, category.period_unit);
  return `How often this is due, in ${normalizedUnit} (e.g. ${category.period_value} = every ${formatCategoryPeriod(category)})`;
}

export function addDatePeriod(baseDate: Date, periodValue: number, periodUnit: MaintenancePeriodUnit): Date {
  const nextDate = new Date(baseDate);

  if (periodUnit === 'weeks') {
    nextDate.setDate(nextDate.getDate() + periodValue * 7);
    return nextDate;
  }

  if (periodUnit === 'months') {
    nextDate.setMonth(nextDate.getMonth() + periodValue);
    return nextDate;
  }

  return nextDate;
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().split('T')[0];
}
