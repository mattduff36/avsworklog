'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { JobCataloguePicker } from '@/components/daily-allocation/JobCataloguePicker';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import type { DailyAllocationBoardPayload, DailyLabourBoardRow, DailyPlantBoardRow } from '@/types/daily-allocation';
import type { JobCatalogueOption } from '@/types/job-catalogue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function tomorrowIso() {
  return format(addDays(new Date(), 1), 'yyyy-MM-dd');
}

type ApiErrorPayload = {
  error?: string;
  code?: string;
};

type PublishAttempt = {
  workDate: string;
  userId: string;
  key: string;
};

const PUBLISH_ATTEMPT_STORAGE_KEY = 'daily-allocation:publish-attempt';

class DailyAllocationRequestError extends Error {
  constructor(message: string, readonly isConflict: boolean) {
    super(message);
    this.name = 'DailyAllocationRequestError';
  }
}

function requestError(response: Response, payload: ApiErrorPayload, fallback: string) {
  return new DailyAllocationRequestError(
    payload.error?.trim() || fallback,
    response.status === 409 || payload.code === 'STALE_DRAFT_VERSION' || payload.code === 'PLANT_CONFLICT',
  );
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

export default function DailyAllocationBoardPage() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('daily-allocation');
  const { permissionLevels } = usePermissionSnapshot();
  const [workDate, setWorkDate] = useState(tomorrowIso);
  const [board, setBoard] = useState<DailyAllocationBoardPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishFailed, setPublishFailed] = useState(false);
  const publishAttemptRef = useRef<PublishAttempt | null>(null);
  const previousWorkDateRef = useRef(workDate);
  const [hiredSerial, setHiredSerial] = useState('');
  const [hiredDescription, setHiredDescription] = useState('');
  const [hiredCompany, setHiredCompany] = useState('');
  const [hiredJob, setHiredJob] = useState<JobCatalogueOption | null>(null);
  const [registeredPlantId, setRegisteredPlantId] = useState('');
  const [registeredJob, setRegisteredJob] = useState<JobCatalogueOption | null>(null);
  const canManage = (permissionLevels?.['daily-allocation'] || 0) >= 4 || Boolean(board?.context.is_manager);

  const loadBoard = useCallback(async (date: string): Promise<boolean> => {
    setLoading(true);
    setBoard(null);
    setLoadError(null);
    try {
      const response = await fetch(`/api/daily-allocation/board?date=${date}`, { cache: 'no-store' });
      const payload = await response.json() as DailyAllocationBoardPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load the allocation board.');
      setBoard(payload);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load the allocation board.';
      setLoadError(message);
      toast.error(message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasPermission || permissionLoading) return;
    void loadBoard(workDate);
  }, [hasPermission, loadBoard, permissionLoading, workDate]);

  useEffect(() => {
    if (previousWorkDateRef.current === workDate) return;
    previousWorkDateRef.current = workDate;
    publishAttemptRef.current = null;
    clearStoredPublishAttempt();
    setPublishFailed(false);
    setConfirmPublish(false);
  }, [workDate]);

  const incompleteCount = useMemo(
    () => (board?.labour || []).filter((row) => !row.publish_ready).length,
    [board]
  );

  function showRequestError(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    if (error instanceof DailyAllocationRequestError && error.isConflict) {
      toast.error(message, {
        description: 'The board may be stale. Refresh it before retrying so you do not overwrite newer changes.',
        action: {
          label: 'Refresh board',
          onClick: () => void loadBoard(workDate),
        },
      });
      return;
    }
    toast.error(message);
  }

  async function saveLabour(row: DailyLabourBoardRow, patch: Partial<DailyLabourBoardRow['draft']> & {
    job_source_type?: string | null;
    job_source_id?: string | null;
    job_code?: string | null;
    start_time?: string | null;
    meeting_point?: string | null;
    meet_person?: string | null;
    notes?: string | null;
  }) {
    if (!board || board.work_date !== workDate) {
      toast.error('This board is no longer current. Reload the selected date before saving.');
      return;
    }
    setSavingId(row.profile_id);
    try {
      const response = await fetch('/api/daily-allocation/labour', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_date: workDate,
          profile_id: row.profile_id,
          job_source_type: patch?.job_source_type ?? row.draft?.job_source_type,
          job_source_id: patch?.job_source_id ?? row.draft?.job_source_id,
          job_code: patch?.job_code ?? row.draft?.job_code,
          start_time: patch?.start_time ?? row.draft?.instructions.start_time,
          meeting_point: patch?.meeting_point ?? row.draft?.instructions.meeting_point,
          meet_person: patch?.meet_person ?? row.draft?.instructions.meet_person,
          notes: patch?.notes ?? row.draft?.instructions.notes,
          row_version: row.draft?.row_version,
        }),
      });
      const payload = await response.json() as ApiErrorPayload;
      if (!response.ok) throw requestError(response, payload, 'Unable to save allocation.');
      await loadBoard(workDate);
    } catch (error) {
      showRequestError(error, 'Unable to save allocation.');
    } finally {
      setSavingId(null);
    }
  }

  async function clearLabour(row: DailyLabourBoardRow) {
    if (!board || board.work_date !== workDate) {
      toast.error('This board is no longer current. Reload the selected date before clearing.');
      return;
    }
    setSavingId(row.profile_id);
    try {
      const query = new URLSearchParams({ date: workDate, profileId: row.profile_id });
      const response = await fetch(`/api/daily-allocation/labour?${query.toString()}`, { method: 'DELETE' });
      const payload = await response.json() as ApiErrorPayload;
      if (!response.ok) throw requestError(response, payload, 'Unable to clear allocation.');
      await loadBoard(workDate);
    } catch (error) {
      showRequestError(error, 'Unable to clear allocation.');
    } finally {
      setSavingId(null);
    }
  }

  async function savePlant(body: Record<string, unknown>) {
    if (!board || board.work_date !== workDate) {
      toast.error('This board is no longer current. Reload the selected date before saving plant.');
      return;
    }
    setSavingId('plant');
    try {
      const response = await fetch('/api/daily-allocation/plant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_date: workDate, ...body }),
      });
      const payload = await response.json() as ApiErrorPayload;
      if (!response.ok) throw requestError(response, payload, 'Unable to save plant allocation.');
      await loadBoard(workDate);
    } catch (error) {
      showRequestError(error, 'Unable to save plant allocation.');
    } finally {
      setSavingId(null);
    }
  }

  async function publish() {
    if (!board || board.work_date !== workDate) {
      toast.error('This board is no longer current. Reload the selected date before publishing.');
      return;
    }
    setPublishing(true);
    try {
      const userId = board?.context.user_id || 'unknown';
      const storedAttempt = readStoredPublishAttempt();
      const existingAttempt = publishAttemptRef.current || storedAttempt;
      const attempt = existingAttempt?.workDate === workDate && existingAttempt.userId === userId
        ? existingAttempt
        : {
            workDate,
            userId,
            key: `${workDate}:${userId}:${globalThis.crypto.randomUUID()}`,
          };
      publishAttemptRef.current = attempt;
      storePublishAttempt(attempt);
      const response = await fetch('/api/daily-allocation/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_date: workDate,
          idempotency_key: attempt.key,
        }),
      });
      const payload = await response.json() as ApiErrorPayload;
      if (!response.ok) throw requestError(response, payload, 'Unable to publish.');
      publishAttemptRef.current = null;
      clearStoredPublishAttempt();
      setPublishFailed(false);
      toast.success('Allocation published. Employees have been notified.');
      setConfirmPublish(false);
      await loadBoard(workDate);
    } catch (error) {
      setPublishFailed(true);
      showRequestError(error, 'Unable to publish.');
    } finally {
      setPublishing(false);
    }
  }

  async function refreshForNewPublishAttempt() {
    setPublishing(true);
    const refreshed = await loadBoard(workDate);
    if (refreshed) {
      publishAttemptRef.current = null;
      clearStoredPublishAttempt();
      setPublishFailed(false);
      toast.success('Board refreshed. The next publish will start a new attempt.');
    }
    setPublishing(false);
  }

  if (permissionLoading) {
    return <AppPageLoadingShell title="Daily Allocation" message="Loading daily allocation..." />;
  }

  if (!hasPermission) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Daily Allocation"
          description="This module is not enabled for your team. During deployment it remains unavailable until post-deploy activation is complete."
        />
      </AppPageShell>
    );
  }

  if (loading) {
    return <AppPageLoadingShell title="Daily Allocation" message="Loading daily allocation..." />;
  }

  if (!board) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Daily Allocation unavailable"
          description={loadError || 'The allocation board could not be loaded.'}
          actions={<Button onClick={() => void loadBoard(workDate)}>Retry</Button>}
        />
      </AppPageShell>
    );
  }

  if (!canManage) {
    return (
      <AppPageShell>
        <AppPageHeader title="Daily Allocation" description="Manager access is required to plan this board." />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="Daily Allocation"
        description="Assign one primary job per employee, plan plant, then publish immutable instructions."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setWorkDate(format(addDays(parseISO(workDate), -1), 'yyyy-MM-dd'))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
              className="w-auto"
            />
            <Button variant="outline" onClick={() => setWorkDate(format(addDays(parseISO(workDate), 1), 'yyyy-MM-dd'))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button onClick={() => setConfirmPublish(true)} disabled={loading || incompleteCount > 0}>
              Publish
            </Button>
          </div>
        }
      />

      {loading ? (
        <AppPageLoadingShell title="Daily Allocation" message="Loading board..." />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {board.latest_publication ? (
              <span>
                Latest published revision {board.latest_publication.revision_no}
                {board.latest_publication.published_by_name ? ` by ${board.latest_publication.published_by_name}` : ''}
              </span>
            ) : (
              <span>No published revision for this date yet.</span>
            )}
            {incompleteCount > 0 ? (
              <Badge variant="secondary">{incompleteCount} employee{incompleteCount === 1 ? '' : 's'} still need a job</Badge>
            ) : (
              <Badge>Ready to publish</Badge>
            )}
          </div>

          {board.publication_history.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Publication history</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {board.publication_history.map((publication) => (
                    <li
                      key={publication.id}
                      className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="font-medium">Revision {publication.revision_no}</span>
                      <span className="text-muted-foreground">
                        {publication.published_by_name ? `${publication.published_by_name} · ` : ''}
                        {format(parseISO(publication.published_at), 'dd MMM yyyy HH:mm')}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <div className="space-y-4">
            {board.labour.map((row) => (
              <LabourRow
                key={`${workDate}:${row.profile_id}`}
                row={row}
                disabled={row.availability === 'full_day_absence' || savingId === row.profile_id}
                onJobSelect={(option) => void saveLabour(row, {
                  job_source_type: option?.source || null,
                  job_source_id: option?.sourceId || null,
                  job_code: option?.value || null,
                })}
                onInstructionChange={(field, value) => void saveLabour(row, { [field]: value })}
                onClear={() => void clearLabour(row)}
              />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Plant planning</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-lg border p-4">
                  <h3 className="font-medium">Registered plant</h3>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={registeredPlantId}
                    onChange={(event) => setRegisteredPlantId(event.target.value)}
                  >
                    <option value="">Select plant</option>
                    {board.available_plant.map((plant) => (
                      <option key={plant.id} value={plant.id}>
                        {formatFleetAssetLabel({ identifier: plant.plant_id, nickname: plant.nickname })}
                      </option>
                    ))}
                  </select>
                  <JobCataloguePicker value={registeredJob?.value || null} sourceId={registeredJob?.sourceId} onSelect={setRegisteredJob} />
                  <Button
                    disabled={!registeredPlantId || !registeredJob}
                    onClick={() => void savePlant({
                      plant_kind: 'registered',
                      plant_id: registeredPlantId,
                      job_source_type: registeredJob?.source,
                      job_source_id: registeredJob?.sourceId,
                      job_code: registeredJob?.value,
                    })}
                  >
                    Add registered plant
                  </Button>
                </div>
                <div className="space-y-3 rounded-lg border p-4">
                  <h3 className="font-medium">Hired plant</h3>
                  <Input placeholder="Serial / ID" value={hiredSerial} onChange={(event) => setHiredSerial(event.target.value)} />
                  <Input placeholder="Description" value={hiredDescription} onChange={(event) => setHiredDescription(event.target.value)} />
                  <Input placeholder="Hire company" value={hiredCompany} onChange={(event) => setHiredCompany(event.target.value)} />
                  <JobCataloguePicker value={hiredJob?.value || null} sourceId={hiredJob?.sourceId} onSelect={setHiredJob} />
                  <Button
                    disabled={!hiredSerial || !hiredDescription || !hiredCompany || !hiredJob}
                    onClick={() => void savePlant({
                      plant_kind: 'hired',
                      hired_serial: hiredSerial,
                      hired_description: hiredDescription,
                      hired_company: hiredCompany,
                      job_source_type: hiredJob?.source,
                      job_source_id: hiredJob?.sourceId,
                      job_code: hiredJob?.value,
                    })}
                  >
                    Add hired plant
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {board.plant.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No plant planned for this date.</p>
                ) : board.plant.map((row) => (
                  <PlantRow
                    key={`${workDate}:${row.draft.id}`}
                    row={row}
                    teams={board.available_teams}
                    onReassign={async (ownerTeamId) => {
                      await savePlant({
                        id: row.draft.id,
                        plant_kind: row.draft.plant_kind,
                        plant_id: row.draft.plant_id,
                        hired_serial: row.draft.hired_serial,
                        hired_description: row.draft.hired_description,
                        hired_company: row.draft.hired_company,
                        owner_team_id: ownerTeamId,
                        job_source_type: row.draft.job_source_type,
                        job_source_id: row.draft.job_source_id,
                        job_code: row.draft.job_code,
                        notes: row.draft.notes,
                        row_version: row.draft.row_version,
                      });
                    }}
                    onRemove={async () => {
                      const response = await fetch(`/api/daily-allocation/plant?id=${row.draft.id}`, { method: 'DELETE' });
                      const payload = await response.json() as { error?: string };
                      if (!response.ok) throw new Error(payload.error || 'Unable to remove plant.');
                      await loadBoard(workDate);
                    }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish allocation for {workDate}?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates an immutable revision and sends a low-priority in-app message to each employee in scope. Later edits stay in draft until you publish again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {publishFailed ? (
              <Button variant="outline" onClick={() => void refreshForNewPublishAttempt()} disabled={publishing}>
                Refresh and start new attempt
              </Button>
            ) : null}
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void publish();
              }}
              disabled={publishing}
            >
              {publishing ? 'Publishing…' : publishFailed ? 'Retry publish' : 'Publish'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPageShell>
  );
}

function LabourRow({
  row,
  disabled,
  onJobSelect,
  onInstructionChange,
  onClear,
}: {
  row: DailyLabourBoardRow;
  disabled: boolean;
  onJobSelect: (option: JobCatalogueOption | null) => void;
  onInstructionChange: (field: 'start_time' | 'meeting_point' | 'meet_person' | 'notes', value: string) => void;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">{row.full_name}</h3>
            <p className="text-sm text-muted-foreground">{[row.employee_id, row.team_name].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {row.availability !== 'available' ? (
              <Badge variant="secondary">{row.blocking_absence?.reason_name || row.availability.replaceAll('_', ' ')}</Badge>
            ) : null}
            {row.pending_absence ? <Badge variant="outline">Pending absence</Badge> : null}
            {row.publish_ready ? <Badge>Ready</Badge> : <Badge variant="secondary">Incomplete</Badge>}
          </div>
        </div>
        {row.warnings.map((warning) => (
          <p key={warning} className="text-sm text-amber-600">{warning}</p>
        ))}
        {row.availability !== 'full_day_absence' ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>Job code</Label>
              <JobCataloguePicker
                value={row.draft?.job_code || null}
                sourceId={row.draft?.job_source_id}
                disabled={disabled}
                onSelect={onJobSelect}
              />
              <p className="text-sm text-muted-foreground">
                Site: {row.draft?.site_address || 'Derived from the selected job'}
              </p>
              {row.draft ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Clear allocation for ${row.full_name}`}
                  onClick={onClear}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear allocation
                </Button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Start time</Label>
                <Input
                  defaultValue={row.draft?.instructions.start_time || ''}
                  disabled={disabled}
                  onBlur={(event) => onInstructionChange('start_time', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Meeting point</Label>
                <Input
                  defaultValue={row.draft?.instructions.meeting_point || ''}
                  disabled={disabled}
                  onBlur={(event) => onInstructionChange('meeting_point', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Meet</Label>
                <Input
                  defaultValue={row.draft?.instructions.meet_person || ''}
                  disabled={disabled}
                  onBlur={(event) => onInstructionChange('meet_person', event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  defaultValue={row.draft?.instructions.notes || ''}
                  disabled={disabled}
                  onBlur={(event) => onInstructionChange('notes', event.target.value)}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Approved leave replaces work for this date.</p>
        )}
      </CardContent>
    </Card>
  );
}

function PlantRow({
  row,
  teams,
  onReassign,
  onRemove,
}: {
  row: DailyPlantBoardRow;
  teams: Array<{ id: string; name: string }>;
  onReassign: (ownerTeamId: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [ownerTeamId, setOwnerTeamId] = useState(row.draft.owner_team_id || '');

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{row.plant_label}</p>
        <p className="text-sm text-muted-foreground">
          {row.draft.job_code} · {row.draft.site_address}
        </p>
        {row.warnings.map((warning) => (
          <p key={warning} className="text-sm text-amber-600">{warning}</p>
        ))}
        {row.owned_by_other_team && !row.can_reassign ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Owned by another team</Badge>
            <Button type="button" variant="outline" size="sm" disabled>
              Admin only
            </Button>
            <span className="text-xs text-muted-foreground">
              Level 5 access is required to reassign this plant.
            </span>
          </div>
        ) : null}
        {row.can_reassign ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.owned_by_other_team ? <Badge variant="outline">Owned by another team</Badge> : null}
            <Label htmlFor={`owner-team-${row.draft.id}`} className="text-xs">Ownership team</Label>
            <select
              id={`owner-team-${row.draft.id}`}
              className="flex h-9 min-w-40 rounded-md border border-input bg-background px-3 text-sm"
              value={ownerTeamId}
              onChange={(event) => setOwnerTeamId(event.target.value)}
            >
              <option value="">Select team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!ownerTeamId || ownerTeamId === row.draft.owner_team_id}
              onClick={() => {
                void onReassign(ownerTeamId).catch((error: unknown) => {
                  toast.error(error instanceof Error ? error.message : 'Unable to transfer plant ownership.');
                });
              }}
            >
              Transfer ownership
            </Button>
          </div>
        ) : null}
      </div>
      {!row.owned_by_other_team || row.can_reassign ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void onRemove().catch((error: unknown) => {
              toast.error(error instanceof Error ? error.message : 'Unable to remove plant.');
            });
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Remove
        </Button>
      ) : null}
    </div>
  );
}
