import { jobResourceKey } from '@/components/daily-allocation/board/board-dnd';
import type { DailyAllocationBoardPrimary } from '@/lib/config/daily-allocation-primary-preference';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import type {
  DailyAllocationEmployeeResource,
  DailyAllocationJobProjection,
  DailyAllocationPlantAssignment,
  DailyAllocationPlantResource,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

export type DailyAllocationBoardRowKind = 'job' | 'employee' | 'plant' | 'unassigned';

export interface DailyAllocationBoardRow {
  id: string;
  kind: DailyAllocationBoardRowKind;
  label: string;
  subtitle: string | null;
  job: DailyAllocationJobProjection | null;
  employee: DailyAllocationEmployeeResource | null;
  plant: DailyAllocationPlantResource | null;
  plantAssignment: DailyAllocationPlantAssignment | null;
  visits: DailyAllocationVisit[];
  visitsByDate: Record<string, DailyAllocationVisit[]>;
}

export interface BuildDailyAllocationBoardRowsInput {
  primary: DailyAllocationBoardPrimary;
  board: DailyAllocationRangeBoardPayload;
  dates: string[];
  jobSearch?: string;
}

function emptyVisitBuckets(dates: string[]): Record<string, DailyAllocationVisit[]> {
  return Object.fromEntries(dates.map((date) => [date, []]));
}

function sortVisits(visits: DailyAllocationVisit[]): DailyAllocationVisit[] {
  return [...visits].sort((left, right) =>
    left.starts_at.localeCompare(right.starts_at) || left.id.localeCompare(right.id)
  );
}

function jobMatches(job: DailyAllocationJobProjection, search: string): boolean {
  if (!search) return true;
  return [job.job_code, job.customer_name, job.title, job.site_address]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(search));
}

function visitBuckets(
  visits: DailyAllocationVisit[],
  dates: string[]
): Record<string, DailyAllocationVisit[]> {
  const result = emptyVisitBuckets(dates);
  for (const visit of visits) {
    if (result[visit.work_date]) result[visit.work_date].push(visit);
  }
  for (const date of dates) result[date] = sortVisits(result[date]);
  return result;
}

function jobForVisit(
  visit: DailyAllocationVisit,
  jobsByKey: Map<string, DailyAllocationJobProjection>
): DailyAllocationJobProjection {
  return jobsByKey.get(`${visit.job_source_type}:${visit.job_source_id}`) || {
    source_type: visit.job_source_type,
    source_id: visit.job_source_id,
    job_code: visit.job_code,
    customer_name: null,
    title: null,
    site_address: visit.site_address,
    source_href: null,
  };
}

