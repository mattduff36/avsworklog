'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DragDropProvider } from '@dnd-kit/react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DailyAllocationBetaBadge } from '@/components/daily-allocation/DailyAllocationBetaBadge';
import { BoardToolbar } from '@/components/daily-allocation/board/BoardToolbar';
import { ResourceSidebar, type ResourceSidebarTab } from '@/components/daily-allocation/board/ResourceSidebar';
import { JobsPanel, type DailyAllocationTimelineMode } from '@/components/daily-allocation/board/JobsPanel';
import {
  AssignResourcesDialog,
  DeleteVisitDialog,
  MoveVisitDialog,
  OverrideDialog,
  PublicationHistoryDialog,
  PublishDialog,
  VisitEditorDialog,
  emptyVisitForm,
  type MoveVisitFormState,
  type VisitFormState,
} from '@/components/daily-allocation/board/AllocationDialogs';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import {
  createDailyAllocationDndSensors,
  dailyAllocationAccessibilityPlugin,
  jobResourceKey,
  readDropClientX,
  type DailyAllocationDragSource,
  type DailyAllocationDropTarget,
} from '@/components/daily-allocation/board/board-dnd';
import {
  evaluateEmployeeAssignmentBlock,
  filterDailyAllocationBoardForTeam,
  authoritativePlanDayIdentity,
  isDateConverted,
  latestPublicationForDate,
  planDayForDate,
  publicationsForDate,
  resolveDailyAllocationActiveTeamId,
  visitLabour,
  visitPlant,
} from '@/components/daily-allocation/board/board-model';
import { buildDailyAllocationBoardRows } from '@/components/daily-allocation/board/daily-allocation-board-primary';
import {
  useDailyAllocationBoard,
} from '@/components/daily-allocation/board/hooks/use-daily-allocation-board';
import {
  createOptimisticEntityId,
  useDailyAllocationBoardMutations,
} from '@/components/daily-allocation/board/hooks/use-daily-allocation-mutations';
import { useDailyAllocationPrimaryPreference } from '@/components/daily-allocation/board/hooks/use-daily-allocation-primary-preference';
import {
  isDailyAllocationApiError,
  isDailyAllocationStaleOrConflictError,
  fetchDailyAllocationConversionSource,
} from '@/lib/client/daily-allocation';
import {
  DAILY_ALLOCATION_DEFAULT_END_HOUR,
  DAILY_ALLOCATION_DEFAULT_START_HOUR,
  dailyAllocationIntervalsOverlap,
  formatDailyAllocationVisitTime,
  getDailyAllocationInitialVisitWindow,
  getDailyAllocationTimeMinutes,
  mapDailyAllocationClientXToMinutes,
  toDailyAllocationLondonIsoFromMinutes,
} from '@/lib/utils/daily-allocation-timeline';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import type { JobCatalogueOption } from '@/types/job-catalogue';
import type {
  DailyAllocationConflictKind,
  DailyAllocationConvertInput,
  DailyAllocationConvertResult,
  DailyAllocationJobProjection,
  DailyAllocationPlanDay,
  DailyAllocationVisit,
} from '@/types/daily-allocation';
import { DAILY_TIMELINE_HOUR_WIDTH, dailyTimelineRangeLeft } from '@/components/daily-allocation/board/daily-timeline-layout';
import { GuidedLegacyConversionDialog } from '@/components/daily-allocation/board/GuidedLegacyConversionDialog';
import { getDailyAllocationElementVisualScale } from '@/components/daily-allocation/board/daily-allocation-viewport-fit';

const PUBLISH_ATTEMPT_STORAGE_KEY = 'daily-allocation:publish-attempt';
const dailyAllocationBetaBadge = <DailyAllocationBetaBadge />;

type PublishAttempt = {
  workDate: string;
  userId: string;
  key: string;
};

type AuthoritativePlanDay = Pick<DailyAllocationPlanDay, 'id' | 'plan_version'>;

function toAuthoritativePlanDay(result: DailyAllocationConvertResult): AuthoritativePlanDay {
  return { id: result.plan_day_id, plan_version: result.plan_version };
}

function planEnsureKey(teamId: string, workDate: string) {
  return `${teamId}:${workDate}`;
}

function jobToOption(job: DailyAllocationJobProjection): JobCatalogueOption {
  return {
    value: job.job_code,
    label: job.job_code,
    customerName: job.customer_name,
    quoteTitle: job.title,
    source: job.source_type,
    sourceId: job.source_id,
    siteAddress: job.site_address,
    addressValid: true,
    aliases: [],
    isAmbiguous: false,
    blockReason: null,
  };
}

function readStoredPublishAttempt(): PublishAttempt | null {
  try {
    return JSON.parse(window.sessionStorage.getItem(PUBLISH_ATTEMPT_STORAGE_KEY) || 'null') as PublishAttempt | null;
  } catch {
    return null;
  }
}

