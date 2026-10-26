import { MODULE_DISPLAY_NAMES, type ModuleName } from '@/types/roles';

export const REPORT_IDS = [
  'timesheet-summary',
  'payroll-export',
  'plant-usage',
  'job-labour',
  'daily-checks-compliance',
  'daily-checks-defects',
  'bulk-daily-check-pdfs',
  'absence-bookings',
  'allowance-snapshot',
  'absence-weekly-print',
] as const;

export type ReportId = (typeof REPORT_IDS)[number];

const TIMESHEET_REPORTS = new Set<ReportId>(['timesheet-summary', 'payroll-export', 'job-labour']);
const ABSENCE_REPORTS = new Set<ReportId>(['absence-bookings', 'allowance-snapshot', 'absence-weekly-print']);
const DAILY_CHECK_REPORTS = new Set<ReportId>([
  'daily-checks-compliance',
  'daily-checks-defects',
  'bulk-daily-check-pdfs',
]);
const DAILY_CHECK_MODULES = ['inspections', 'plant-inspections', 'hgv-inspections'] as const satisfies readonly ModuleName[];

const PLANT_USAGE_LEVEL = 4;
const UNCONFIRMED = 'Report permissions could not be confirmed.';
const LOADING = 'Permissions are still loading.';

export interface ReportAccessSnapshot {
  state: 'loading' | 'error' | 'ready';
  permissionLevels: Partial<Record<ModuleName, number>> | null;
  moduleMinimumAccessLevels: Partial<Record<ModuleName, number>> | null;
}

function isReportId(reportId: string): reportId is ReportId {
  return (REPORT_IDS as readonly string[]).includes(reportId);
}

function readLevel(snapshot: ReportAccessSnapshot, moduleName: ModuleName): number | null {
  const level = snapshot.permissionLevels?.[moduleName];
  return typeof level === 'number' && Number.isFinite(level) ? level : null;
}

function readMinimum(snapshot: ReportAccessSnapshot, moduleName: ModuleName): number | null {
  const minimum = snapshot.moduleMinimumAccessLevels?.[moduleName];
  return typeof minimum === 'number' && Number.isFinite(minimum) ? Math.max(1, minimum) : null;
}

function requirement(moduleName: ModuleName, minimum: number): string {
  return `${MODULE_DISPLAY_NAMES[moduleName]} level ${minimum} or higher`;
}

function sourceDecision(
  snapshot: ReportAccessSnapshot,
  moduleName: ModuleName,
): { allowed: boolean; reason: string } {
  const minimum = readMinimum(snapshot, moduleName);
  const level = readLevel(snapshot, moduleName);
  const label = MODULE_DISPLAY_NAMES[moduleName];
  if (minimum == null || level == null) {
    return { allowed: false, reason: `${label} permission level could not be confirmed.` };
  }
  if (level > 0 && level >= minimum) {
    return { allowed: true, reason: '' };
  }
  return { allowed: false, reason: `Requires ${requirement(moduleName, minimum)}.` };
}

function plantUsageDecision(snapshot: ReportAccessSnapshot): { allowed: boolean; reason: string } {
  const reports = sourceDecision(snapshot, 'reports');
  if (!reports.allowed) return reports;
  const level = readLevel(snapshot, 'daily-allocation');
  if (level == null) {
    return { allowed: false, reason: 'Daily Allocation permission level could not be confirmed.' };
  }
  const configured = readMinimum(snapshot, 'daily-allocation');
  if (configured == null) {
    return { allowed: false, reason: 'Daily Allocation permission level could not be confirmed.' };
  }
  const required = Math.max(PLANT_USAGE_LEVEL, configured);
  if (level >= required) return { allowed: true, reason: '' };
  return { allowed: false, reason: `Requires ${requirement('daily-allocation', required)}.` };
}

function dailyChecksDecision(snapshot: ReportAccessSnapshot): { allowed: boolean; reason: string } {
  const reports = sourceDecision(snapshot, 'reports');
  if (!reports.allowed) return reports;
  const decisions = DAILY_CHECK_MODULES.map((moduleName) => sourceDecision(snapshot, moduleName));
  if (decisions.some((decision) => decision.allowed)) return { allowed: true, reason: '' };
  const known = decisions
    .map((decision) => decision.reason)
    .filter((reason) => reason.startsWith('Requires '))
    .map((reason) => reason.slice('Requires '.length).replace(/\.$/, ''));
  const unconfirmed = decisions.some((decision) => decision.reason.includes('could not be confirmed'));
  if (known.length === 0) {
    return { allowed: false, reason: 'Daily Checks permission levels could not be confirmed.' };
  }
  const list = known.length === 1
    ? known[0]
    : `one of ${known.slice(0, -1).join(', ')}, or ${known[known.length - 1]}`;
  const suffix = unconfirmed ? ' Other Daily Checks permission levels could not be confirmed.' : '';
  return { allowed: false, reason: `Requires ${list}.${suffix}` };
}

export function reportAccessDeniedReason(reportId: string, snapshot: ReportAccessSnapshot): string | null {
  if (snapshot.state === 'loading') return LOADING;
  if (
    snapshot.state !== 'ready'
    || !snapshot.permissionLevels
    || !snapshot.moduleMinimumAccessLevels
    || !isReportId(reportId)
  ) {
    return UNCONFIRMED;
  }

  const decision = reportId === 'plant-usage'
    ? plantUsageDecision(snapshot)
    : DAILY_CHECK_REPORTS.has(reportId)
      ? dailyChecksDecision(snapshot)
      : TIMESHEET_REPORTS.has(reportId)
        ? (() => {
            const reports = sourceDecision(snapshot, 'reports');
            return reports.allowed ? sourceDecision(snapshot, 'timesheets') : reports;
          })()
        : ABSENCE_REPORTS.has(reportId)
          ? (() => {
              const reports = sourceDecision(snapshot, 'reports');
              return reports.allowed ? sourceDecision(snapshot, 'absence') : reports;
            })()
          : { allowed: false, reason: UNCONFIRMED };

  return decision.allowed ? null : decision.reason;
}
