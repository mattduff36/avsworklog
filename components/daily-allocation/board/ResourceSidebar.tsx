'use client';

import { useMemo, useRef, type MouseEvent } from 'react';
import { AlertTriangle, GripVertical, Search, X } from 'lucide-react';
import { useDraggable } from '@dnd-kit/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  boardControlStyles,
  RESOURCE_GUIDANCE_CLASS,
} from '@/components/daily-allocation/board/board-control-styles';
import {
  DAILY_ALLOCATION_DND,
  jobResourceKey,
  type DailyAllocationDragSource,
} from '@/components/daily-allocation/board/board-dnd';
import { employeeDay, employeeLabel } from '@/components/daily-allocation/board/board-model';
import {
  buildDailyAllocationEmployeeOccupancy,
  buildDailyAllocationPlantOccupancy,
  formatDailyAllocationOccupancySummary,
  type DailyAllocationOccupancySegment,
} from '@/components/daily-allocation/board/daily-allocation-occupancy';
import {
  ResourceOccupancyLegend,
  ResourceOccupancyStrip,
} from '@/components/daily-allocation/board/ResourceOccupancyStrip';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import { cn } from '@/lib/utils/cn';
import type {
  DailyAllocationEmployeeResource,
  DailyAllocationJobProjection,
  DailyAllocationLabourAssignment,
  DailyAllocationPlantAssignment,
  DailyAllocationPlantResource,
} from '@/types/daily-allocation';

export type ResourceSidebarTab = 'jobs' | 'employees' | 'plant';

export interface ResourceSidebarSelectedVisit {
  label: string;
  detail: string;
}

interface ResourceSidebarProps {
  tab: ResourceSidebarTab;
  onTabChange: (tab: ResourceSidebarTab) => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedDate: string;
  jobs: DailyAllocationJobProjection[];
  employees: DailyAllocationEmployeeResource[];
  plant: DailyAllocationPlantResource[];
  labourAssignments: DailyAllocationLabourAssignment[];
  plantAssignments: DailyAllocationPlantAssignment[];
  selectedResourceId: string | null;
  onSelectResource: (resource: DailyAllocationDragSource) => void;
  selectedVisit?: ResourceSidebarSelectedVisit | null;
  onClearSelectedVisit?: () => void;
}

