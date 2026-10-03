'use client';

import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { format, parseISO } from 'date-fns';
import { useDroppable } from '@dnd-kit/react';
import { DAILY_ALLOCATION_DND } from '@/components/daily-allocation/board/board-dnd';
import type { DailyAllocationBoardRow } from '@/components/daily-allocation/board/daily-allocation-board-primary';
import { getDailyAllocationBoardRowTestId } from '@/components/daily-allocation/board/daily-allocation-board-primary';
import {
  employeeDay,
  visitConflicts,
  visitLabour,
  visitPlant,
} from '@/components/daily-allocation/board/board-model';
import {
  buildDailyAllocationEmployeeOccupancy,
  dailyAllocationEmployeeUnavailableReason,
  formatDailyAllocationOccupancySummary,
} from '@/components/daily-allocation/board/daily-allocation-occupancy';
import { ResourceOccupancyStrip } from '@/components/daily-allocation/board/ResourceOccupancyStrip';
import { VisitCard } from '@/components/daily-allocation/board/VisitCard';
import { cn } from '@/lib/utils/cn';
import { getDailyAllocationTimeMinutes } from '@/lib/utils/daily-allocation-timeline';
import {
  classifyDailyAllocationSession,
  dailyAllocationSessionLabel,
  type DailyAllocationSession,
} from '@/lib/utils/daily-allocation-sessions';
import type { DailyAllocationBoardView } from '@/lib/config/daily-allocation-view-preference';
import type { DailyAllocationRangeBoardPayload, DailyAllocationVisit } from '@/types/daily-allocation';

const HALF_DAY_SESSIONS = ['am', 'pm'] as const;
const RESIZE_DRAG_THRESHOLD_PX = 24;

function resizedSession(
  session: DailyAllocationSession,
  edge: 'start' | 'end',
  deltaX: number,
): DailyAllocationSession | null {
  if (Math.abs(deltaX) < RESIZE_DRAG_THRESHOLD_PX) return null;
  if (session === 'full' && edge === 'start' && deltaX > 0) return 'pm';
  if (session === 'full' && edge === 'end' && deltaX < 0) return 'am';
  if (session === 'am' && edge === 'end' && deltaX > 0) return 'full';
  if (session === 'pm' && edge === 'start' && deltaX < 0) return 'full';
  return null;
}

function keyboardResizedSession(
  session: DailyAllocationSession,
  edge: 'start' | 'end',
  key: string,
): DailyAllocationSession | null {
  if (session === 'full' && edge === 'start' && key === 'ArrowRight') return 'pm';
  if (session === 'full' && edge === 'end' && key === 'ArrowLeft') return 'am';
  if (session === 'am' && edge === 'end' && key === 'ArrowRight') return 'full';
  if (session === 'pm' && edge === 'start' && key === 'ArrowLeft') return 'full';
  return null;
}

interface SessionBoardProps {
  board: DailyAllocationRangeBoardPayload;
  view: DailyAllocationBoardView;
  date: string;
  dates: string[];
  rows: DailyAllocationBoardRow[];
  selectedVisitId: string | null;
  labourNames: (visitId: string) => string[];
  plantLabels: (visitId: string) => string[];
  persistenceLabel?: (visitId: string) => string | null;
  onSelectVisit: (visit: DailyAllocationVisit) => void;
  onEditVisit: (visit: DailyAllocationVisit) => void;
  onDeleteVisit: (visit: DailyAllocationVisit) => void;
  onAssignVisit: (visit: DailyAllocationVisit) => void;
  onMoveVisit: (visit: DailyAllocationVisit) => void;
  onSetSession: (
    visit: DailyAllocationVisit,
    session: DailyAllocationSession,
    profileId?: string | null,
  ) => void;
  onReviewCustom?: () => void;
}

function sessionVisits(visits: DailyAllocationVisit[], session: DailyAllocationSession | null) {
  return visits.filter((visit) => classifyDailyAllocationSession(
    getDailyAllocationTimeMinutes(visit.starts_at),
    getDailyAllocationTimeMinutes(visit.ends_at),
  ) === session);
}

function useEmployeeSessionDrop(
  profileId: string | null,
  date: string,
  session: DailyAllocationSession,
) {
  return useDroppable({
    id: `session:${profileId || 'unassigned'}:${date}:${session}`,
    type: DAILY_ALLOCATION_DND.timeline,
    accept: [DAILY_ALLOCATION_DND.job, DAILY_ALLOCATION_DND.visit, DAILY_ALLOCATION_DND.plant],
    data: {
      target: {
        surface: 'session',
        workDate: date,
        profileId,
        session,
      },
    },
  });
}