function buildJobRows(
  visits: DailyAllocationVisit[],
  jobsByKey: Map<string, DailyAllocationJobProjection>,
  dates: string[]
): DailyAllocationBoardRow[] {
  const visitsByJob = new Map<string, DailyAllocationVisit[]>();
  for (const visit of visits) {
    const key = `${visit.job_source_type}:${visit.job_source_id}`;
    visitsByJob.set(key, [...(visitsByJob.get(key) || []), visit]);
  }
  return [...visitsByJob.entries()]
    .map(([key, jobVisits]) => {
      const job = jobForVisit(jobVisits[0], jobsByKey);
      return {
        id: `job:${key}`,
        kind: 'job' as const,
        label: job.job_code,
        subtitle: job.title || job.customer_name || job.site_address,
        job,
        employee: null,
        plant: null,
        plantAssignment: null,
        visits: sortVisits(jobVisits),
        visitsByDate: visitBuckets(jobVisits, dates),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildEmployeeRows(
  board: DailyAllocationRangeBoardPayload,
  visits: DailyAllocationVisit[],
  dates: string[]
): DailyAllocationBoardRow[] {
  const visitsById = new Map(visits.map((visit) => [visit.id, visit]));
  const employeeById = new Map(
    board.resources.employees.map((employee) => [employee.profile_id, employee])
  );
  const visitsByEmployee = new Map<string, Map<string, DailyAllocationVisit>>();
  const assignedVisitIds = new Set<string>();
  for (const assignment of board.labour_assignments) {
    const visit = visitsById.get(assignment.visit_id);
    if (!visit) continue;
    assignedVisitIds.add(visit.id);
    const employeeVisits = visitsByEmployee.get(assignment.profile_id) || new Map();
    employeeVisits.set(visit.id, visit);
    visitsByEmployee.set(assignment.profile_id, employeeVisits);
  }
  const profileIds = new Set([
    ...employeeById.keys(),
    ...visitsByEmployee.keys(),
  ]);
  const rows = [...profileIds].map<DailyAllocationBoardRow>((profileId) => {
    const employeeVisits = visitsByEmployee.get(profileId) || new Map();
    const employee = employeeById.get(profileId) || {
      profile_id: profileId,
      full_name: 'Employee',
      employee_id: null,
      team_id: null,
      team_name: null,
      days: [],
    };
    const rowVisits = sortVisits([...employeeVisits.values()]);
    return {
      id: `employee:${profileId}`,
      kind: 'employee' as const,
      label: employee.full_name,
      subtitle: [employee.employee_id, employee.team_name].filter(Boolean).join(' · ') || null,
      job: null,
      employee,
      plant: null,
      plantAssignment: null,
      visits: rowVisits,
      visitsByDate: visitBuckets(rowVisits, dates),
    };
  }).sort((left, right) => left.label.localeCompare(right.label));

  const unassigned = visits.filter((visit) => !assignedVisitIds.has(visit.id));
  if (unassigned.length > 0) rows.push(unassignedRow(unassigned, dates, 'employees'));
  return rows;
}

function plantAssignmentKey(assignment: DailyAllocationPlantAssignment): string {
  return assignment.plant_kind === 'registered'
    ? `registered:${assignment.plant_id || assignment.id}`
    : `hired:${assignment.hired_serial || assignment.id}`;
}

function buildPlantRows(
  board: DailyAllocationRangeBoardPayload,
  visits: DailyAllocationVisit[],
  dates: string[]
): DailyAllocationBoardRow[] {
  const visitsById = new Map(visits.map((visit) => [visit.id, visit]));
  const plantById = new Map(board.resources.plant.map((plant) => [plant.id, plant]));
  const visitsByPlant = new Map<
    string,
    { assignment: DailyAllocationPlantAssignment; visits: Map<string, DailyAllocationVisit> }
  >();
  const assignedVisitIds = new Set<string>();
  for (const assignment of board.plant_assignments) {
    const visit = visitsById.get(assignment.visit_id);
    if (!visit) continue;
    assignedVisitIds.add(visit.id);
    const key = plantAssignmentKey(assignment);
    const entry = visitsByPlant.get(key) || { assignment, visits: new Map() };
    entry.visits.set(visit.id, visit);
    visitsByPlant.set(key, entry);
  }
  const rows = [...visitsByPlant.entries()].map<DailyAllocationBoardRow>(([key, entry]) => {
    const plant = entry.assignment.plant_id
      ? plantById.get(entry.assignment.plant_id) || null
      : null;
    const label = entry.assignment.plant_kind === 'hired'
      ? [entry.assignment.hired_serial, entry.assignment.hired_description].filter(Boolean).join(' · ') || 'Hired plant'
      : plant
        ? formatFleetAssetLabel({ identifier: plant.plant_id, nickname: plant.nickname })
        : entry.assignment.plant_id || 'Registered plant';
    const rowVisits = sortVisits([...entry.visits.values()]);
    return {
      id: `plant:${key}`,
      kind: 'plant' as const,
      label,
      subtitle: entry.assignment.plant_kind === 'hired'
        ? entry.assignment.hired_company || 'Hired plant'
        : 'Registered plant',
      job: null,
      employee: null,
      plant,
      plantAssignment: entry.assignment,
      visits: rowVisits,
      visitsByDate: visitBuckets(rowVisits, dates),
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
  const representedRegisteredPlant = new Set(
    [...visitsByPlant.values()]
      .filter((entry) => entry.assignment.plant_kind === 'registered')
      .map((entry) => entry.assignment.plant_id)
      .filter((id): id is string => Boolean(id))
  );
  for (const plant of board.resources.plant) {
    if (representedRegisteredPlant.has(plant.id)) continue;
    rows.push({
      id: `plant:registered:${plant.id}`,
      kind: 'plant',
      label: formatFleetAssetLabel({ identifier: plant.plant_id, nickname: plant.nickname }),
      subtitle: 'Registered plant · Unassigned',
      job: null,
      employee: null,
      plant,
      plantAssignment: null,
      visits: [],
      visitsByDate: emptyVisitBuckets(dates),
    });
  }
  rows.sort((left, right) => left.label.localeCompare(right.label));

  const unassigned = visits.filter((visit) => !assignedVisitIds.has(visit.id));
  if (unassigned.length > 0) rows.push(unassignedRow(unassigned, dates, 'plant'));
  return rows;
}

function unassignedRow(
  visits: DailyAllocationVisit[],
  dates: string[],
  resource: 'employees' | 'plant'
): DailyAllocationBoardRow {
  return {
    id: 'unassigned',
    kind: 'unassigned',
    label: 'Unassigned',
    subtitle: `Visits with no ${resource} yet`,
    job: null,
    employee: null,
    plant: null,
    plantAssignment: null,
    visits: sortVisits(visits),
    visitsByDate: visitBuckets(visits, dates),
  };
}

export function buildDailyAllocationBoardRows(
  input: BuildDailyAllocationBoardRowsInput
): DailyAllocationBoardRow[] {
  const dates = [...new Set(input.dates)];
  const dateSet = new Set(dates);
  const search = input.jobSearch?.trim().toLowerCase() || '';
  const jobsByKey = new Map(input.board.jobs.map((job) => [jobResourceKey(job), job]));
  const visits = input.board.visits.filter((visit) => {
    if (!dateSet.has(visit.work_date)) return false;
    return jobMatches(jobForVisit(visit, jobsByKey), search);
  });
  if (input.primary === 'employee') {
    return buildEmployeeRows(input.board, visits, dates);
  }
  if (input.primary === 'plant') {
    return buildPlantRows(input.board, visits, dates);
  }
  return buildJobRows(visits, jobsByKey, dates);
}

export function getDailyAllocationBoardAxisLabel(primary: DailyAllocationBoardPrimary): string {
  if (primary === 'employee') return 'Employee';
  if (primary === 'plant') return 'Plant';
  return 'Job';
}

export function getDailyAllocationBoardRowTestId(row: DailyAllocationBoardRow): string {
  if (row.kind === 'unassigned') return 'daily-allocation-board-row-unassigned';
  return `daily-allocation-board-row-${row.kind}-${row.id.split(':').slice(1).join(':')}`;
}
