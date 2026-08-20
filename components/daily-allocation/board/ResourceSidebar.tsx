'use client';

import { useMemo, useRef, type MouseEvent } from 'react';
import { AlertTriangle, GripVertical, Search } from 'lucide-react';
import { useDraggable } from '@dnd-kit/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import {
  DAILY_ALLOCATION_DND,
  jobResourceKey,
  type DailyAllocationDragSource,
} from '@/components/daily-allocation/board/board-dnd';
import { employeeDay, employeeLabel } from '@/components/daily-allocation/board/board-model';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import { cn } from '@/lib/utils/cn';
import type {
  DailyAllocationEmployeeResource,
  DailyAllocationJobProjection,
  DailyAllocationPlantResource,
} from '@/types/daily-allocation';

export type ResourceSidebarTab = 'jobs' | 'employees' | 'plant';

interface ResourceSidebarProps {
  tab: ResourceSidebarTab;
  onTabChange: (tab: ResourceSidebarTab) => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedDate: string;
  jobs: DailyAllocationJobProjection[];
  employees: DailyAllocationEmployeeResource[];
  plant: DailyAllocationPlantResource[];
  selectedResourceId: string | null;
  onSelectResource: (resource: DailyAllocationDragSource) => void;
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

function DragHandle({ testId }: { testId: string }) {
  return (
    <span
      data-testid={testId}
      className="inline-flex min-h-11 min-w-11 touch-none items-center justify-center text-slate-400"
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
      ref={(node) => {
        ref(node);
        handleRef(node);
      }}
      type="button"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      aria-pressed={selected}
      aria-label={`${selected ? 'Selected' : 'Select'} ${label}. Drag from the handle to assign.`}
      data-testid={`daily-allocation-resource-${source.kind}-${id}`}
      className={cn(
        'flex w-full items-center gap-1 rounded-lg p-1.5 text-left motion-reduce:transition-none',
        selected ? boardControlStyles.primary : tintClassName,
        isDragging && 'opacity-60'
      )}
    >
      <DragHandle testId={handleTestId} />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-semibold" title={label}>{label}</span>
        <span className={cn('block truncate text-xs', selected ? 'text-white/80' : 'text-slate-300')} title={subtitle}>
          {subtitle}
        </span>
        {metadata ? (
          <span className={cn('block truncate text-[10px]', selected ? 'text-white/70' : 'text-slate-400')} title={metadata}>
            {metadata}
          </span>
        ) : null}
      </span>
      {warning ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label={warning} /> : null}
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
  selectedResourceId,
  onSelectResource,
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

  const placeholders: Record<ResourceSidebarTab, string> = {
    jobs: 'Search jobs',
    employees: 'Search employees',
    plant: 'Search plant',
  };

  return (
    <Card
      className="flex h-full min-h-0 max-h-[min(36rem,70dvh)] flex-col overflow-hidden border-slate-700 bg-slate-900 text-slate-100 xl:max-h-none"
      data-testid="daily-allocation-resources"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as ResourceSidebarTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <CardHeader className="shrink-0 space-y-3 p-4 pb-0">
          <CardTitle className="text-base">Resources</CardTitle>
          <TabsList aria-label="Resource type" className="grid h-9 w-full grid-cols-3 gap-0 p-1">
            <TabsTrigger value="jobs">Jobs ({filteredJobs.length})</TabsTrigger>
            <TabsTrigger value="employees">Employees ({filteredEmployees.length})</TabsTrigger>
            <TabsTrigger value="plant">Plant ({filteredPlant.length})</TabsTrigger>
          </TabsList>
          <p className="pt-2 text-xs text-slate-300">
            Drag onto the board, or select then Add visit / Assign.
          </p>
          <div className="relative pt-2 pb-3">
            <Search className="pointer-events-none absolute left-2.5 top-4 h-4 w-4 text-slate-400" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={placeholders[tab]}
              aria-label={placeholders[tab]}
              className="h-9 border-slate-600 bg-slate-950 pl-8 text-slate-100"
            />
          </div>
        </CardHeader>
        <CardContent
          className="relative min-h-0 flex-1 overflow-hidden px-4 pb-0 pt-0"
          data-testid="daily-allocation-resources-list"
        >
          <TabsContent value="jobs" className="absolute inset-0 mt-0 space-y-2 overflow-y-auto overscroll-contain">
            {filteredJobs.length === 0 ? (
              <p className="text-sm text-slate-400">No catalogue jobs match this search.</p>
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
            })}
          </TabsContent>
          <TabsContent value="employees" className="absolute inset-0 mt-0 space-y-2 overflow-y-auto overscroll-contain">
            {filteredEmployees.length === 0 ? (
              <p className="text-sm text-slate-400">No employees match this search.</p>
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
                  tintClassName={boardControlStyles.resourceEmployee}
                  handleTestId={`daily-allocation-resource-drag-handle-employee-${employee.profile_id}`}
                  onSelect={() => onSelectResource(source)}
                />
              );
            })}
          </TabsContent>
          <TabsContent value="plant" className="absolute inset-0 mt-0 space-y-2 overflow-y-auto overscroll-contain">
            {filteredPlant.length === 0 ? (
              <p className="text-sm text-slate-400">No registered plant match this search.</p>
            ) : filteredPlant.map((item) => {
              const label = formatFleetAssetLabel({ identifier: item.plant_id, nickname: item.nickname });
              const source: DailyAllocationDragSource = { kind: 'plant', plantId: item.id, label };
              return (
                <DraggableCard
                  key={item.id}
                  id={`plant:${item.id}`}
                  type={DAILY_ALLOCATION_DND.plant}
                  source={source}
                  selected={selectedResourceId === item.id}
                  label={label}
                  subtitle="Registered plant"
                  tintClassName={boardControlStyles.resourcePlant}
                  handleTestId={`daily-allocation-resource-drag-handle-plant-${item.id}`}
                  onSelect={() => onSelectResource(source)}
                />
              );
            })}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