function SessionDrop({
  dropRef,
  profileId,
  date,
  session,
  label,
  highlighted,
  leadingBorder,
  children,
}: {
  dropRef: (element: Element | null) => void;
  profileId: string | null;
  date: string;
  session: DailyAllocationSession;
  label: string;
  highlighted: boolean;
  leadingBorder: boolean;
  children: ReactNode;
}) {
  return (
    <div
      ref={dropRef}
      role="gridcell"
      aria-label={label}
      data-testid={`daily-allocation-session-${profileId || 'unassigned'}-${date}-${session}`}
      className={cn(
        'min-h-28 space-y-2 bg-slate-950/50 p-2',
        leadingBorder && 'border-l border-border',
        highlighted && 'bg-[hsl(var(--daily-allocation-primary)/0.12)]',
      )}
    >
      {children}
    </div>
  );
}

function SessionVisit({
  board,
  row,
  visit,
  date,
  selectedVisitId,
  labourNames,
  plantLabels,
  persistenceLabel,
  onSelectVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
  onMoveVisit,
  onSetSession,
}: {
  board: DailyAllocationRangeBoardPayload;
  row: DailyAllocationBoardRow;
  visit: DailyAllocationVisit;
  date: string;
  selectedVisitId: string | null;
  labourNames: (visitId: string) => string[];
  plantLabels: (visitId: string) => string[];
  persistenceLabel?: (visitId: string) => string | null;
  onSelectVisit: (visit: DailyAllocationVisit) => void;
  onEditVisit: (visit: DailyAllocationVisit) => void;
  onDeleteVisit: (visit: DailyAllocationVisit) => void;
  onAssignVisit: (visit: DailyAllocationVisit) => void;
  onMoveVisit: (visit: DailyAllocationVisit) => void;
  onSetSession: (
    visit: DailyAllocationVisit,
    session: DailyAllocationSession,
    profileId?: string | null,
  ) => void;
}) {
  const currentSession = classifyDailyAllocationSession(
    getDailyAllocationTimeMinutes(visit.starts_at),
    getDailyAllocationTimeMinutes(visit.ends_at),
  );
  const resizeEdges = currentSession === 'full'
    ? (['start', 'end'] as const)
    : currentSession === 'am'
      ? (['end'] as const)
      : currentSession === 'pm'
        ? (['start'] as const)
        : [];

  function handleResizePointerDown(
    edge: 'start' | 'end',
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!currentSession) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const pointerId = event.pointerId;

    const cleanup = () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
    };
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      const nextSession = resizedSession(currentSession, edge, pointerEvent.clientX - startX);
      if (nextSession) {
        onSetSession(visit, nextSession, row.employee?.profile_id ?? null);
      }
    };
    const cancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
    };

    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  }

  function handleResizeKeyDown(
    edge: 'start' | 'end',
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    if (!currentSession) return;
    const nextSession = keyboardResizedSession(currentSession, edge, event.key);
    if (!nextSession) return;
    event.preventDefault();
    event.stopPropagation();
    onSetSession(visit, nextSession, row.employee?.profile_id ?? null);
  }

  return (
    <VisitCard
      visit={visit}
      instanceId={`${row.id}:${date}:${visit.id}`}
      title={visit.job_code}
      labour={visitLabour(board, visit.id)}
      plant={visitPlant(board, visit.id)}
      labourNames={labourNames(visit.id)}
      plantLabels={plantLabels(visit.id)}
      conflicts={visitConflicts(board, visit.id)}
      selected={selectedVisitId === visit.id}
      compact
      sourceProfileId={row.employee?.profile_id || null}
      persistenceLabel={persistenceLabel?.(visit.id)}
      onSelect={() => onSelectVisit(visit)}
      onMove={() => onMoveVisit(visit)}
      onEdit={() => onEditVisit(visit)}
      onDelete={() => onDeleteVisit(visit)}
      onAssign={() => onAssignVisit(visit)}
      resizeEdges={resizeEdges}
      onResizePointerDown={currentSession ? handleResizePointerDown : undefined}
      onResizeKeyDown={currentSession ? handleResizeKeyDown : undefined}
    />
  );
}