function storePublishAttempt(attempt: PublishAttempt) {
  try {
    window.sessionStorage.setItem(PUBLISH_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // In-memory reuse still protects retries when browser storage is unavailable.
  }
}

function clearStoredPublishAttempt() {
  try {
    window.sessionStorage.removeItem(PUBLISH_ATTEMPT_STORAGE_KEY);
  } catch {
    // The in-memory attempt is cleared independently.
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isUnallocatedConfirmation(error: unknown) {
  return isDailyAllocationApiError(error) && error.code === 'CONFIRM_UNALLOCATED_REQUIRED';
}

export function DailyAllocationManagerBoard({
  onSelectedDateChange,
}: {
  onSelectedDateChange: (date: string) => void;
}) {
  const boardState = useDailyAllocationBoard();
  const mutations = useDailyAllocationBoardMutations();
  const rawBoard = boardState.board;
  const rawViewBoard = boardState.viewBoard;
  const selectedDate = boardState.selectedDate;
  const primaryPreference = useDailyAllocationPrimaryPreference(rawBoard?.context.user_id || '');
  const pointerX = useRef<number | null>(null);
  const dragActiveRef = useRef(false);
  const publishAttemptRef = useRef<PublishAttempt | null>(null);
  const ensurePlanDayInflight = useRef(new Map<string, Promise<AuthoritativePlanDay | null>>());

  const [resourceTab, setResourceTab] = useState<ResourceSidebarTab>('jobs');
  const [resourceSearch, setResourceSearch] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [selectedTeamOverride, setSelectedTeamOverride] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<DailyAllocationDragSource | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [visitForm, setVisitForm] = useState<VisitFormState>(emptyVisitForm(selectedDate));
  const [visitDialog, setVisitDialog] = useState<'add' | 'edit' | null>(null);
  const [moveVisitId, setMoveVisitId] = useState<string | null>(null);
  const [moveForm, setMoveForm] = useState<MoveVisitFormState>({
    workDate: selectedDate,
    startTime: '08:00',
  });
  const [assignOpen, setAssignOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [unallocatedConfirm, setUnallocatedConfirm] = useState(false);
  const [publishFailed, setPublishFailed] = useState(false);
  const [deleteVisit, setDeleteVisit] = useState<DailyAllocationVisit | null>(null);
  const [overrideKind, setOverrideKind] = useState<DailyAllocationConflictKind | null>(null);
  const [pendingAssign, setPendingAssign] = useState<
    | {
        type: 'employee';
        profileId: string;
        visit: DailyAllocationVisit;
        instructions: { meeting_point: string | null; meet_person: string | null; notes: string | null };
      }
    | { type: 'plant'; plantId: string; visit: DailyAllocationVisit }
    | null
  >(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [dndSessionEpoch, setDndSessionEpoch] = useState(0);
  const [conversionOpen, setConversionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [timelineMode, setTimelineMode] = useState<DailyAllocationTimelineMode>('fit');

  const activeTeamId = rawBoard
    ? resolveDailyAllocationActiveTeamId(rawBoard, selectedTeamOverride)
    : null;
  const fullBoard = useMemo(() => {
    if (!rawBoard || !activeTeamId) return rawBoard;
    return filterDailyAllocationBoardForTeam(rawBoard, activeTeamId);
  }, [rawBoard, activeTeamId]);
  const board = useMemo(() => {
    if (!rawViewBoard || !activeTeamId) return rawViewBoard;
    return filterDailyAllocationBoardForTeam(rawViewBoard, activeTeamId);
  }, [rawViewBoard, activeTeamId]);
  const ownerTeamId = activeTeamId || fullBoard?.context.team_id || '';

  useEffect(() => {
    if (!boardState.boardError) return;
    toast.error(errorMessage(boardState.boardError, 'Unable to load the allocation board.'));
  }, [boardState.boardError]);

  useEffect(() => {
    function recoverStuckInteraction(event: PointerEvent | KeyboardEvent | Event) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      boardState.setPointerInteractionActive(false);
      if (dragActiveRef.current) {
        dragActiveRef.current = false;
        setDndSessionEpoch((current) => current + 1);
        setStatusMessage('Drag cancelled. Board controls restored.');
      }
    }
    window.addEventListener('pointercancel', recoverStuckInteraction);
    window.addEventListener('blur', recoverStuckInteraction);
    window.addEventListener('keydown', recoverStuckInteraction);
    return () => {
      window.removeEventListener('pointercancel', recoverStuckInteraction);
      window.removeEventListener('blur', recoverStuckInteraction);
      window.removeEventListener('keydown', recoverStuckInteraction);
    };
  }, [boardState]);

  function handleDateChange(date: string) {
    publishAttemptRef.current = null;
    clearStoredPublishAttempt();
    setPublishFailed(false);
    setPublishOpen(false);
    setUnallocatedConfirm(false);
    onSelectedDateChange(date);
  }

  const rows = useMemo(() => {
    if (!board) return [];
    return buildDailyAllocationBoardRows({
      primary: primaryPreference.primary,
      board,
      dates: boardState.view === 'daily' ? [selectedDate] : board.dates,
      jobSearch,
    });
  }, [board, boardState.view, jobSearch, primaryPreference.primary, selectedDate]);

  function labourNames(visitId: string) {
    if (!fullBoard) return [];
    return visitLabour(fullBoard, visitId).map((assignment) => {
      const employee = fullBoard.resources.employees.find((item) => item.profile_id === assignment.profile_id);
      return employee ? employee.full_name : assignment.profile_id;
    });
  }

  function plantLabels(visitId: string) {
    if (!fullBoard) return [];
    return visitPlant(fullBoard, visitId).map((assignment) => {
      if (assignment.plant_kind === 'hired') {
        return [assignment.hired_serial, assignment.hired_description].filter(Boolean).join(' · ');
      }
      const plant = fullBoard.resources.plant.find((item) => item.id === assignment.plant_id);
      return plant
        ? formatFleetAssetLabel({ identifier: plant.plant_id, nickname: plant.nickname })
        : assignment.plant_id || 'Plant';
    });
  }

  function showMutationError(error: unknown, fallback: string) {
    const message = errorMessage(error, fallback);
    if (isDailyAllocationStaleOrConflictError(error) && !isUnallocatedConfirmation(error)) {
      toast.error(message, {
        description: 'The board may be stale. Refresh it before retrying so you do not overwrite newer changes.',
        action: {
          label: 'Refresh board',
          onClick: () => void boardState.refetch(),
        },
      });
      void boardState.refetch();
      return;
    }
    toast.error(message);
  }

  async function ensurePlanDay(workDate: string): Promise<AuthoritativePlanDay | null> {
    if (!fullBoard) return null;
    const teamId = ownerTeamId;
    if (!teamId) {
      toast.error('A team is required to create this timed plan.');
      return null;
    }
    const key = planEnsureKey(teamId, workDate);
    const inflight = ensurePlanDayInflight.current.get(key);
    if (inflight) return inflight;
    const existing = authoritativePlanDayIdentity(planDayForDate(fullBoard, workDate));
    if (existing) return existing;

    const request = (async (): Promise<AuthoritativePlanDay | null> => {
      let source;
      try {
        source = await fetchDailyAllocationConversionSource(workDate, teamId);
      } catch (error) {
        showMutationError(error, 'Unable to load the authoritative conversion source.');
        return null;
      }
      if (source.labour_drafts.length > 0 || source.plant_drafts.length > 0) {
        setConversionOpen(true);
        setStatusMessage('Review every untimed draft before creating timed visits.');
        return null;
      }
      const optimisticPlanDay: DailyAllocationPlanDay = {
        id: createOptimisticEntityId(globalThis.crypto.randomUUID(), 'plan'),
        work_date: workDate,
        team_id: teamId,
        plan_version: 1,
        converted_at: new Date().toISOString(),
        converted_by: fullBoard.context.user_id,
        updated_at: new Date().toISOString(),
      };
      try {
        const result = await mutations.convert.mutateAsync({
          request: {
            work_date: workDate,
            team_id: teamId,
            expected_source_fingerprint: source.source_fingerprint,
            visits: [],
            labour_drafts: [],
            plant_drafts: [],
          },
          optimisticPlanDay,
        });
        return toAuthoritativePlanDay(result);
      } catch (error) {
        showMutationError(error, 'Unable to create this timed plan.');
        return null;
      }
    })().finally(() => {
      ensurePlanDayInflight.current.delete(key);
    });

    ensurePlanDayInflight.current.set(key, request);
    return request;
  }

  function openAddVisit(jobKey: string, workDate: string, startTime?: string, endTime?: string) {
    const job = fullBoard?.jobs.find((item) => jobResourceKey(item) === jobKey);
    const form: VisitFormState = {
      ...emptyVisitForm(workDate || selectedDate),
      job: job ? jobToOption(job) : null,
      startTime: startTime || '08:00',
      endTime: endTime || '11:00',
    };
    setVisitForm(form);
    setVisitDialog('add');
  }

  function openMoveVisit(visit: DailyAllocationVisit) {
    setSelectedVisitId(visit.id);
    setMoveVisitId(visit.id);
    setMoveForm({
      workDate: visit.work_date,
      startTime: formatDailyAllocationVisitTime(visit.starts_at),
    });
  }

  async function submitMoveVisit() {
    const visit = fullBoard?.visits.find((item) => item.id === moveVisitId);
    if (!visit) return;
    const [hours, minutes] = moveForm.startTime.split(':').map(Number);
    const startMinutes = hours * 60 + minutes;
    if (!Number.isFinite(startMinutes) || startMinutes % 30 !== 0) {
      toast.error('Choose a start time on the 30-minute grid.');
      return;
    }
    if (await moveVisit(visit, moveForm.workDate, startMinutes)) {
      setMoveVisitId(null);
    }
  }

  function openEditVisit(visit: DailyAllocationVisit) {
    const job = fullBoard?.jobs.find(
      (item) => item.source_type === visit.job_source_type && item.source_id === visit.job_source_id
    );
    setSelectedVisitId(visit.id);
    setVisitForm({
      job: job
        ? jobToOption(job)
        : {
            value: visit.job_code,
            label: visit.job_code,
            customerName: null,
            quoteTitle: null,
            source: visit.job_source_type,
            sourceId: visit.job_source_id,
            siteAddress: visit.site_address,
            addressValid: true,
            aliases: [],
            isAmbiguous: false,
            blockReason: null,
          },
      workDate: visit.work_date,
      startTime: formatDailyAllocationVisitTime(visit.starts_at),
      endTime: formatDailyAllocationVisitTime(visit.ends_at),
      meetingPoint: visit.meeting_point || '',
      meetPerson: visit.meet_person || '',
      notes: visit.notes || '',
    });
    setVisitDialog('edit');
  }

  async function submitVisitForm(
    form: VisitFormState,
    mode: 'add' | 'edit'
  ) {
    if (!fullBoard || !form.job) {
      toast.error('Choose a catalogue job.');
      return;
    }
    const startMinutes = Number(form.startTime.slice(0, 2)) * 60 + Number(form.startTime.slice(3, 5));
    const endMinutes = Number(form.endTime.slice(0, 2)) * 60 + Number(form.endTime.slice(3, 5));
    if (startMinutes % 30 !== 0 || endMinutes % 30 !== 0) {
      toast.error('Start and end times must use 30-minute steps.');
      return;
    }
    if (endMinutes - startMinutes < 30) {
      toast.error('Visits must be at least 30 minutes long.');
      return;
    }
    const planDay = authoritativePlanDayIdentity(planDayForDate(fullBoard, form.workDate)) ?? (
      mode === 'add' ? await ensurePlanDay(form.workDate) : null
    );
    if (!planDay) return;
    const starts_at = toDailyAllocationLondonIsoFromMinutes(form.workDate, startMinutes);
    const ends_at = toDailyAllocationLondonIsoFromMinutes(form.workDate, endMinutes);
    const request = {
      plan_day_id: planDay.id,
      expected_plan_version: planDay.plan_version,
      job_source_type: form.job.source,
      job_source_id: form.job.sourceId,
      job_code: form.job.value,
      starts_at,
      ends_at,
      meeting_point: form.meetingPoint || null,
      meet_person: form.meetPerson || null,
      notes: form.notes || null,
    };
    const optimisticVisit: DailyAllocationVisit = {
      id: mode === 'edit' && selectedVisitId
        ? selectedVisitId
        : createOptimisticEntityId(globalThis.crypto.randomUUID(), 'visit'),
      plan_day_id: planDay.id,
      work_date: form.workDate,
      owner_team_id: ownerTeamId,
      job_source_type: form.job.source,
      job_source_id: form.job.sourceId,
      job_code: form.job.value,
      site_address: form.job.siteAddress || '',
      starts_at,
      ends_at,
      meeting_point: form.meetingPoint || null,
      meet_person: form.meetPerson || null,
      notes: form.notes || null,
      row_version: 1,
      updated_at: new Date().toISOString(),
    };
    try {
      if (mode === 'edit' && selectedVisitId) {
        const existing = fullBoard.visits.find((visit) => visit.id === selectedVisitId);
        await mutations.updateVisit.mutateAsync({
          visitId: selectedVisitId,
          request: {
            ...request,
            visit_id: selectedVisitId,
            expected_row_version: existing?.row_version,
          },
          optimisticVisit: {
            ...optimisticVisit,
            id: selectedVisitId,
            row_version: (existing?.row_version || 1) + 1,
          },
        });
        toast.success('Visit updated.');
      } else {
        await mutations.createVisit.mutateAsync({ request, optimisticVisit });
        toast.success('Visit created.');
      }
      setVisitDialog(null);
      setStatusMessage('Visit saved.');
    } catch (error) {
      showMutationError(error, 'Unable to save visit.');
    }
  }

  async function createVisitAt(job: DailyAllocationJobProjection, workDate: string, startMinutes: number | null) {
    const window = getDailyAllocationInitialVisitWindow(
      startMinutes ?? 8 * 60,
      180,
      DAILY_ALLOCATION_DEFAULT_END_HOUR
    );
    const form: VisitFormState = {
      ...emptyVisitForm(workDate),
      job: jobToOption(job),
      startTime: `${String(Math.floor(window.startMinutes / 60)).padStart(2, '0')}:${String(window.startMinutes % 60).padStart(2, '0')}`,
      endTime: `${String(Math.floor(window.endMinutes / 60)).padStart(2, '0')}:${String(window.endMinutes % 60).padStart(2, '0')}`,
    };
    if (startMinutes == null) {
      openAddVisit(jobResourceKey(job), workDate);
      return;
    }
    await submitVisitForm(form, 'add');
  }

  async function moveVisit(
    visit: DailyAllocationVisit,
    workDate: string,
    startMinutes: number | null
  ) {
    if (!fullBoard) return false;
    const planDay = authoritativePlanDayIdentity(planDayForDate(fullBoard, workDate))
      ?? await ensurePlanDay(workDate);
    if (!planDay) return false;
    const duration = getDailyAllocationTimeMinutes(visit.ends_at) - getDailyAllocationTimeMinutes(visit.starts_at);
    const start = startMinutes ?? getDailyAllocationTimeMinutes(visit.starts_at);
    const startsAt = toDailyAllocationLondonIsoFromMinutes(workDate, start);
    const endsAt = toDailyAllocationLondonIsoFromMinutes(workDate, start + Math.max(duration, 30));
    const optimisticVisit = {
      ...visit,
      work_date: workDate,
      plan_day_id: planDay.id,
      owner_team_id: ownerTeamId || visit.owner_team_id,
      starts_at: startsAt,
      ends_at: endsAt,
      row_version: visit.row_version + 1,
    };
    try {
      const sourcePlan = planDayForDate(fullBoard, visit.work_date);
      if (sourcePlan && sourcePlan.id !== planDay.id) {
        await mutations.moveVisit.mutateAsync({
          request: {
            visit_id: visit.id,
            target_plan_day_id: planDay.id,
            expected_source_plan_version: sourcePlan.plan_version,
            expected_target_plan_version: planDay.plan_version,
            expected_row_version: visit.row_version,
            starts_at: startsAt,
            ends_at: endsAt,
          },
          optimisticVisit,
          sourcePlanDayId: sourcePlan.id,
        });
      } else {
        await mutations.updateVisit.mutateAsync({
          visitId: visit.id,
          request: {
            visit_id: visit.id,
            plan_day_id: planDay.id,
            expected_plan_version: planDay.plan_version,
            expected_row_version: visit.row_version,
            job_source_type: visit.job_source_type,
            job_source_id: visit.job_source_id,
            job_code: visit.job_code,
            starts_at: startsAt,
            ends_at: endsAt,
            meeting_point: visit.meeting_point,
            meet_person: visit.meet_person,
            notes: visit.notes,
          },
          optimisticVisit,
        });
      }
      setStatusMessage('Visit moved.');
      return true;
    } catch (error) {
      showMutationError(error, 'Unable to move visit.');
      return false;
    }
  }

  async function resizeVisit(visit: DailyAllocationVisit, startsAt: string, endsAt: string) {
    if (!fullBoard) return;
    const planDay = planDayForDate(fullBoard, visit.work_date);
    if (!planDay) return;
    try {
      await mutations.updateVisit.mutateAsync({
        visitId: visit.id,
        request: {
          visit_id: visit.id,
          plan_day_id: planDay.id,
          expected_plan_version: planDay.plan_version,
          expected_row_version: visit.row_version,
          job_source_type: visit.job_source_type,
          job_source_id: visit.job_source_id,
          job_code: visit.job_code,
          starts_at: startsAt,
          ends_at: endsAt,
          meeting_point: visit.meeting_point,
          meet_person: visit.meet_person,
          notes: visit.notes,
        },
        optimisticVisit: {
          ...visit,
          starts_at: startsAt,
          ends_at: endsAt,
          row_version: visit.row_version + 1,
        },
      });
      setStatusMessage(
        `Visit resized to ${formatDailyAllocationVisitTime(startsAt)}–${formatDailyAllocationVisitTime(endsAt)}.`
      );
    } catch (error) {
      showMutationError(error, 'Unable to resize visit.');
    }
  }

  function employeeAssignmentBlock(
    visit: DailyAllocationVisit,
    profileId: string
  ): { hard: string } | { warning: DailyAllocationConflictKind } | null {
    if (!fullBoard) return null;
    return evaluateEmployeeAssignmentBlock(fullBoard, visit, profileId);
  }

  async function assignEmployee(
    visit: DailyAllocationVisit,
    profileId: string,
    instructions: { meeting_point: string | null; meet_person: string | null; notes: string | null } = {
      meeting_point: null,
      meet_person: null,
      notes: null,
    },
    overrideId?: string,
    expectedPlanVersion?: number
  ) {
    if (!fullBoard) return;
    const planDay = planDayForDate(fullBoard, visit.work_date);
    if (!planDay) return;
    const block = employeeAssignmentBlock(visit, profileId);
    if (block && 'hard' in block) {
      toast.error(block.hard);
      void boardState.refetch();
      return;
    }
    if (block && 'warning' in block && !overrideId) {
      setPendingAssign({ type: 'employee', profileId, visit, instructions });
      setOverrideKind(block.warning);
      return;
    }
    const existingAssignment = fullBoard.labour_assignments.find(
      (assignment) => assignment.visit_id === visit.id && assignment.profile_id === profileId
    );
    try {
      await mutations.assignLabour.mutateAsync({
        request: {
          visit_id: visit.id,
          profile_id: profileId,
          expected_plan_version: expectedPlanVersion ?? planDay.plan_version,
          expected_row_version: existingAssignment?.row_version,
          ...instructions,
          override_id: overrideId,
        },
        optimisticAssignment: {
          id: existingAssignment?.id
            || createOptimisticEntityId(globalThis.crypto.randomUUID(), 'labour'),
          visit_id: visit.id,
          plan_day_id: planDay.id,
          work_date: visit.work_date,
          profile_id: profileId,
          starts_at: visit.starts_at,
          ends_at: visit.ends_at,
          meeting_point: instructions.meeting_point,
          meet_person: instructions.meet_person,
          notes: instructions.notes,
          row_version: (existingAssignment?.row_version || 0) + 1,
          updated_at: new Date().toISOString(),
        },
      });
      toast.success(existingAssignment ? 'Employee instructions updated.' : 'Employee assigned.');
      setStatusMessage(existingAssignment ? 'Employee instructions updated.' : 'Employee assigned.');
    } catch (error) {
      showMutationError(error, 'Unable to assign employee.');
    }
  }

  async function assignRegisteredPlant(visit: DailyAllocationVisit, plantId: string) {
    if (!fullBoard) return;
    const planDay = planDayForDate(fullBoard, visit.work_date);
    if (!planDay) return;
    const otherJob = fullBoard.plant_assignments.find((assignment) => (
      assignment.plant_id === plantId
      && assignment.work_date === visit.work_date
      && assignment.visit_id !== visit.id
    ));
    if (otherJob) {
      const otherVisit = fullBoard.visits.find((item) => item.id === otherJob.visit_id);
      if (otherVisit && (
        otherVisit.job_source_type !== visit.job_source_type
        || otherVisit.job_source_id !== visit.job_source_id
      )) {
        toast.error('This plant is already planned on a different job today.');
        void boardState.refetch();
        return;
      }
      if (otherVisit && dailyAllocationIntervalsOverlap(otherVisit, visit)) {
        toast.error('This plant already has an overlapping visit.');
        void boardState.refetch();
        return;
      }
    }
    const existingAssignment = fullBoard.plant_assignments.find(
      (assignment) => assignment.visit_id === visit.id && assignment.plant_id === plantId
    );
    try {
      await mutations.assignPlant.mutateAsync({
        request: {
          visit_id: visit.id,
          expected_plan_version: planDay.plan_version,
          expected_row_version: existingAssignment?.row_version,
          plant_kind: 'registered',
          plant_id: plantId,
        },
        optimisticAssignment: {
          id: existingAssignment?.id
            || createOptimisticEntityId(globalThis.crypto.randomUUID(), 'plant'),
          visit_id: visit.id,
          plan_day_id: planDay.id,
          work_date: visit.work_date,
          plant_kind: 'registered',
          plant_id: plantId,
          hired_serial: null,
          hired_description: null,
          hired_company: null,
          owner_team_id: ownerTeamId || fullBoard.context.team_id,
          starts_at: visit.starts_at,
          ends_at: visit.ends_at,
          notes: existingAssignment?.notes ?? null,
          row_version: (existingAssignment?.row_version || 0) + 1,
          updated_at: new Date().toISOString(),
        },
      });
      toast.success(existingAssignment ? 'Plant assignment updated.' : 'Plant assigned.');
    } catch (error) {
      showMutationError(error, 'Unable to assign plant.');
    }
  }

  async function assignHiredPlant(
    visit: DailyAllocationVisit,
    hired: { hired_serial: string; hired_description: string; hired_company: string }
  ) {
    if (!fullBoard) return;
    const planDay = planDayForDate(fullBoard, visit.work_date);
    if (!planDay) return;
    const existingAssignment = fullBoard.plant_assignments.find(
      (assignment) =>
        assignment.visit_id === visit.id
        && assignment.hired_serial === hired.hired_serial
        && assignment.hired_company === hired.hired_company
    );
    try {
      await mutations.assignPlant.mutateAsync({
        request: {
          visit_id: visit.id,
          expected_plan_version: planDay.plan_version,
          expected_row_version: existingAssignment?.row_version,
          plant_kind: 'hired',
          ...hired,
        },
        optimisticAssignment: {
          id: existingAssignment?.id
            || createOptimisticEntityId(globalThis.crypto.randomUUID(), 'plant'),
          visit_id: visit.id,
          plan_day_id: planDay.id,
          work_date: visit.work_date,
          plant_kind: 'hired',
          plant_id: null,
          ...hired,
          owner_team_id: ownerTeamId || fullBoard.context.team_id,
          starts_at: visit.starts_at,
          ends_at: visit.ends_at,
          notes: existingAssignment?.notes ?? null,
          row_version: (existingAssignment?.row_version || 0) + 1,
          updated_at: new Date().toISOString(),
        },
      });
      toast.success(existingAssignment ? 'Hired plant assignment updated.' : 'Hired plant assigned.');
    } catch (error) {
      showMutationError(error, 'Unable to assign hired plant.');
    }
  }

  async function handleOverrideConfirm(evidence: string) {
    if (!fullBoard || !pendingAssign || !overrideKind) return;
    const planDay = planDayForDate(fullBoard, pendingAssign.visit.work_date);
    if (!planDay) return;
    try {
      const result = await mutations.createOverride.mutateAsync({
        request: {
          plan_day_id: planDay.id,
          expected_plan_version: planDay.plan_version,
          conflict_kind: overrideKind,
          evidence,
          visit_id: pendingAssign.visit.id,
          profile_id: pendingAssign.type === 'employee' ? pendingAssign.profileId : '',
        },
        optimisticOverride: {
          id: createOptimisticEntityId(globalThis.crypto.randomUUID(), 'override'),
          plan_day_id: planDay.id,
          visit_id: pendingAssign.visit.id,
          profile_id: pendingAssign.type === 'employee' ? pendingAssign.profileId : null,
          plant_id: null,
          conflict_kind: overrideKind,
          evidence,
          confirmed_by: fullBoard.context.user_id,
          confirmed_at: new Date().toISOString(),
        },
      });
      setOverrideKind(null);
      if (pendingAssign.type === 'employee') {
        await assignEmployee(
          pendingAssign.visit,
          pendingAssign.profileId,
          pendingAssign.instructions,
          result.override_id,
          planDay.plan_version + 1
        );
      }
      setPendingAssign(null);
    } catch (error) {
      showMutationError(error, 'Unable to record override.');
    }
  }

  async function handleDeleteVisit() {
    if (!fullBoard || !deleteVisit) return;
    const planDay = planDayForDate(fullBoard, deleteVisit.work_date);
    if (!planDay) return;
    try {
      await mutations.removeVisit.mutateAsync({
        visit_id: deleteVisit.id,
        expected_plan_version: planDay.plan_version,
        expected_row_version: deleteVisit.row_version,
      });
      toast.success('Visit deleted.');
      setDeleteVisit(null);
      setSelectedVisitId(null);
    } catch (error) {
      showMutationError(error, 'Unable to delete visit.');
    }
  }

  async function publish(confirmUnallocated: boolean) {
    if (!fullBoard) return;
    const planDay = authoritativePlanDayIdentity(planDayForDate(fullBoard, selectedDate));
    if (!planDay) return;
    const userId = fullBoard.context.user_id || 'unknown';
    const storedAttempt = readStoredPublishAttempt();
    const existingAttempt = publishAttemptRef.current || storedAttempt;
    const attempt = existingAttempt?.workDate === selectedDate && existingAttempt.userId === userId
      ? existingAttempt
      : { workDate: selectedDate, userId, key: `${selectedDate}:${userId}:${globalThis.crypto.randomUUID()}` };
    publishAttemptRef.current = attempt;
    storePublishAttempt(attempt);
    try {
      await mutations.publishV2.mutateAsync({
        request: {
          snapshot_version: 2,
          plan_day_id: planDay.id,
          expected_plan_version: planDay.plan_version,
          idempotency_key: attempt.key,
          confirm_unallocated: confirmUnallocated,
        },
        optimisticPublication: {
          id: createOptimisticEntityId(attempt.key, 'publication'),
          work_date: selectedDate,
          revision_no: (latestPublicationForDate(fullBoard, selectedDate)?.revision_no || 0) + 1,
          published_at: new Date().toISOString(),
          published_by: userId,
          published_by_name: null,
          scope_team_id: ownerTeamId || fullBoard.context.team_id,
          snapshot_version: 2,
          plan_day_id: planDay.id,
          published_plan_version: planDay.plan_version,
          confirm_unallocated: confirmUnallocated,
        },
      });
      publishAttemptRef.current = null;
      clearStoredPublishAttempt();
      setPublishFailed(false);
      setUnallocatedConfirm(false);
      setPublishOpen(false);
      toast.success('Allocation published. Employees have been notified.');
    } catch (error) {
      if (isUnallocatedConfirmation(error)) {
        boardState.setMutationError(null);
        setUnallocatedConfirm(true);
        setPublishOpen(true);
        setStatusMessage('Confirm publishing with unallocated employees.');
        return;
      }
      setPublishFailed(true);
      showMutationError(error, 'Unable to publish.');
    }
  }

  async function refreshForNewPublishAttempt() {
    const refreshed = await boardState.refetch();
    if (refreshed) {
      publishAttemptRef.current = null;
      clearStoredPublishAttempt();
      setPublishFailed(false);
      toast.success('Board refreshed. The next publish will start a new attempt.');
    }
  }

  async function submitGuidedConversion(
    request: Omit<DailyAllocationConvertInput, 'request_id'>
  ) {
    if (!fullBoard) return;
    const optimisticPlanDay: DailyAllocationPlanDay = {
      id: createOptimisticEntityId(globalThis.crypto.randomUUID(), 'plan'),
      work_date: request.work_date,
      team_id: request.team_id,
      plan_version: 1,
      converted_at: new Date().toISOString(),
      converted_by: fullBoard.context.user_id,
      updated_at: new Date().toISOString(),
    };
    try {
      await mutations.convert.mutateAsync({ request, optimisticPlanDay });
      setConversionOpen(false);
      setStatusMessage('Legacy drafts converted to the reviewed timed plan.');
      toast.success('Legacy drafts converted.');
      await boardState.refetch();
    } catch (error) {
      showMutationError(error, 'Unable to convert these legacy drafts.');
      throw error;
    }
  }

  function handleDragEnd(event: {
    canceled?: boolean;
    operation?: {
      source?: { data?: { source?: DailyAllocationDragSource } } | null;
      target?: { data?: { target?: DailyAllocationDropTarget; hourWidth?: number; startHour?: number; endHour?: number } } | null;
    };
  }) {
    dragActiveRef.current = false;
    boardState.setPointerInteractionActive(false);
    if (event.canceled) return;
    const source = event.operation?.source?.data?.source;
    const target = event.operation?.target?.data?.target;
    if (!source || !target || !fullBoard) return;
    const clientX = readDropClientX(event, pointerX.current);
    const startMinutes = (() => {
      if (target.surface !== 'timeline' || clientX == null) return null;
      const header = document.querySelector<HTMLElement>('[data-testid="daily-allocation-daily-timeline-header"]');
      if (!header) return null;
      const visualScale = getDailyAllocationElementVisualScale(header);
      const rangeLeft = dailyTimelineRangeLeft(header.getBoundingClientRect().left, visualScale);
      return mapDailyAllocationClientXToMinutes({
        clientX,
        rangeLeft,
        hourWidth: (event.operation?.target?.data?.hourWidth || DAILY_TIMELINE_HOUR_WIDTH)
          * visualScale,
        startHour: event.operation?.target?.data?.startHour || DAILY_ALLOCATION_DEFAULT_START_HOUR,
        endHour: event.operation?.target?.data?.endHour || DAILY_ALLOCATION_DEFAULT_END_HOUR,
      });
    })();

    if (source.kind === 'job' && (target.surface === 'timeline' || target.surface === 'week-cell') && target.workDate) {
      void createVisitAt(source.job, target.workDate, target.surface === 'timeline' ? startMinutes : 8 * 60);
      return;
    }
    if (source.kind === 'visit' && (target.surface === 'timeline' || target.surface === 'week-cell') && target.workDate) {
      void moveVisit(source.visit, target.workDate, target.surface === 'timeline' ? startMinutes : null);
      return;
    }
    if ((source.kind === 'employee' || source.kind === 'plant') && target.visitId) {
      const visit = fullBoard.visits.find((item) => item.id === target.visitId);
      if (!visit) return;
      setSelectedVisitId(visit.id);
      if (source.kind === 'employee') void assignEmployee(visit, source.profileId);
      else void assignRegisteredPlant(visit, source.plantId);
    }
  }

  const converted = fullBoard ? isDateConverted(fullBoard, selectedDate) : false;
  const latestPublication = fullBoard ? latestPublicationForDate(fullBoard, selectedDate) : null;
  const history = fullBoard ? publicationsForDate(fullBoard, selectedDate) : [];
  const selectedVisit = fullBoard?.visits.find((visit) => visit.id === selectedVisitId) || null;
  const moveDialogVisit = fullBoard?.visits.find((visit) => visit.id === moveVisitId) || null;
  const selectedLegacyLabour = fullBoard?.legacy.labour.filter((draft) => draft.work_date === selectedDate) || [];
  const selectedLegacyPlant = fullBoard?.legacy.plant.filter((draft) => draft.work_date === selectedDate) || [];
  const employeeNames = useMemo(
    () => new Map(fullBoard?.resources.employees.map((employee) => [employee.profile_id, employee.full_name]) || []),
    [fullBoard?.resources.employees]
  );

  if (boardState.isBoardLoading && !fullBoard) {
    return (
      <AppPageLoadingShell
        title="Daily Allocation"
        titleMeta={dailyAllocationBetaBadge}
        message="Loading daily allocation..."
      />
    );
  }

  if (boardState.boardError && !fullBoard) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Daily Allocation unavailable"
          titleMeta={dailyAllocationBetaBadge}
          description={errorMessage(boardState.boardError, 'The allocation board could not be loaded.')}
          actions={<Button onClick={() => void boardState.refetch()}>Retry</Button>}
        />
      </AppPageShell>
    );
  }

  if (!fullBoard || !board) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Daily Allocation unavailable"
          titleMeta={dailyAllocationBetaBadge}
          description="The allocation board could not be loaded."
          actions={<Button onClick={() => void boardState.refetch()}>Retry</Button>}
        />
      </AppPageShell>
    );
  }

  return (
    <DragDropProvider
      key={dndSessionEpoch}
      sensors={createDailyAllocationDndSensors()}
      plugins={(defaults) => [...defaults, dailyAllocationAccessibilityPlugin()]}
      onDragStart={() => {
        dragActiveRef.current = true;
        boardState.setPointerInteractionActive(true);
      }}
      onDragEnd={handleDragEnd}
    >
      <AppPageShell
        width="full"
        className="flex h-full min-h-0 flex-col gap-2 space-y-0 overflow-hidden"
        onPointerMoveCapture={(event) => {
          pointerX.current = event.clientX;
        }}
      >
        <div className="sr-only" aria-live="polite">{statusMessage}</div>

          {!converted && (selectedLegacyLabour.length > 0 || selectedLegacyPlant.length > 0) ? (
            <div
              className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-950/30 px-4 py-3"
              data-testid="daily-allocation-legacy-conversion"
            >
              <div>
                <p className="text-sm font-semibold text-amber-100">Untimed legacy drafts need review</p>
                <p className="text-xs text-amber-200/80">
                  {selectedLegacyLabour.length} labour and {selectedLegacyPlant.length} plant drafts must each be mapped or given an explicit disposition.
                </p>
              </div>
              <Button
                type="button"
                className={boardControlStyles.primary}
                onClick={() => setConversionOpen(true)}
              >
                Review and convert
              </Button>
            </div>
          ) : null}

          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[350px_minmax(0,1fr)]">
            <ResourceSidebar
              tab={resourceTab}
              onTabChange={setResourceTab}
              search={resourceSearch}
              onSearchChange={setResourceSearch}
              selectedDate={selectedDate}
              jobs={fullBoard.jobs}
              employees={fullBoard.resources.employees}
              plant={fullBoard.resources.plant}
              labourAssignments={fullBoard.labour_assignments}
              plantAssignments={fullBoard.plant_assignments}
              selectedResourceId={
                selectedResource?.kind === 'job'
                  ? jobResourceKey(selectedResource.job)
                  : selectedResource?.kind === 'employee'
                    ? selectedResource.profileId
                    : selectedResource?.kind === 'plant'
                      ? selectedResource.plantId
                      : null
              }
              onSelectResource={setSelectedResource}
            />
            <Card className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-slate-700 bg-slate-900 text-slate-100">
              <div className="shrink-0 border-b border-slate-800 px-3 py-2">
                <BoardToolbar
                  title={`${boardState.view === 'daily' ? 'Daily' : 'Weekly'} ${primaryPreference.primary === 'employee' ? 'employee' : primaryPreference.primary} board`}
                  titleMeta={dailyAllocationBetaBadge}
                  selectedDate={selectedDate}
                  view={boardState.view}
                  onDateChange={handleDateChange}
                  onViewChange={boardState.setView}
                  primary={primaryPreference.primary}
                  onPrimaryChange={primaryPreference.setPrimary}
                  jobSearch={jobSearch}
                  onJobSearchChange={setJobSearch}
                  timelineMode={timelineMode}
                  onTimelineModeChange={setTimelineMode}
                  latestPublicationLabel={
                    latestPublication
                      ? `Latest published revision ${latestPublication.revision_no}${latestPublication.published_by_name ? ` by ${latestPublication.published_by_name}` : ''}`
                      : 'No published revision for this date yet.'
                  }
                  onOpenHistory={() => setHistoryOpen(true)}
                  onAddVisit={() => openAddVisit(
                    selectedResource?.kind === 'job' ? jobResourceKey(selectedResource.job) : '',
                    selectedDate
                  )}
                  onAssign={() => {
                    if (selectedVisit && selectedResource?.kind === 'employee') {
                      void assignEmployee(selectedVisit, selectedResource.profileId);
                      return;
                    }
                    if (selectedVisit && selectedResource?.kind === 'plant') {
                      void assignRegisteredPlant(selectedVisit, selectedResource.plantId);
                      return;
                    }
                    setAssignOpen(true);
                  }}
                  assignDisabled={!selectedVisit}
                  assignLabel={
                    selectedVisit && selectedResource?.kind !== 'job'
                      ? 'Assign selected resource'
                      : 'Assign resources'
                  }
                  onPublish={() => {
                    setUnallocatedConfirm(false);
                    setPublishOpen(true);
                  }}
                  publishDisabled={!converted}
                  publishDisabledReason={!converted ? 'Add a timed visit before publishing.' : undefined}
                  publishing={mutations.publishV2.isPending}
                  isLoading={boardState.isBoardLoading}
                  isFetching={boardState.isBoardFetching}
                  isStale={Boolean(boardState.mutationError)}
                  statusMessage={statusMessage}
                  teams={rawBoard?.resources.teams || []}
                  activeTeamId={activeTeamId}
                  onTeamChange={setSelectedTeamOverride}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-2">
                <JobsPanel
                  board={board}
                  view={boardState.view}
                  primary={primaryPreference.primary}
                  selectedDate={selectedDate}
                  dates={board.dates}
                  rows={rows}
                  timelineMode={timelineMode}
                  selectedVisitId={selectedVisitId}
                  labourNames={labourNames}
                  plantLabels={plantLabels}
                  onAddVisit={openAddVisit}
                  onSelectVisit={(visit) => setSelectedVisitId(visit.id)}
                  onMoveVisit={openMoveVisit}
                  onEditVisit={openEditVisit}
                  onDeleteVisit={setDeleteVisit}
                  onAssignVisit={(visit) => {
                    setSelectedVisitId(visit.id);
                    setAssignOpen(true);
                  }}
                  onResizeVisit={(visit, startsAt, endsAt) => {
                    void resizeVisit(visit, startsAt, endsAt);
                  }}
                  onPointerInteractionChange={boardState.setPointerInteractionActive}
                />
              </div>
            </Card>
          </div>

        <PublicationHistoryDialog
          open={historyOpen}
          publications={history}
          onOpenChange={setHistoryOpen}
        />
        <VisitEditorDialog
          open={visitDialog !== null}
          mode={visitDialog || 'add'}
          form={visitForm}
          onFormChange={setVisitForm}
          onOpenChange={(open) => {
            if (!open) setVisitDialog(null);
          }}
          onSubmit={() => void submitVisitForm(visitForm, visitDialog || 'add')}
          saving={mutations.createVisit.isPending || mutations.updateVisit.isPending}
        />
        <MoveVisitDialog
          open={Boolean(moveVisitId)}
          visit={moveDialogVisit}
          dates={fullBoard.dates}
          form={moveForm}
          onFormChange={setMoveForm}
          onOpenChange={(open) => {
            if (!open) setMoveVisitId(null);
          }}
          onSubmit={() => void submitMoveVisit()}
          saving={mutations.moveVisit.isPending || mutations.updateVisit.isPending}
        />
        <AssignResourcesDialog
          key={`${assignOpen}:${selectedVisit?.id || 'none'}`}
          open={assignOpen}
          visit={selectedVisit}
          employees={fullBoard.resources.employees}
          plant={fullBoard.resources.plant}
          labour={selectedVisit ? visitLabour(fullBoard, selectedVisit.id) : []}
          plantAssignments={selectedVisit ? visitPlant(fullBoard, selectedVisit.id) : []}
          labourNames={selectedVisit ? labourNames(selectedVisit.id) : []}
          plantLabels={selectedVisit ? plantLabels(selectedVisit.id) : []}
          onOpenChange={setAssignOpen}
          onAssignEmployee={(profileId, instructions) => selectedVisit && void assignEmployee(
            selectedVisit,
            profileId,
            instructions
          )}
          onAssignPlant={(plantId) => selectedVisit && void assignRegisteredPlant(selectedVisit, plantId)}
          onAssignHiredPlant={(hired) => selectedVisit && void assignHiredPlant(selectedVisit, hired)}
          onRemoveLabour={(assignmentId) => {
            const planDay = selectedVisit ? planDayForDate(fullBoard, selectedVisit.work_date) : null;
            if (!planDay) return;
            const assignment = fullBoard.labour_assignments.find((item) => item.id === assignmentId);
            void mutations.unassignLabour.mutateAsync({
              assignment_id: assignmentId,
              expected_plan_version: planDay.plan_version,
              expected_row_version: assignment?.row_version,
            }).catch((error: unknown) => showMutationError(error, 'Unable to remove assignment.'));
          }}
          onRemovePlant={(assignmentId) => {
            const planDay = selectedVisit ? planDayForDate(fullBoard, selectedVisit.work_date) : null;
            if (!planDay) return;
            const assignment = fullBoard.plant_assignments.find((item) => item.id === assignmentId);
            void mutations.unassignPlant.mutateAsync({
              assignment_id: assignmentId,
              expected_plan_version: planDay.plan_version,
              expected_row_version: assignment?.row_version,
            }).catch((error: unknown) => showMutationError(error, 'Unable to remove plant.'));
          }}
          saving={mutations.isPending}
        />
        <OverrideDialog
          key={overrideKind || 'override-closed'}
          open={overrideKind !== null}
          kind={overrideKind}
          onOpenChange={(open) => {
            if (!open) {
              setOverrideKind(null);
              setPendingAssign(null);
            }
          }}
          onConfirm={(evidence) => void handleOverrideConfirm(evidence)}
          saving={mutations.createOverride.isPending}
        />
        <PublishDialog
          open={publishOpen}
          workDate={selectedDate}
          failed={publishFailed}
          publishing={mutations.publishV2.isPending}
          unallocatedConfirm={unallocatedConfirm}
          onOpenChange={setPublishOpen}
          onPublish={() => void publish(unallocatedConfirm)}
          onRefresh={() => void refreshForNewPublishAttempt()}
        />
        <DeleteVisitDialog
          open={Boolean(deleteVisit)}
          visit={deleteVisit}
          onOpenChange={(open) => {
            if (!open) setDeleteVisit(null);
          }}
          onConfirm={() => void handleDeleteVisit()}
          saving={mutations.removeVisit.isPending}
        />
        <GuidedLegacyConversionDialog
          open={conversionOpen}
          workDate={selectedDate}
          teamId={ownerTeamId}
          employeeNames={employeeNames}
          onOpenChange={setConversionOpen}
          onSubmit={submitGuidedConversion}
          saving={mutations.convert.isPending}
        />
      </AppPageShell>
    </DragDropProvider>
  );
}