function useDragSafeActivation(isDragging: boolean, onActivate: () => void) {
  const didDrag = useRef(false);

  function handlePointerDown() {
    didDrag.current = false;
  }

  function handlePointerMove() {
    if (isDragging) didDrag.current = true;
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (didDrag.current) {
      didDrag.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onActivate();
  }

  return { handleClick, handlePointerDown, handlePointerMove };
}

function DragHandle({
  testId,
  handleRef,
}: {
  testId: string;
  handleRef: (element: HTMLElement | null) => void;
}) {
  return (
    <span
      ref={handleRef}
      data-testid={testId}
      className="flex min-h-11 min-w-11 touch-none items-center justify-center self-stretch text-muted-foreground"
      style={{ touchAction: 'none' }}
    >
      <GripVertical aria-hidden="true" className="h-4 w-4" />
    </span>
  );
}

function DraggableCard({
  id,
  type,
  source,
  selected,
  label,
  subtitle,
  metadata,
  warning,
  occupancy,
  tintClassName,
  handleTestId,
  onSelect,
}: {
  id: string;
  type: string;
  source: DailyAllocationDragSource;
  selected: boolean;
  label: string;
  subtitle: string;
  metadata?: string;
  warning?: string | null;
  occupancy?: DailyAllocationOccupancySegment[];
  tintClassName: string;
  handleTestId: string;
  onSelect: () => void;
}) {
  const { ref, handleRef, isDragging } = useDraggable({
    id,
    type,
    data: { source },
  });
  const { handleClick, handlePointerDown, handlePointerMove } = useDragSafeActivation(isDragging, onSelect);

  return (
    <button
      ref={ref}
      type="button"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      aria-pressed={selected}
      aria-label={`${selected ? 'Selected' : 'Select'} ${label}. Drag from the handle to assign.`}
      data-testid={`daily-allocation-resource-${source.kind}-${id}`}
      className={cn(
        'relative flex min-h-11 w-full touch-none items-stretch overflow-hidden rounded-lg text-left transition',
        selected ? boardControlStyles.primary : tintClassName,
        isDragging && 'cursor-grabbing opacity-40'
      )}
    >
      <DragHandle testId={handleTestId} handleRef={handleRef} />
      <span className="flex min-w-0 flex-1 items-center gap-2 p-2 pl-0">
        <span className="min-w-0 flex-1 space-y-0.5">
          <span
            className={cn('block truncate text-sm font-semibold', selected ? 'text-white' : 'text-slate-100')}
            title={label}
          >
            {label}
          </span>
          <span
            className={cn('block truncate text-xs', selected ? 'text-white/80' : 'text-slate-300')}
            title={subtitle}
          >
            {subtitle}
          </span>
          {metadata ? (
            <span
              className={cn('block truncate text-[10px]', selected ? 'text-white/70' : 'text-slate-400')}
              title={metadata}
            >
              {metadata}
            </span>
          ) : null}
        </span>
        {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
      </span>
      {occupancy ? (
        <ResourceOccupancyStrip
          segments={occupancy}
          label={formatDailyAllocationOccupancySummary(occupancy)}
        />
      ) : null}
    </button>
  );
}

export function ResourceSidebar({
  tab,
  onTabChange,
  search,
  onSearchChange,
  selectedDate,
  jobs,
  employees,
  plant,
  labourAssignments,
  plantAssignments,
  selectedResourceId,
  onSelectResource,
  selectedVisit,
  onClearSelectedVisit,
}: ResourceSidebarProps) {
  const term = search.trim().toLowerCase();
  const filteredJobs = useMemo(
    () => jobs.filter((job) => {
      if (!term) return true;
      return [job.job_code, job.customer_name, job.title, job.site_address]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term));
    }),
    [jobs, term]
  );
  const filteredEmployees = useMemo(
    () => employees.filter((employee) => {
      if (!term) return true;
      return employeeLabel(employee).toLowerCase().includes(term);
    }),
    [employees, term]
  );
  const filteredPlant = useMemo(
    () => plant.filter((item) => {
      if (!term) return true;
      return formatFleetAssetLabel({ identifier: item.plant_id, nickname: item.nickname })
        .toLowerCase()
        .includes(term);
    }),
    [plant, term]
  );
  const labourByEmployee = useMemo(() => {
    const result = new Map<string, DailyAllocationLabourAssignment[]>();
    for (const assignment of labourAssignments) {
      if (assignment.work_date !== selectedDate) continue;
      result.set(assignment.profile_id, [...(result.get(assignment.profile_id) || []), assignment]);
    }
    return result;
  }, [labourAssignments, selectedDate]);
  const plantByResource = useMemo(() => {
    const result = new Map<string, DailyAllocationPlantAssignment[]>();
    for (const assignment of plantAssignments) {
      if (assignment.work_date !== selectedDate || assignment.plant_kind !== 'registered' || !assignment.plant_id) continue;
      result.set(assignment.plant_id, [...(result.get(assignment.plant_id) || []), assignment]);
    }
    return result;
  }, [plantAssignments, selectedDate]);

  const placeholders: Record<ResourceSidebarTab, string> = {
    jobs: 'Search jobs',
    employees: 'Search employees',
    plant: 'Search plant',
  };

  return (
    <Card
      className="flex h-full min-h-0 flex-col overflow-hidden border-border"
      data-testid="daily-allocation-resources"
    >
      <CardHeader className="shrink-0 pb-3">
        <CardTitle className="text-base">Resources</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as ResourceSidebarTab)}
          className="shrink-0"
        >
          <TabsList
            aria-label="Resource type"
            className="grid w-full grid-cols-3"
            data-testid="daily-allocation-resource-tabs"
          >
            <TabsTrigger value="jobs">Jobs ({filteredJobs.length})</TabsTrigger>
            <TabsTrigger value="employees">Employees ({filteredEmployees.length})</TabsTrigger>
            <TabsTrigger value="plant">Plant ({filteredPlant.length})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="shrink-0 space-y-3">
          {tab !== 'jobs' && selectedVisit ? (
            <div className="rounded-md border border-daily-allocation/40 bg-daily-allocation-soft p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">{selectedVisit.label}</p>
                  <p className="mt-1 text-muted-foreground">{selectedVisit.detail}</p>
                </div>
                {onClearSelectedVisit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClearSelectedVisit}
                    className={cn('h-7 px-2', boardControlStyles.ghost)}
                    aria-label="Clear selected visit"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-muted-foreground">
                Tap a resource or drag its card onto this or another visit.
              </p>
            </div>
          ) : (
            <p className={RESOURCE_GUIDANCE_CLASS}>
              {tab === 'jobs'
                ? 'Drag a job onto the board, or select a job then Add visit.'
                : 'Drag from the grip handle onto a timed visit, or select the visit and tap a resource.'}
            </p>
          )}
          {tab !== 'jobs' ? <ResourceOccupancyLegend /> : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={placeholders[tab]}
              aria-label={placeholders[tab]}
              className="pl-9"
            />
          </div>
        </div>

        <div
          className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3"
          data-testid="daily-allocation-resources-list"
        >
          <div className="space-y-2">
            {tab === 'jobs' ? (
              filteredJobs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  No catalogue jobs match this search.
                </div>
              ) : filteredJobs.map((job) => {
                const source: DailyAllocationDragSource = { kind: 'job', job };
                return (
                  <DraggableCard
                    key={jobResourceKey(job)}
                    id={`job:${jobResourceKey(job)}`}
                    type={DAILY_ALLOCATION_DND.job}
                    source={source}
                    selected={selectedResourceId === jobResourceKey(job)}
                    label={job.job_code}
                    subtitle={[job.customer_name, job.title].filter(Boolean).join(' · ') || 'Catalogue job'}
                    metadata={job.site_address || undefined}
                    tintClassName={boardControlStyles.resourceJob}
                    handleTestId={`daily-allocation-resource-drag-handle-job-${job.source_id}`}
                    onSelect={() => onSelectResource(source)}
                  />
                );
              })
            ) : null}
            {tab === 'employees' ? (
              filteredEmployees.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  No employees match this search.
                </div>
              ) : filteredEmployees.map((employee) => {
                const day = employeeDay(employee, selectedDate);
                const warning = day?.availability === 'full_day_absence'
                  ? day.blocking_absence?.reason_name || 'Absent'
                  : day?.pending_absence
                    ? 'Pending absence'
                    : null;
                const source: DailyAllocationDragSource = {
                  kind: 'employee',
                  profileId: employee.profile_id,
                  label: employee.full_name,
                };
                const occupancy = buildDailyAllocationEmployeeOccupancy({
                  day,
                  assignments: labourByEmployee.get(employee.profile_id) || [],
                });
                return (
                  <DraggableCard
                    key={employee.profile_id}
                    id={`employee:${employee.profile_id}`}
                    type={DAILY_ALLOCATION_DND.employee}
                    source={source}
                    selected={selectedResourceId === employee.profile_id}
                    label={employee.full_name}
                    subtitle={[employee.employee_id, employee.team_name].filter(Boolean).join(' · ') || 'Employee'}
                    metadata={warning || day?.availability.replaceAll('_', ' ')}
                    warning={warning}
                    occupancy={occupancy}
                    tintClassName={boardControlStyles.resourceEmployee}
                    handleTestId={`daily-allocation-resource-drag-handle-employee-${employee.profile_id}`}
                    onSelect={() => onSelectResource(source)}
                  />
                );
              })
            ) : null}
            {tab === 'plant' ? (
              filteredPlant.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  No registered plant match this search.
                </div>
              ) : filteredPlant.map((item) => {
                const label = formatFleetAssetLabel({ identifier: item.plant_id, nickname: item.nickname });
                const source: DailyAllocationDragSource = { kind: 'plant', plantId: item.id, label };
                const occupancy = buildDailyAllocationPlantOccupancy(
                  plantByResource.get(item.id) || []
                );
                return (
                  <DraggableCard
                    key={item.id}
                    id={`plant:${item.id}`}
                    type={DAILY_ALLOCATION_DND.plant}
                    source={source}
                    selected={selectedResourceId === item.id}
                    label={label}
                    subtitle="Registered plant"
                    occupancy={occupancy}
                    tintClassName={boardControlStyles.resourcePlant}
                    handleTestId={`daily-allocation-resource-drag-handle-plant-${item.id}`}
                    onSelect={() => onSelectResource(source)}
                  />
                );
              })
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