function EmployeeRail({
  row,
  board,
  date,
}: {
  row: DailyAllocationBoardRow;
  board: DailyAllocationRangeBoardPayload;
  date: string;
}) {
  const employee = row.employee;
  const day = employee ? employeeDay(employee, date) : null;
  const occupancy = employee
    ? buildDailyAllocationEmployeeOccupancy({
        day,
        assignments: board.labour_assignments.filter((assignment) => (
          assignment.profile_id === employee.profile_id && assignment.work_date === date
        )),
      })
    : null;
  const reason = dailyAllocationEmployeeUnavailableReason(day);
  return (
    <div role="rowheader" className="sticky left-0 z-10 space-y-2 border-r border-t border-border bg-slate-900 p-3">
      <p className="truncate font-semibold text-foreground">{row.label}</p>
      <p className="truncate text-sm text-muted-foreground">{row.subtitle || 'Employee'}</p>
      {occupancy ? (
        <ResourceOccupancyStrip
          segments={occupancy}
          label={formatDailyAllocationOccupancySummary(occupancy, reason)}
        />
      ) : null}
    </div>
  );
}

function EmployeeDaySessions({
  board,
  row,
  workDate,
  selectedVisitId,
  labourNames,
  plantLabels,
  persistenceLabel,
  onSelectVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
  onMoveVisit,
  onSetSession,
}: {
  board: DailyAllocationRangeBoardPayload;
  row: DailyAllocationBoardRow;
  workDate: string;
  selectedVisitId: string | null;
  labourNames: (visitId: string) => string[];
  plantLabels: (visitId: string) => string[];
  persistenceLabel?: (visitId: string) => string | null;
  onSelectVisit: (visit: DailyAllocationVisit) => void;
  onEditVisit: (visit: DailyAllocationVisit) => void;
  onDeleteVisit: (visit: DailyAllocationVisit) => void;
  onAssignVisit: (visit: DailyAllocationVisit) => void;
  onMoveVisit: (visit: DailyAllocationVisit) => void;
  onSetSession: (
    visit: DailyAllocationVisit,
    session: DailyAllocationSession,
    profileId?: string | null,
  ) => void;
}) {
  const visits = row.visitsByDate[workDate] || [];
  const fullVisits = sessionVisits(visits, 'full');
  const profileId = row.employee?.profile_id || null;
  const amDrop = useEmployeeSessionDrop(profileId, workDate, 'am');
  const pmDrop = useEmployeeSessionDrop(profileId, workDate, 'pm');
  const pairedHighlight = amDrop.isDropTarget || pmDrop.isDropTarget;
  const drops = { am: amDrop, pm: pmDrop };
  const bothHalvesEmpty = HALF_DAY_SESSIONS.every((session) => sessionVisits(visits, session).length === 0);
  const visitProps = {
    board,
    row,
    date: workDate,
    selectedVisitId,
    labourNames,
    plantLabels,
    persistenceLabel,
    onSelectVisit,
    onEditVisit,
    onDeleteVisit,
    onAssignVisit,
    onMoveVisit,
    onSetSession,
  };

  return (
    <div
      role="presentation"
      className="grid grid-cols-2"
      style={{ gridColumn: 'span 2 / span 2' }}
      data-session-pair={pairedHighlight ? 'active' : 'idle'}
    >
      {HALF_DAY_SESSIONS.map((session) => {
        const halfDayVisits = sessionVisits(visits, session);
        const showDropPrompt = halfDayVisits.length === 0
          && fullVisits.length === 0
          && Boolean(profileId)
          && !(bothHalvesEmpty && session === 'pm');
        return (
          <SessionDrop
            key={`${row.id}:${workDate}:${session}`}
            dropRef={drops[session].ref}
            profileId={profileId}
            date={workDate}
            session={session}
            label={`${row.label}, ${workDate}, ${dailyAllocationSessionLabel(session)}`}
            highlighted={pairedHighlight}
            leadingBorder={session === 'am'}
          >
            {halfDayVisits.map((visit) => (
              <SessionVisit key={visit.id} {...visitProps} visit={visit} />
            ))}
            {showDropPrompt ? (
              <p className="text-[11px] text-muted-foreground">Drop a job</p>
            ) : null}
          </SessionDrop>
        );
      })}
      {fullVisits.length > 0 ? (
        <div
          role="gridcell"
          aria-label={`${row.label}, ${workDate}, full day`}
          className="pointer-events-none col-span-2 col-start-1 row-start-1 z-[1] space-y-2 p-2"
        >
          {fullVisits.map((visit) => (
            <div key={visit.id} className="pointer-events-auto">
              <SessionVisit {...visitProps} visit={visit} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SessionBoard({
  board,
  view,
  date,
  dates,
  rows,
  selectedVisitId,
  labourNames,
  plantLabels,
  persistenceLabel,
  onSelectVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
  onMoveVisit,
  onSetSession,
  onReviewCustom,
}: SessionBoardProps) {
  const visibleDates = view === 'daily' ? [date] : dates;
  const columns = view === 'daily'
    ? HALF_DAY_SESSIONS.map((session) => ({
        key: session,
        label: dailyAllocationSessionLabel(session),
        date,
        session,
      }))
    : visibleDates.flatMap((workDate) => HALF_DAY_SESSIONS.map((session) => ({
        key: `${workDate}:${session}`,
        label: `${format(parseISO(workDate), 'EEE d')} ${dailyAllocationSessionLabel(session)}`,
        date: workDate,
        session,
      })));

  return (
    <div
      className="h-full min-h-0 overflow-auto rounded-lg border border-border"
      data-testid={view === 'daily' ? 'daily-allocation-daily-board' : 'daily-allocation-weekly-board'}
    >
      <div
        role="grid"
        aria-label={view === 'daily' ? 'Daily employee sessions' : 'Weekly employee sessions'}
        className="grid min-w-[64rem]"
        style={{ gridTemplateColumns: `220px repeat(${columns.length}, minmax(9rem, 1fr))` }}
      >
        <div role="columnheader" className="sticky left-0 z-20 border-b border-r border-border bg-slate-950 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Employee
        </div>
        {columns.map((column) => (
          <div key={column.key} role="columnheader" className="border-b border-l border-border bg-slate-950 px-2 py-2 text-center text-xs font-semibold text-foreground">
            {column.label}
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="col-span-full border-t border-border p-4 text-sm text-muted-foreground">
            No employees are available for this team.
          </div>
        ) : rows.map((row) => (
          <div key={row.id} role="row" className="contents" data-testid={getDailyAllocationBoardRowTestId(row)}>
            <EmployeeRail row={row} board={board} date={date} />
            {visibleDates.map((workDate) => (
              <EmployeeDaySessions
                key={`${row.id}:${workDate}`}
                board={board}
                row={row}
                workDate={workDate}
                selectedVisitId={selectedVisitId}
                labourNames={labourNames}
                plantLabels={plantLabels}
                persistenceLabel={persistenceLabel}
                onSelectVisit={onSelectVisit}
                onEditVisit={onEditVisit}
                onDeleteVisit={onDeleteVisit}
                onAssignVisit={onAssignVisit}
                onMoveVisit={onMoveVisit}
                onSetSession={onSetSession}
              />
            ))}
          </div>
        ))}
      </div>
      <CustomSessionNotice
        rows={rows}
        dates={visibleDates}
        board={board}
        selectedVisitId={selectedVisitId}
        labourNames={labourNames}
        plantLabels={plantLabels}
        persistenceLabel={persistenceLabel}
        onSelectVisit={onSelectVisit}
        onEditVisit={onEditVisit}
        onDeleteVisit={onDeleteVisit}
        onAssignVisit={onAssignVisit}
        onMoveVisit={onMoveVisit}
        onSetSession={onSetSession}
        onReviewCustom={onReviewCustom}
      />
    </div>
  );
}

function CustomSessionNotice(props: Omit<SessionBoardProps, 'view' | 'date'> & { dates: string[] }) {
  const custom = props.rows.flatMap((row) => props.dates.flatMap((date) => (
    sessionVisits(row.visitsByDate[date] || [], null).map((visit) => ({ row, visit, date }))
  )));
  if (custom.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-amber-400/40 bg-amber-400/10 p-3" data-testid="daily-allocation-custom-sessions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-amber-100">
          {custom.length === 1 ? '1 visit still uses a custom time.' : `${custom.length} visits still use a custom time.`} Choose Full, AM, or PM before publishing changes.
        </p>
        {props.onReviewCustom ? (
          <button
            type="button"
            className="rounded-md bg-amber-200 px-2 py-1 text-xs font-semibold text-slate-950"
            onClick={props.onReviewCustom}
          >
            Review sessions
          </button>
        ) : null}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {custom.map(({ row, visit, date }) => (
          <SessionVisit key={`${row.id}:${visit.id}`} {...props} row={row} visit={visit} date={date} />
        ))}
      </div>
    </div>
  );
}
