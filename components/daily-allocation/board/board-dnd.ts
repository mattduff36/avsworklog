import {
  Accessibility,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from '@dnd-kit/dom';
import type { DailyAllocationJobProjection, DailyAllocationVisit } from '@/types/daily-allocation';

export const DAILY_ALLOCATION_DND = {
  job: 'daily-allocation-job',
  employee: 'daily-allocation-employee',
  plant: 'daily-allocation-plant',
  visit: 'daily-allocation-visit',
  timeline: 'daily-allocation-timeline',
  weekCell: 'daily-allocation-week-cell',
} as const;

export type DailyAllocationResourceKind = 'job' | 'employee' | 'plant';

export interface DailyAllocationDragJob {
  kind: 'job';
  job: DailyAllocationJobProjection;
}

export interface DailyAllocationDragEmployee {
  kind: 'employee';
  profileId: string;
  label: string;
}

export interface DailyAllocationDragPlant {
  kind: 'plant';
  plantId: string;
  label: string;
}

export interface DailyAllocationDragVisit {
  kind: 'visit';
  visit: DailyAllocationVisit;
}

export type DailyAllocationDragSource =
  | DailyAllocationDragJob
  | DailyAllocationDragEmployee
  | DailyAllocationDragPlant
  | DailyAllocationDragVisit;

export interface DailyAllocationDropTarget {
  workDate?: string;
  visitId?: string;
  jobKey?: string;
  surface: 'timeline' | 'week-cell' | 'visit';
}

export function jobResourceKey(job: Pick<DailyAllocationJobProjection, 'source_type' | 'source_id'>): string {
  return `${job.source_type}:${job.source_id}`;
}

export function isFormFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function createDailyAllocationPointerSensor() {
  return PointerSensor.configure({
    activationConstraints(event: { pointerType?: string }) {
      if (event.pointerType === 'touch') {
        return [
          new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 }),
        ];
      }
      return [new PointerActivationConstraints.Distance({ value: 8 })];
    },
  });
}

export function createDailyAllocationKeyboardSensor() {
  return KeyboardSensor.configure({
    preventActivation(event: { target?: EventTarget | null }) {
      return isFormFieldTarget(event.target ?? null);
    },
  });
}

export function dailyAllocationAccessibilityPlugin() {
  return Accessibility.configure({
    announcements: {
      dragstart({ operation: { source } }: { operation: { source?: { data?: { source?: DailyAllocationDragSource } } } }) {
        const drag = source?.data?.source;
        if (drag?.kind === 'job') return `Picked up job ${drag.job.job_code}.`;
        if (drag?.kind === 'employee') return `Picked up ${drag.label}.`;
        if (drag?.kind === 'plant') return `Picked up ${drag.label}.`;
        if (drag?.kind === 'visit') return `Picked up visit ${drag.visit.job_code}.`;
        return 'Started dragging.';
      },
      dragend({ canceled }: { canceled?: boolean }) {
        return canceled ? 'Drag cancelled.' : 'Drop completed.';
      },
    },
  });
}

export function createDailyAllocationDndSensors() {
  return [
    createDailyAllocationPointerSensor(),
    createDailyAllocationKeyboardSensor(),
  ];
}

export function readDropClientX(event: unknown, fallback: number | null): number | null {
  const operation = (event as { operation?: { position?: { current?: { x?: number } } } }).operation;
  const x = operation?.position?.current?.x;
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  return fallback;
}
